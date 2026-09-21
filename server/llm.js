import { buildMessages, buildDemoResult } from "./prompts.js";
import { listProviderRowsForScene, listAllEnabledProviderRows, getLLMProviderRow, listEnabledProviders } from "./db.js";

const SCENE_LABELS = { fast: "快诊", clinic: "门诊", emergency: "急诊", wellness: "保健", maternal: "妇幼" };
/* 就诊通道 → 路由场景：妇幼恒定 maternal；中医复用保健组；眼科/口腔复用门诊组 */
const LEVEL_SCENES = { L1: "fast", L2: "clinic", L3: "emergency", L4: "wellness", L5: "maternal", L6: "wellness", L7: "clinic", L8: "clinic", L9: "clinic" };
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 120000);

/* 按就诊通道 + 疑难特征选择路由场景：妇幼通道恒定路由到妇幼垂直模型组 */
export function resolveScene(level, formData) {
  const fd = formData || {};
  const str = (v) => String(v || "").trim();

  // 妇幼通道：用户主动选择，恒定路由到妇幼垂直模型组（孕产妇/儿童语义安全护栏）
  if (level === "L5") return "maternal";

  // 疑难升级：多病叠加、罕见疑难病史，即便从门诊/保健进入也升级到急诊通道做高规格推理
  const multi = str(fd.multi_disease);
  const rare = str(fd.rare_disease_history);
  if (/^是/.test(multi)) return "emergency";
  if (rare && rare !== "无" && !/无|不适用/.test(rare.slice(0, 3))) return "emergency";

  // 默认按首页就诊通道 TAB 路由
  return LEVEL_SCENES[level] || "clinic";
}

function getConfigFromRow(row) {
  if (!row || !row.api_key || !row.base_url) return null;
  return {
    id: row.id,
    apiKey: row.api_key,
    baseUrl: String(row.base_url || "").replace(/\/+$/, ""),
    model: row.model,
    providerName: row.name,
  };
}

export function getLLMStatus() {
  const enabled = listEnabledProviders();
  const sceneModels = Object.entries(SCENE_LABELS).map(([scene, label]) => {
    const chain = enabled.filter((p) => p.scenes.split(",").includes(scene));
    const primary = chain[0];
    return {
      scene,
      label,
      configured: chain.length > 0,
      primary: primary ? `${primary.name} · ${primary.model}` : "",
      backups: Math.max(0, chain.length - 1),
    };
  });
  const anyEnabled = enabled.length > 0;
  return {
    configured: anyEnabled,
    model: anyEnabled ? `${enabled[0].name} · ${enabled[0].model}` : "-",
    provider: anyEnabled ? enabled[0].name : "",
    demoMode: !anyEnabled,
    scene_models: sceneModels,
  };
}

function extractJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* 继续尝试从代码块/冗余文本中提取 */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      return null;
    }
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeResult(raw, fallback) {
  if (!raw || typeof raw !== "object") return fallback;
  const ensureArr = (v) => (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? [v] : []);
  const pick = (v, d) => (v === undefined || v === null || v === "" ? d : v);

  return {
    demo: false,
    key_findings: pick(raw.key_findings, fallback.key_findings),
    risk_level: pick(raw.risk_level, fallback.risk_level),
    risk_reason: pick(raw.risk_reason, fallback.risk_reason),
    red_flags: ensureArr(raw.red_flags),
    differential: ensureArr(raw.differential),
    uncertainties: ensureArr(raw.uncertainties),
    recommended_exams: ensureArr(raw.recommended_exams),
    plan: pick(raw.plan, fallback.plan),
    confidence: typeof raw.confidence === "number" ? raw.confidence : fallback.confidence,
  };
}

/* 单模型调用：成功返回标准化结果，失败抛错（由调用方决定是否切换备用） */
async function callProvider(config, messages, fallback) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const err = new Error(`[${config.providerName}] LLM API ${res.status}: ${errText.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(content);
    const result = normalizeResult(parsed, fallback);
    result.provider = config.providerName;
    result.model = config.model;
    return result;
  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error(`[${config.providerName}] LLM 请求超时`);
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* 场景路由 + 主备链式调用：同场景内按优先级依次尝试，主模型失败自动切换备用 */
export async function callLLM({ level, formData, ragContext }) {
  const scene = resolveScene(level, formData);
  let chain = listProviderRowsForScene(scene).map(getConfigFromRow).filter(Boolean);
  let degraded = false;
  if (!chain.length) {
    chain = listAllEnabledProviderRows().map(getConfigFromRow).filter(Boolean);
    degraded = chain.length > 0;
  }

  if (!chain.length) {
    const anyEnabled = listEnabledProviders().length > 0;
    if (!anyEnabled) return buildDemoResult(level, formData);
    throw new Error(`「${SCENE_LABELS[scene]}」通道下没有启用的模型，请在后台为该通道启用并配置模型`);
  }

  const messages = buildMessages({ level, formData, ragContext });
  const fallback = buildDemoResult(level, formData);
  const errors = [];
  for (let i = 0; i < chain.length; i++) {
    try {
      const result = await callProvider(chain[i], messages, fallback);
      result.route = { scene, scene_label: SCENE_LABELS[scene], primary: chain[0].providerName, used: chain[i].providerName, fallback_used: i > 0, degraded };
      return result;
    } catch (err) {
      errors.push(err.message);
      console.error(`[ai-hospital] 模型调用失败（${chain[i].providerName}）:`, err.message);
    }
  }
  const e = new Error(`所有已启用模型均调用失败：${errors.join("；")}`);
  e.status = 502;
  throw e;
}

/* 指定模型调用（前台"换模型对比分析"用）：单模型，失败直接抛错 */
export async function callLLMWithProvider(providerId, { level, formData, ragContext }) {
  const row = getLLMProviderRow(Number(providerId));
  const config = getConfigFromRow(row);
  if (!config) throw new Error("该模型未启用或未配置 Key/地址");
  const messages = buildMessages({ level, formData, ragContext });
  const result = await callProvider(config, messages, buildDemoResult(level, formData));
  result.route = { scene: resolveScene(level, formData), used: config.providerName, fallback_used: false, manual: true };
  return result;
}

/* 用指定配置发送最小请求，验证 API Key 与连通性 */
export async function testProvider({ base_url, model, api_key }) {
  const baseUrl = String(base_url || "").replace(/\/+$/, "");
  if (!api_key) throw new Error("该配置尚未填入 API Key");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${api_key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 5 }),
      signal: controller.signal,
    });
    const latency = Date.now() - started;
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      let hint = `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) hint += "，API Key 无效或无权限";
      else if (res.status === 404) hint += "，请检查 API 地址与模型名称";
      else if (res.status === 429) hint += "，调用频率或额度受限";
      return { ok: false, message: `${hint}：${errText.slice(0, 200)}` };
    }
    return { ok: true, message: `连接成功（${latency}ms）` };
  } catch (err) {
    if (err.name === "AbortError") return { ok: false, message: "连接超时（30s），请检查网络与 API 地址" };
    return { ok: false, message: `连接失败：${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}
