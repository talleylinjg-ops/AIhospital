import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "consultations.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS consultations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    risk_level TEXT,
    chief_complaint TEXT,
    name TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    form_data TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    note TEXT DEFAULT '',
    password_hash TEXT DEFAULT '',
    balance REAL NOT NULL DEFAULT 0,
    profile TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS wallet_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    balance_after REAL NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    ref_type TEXT DEFAULT '',
    ref_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    unit TEXT DEFAULT '次',
    description TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 10,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    service_id INTEGER,
    service_name TEXT NOT NULL,
    unit_price REAL NOT NULL DEFAULT 0,
    qty INTEGER NOT NULL DEFAULT 1,
    amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT '已付款',
    note TEXT DEFAULT '',
    source TEXT NOT NULL DEFAULT '后台登记',
    out_trade_no TEXT DEFAULT '',
    pay_channel TEXT DEFAULT '',
    pay_qr TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS llm_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL,
    api_key TEXT DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT '国内通用',
    note TEXT NOT NULL DEFAULT '',
    scenes TEXT NOT NULL DEFAULT 'clinic',
    priority INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT '其他',
    label TEXT NOT NULL DEFAULT '',
    mime TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    stored TEXT NOT NULL DEFAULT '',
    consult_id INTEGER DEFAULT NULL,
    purchase_id INTEGER DEFAULT NULL,
    customer_id INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS recharge_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    channel TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT '待支付',
    out_trade_no TEXT NOT NULL,
    trade_no TEXT DEFAULT '',
    qr TEXT DEFAULT '',
    paid_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_recharge_out_trade ON recharge_orders(out_trade_no);
  `);

  // 兼容旧库：先补齐新增列，再建索引
  const cols = new Set(db.prepare("PRAGMA table_info(consultations)").all().map((c) => c.name));
  if (!cols.has("name")) db.exec("ALTER TABLE consultations ADD COLUMN name TEXT DEFAULT ''");
  if (!cols.has("phone")) db.exec("ALTER TABLE consultations ADD COLUMN phone TEXT DEFAULT ''");
  if (!cols.has("customer_id")) db.exec("ALTER TABLE consultations ADD COLUMN customer_id INTEGER");
  const pCols = new Set(db.prepare("PRAGMA table_info(purchases)").all().map((c) => c.name));
  if (!pCols.has("source")) db.exec("ALTER TABLE purchases ADD COLUMN source TEXT NOT NULL DEFAULT '后台登记'");
  if (!pCols.has("out_trade_no")) db.exec("ALTER TABLE purchases ADD COLUMN out_trade_no TEXT DEFAULT ''");
  if (!pCols.has("pay_channel")) db.exec("ALTER TABLE purchases ADD COLUMN pay_channel TEXT DEFAULT ''");
  if (!pCols.has("pay_qr")) db.exec("ALTER TABLE purchases ADD COLUMN pay_qr TEXT DEFAULT ''");
  const cuCols = new Set(db.prepare("PRAGMA table_info(customers)").all().map((c) => c.name));
  if (!cuCols.has("password_hash")) db.exec("ALTER TABLE customers ADD COLUMN password_hash TEXT DEFAULT ''");
  if (!cuCols.has("balance")) db.exec("ALTER TABLE customers ADD COLUMN balance REAL NOT NULL DEFAULT 0");
  if (!cuCols.has("profile")) db.exec("ALTER TABLE customers ADD COLUMN profile TEXT DEFAULT '{}'");
  const sCols = new Set(db.prepare("PRAGMA table_info(services)").all().map((c) => c.name));
  if (!sCols.has("sort_order")) db.exec("ALTER TABLE services ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 10");
  if (!sCols.has("needs_doc")) db.exec("ALTER TABLE services ADD COLUMN needs_doc INTEGER NOT NULL DEFAULT 0");
  const lCols = new Set(db.prepare("PRAGMA table_info(llm_providers)").all().map((c) => c.name));
  if (!lCols.has("category")) db.exec("ALTER TABLE llm_providers ADD COLUMN category TEXT NOT NULL DEFAULT '国内通用'");
  if (!lCols.has("note")) db.exec("ALTER TABLE llm_providers ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  if (!lCols.has("scenes")) db.exec("ALTER TABLE llm_providers ADD COLUMN scenes TEXT NOT NULL DEFAULT 'clinic'");
  if (!lCols.has("priority")) db.exec("ALTER TABLE llm_providers ADD COLUMN priority INTEGER NOT NULL DEFAULT 100");

  db.exec(`
  CREATE INDEX IF NOT EXISTS idx_consult_level ON consultations(level);
  CREATE INDEX IF NOT EXISTS idx_consult_risk ON consultations(risk_level);
  CREATE INDEX IF NOT EXISTS idx_consult_created ON consultations(created_at);
  CREATE INDEX IF NOT EXISTS idx_consult_phone ON consultations(phone);
  CREATE INDEX IF NOT EXISTS idx_consult_customer ON consultations(customer_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE phone <> '';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_out_trade ON purchases(out_trade_no) WHERE out_trade_no <> '';
  `);

  // 旧数据迁移：customers 表为空时，从历史问诊记录聚合建档并回填关联
  const hasCustomers = db.prepare("SELECT COUNT(*) AS n FROM customers").get().n > 0;
  if (!hasCustomers) {
    const grouped = db.prepare(`
      SELECT CASE WHEN trim(phone) <> '' THEN trim(phone) ELSE '' END AS phone,
             CASE WHEN trim(phone) <> '' THEN '' ELSE trim(name) END AS name_only,
             MAX(trim(name)) AS name, MAX(trim(phone)) AS max_phone, MIN(created_at) AS first_at
      FROM consultations WHERE trim(phone) <> '' OR trim(name) <> ''
      GROUP BY CASE WHEN trim(phone) <> '' THEN 'phone:' || trim(phone) ELSE 'name:' || trim(name) END
    `).all();
    const insertC = db.prepare("INSERT INTO customers (name, phone, created_at) VALUES (?, ?, ?)");
    for (const g of grouped) {
      const id = insertC.run(g.name || "", g.phone || g.max_phone || "", g.first_at).lastInsertRowid;
      if (g.phone) db.prepare("UPDATE consultations SET customer_id = ? WHERE trim(phone) = ?").run(id, g.phone);
      else db.prepare("UPDATE consultations SET customer_id = ? WHERE trim(phone) = '' AND trim(name) = ?").run(id, g.name_only);
    }
  }

  // 会员服务置顶种子（幂等，sort_order=1 置顶于普通服务前）
  const memberSeed = [
    { name: "会员服务 · 基础会员", price: 0, unit: "", description: "注册即享有限免费 AI 问诊与报告额度" },
    { name: "会员服务 · 月付会员", price: 9.9, unit: "月", description: "AI 健康问诊每月给定额流量" },
    { name: "会员服务 · 年付会员", price: 99.9, unit: "年", description: "AI 健康问诊每年给定额流量" },
  ];
  const existsService = db.prepare("SELECT 1 FROM services WHERE name = ?");
  const seedService = db.prepare("INSERT INTO services (name, price, unit, description, active, sort_order) VALUES (?, ?, ?, ?, 1, 1)");
  for (const s of memberSeed) {
    if (!existsService.get(s.name)) seedService.run(s.name, s.price, s.unit, s.description);
  }

  // 需要上传报告/病历材料的服务项目标记（幂等，按名称匹配）
  const docServiceSeed = db.prepare("UPDATE services SET needs_doc = 1 WHERE name = ?");
  for (const n of ["AI 慢病管理月度套餐", "体检报告解读"]) docServiceSeed.run(n);

  // 附件索引
  db.exec(`
  CREATE INDEX IF NOT EXISTS idx_att_consult ON attachments(consult_id);
  CREATE INDEX IF NOT EXISTS idx_att_purchase ON attachments(purchase_id);
  CREATE INDEX IF NOT EXISTS idx_att_customer ON attachments(customer_id);
  `);
}
migrate();

/* ==================== 大模型配置 ==================== */

/* 预置模型库：覆盖国内外通用大模型 + 医疗垂直大模型。
   scenes: 通道路由标签（fast 快诊 / clinic 门诊 / emergency 急诊 / wellness 保健 / maternal 妇幼），逗号分隔
   priority: 同场景内升序为主备顺序（小者优先为主模型） */
const LLM_PRESETS = [
  /* ---- 国内通用 ---- */
  { name: "DeepSeek-R1", base_url: "https://api.deepseek.com/v1", model: "deepseek-reasoner", category: "国内通用", scenes: "clinic,emergency", priority: 8, note: "门诊主推：常见病/慢病/老年共病推理第一梯队，贴合国内指南；同时作为急诊国内兜底" },
  { name: "豆包 Pro（火山方舟）", base_url: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-pro-32k", category: "国内通用", scenes: "fast,wellness", priority: 14, note: "快诊/保健：口语化症状理解强、体检报告解读好；model 需填方舟推理接入点 ID" },
  { name: "通义千问 Max", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-max", category: "国内通用", scenes: "clinic,wellness", priority: 12, note: "保健主推：长文本/健康方案/患者教育文本强；门诊可作备选" },
  { name: "文心一言 X1（千帆）", base_url: "https://qianfan.baidubce.com/v2", model: "ernie-x1-32k-preview", category: "国内通用", scenes: "wellness", priority: 16, note: "保健：中医药知识、公卫宣教；model 名以千帆控制台为准" },
  { name: "月之暗面 Kimi", base_url: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", category: "国内通用", scenes: "clinic,wellness", priority: 24, note: "门诊/保健：长文本处理与中文理解优秀，适合补充阅读" },
  { name: "智谱 GLM", base_url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", category: "国内通用", scenes: "fast", priority: 5, note: "快诊主推：中文医疗对话均衡，glm-4-flash 免费额度高、响应快" },
  /* ---- 海外通用 ---- */
  { name: "OpenAI GPT-o1", base_url: "https://api.openai.com/v1", model: "o1", category: "海外通用", scenes: "emergency", priority: 3, note: "急诊主推：复杂多病共存/罕见病临床推理最强，用药方案必须按国内指南复核" },
  { name: "OpenAI GPT-4o", base_url: "https://api.openai.com/v1", model: "gpt-4o", category: "海外通用", scenes: "clinic,emergency", priority: 20, note: "多模态：化验单/皮肤照片/影像初步解读，门诊/急诊可选" },
  { name: "Claude 3.7 Sonnet", base_url: "https://api.anthropic.com/v1", model: "claude-3-7-sonnet-20250219", category: "海外通用", scenes: "emergency", priority: 6, note: "急诊备选：超长病历/多页报告无损消化，输出稳定幻觉低" },
  { name: "Gemini 2.5 Pro", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-pro", category: "海外通用", scenes: "clinic,wellness", priority: 26, note: "医学多模态强，放射/皮肤/病理影像辅助解读（体检报告）" },
  { name: "OpenRouter", base_url: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", category: "海外通用", scenes: "fast,clinic,emergency,wellness", priority: 40, note: "聚合网关，一个 Key 调多家模型；四通道通用兜底" },
  /* ---- 国内垂直 ---- */
  { name: "讯飞星火医疗（晓医）", base_url: "https://spark-api-open.xf-yun.com/v1", model: "4.0Ultra", category: "国内垂直", scenes: "fast,maternal", priority: 7, note: "妇幼通道主推：孕产妇/儿童健康评估与用药安全语义理解，医疗版需讯飞授权" },
  { name: "百川 Baichuan-M4", base_url: "https://api.baichuan-ai.com/v1", model: "Baichuan-M2-32B", category: "国内垂直", scenes: "maternal,emergency", priority: 30, note: "妇幼备选：肿瘤/儿科专科，低幻觉强循证；医疗版需商务授权" },
  { name: "医联 MedGPT", base_url: "", model: "medgpt", category: "国内垂直", scenes: "wellness", priority: 90, note: "慢病随访/健康管理；无公开 API，需企业合作接入" },
  { name: "智愈 MedSeek（良医汇）", base_url: "", model: "medseek", category: "国内垂直", scenes: "emergency", priority: 90, note: "肿瘤专科循证检索（TNM 分期/化疗方案），面向医生；无公开 API" },
  { name: "小荷 AI 医生", base_url: "", model: "xiaohe", category: "国内垂直", scenes: "clinic", priority: 90, note: "门诊：化验单拍照解读、用药科普；无公开 API" },
  { name: "联影元智", base_url: "", model: "uyuanzhi", category: "国内垂直", scenes: "clinic,emergency", priority: 95, note: "医学影像辅助阅片（CT/核磁），医院端 B 端；无公开 API" },
  /* ---- 海外垂直 ---- */
  { name: "Med-PaLM 2", base_url: "", model: "med-palm-2", category: "海外垂直", scenes: "wellness", priority: 98, note: "体检报告总结/ICD 编码，欧美体系；面向 B 端，无公开 API" },
  { name: "Med-Gemini", base_url: "", model: "med-gemini", category: "海外垂直", scenes: "emergency", priority: 99, note: "医学影像+基因组多模态科研；面向 B 端，无公开 API" },
];

function initLLMProviders() {
  const insert = db.prepare("INSERT INTO llm_providers (name, base_url, model, api_key, enabled, category, note, scenes, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  // 旧库一次性迁移：旧 DeepSeek 预置（未填 Key）更名为 DeepSeek-R1 并指向推理模型
  db.prepare("UPDATE llm_providers SET name = 'DeepSeek-R1', model = 'deepseek-reasoner', category = '国内通用', scenes = 'clinic,emergency', priority = 8, note = ? WHERE name = 'DeepSeek' AND api_key = ''").run(
    LLM_PRESETS.find((p) => p.name === "DeepSeek-R1").note
  );
  // 旧库分类修正：海外网关与 OpenAI 归入海外通用
  db.prepare("UPDATE llm_providers SET category = '海外通用' WHERE name IN ('OpenAI', 'OpenRouter') AND category = '国内通用'").run();
  // 幂等补种：老库也自动获得全部新预置
  const existing = new Set(db.prepare("SELECT name FROM llm_providers").all().map((r) => r.name));
  const envKey = String(process.env.USER_LLM_API_KEY || "").trim();
  const hasRealEnvKey = Boolean(envKey) && envKey !== "your-api-key-here";
  for (const p of LLM_PRESETS) {
    if (existing.has(p.name)) continue;
    const isDeepSeek = p.name === "DeepSeek-R1";
    insert.run(p.name, p.base_url, p.model, isDeepSeek && hasRealEnvKey ? envKey : "", 0, p.category, p.note, p.scenes, p.priority);
  }
  // 旧词汇迁移（general/complex -> 新通道路由）：仅对非预置用户自定义行，把旧标签翻译成新通道标签
  const presetNames = new Set(LLM_PRESETS.map((p) => p.name));
  const legacyRows = db.prepare("SELECT id, name, scenes FROM llm_providers WHERE scenes LIKE '%general%' OR scenes LIKE '%complex%'").all();
  const migrateLegacy = db.prepare("UPDATE llm_providers SET scenes = ? WHERE id = ?");
  for (const r of legacyRows) {
    if (presetNames.has(r.name)) continue;
    const out = [];
    for (const s of String(r.scenes || "").split(",")) {
      const t = s.trim();
      if (t === "general") out.push("fast", "clinic", "wellness");
      else if (t === "complex") out.push("emergency");
      else if (t === "maternal") out.push("maternal");
    }
    if (out.length) migrateLegacy.run([...new Set(out)].join(","), r.id);
  }
  // 预置行同步：已存在的预置行若仍用旧场景词汇或未自定义优先级，同步最新预置元数据，避免路由错乱
  const syncMetaStmt = db.prepare("UPDATE llm_providers SET scenes = ?, priority = ? WHERE name = ? AND (priority = 100 OR scenes LIKE '%general%' OR scenes LIKE '%complex%')");
  for (const p of LLM_PRESETS) syncMetaStmt.run(p.scenes, p.priority, p.name);
  // 兜底：无任何启用配置时，默认启用 DeepSeek-R1（填入 Key 后即可推理）
  const anyEnabled = db.prepare("SELECT COUNT(*) AS n FROM llm_providers WHERE enabled = 1").get().n;
  if (!anyEnabled) {
    db.prepare("UPDATE llm_providers SET enabled = 1 WHERE name = 'DeepSeek-R1' AND api_key = ''").run();
  }
}
initLLMProviders();

const listProvidersStmt = db.prepare("SELECT * FROM llm_providers ORDER BY enabled DESC, id ASC");
const providerStmt = db.prepare("SELECT * FROM llm_providers WHERE id = ?");
const insertProviderStmt = db.prepare("INSERT INTO llm_providers (name, base_url, model, api_key, enabled, category, note, scenes, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
const updateProviderStmt = db.prepare("UPDATE llm_providers SET name = ?, base_url = ?, model = ?, api_key = ?, category = ?, note = ?, scenes = ?, priority = ? WHERE id = ?");
const deleteProviderStmt = db.prepare("DELETE FROM llm_providers WHERE id = ?");
const countProvidersStmt = db.prepare("SELECT COUNT(*) AS n FROM llm_providers");

function maskKey(key) {
  const k = String(key || "");
  if (!k) return "";
  if (k.length <= 8) return k.slice(0, 2) + "****";
  return k.slice(0, 5) + "****" + k.slice(-4);
}

const PROVIDER_CATEGORIES = ["国内通用", "海外通用", "国内垂直", "海外垂直"];
const PROVIDER_SCENES = ["fast", "clinic", "emergency", "wellness", "maternal"];
const SCENE_LABELS = { fast: "快诊", clinic: "门诊", emergency: "急诊", wellness: "保健", maternal: "妇幼" };

function normalizeScenes(input, fallback = "clinic") {
  const parts = String(input || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => PROVIDER_SCENES.includes(s));
  return parts.length ? [...new Set(parts)].join(",") : fallback;
}

function toPublicProvider(row) {
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    model: row.model,
    enabled: row.enabled,
    category: PROVIDER_CATEGORIES.includes(row.category) ? row.category : "国内通用",
    note: row.note || "",
    scenes: normalizeScenes(row.scenes),
    scene_labels: normalizeScenes(row.scenes).split(",").map((s) => SCENE_LABELS[s] || s),
    priority: Number(row.priority) || 100,
    has_key: Boolean(row.api_key),
    key_masked: maskKey(row.api_key),
  };
}

export function listLLMProviders() {
  return listProvidersStmt.all().map(toPublicProvider);
}
export function getLLMProviderRow(id) {
  return providerStmt.get(Number(id)) || null;
}
export function createLLMProvider({ name, base_url, model, api_key, enabled, category, note, scenes, priority } = {}) {
  const n = String(name || "").trim();
  if (!n) throw new Error("配置名称不能为空");
  const url = String(base_url || "").trim().replace(/\/+$/, "");
  if (url && !/^https?:\/\//.test(url)) throw new Error("API 地址需以 http(s):// 开头");
  const m = String(model || "").trim();
  if (!m) throw new Error("模型名称不能为空");
  const cat = PROVIDER_CATEGORIES.includes(category) ? category : "国内通用";
  const prio = Math.max(1, Math.min(999, Number(priority) || 100));
  return Number(insertProviderStmt.run(n, url, m, String(api_key || "").trim(), enabled ? 1 : 0, cat, String(note || "").trim(), normalizeScenes(scenes), prio).lastInsertRowid);
}
export function updateLLMProvider(id, data = {}) {
  const cur = getLLMProviderRow(id);
  if (!cur) throw new Error("配置不存在");
  const n = String(data.name ?? cur.name).trim();
  if (!n) throw new Error("配置名称不能为空");
  const url = String(data.base_url ?? cur.base_url).trim().replace(/\/+$/, "");
  if (url && !/^https?:\/\//.test(url)) throw new Error("API 地址需以 http(s):// 开头");
  const m = String(data.model ?? cur.model).trim();
  if (!m) throw new Error("模型名称不能为空");
  const cat = PROVIDER_CATEGORIES.includes(data.category) ? data.category : PROVIDER_CATEGORIES.includes(cur.category) ? cur.category : "国内通用";
  const key = String(data.api_key ?? "").trim();
  const note = String(data.note ?? cur.note).trim();
  const scenes = data.scenes === undefined ? normalizeScenes(cur.scenes) : normalizeScenes(data.scenes);
  const prio = data.priority === undefined ? Number(cur.priority) || 100 : Math.max(1, Math.min(999, Number(data.priority) || 100));
  updateProviderStmt.run(n, url, m, key || cur.api_key, cat, note, scenes, prio, Number(id));
  return toPublicProvider(getLLMProviderRow(id));
}
export function removeLLMProvider(id) {
  const cur = getLLMProviderRow(id);
  if (!cur) throw new Error("配置不存在");
  deleteProviderStmt.run(Number(id));
  return providersCount() === 0;
}
/* 多模型共存：toggle 启用/停用，互斥逻辑已移除 */
export function toggleLLMProvider(id, enabled) {
  const cur = getLLMProviderRow(id);
  if (!cur) throw new Error("配置不存在");
  if (enabled && !cur.api_key) throw new Error("请先编辑该配置并填入 API Key");
  db.prepare("UPDATE llm_providers SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, Number(id));
  return toPublicProvider(getLLMProviderRow(id));
}
export function enableLLMProvider(id) {
  return toggleLLMProvider(id, true);
}
/* 场景路由查询：该场景下启用且有 Key 的配置，按优先级升序（主 → 备）；返回含 api_key 的原始行供 LLM 调用层使用 */
export function listProviderRowsForScene(scene) {
  const s = PROVIDER_SCENES.includes(scene) ? scene : "clinic";
  return db
    .prepare("SELECT * FROM llm_providers WHERE enabled = 1 AND api_key <> '' AND base_url <> '' AND (',' || scenes || ',') LIKE ? ORDER BY priority ASC, id ASC")
    .all(`%,${s},%`);
}
export function listProvidersForScene(scene) {
  return listProviderRowsForScene(scene).map(toPublicProvider);
}
/* 跨通道兜底：所有已启用且有 Key 的配置（供某通道无专属模型时降级使用） */
export function listAllEnabledProviderRows() {
  return db.prepare("SELECT * FROM llm_providers WHERE enabled = 1 AND api_key <> '' AND base_url <> '' ORDER BY priority ASC, id ASC").all();
}
export function listEnabledProviders() {
  return db.prepare("SELECT * FROM llm_providers WHERE enabled = 1 AND api_key <> '' AND base_url <> '' ORDER BY priority ASC, id ASC").all().map(toPublicProvider);
}
export function providersCount() {
  return countProvidersStmt.get().n;
}

/* ==================== 管理员账号 ==================== */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const origin = Buffer.from(hash, "hex");
  return test.length === origin.length && crypto.timingSafeEqual(test, origin);
}

function initAdminUsers() {
  const n = db.prepare("SELECT COUNT(*) AS n FROM admin_users").get().n;
  if (n === 0) {
    const username = String(process.env.ADMIN_USERNAME || "admin").trim() || "admin";
    const password = process.env.ADMIN_PASSWORD || "admin123456";
    db.prepare("INSERT INTO admin_users (username, password_hash) VALUES (?, ?)").run(username, hashPassword(password));
    console.log(`[ai-hospital] 已创建默认管理员账号: ${username}`);
  }
}
initAdminUsers();

const findUserStmt = db.prepare("SELECT * FROM admin_users WHERE username = ?");
const getUserStmt = db.prepare("SELECT id, username, created_at FROM admin_users WHERE id = ?");

export function findUser(username) {
  return findUserStmt.get(String(username || "").trim());
}
export function getUser(id) {
  return getUserStmt.get(id);
}
export function checkUserPassword(username, password) {
  const user = findUser(username);
  if (!user) return null;
  if (!verifyPassword(String(password || ""), user.password_hash)) return null;
  return user;
}
export function updateUserAccount(userId, { username, newPassword }) {
  const user = getUserStmt.get(userId);
  if (!user) throw new Error("账号不存在");
  if (username !== undefined && username !== user.username) {
    const name = String(username).trim();
    if (name.length < 2 || name.length > 30) throw new Error("账号长度需在 2-30 个字符");
    const exists = findUserStmt.get(name);
    if (exists) throw new Error("该账号已被使用");
    db.prepare("UPDATE admin_users SET username = ? WHERE id = ?").run(name, userId);
  }
  if (newPassword) {
    const pw = String(newPassword);
    if (pw.length < 6) throw new Error("新密码至少 6 位");
    db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").run(hashPassword(pw), userId);
  }
  return getUserStmt.get(userId);
}

/* ==================== 会员（客户） ==================== */

const customerByPhoneStmt = db.prepare("SELECT id FROM customers WHERE phone = ? AND phone <> ''");
const customerByNameStmt = db.prepare("SELECT id FROM customers WHERE name = ? AND name <> '' AND (phone = '' OR phone IS NULL)");
const insertCustomerStmt = db.prepare("INSERT INTO customers (name, phone) VALUES (?, ?)");

export function ensureCustomer(name, phone) {
  const n = String(name || "").trim();
  const p = String(phone || "").trim();
  if (!n && !p) return null;
  if (p) {
    const byPhone = customerByPhoneStmt.get(p);
    if (byPhone) return byPhone.id;
  }
  if (n && !p) {
    const byName = customerByNameStmt.get(n);
    if (byName) return byName.id;
  }
  return Number(insertCustomerStmt.run(n, p).lastInsertRowid);
}

const listCustomersStmt = db.prepare(`
SELECT c.id, c.name, c.phone, c.note, c.balance, c.profile, c.created_at, c.updated_at,
  (c.password_hash <> '') AS is_member,
  (SELECT COUNT(*) FROM consultations cs WHERE cs.customer_id = c.id) AS consult_count,
  (SELECT MIN(created_at) FROM consultations cs WHERE cs.customer_id = c.id) AS first_at,
  (SELECT MAX(created_at) FROM consultations cs WHERE cs.customer_id = c.id) AS last_at,
  (SELECT COUNT(*) FROM consultations cs WHERE cs.customer_id = c.id AND cs.risk_level = '立即急诊') AS high_risk_count,
  (SELECT COUNT(*) FROM purchases p WHERE p.customer_id = c.id) AS purchase_count,
  (SELECT IFNULL(SUM(amount), 0) FROM purchases p WHERE p.customer_id = c.id AND p.status = '已付款') AS paid_total,
  (SELECT IFNULL(SUM(amount), 0) FROM purchases p WHERE p.customer_id = c.id) AS amount_total
FROM customers c
WHERE (@kw IS NULL OR c.phone LIKE @kw OR c.name LIKE @kw OR c.note LIKE @kw)
ORDER BY (SELECT MAX(created_at) FROM consultations cs WHERE cs.customer_id = c.id) DESC, c.id DESC
LIMIT @limit OFFSET @offset
`);

const listCustomersCountStmt = db.prepare(
  "SELECT COUNT(*) AS total FROM customers WHERE (@kw IS NULL OR phone LIKE @kw OR name LIKE @kw OR note LIKE @kw)"
);

const customerStmt = db.prepare("SELECT id, name, phone, note, balance, profile, created_at, updated_at FROM customers WHERE id = ?");
/* 仅供密码校验/登录使用，含敏感列，禁止出现在对外 JSON */
const customerAuthStmt = db.prepare("SELECT * FROM customers WHERE id = ?");
const updateCustomerStmt = db.prepare("UPDATE customers SET name = ?, phone = ?, note = ?, updated_at = datetime('now','localtime') WHERE id = ?");
const deleteCustomerStmt = db.prepare("DELETE FROM customers WHERE id = ?");
const countCustomersStmt = db.prepare("SELECT COUNT(*) AS n FROM customers");

export function listCustomers({ page = 1, pageSize = 20, keyword = "" } = {}) {
  const kw = keyword ? `%${keyword}%` : null;
  const offset = (Math.max(1, page) - 1) * pageSize;
  return {
    total: listCustomersCountStmt.get({ kw }).total,
    page: Math.max(1, page),
    pageSize,
    records: listCustomersStmt.all({ kw, limit: pageSize, offset }),
  };
}

export function getCustomer(id) {
  return customerStmt.get(Number(id)) || null;
}

export function createCustomer({ name, phone, note } = {}) {
  const n = String(name || "").trim();
  const p = String(phone || "").trim();
  if (!n && !p) throw new Error("称呼和手机号至少填一项");
  if (p) {
    const dup = customerByPhoneStmt.get(p);
    if (dup) throw new Error("该手机号已存在会员档案");
  }
  const id = Number(insertCustomerStmt.run(n, p).lastInsertRowid);
  if (note) updateCustomerStmt.run(n, p, String(note).slice(0, 500), id);
  return id;
}

export function updateCustomer(id, { name, phone, note }) {
  const cur = getCustomer(id);
  if (!cur) throw new Error("客户不存在");
  const n = String(name ?? cur.name).trim();
  const p = String(phone ?? cur.phone).trim();
  if (p) {
    const dup = customerByPhoneStmt.get(p);
    if (dup && dup.id !== Number(id)) throw new Error("该手机号已属于其他客户");
  }
  updateCustomerStmt.run(n, p, String(note ?? cur.note).slice(0, 500), Number(id));
  return getCustomer(id);
}

export function removeCustomer(id) {
  const cur = getCustomer(id);
  if (!cur) throw new Error("客户不存在");
  deleteCustomerStmt.run(Number(id));
  db.prepare("UPDATE consultations SET customer_id = NULL WHERE customer_id = ?").run(Number(id));
}

export function customersCount() {
  return countCustomersStmt.get().n;
}

/* ==================== 会员账号 / 钱包 / 健康档案 ==================== */

const ledgerInsertStmt = db.prepare(
  "INSERT INTO wallet_ledger (customer_id, kind, amount, balance_after, title, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
const memberLedgerStmt = db.prepare(`
SELECT id, kind, amount, balance_after, title, ref_type, created_at
FROM wallet_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT ?
`);
const updateBalanceStmt = db.prepare("UPDATE customers SET balance = ?, updated_at = datetime('now','localtime') WHERE id = ?");
const setMemberPasswordStmt = db.prepare("UPDATE customers SET password_hash = ?, updated_at = datetime('now','localtime') WHERE id = ?");
const renameMemberStmt = db.prepare("UPDATE customers SET name = ? WHERE id = ?");
const memberConsultDetailStmt = db.prepare(`
SELECT id, level, risk_level, chief_complaint, name, phone, customer_id, created_at, form_data, result
FROM consultations WHERE id = ? AND customer_id = ?
`);

export function getMemberAuth(id) {
  return customerAuthStmt.get(Number(id)) || null;
}

export function registerMember({ phone, password, name } = {}) {
  const p = String(phone || "").trim();
  const pw = String(password || "");
  const n = String(name || "").trim().slice(0, 20);
  if (!/^1\d{10}$/.test(p)) throw new Error("请输入 11 位大陆手机号");
  if (pw.length < 6 || pw.length > 64) throw new Error("密码长度需为 6-64 位");
  const exist = customerByPhoneStmt.get(p);
  if (exist) {
    const cur = customerAuthStmt.get(exist.id);
    if (cur && cur.password_hash) throw new Error("该手机号已注册为会员，请直接登录");
    setMemberPasswordStmt.run(hashPassword(pw), exist.id);
    if (n) renameMemberStmt.run(n, exist.id);
    return getCustomer(exist.id);
  }
  const id = Number(insertCustomerStmt.run(n || `会员${p.slice(-4)}`, p).lastInsertRowid);
  setMemberPasswordStmt.run(hashPassword(pw), id);
  return getCustomer(id);
}

export function verifyMemberPassword(id, password) {
  const cur = customerAuthStmt.get(Number(id));
  if (!cur || !cur.password_hash) return false;
  return verifyPassword(String(password || ""), cur.password_hash);
}

export function setMemberPassword(id, newPassword) {
  const pw = String(newPassword || "");
  if (pw.length < 6 || pw.length > 64) throw new Error("密码长度需为 6-64 位");
  setMemberPasswordStmt.run(hashPassword(pw), Number(id));
}

export function findMemberIdByPhone(phone) {
  const r = customerByPhoneStmt.get(String(phone || "").trim());
  return r ? r.id : null;
}

/* 健康档案字段 = 问诊表单中既往/基础类字段（可带入表单预填） */
const HEALTH_KEYS = [
  "gender", "age", "height_weight", "region", "occupation_lifestyle",
  "chronic_history", "past_major_events", "rare_disease_history",
  "current_medications", "recent_medications", "drug_allergies", "food_allergies",
  "family_history", "family_similar", "smoking_alcohol", "daily_habits",
  "female_special", "prior_exams",
];

function parseProfile(row) {
  try {
    return JSON.parse(row?.profile || "{}");
  } catch {
    return {};
  }
}

export function readHealthProfile(id) {
  return parseProfile(getCustomer(Number(id)));
}

export function saveHealthProfile(id, data = {}) {
  const c = getCustomer(Number(id));
  if (!c) throw new Error("客户不存在");
  const base = parseProfile(c);
  for (const k of HEALTH_KEYS) {
    if (k in data) {
      const v = data[k];
      base[k] = Array.isArray(v) ? v.join("、") : String(v ?? "").trim();
    }
  }
  db.prepare("UPDATE customers SET profile = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(JSON.stringify(base), Number(id));
  return base;
}

/* 钱包：充值（实时到账，模拟支付，后续可接真实支付/客服确认） */
export function rechargeBalance(customerId, amountRaw, title = "余额充值") {
  const id = Number(customerId);
  const c = getCustomer(id);
  if (!c) throw new Error("客户不存在");
  const amt = Math.round(Number(amountRaw) * 100) / 100;
  if (!(amt > 0) || amt > 10000) throw new Error("充值金额需在 1-10000 元之间");
  const run = db.transaction(() => {
    const next = Math.round((c.balance + amt) * 100) / 100;
    updateBalanceStmt.run(next, id);
    ledgerInsertStmt.run(id, "充值", amt, next, String(title).slice(0, 50), "", null);
    return next;
  });
  return run();
}

/* 钱包：余额支付服务（免费档直接生成已付款订单，不扣款） */
export function payServiceByBalance(customerId, { serviceId, qty = 1, note = "" } = {}) {
  const id = Number(customerId);
  const c = getCustomer(id);
  if (!c) throw new Error("客户不存在");
  const sid = Number(serviceId);
  const service = getService(sid);
  if (!service || !service.active) throw new Error("服务项目不存在或已停用");
  const q = Math.max(1, Math.min(99, Number(qty) || 1));
  const amount = Math.round(service.price * q * 100) / 100;
  if (amount > 0 && c.balance < amount) {
    throw new Error(`余额不足（当前余额 ¥${c.balance.toFixed(2)}），请先充值或选择客服线下付款`);
  }
  const run = db.transaction(() => {
    const purchaseId = Number(
      insertPurchaseStmt.run(id, sid, service.name, service.price, q, amount, "已付款", String(note || "").slice(0, 300), "余额支付").lastInsertRowid
    );
    let balance = c.balance;
    if (amount > 0) {
      balance = Math.round((c.balance - amount) * 100) / 100;
      updateBalanceStmt.run(balance, id);
      ledgerInsertStmt.run(id, "消费", -amount, balance, `购买：${service.name}`, "purchase", purchaseId);
    }
    return { purchaseId, balance, amount };
  });
  return run();
}

export function walletLedger(customerId, limit = 200) {
  return memberLedgerStmt.all(Number(customerId), Math.min(500, Math.max(1, Number(limit) || 200)));
}

/* ==================== 系统设置（键值，支付配置等） ==================== */

const getSettingStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
const upsertSettingStmt = db.prepare(
  "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
);

export function getSetting(key) {
  const r = getSettingStmt.get(String(key));
  return r ? r.value : "";
}
export function setSetting(key, value) {
  upsertSettingStmt.run(String(key), String(value ?? ""));
}
export function getSettings(keys = []) {
  const out = {};
  for (const k of keys) out[k] = getSetting(k);
  return out;
}

/* ==================== 在线充值订单（支付宝 / 微信） ==================== */

const insertRechargeStmt = db.prepare(
  "INSERT INTO recharge_orders (customer_id, amount, channel, status, out_trade_no, qr) VALUES (?, ?, ?, '待支付', ?, ?)"
);
const rechargeStmt = db.prepare("SELECT * FROM recharge_orders WHERE id = ?");
const rechargeByOutStmt = db.prepare("SELECT * FROM recharge_orders WHERE out_trade_no = ?");
const rechargePaidStmt = db.prepare(
  "UPDATE recharge_orders SET status = '已付款', trade_no = ?, paid_at = datetime('now','localtime') WHERE id = ? AND status <> '已付款'"
);
const listRechargeStmt = db.prepare(
  "SELECT r.*, c.name AS customer_name, c.phone AS customer_phone FROM recharge_orders r LEFT JOIN customers c ON c.id = r.customer_id WHERE (@status IS NULL OR r.status = @status) ORDER BY r.id DESC LIMIT 200"
);

export function createRechargeOrder({ customerId, amount, channel, outTradeNo, qr = "" } = {}) {
  const id = Number(customerId);
  const c = getCustomer(id);
  if (!c) throw new Error("客户不存在");
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!(amt > 0) || amt > 10000) throw new Error("充值金额需在 1-10000 元之间");
  return Number(
    insertRechargeStmt.run(id, amt, String(channel || "manual"), String(outTradeNo || ""), String(qr || "")).lastInsertRowid
  );
}
export function getRechargeOrder(id) {
  return rechargeStmt.get(Number(id)) || null;
}
export function getRechargeOrderByOutTradeNo(outTradeNo) {
  return rechargeByOutStmt.get(String(outTradeNo)) || null;
}
export function listRechargeOrders({ status = "" } = {}) {
  return listRechargeStmt.all({ status: status || null });
}

/* 订单到账（幂等）：支付宝/微信回调或后台人工确认共用，入账并记流水 */
export function confirmRechargeOrder(id, tradeNo = "") {
  const row = getRechargeOrder(id);
  if (!row) throw new Error("充值订单不存在");
  if (row.status === "已付款") return { order: row, alreadyPaid: true };
  const run = db.transaction(() => {
    const changed = rechargePaidStmt.run(String(tradeNo || ""), Number(id)).changes;
    if (!changed) return { order: getRechargeOrder(id), alreadyPaid: true };
    const c = getCustomer(row.customer_id);
    const next = Math.round(((c ? c.balance : 0) + row.amount) * 100) / 100;
    updateBalanceStmt.run(next, row.customer_id);
    const title = row.channel === "alipay" ? "支付宝充值" : row.channel === "wechat" ? "微信充值" : "在线充值（确认到账）";
    ledgerInsertStmt.run(row.customer_id, "充值", row.amount, next, title, "recharge", row.id);
    return { order: getRechargeOrder(id), balance: next, alreadyPaid: false };
  });
  return run();
}

export function getMemberConsults(customerId) {
  return customerConsultsStmt.all(Number(customerId));
}

export function getMemberConsult(customerId, consultId) {
  const r = memberConsultDetailStmt.get(Number(consultId), Number(customerId));
  if (!r) return null;
  return { ...r, form_data: JSON.parse(r.form_data || "{}"), result: JSON.parse(r.result || "{}") };
}

/* ==================== 问诊记录 ==================== */

const insertStmt = db.prepare(`
INSERT INTO consultations (level, risk_level, chief_complaint, name, phone, customer_id, form_data, result)
VALUES (@level, @risk_level, @chief_complaint, @name, @phone, @customer_id, @form_data, @result)
`);

const countStmt = db.prepare(`SELECT COUNT(*) AS total FROM consultations`);
const getStmt = db.prepare(`SELECT * FROM consultations WHERE id = @id`);

const listStmt = db.prepare(`
SELECT id, level, risk_level, chief_complaint, name, phone, created_at
FROM consultations
ORDER BY id DESC
LIMIT @limit OFFSET @offset
`);

const listFilteredStmt = db.prepare(`
SELECT id, level, risk_level, chief_complaint, name, phone, created_at
FROM consultations
WHERE (@level IS NULL OR level = @level)
  AND (@risk IS NULL OR risk_level = @risk)
ORDER BY id DESC
LIMIT @limit OFFSET @offset
`);

const countFilteredStmt = db.prepare(`
SELECT COUNT(*) AS total
FROM consultations
WHERE (@level IS NULL OR level = @level)
  AND (@risk IS NULL OR risk_level = @risk)
`);

const listSearchStmt = db.prepare(`
SELECT id, level, risk_level, chief_complaint, name, phone, created_at
FROM consultations
WHERE (@level IS NULL OR level = @level)
  AND (@risk IS NULL OR risk_level = @risk)
  AND (@kw IS NULL OR phone LIKE @kw OR name LIKE @kw OR chief_complaint LIKE @kw)
ORDER BY id DESC
LIMIT @limit OFFSET @offset
`);

const countSearchStmt = db.prepare(`
SELECT COUNT(*) AS total
FROM consultations
WHERE (@level IS NULL OR level = @level)
  AND (@risk IS NULL OR risk_level = @risk)
  AND (@kw IS NULL OR phone LIKE @kw OR name LIKE @kw OR chief_complaint LIKE @kw)
`);

const exportStmt = db.prepare(`
SELECT id, level, risk_level, chief_complaint, name, phone, created_at, form_data, result
FROM consultations
ORDER BY id DESC
`);

const customerConsultsStmt = db.prepare(`
SELECT id, level, risk_level, chief_complaint, name, phone, created_at
FROM consultations WHERE customer_id = ? ORDER BY id DESC
`);

function cleanStr(v, max = 50) {
  return String(v ?? "").trim().slice(0, max);
}

export function insertConsultation({ level, formData, result, memberCustomerId = null } = {}) {
  const risk = result && result.risk_level ? String(result.risk_level) : "";
  const complaint = formData && formData.chief_complaint ? String(formData.chief_complaint).slice(0, 200) : "";
  const name = cleanStr(formData?.name);
  const phone = cleanStr(formData?.phone);
  const customerId =
    Number(memberCustomerId) > 0 ? Number(memberCustomerId) : ensureCustomer(name, phone);
  return insertStmt.run({
    level,
    risk_level: risk,
    chief_complaint: complaint,
    name,
    phone,
    customer_id: customerId,
    form_data: JSON.stringify(formData || {}),
    result: JSON.stringify(result || {}),
  }).lastInsertRowid;
}

export function listConsultations({ page = 1, pageSize = 20, level = "", riskLevel = "", keyword = "" }) {
  const lv = level || null;
  const risk = riskLevel || null;
  const kw = keyword ? `%${keyword}%` : null;
  const offset = (Math.max(1, page) - 1) * pageSize;
  const hasFilter = Boolean(lv || risk);

  let rows;
  let total;
  if (kw) {
    total = countSearchStmt.get({ level: lv, risk, kw }).total;
    rows = listSearchStmt.all({ level: lv, risk, kw, limit: pageSize, offset });
  } else if (hasFilter) {
    total = countFilteredStmt.get({ level: lv, risk }).total;
    rows = listFilteredStmt.all({ level: lv, risk, limit: pageSize, offset });
  } else {
    total = countStmt.get().total;
    rows = listStmt.all({ limit: pageSize, offset });
  }
  return { total, page: Math.max(1, page), pageSize, records: rows };
}

export function getConsultation(id) {
  const row = getStmt.get({ id });
  if (!row) return null;
  return {
    id: row.id,
    level: row.level,
    risk_level: row.risk_level,
    chief_complaint: row.chief_complaint,
    name: row.name,
    phone: row.phone,
    created_at: row.created_at,
    form_data: JSON.parse(row.form_data || "{}"),
    result: JSON.parse(row.result || "{}"),
  };
}

export function getCustomerConsults(customerId) {
  return customerConsultsStmt.all(Number(customerId));
}

export function exportConsultations() {
  return exportStmt.all();
}

/* ==================== 服务项目 ==================== */

const insertServiceStmt = db.prepare("INSERT INTO services (name, price, unit, description, active, needs_doc) VALUES (?, ?, ?, ?, ?, ?)");
const updateServiceStmt = db.prepare("UPDATE services SET name = ?, price = ?, unit = ?, description = ?, active = ?, needs_doc = ? WHERE id = ?");
const deleteServiceStmt = db.prepare("DELETE FROM services WHERE id = ?");
const listServicesStmt = db.prepare("SELECT * FROM services ORDER BY id DESC");
const serviceStmt = db.prepare("SELECT * FROM services WHERE id = ?");
const countServicesStmt = db.prepare("SELECT COUNT(*) AS n FROM services");

export function listServices() {
  return listServicesStmt.all();
}
export function getService(id) {
  return serviceStmt.get(Number(id)) || null;
}
export function createService({ name, price, unit, description, active, needs_doc }) {
  const n = String(name || "").trim();
  if (!n) throw new Error("项目名称不能为空");
  return Number(
    insertServiceStmt.run(n, Number(price) || 0, String(unit || "次").slice(0, 10), String(description || "").slice(0, 300), active === 0 ? 0 : 1, needs_doc ? 1 : 0)
      .lastInsertRowid
  );
}
export function updateService(id, data) {
  const cur = getService(id);
  if (!cur) throw new Error("项目不存在");
  const n = String(data.name ?? cur.name).trim();
  if (!n) throw new Error("项目名称不能为空");
  updateServiceStmt.run(
    n,
    Number(data.price ?? cur.price) || 0,
    String(data.unit ?? cur.unit).slice(0, 10),
    String(data.description ?? cur.description).slice(0, 300),
    data.active === undefined ? cur.active : data.active ? 1 : 0,
    data.needs_doc === undefined ? cur.needs_doc : data.needs_doc ? 1 : 0,
    Number(id)
  );
  return getService(id);
}
export function removeService(id) {
  if (!getService(id)) throw new Error("项目不存在");
  deleteServiceStmt.run(Number(id));
}
export function servicesCount() {
  return countServicesStmt.get().n;
}

export function listActiveServices() {
  return db.prepare("SELECT id, name, price, unit, description, sort_order, needs_doc FROM services WHERE active = 1 ORDER BY sort_order ASC, id ASC").all();
}

/* ==================== 购买记录 ==================== */

const listPurchasesStmt = db.prepare(`
SELECT p.*, c.name AS customer_name, c.phone AS customer_phone
FROM purchases p
LEFT JOIN customers c ON c.id = p.customer_id
WHERE (@kw IS NULL OR c.name LIKE @kw OR c.phone LIKE @kw OR p.service_name LIKE @kw)
  AND (@status IS NULL OR p.status = @status)
ORDER BY p.id DESC
LIMIT @limit OFFSET @offset
`);

const listPurchasesCountStmt = db.prepare(`
SELECT COUNT(*) AS total
FROM purchases p
LEFT JOIN customers c ON c.id = p.customer_id
WHERE (@kw IS NULL OR c.name LIKE @kw OR c.phone LIKE @kw OR p.service_name LIKE @kw)
  AND (@status IS NULL OR p.status = @status)
`);

const customerPurchasesStmt = db.prepare("SELECT * FROM purchases WHERE customer_id = ? ORDER BY id DESC");
const purchaseStmt = db.prepare("SELECT * FROM purchases WHERE id = ?");
const insertPurchaseStmt = db.prepare(
  "INSERT INTO purchases (customer_id, service_id, service_name, unit_price, qty, amount, status, note, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
);
const deletePurchaseStmt = db.prepare("DELETE FROM purchases WHERE id = ?");
const updatePurchaseStatusStmt = db.prepare("UPDATE purchases SET status = ? WHERE id = ?");
const setPurchasePayStmt = db.prepare("UPDATE purchases SET out_trade_no = ?, pay_channel = ?, pay_qr = ? WHERE id = ?");
const purchaseByOutTradeStmt = db.prepare("SELECT * FROM purchases WHERE out_trade_no = ?");
const purchasePaidStmt = db.prepare("UPDATE purchases SET status = '已付款' WHERE id = ? AND status <> '已付款'");

export function listPurchases({ page = 1, pageSize = 20, keyword = "", status = "" } = {}) {
  const kw = keyword ? `%${keyword}%` : null;
  const st = status || null;
  const offset = (Math.max(1, page) - 1) * pageSize;
  return {
    total: listPurchasesCountStmt.get({ kw, status: st }).total,
    page: Math.max(1, page),
    pageSize,
    records: listPurchasesStmt.all({ kw, status: st, limit: pageSize, offset }),
  };
}

export function getPurchase(id) {
  return purchaseStmt.get(Number(id)) || null;
}

export function createPurchase({ customerId, serviceId, qty, status, note, source } = {}) {
  const cid = Number(customerId);
  const customer = getCustomer(cid);
  if (!customer) throw new Error("客户不存在，请先在会员中心建档");
  const sid = Number(serviceId);
  const service = getService(sid);
  if (!service) throw new Error("服务项目不存在");
  if (!service.active) throw new Error("该服务项目已停用");
  const q = Math.max(1, Math.min(999, Number(qty) || 1));
  const amount = Math.round(service.price * q * 100) / 100;
  const st = String(status || "已付款") === "待付款" ? "待付款" : "已付款";
  const src = String(source || "后台登记") === "前台下单" ? "前台下单" : "后台登记";
  return Number(insertPurchaseStmt.run(cid, sid, service.name, service.price, q, amount, st, String(note || "").slice(0, 300), src).lastInsertRowid);
}

/* 前台访客下单：校验联系方式，自动建档，生成待付款订单 */
export function createGuestPurchase({ serviceId, name, phone, qty, note } = {}) {
  const n = String(name || "").trim().slice(0, 50);
  const p = String(phone || "").trim().slice(0, 20);
  if (!p) throw new Error("请填写手机号，方便客服与您确认订单");
  if (!/^[\d\s+-]{5,20}$/.test(p)) throw new Error("手机号格式不正确");
  const sid = Number(serviceId);
  const service = getService(sid);
  if (!service || !service.active) throw new Error("服务项目不存在或已停用");
  const q = Math.max(1, Math.min(99, Number(qty) || 1));
  const amount = Math.round(service.price * q * 100) / 100;
  const customerId = ensureCustomer(n, p);
  const st = amount === 0 ? "已付款" : "待付款";
  return Number(
    insertPurchaseStmt.run(customerId, sid, service.name, service.price, q, amount, st, String(note || "").slice(0, 300), "前台下单").lastInsertRowid
  );
}

export function updatePurchaseStatus(id, status) {
  const cur = getPurchase(id);
  if (!cur) throw new Error("购买记录不存在");
  const st = String(status) === "待付款" ? "待付款" : "已付款";
  updatePurchaseStatusStmt.run(st, Number(id));
  return getPurchase(id);
}

export function removePurchase(id) {
  if (!getPurchase(id)) throw new Error("购买记录不存在");
  deletePurchaseStmt.run(Number(id));
}

export function getCustomerPurchases(customerId) {
  return customerPurchasesStmt.all(Number(customerId));
}

/* 服务订单在线支付（支付宝 / 微信直付，不经余额） */
export function setPurchaseOnlinePayment({ id, outTradeNo, channel, qr = "" } = {}) {
  const p = getPurchase(id);
  if (!p) throw new Error("订单不存在");
  setPurchasePayStmt.run(String(outTradeNo || ""), String(channel || ""), String(qr || ""), Number(id));
  return getPurchase(id);
}
export function getPurchaseByOutTradeNo(outTradeNo) {
  return purchaseByOutTradeStmt.get(String(outTradeNo || "")) || null;
}
export function confirmPurchasePayment(outTradeNo) {
  const p = getPurchaseByOutTradeNo(outTradeNo);
  if (!p) throw new Error("订单不存在");
  if (p.status === "已付款") return { purchase: p, alreadyPaid: true };
  const changed = purchasePaidStmt.run(p.id).changes;
  return { purchase: getPurchase(p.id), alreadyPaid: !changed };
}

/* ==================== 仪表盘统计 ==================== */

const statsTodayStmt = db.prepare(
  `SELECT COUNT(*) AS total FROM consultations WHERE date(created_at) = date('now','localtime')`
);
const statsRiskStmt = db.prepare(
  `SELECT risk_level AS k, COUNT(*) AS v FROM consultations WHERE risk_level <> '' GROUP BY risk_level ORDER BY v DESC`
);
const statsLevelStmt = db.prepare(
  `SELECT level AS k, COUNT(*) AS v FROM consultations GROUP BY level ORDER BY v DESC`
);
const statsHighRiskStmt = db.prepare(`
SELECT id, level, risk_level, chief_complaint, name, phone, created_at
FROM consultations WHERE risk_level = '立即急诊'
ORDER BY id DESC LIMIT 10
`);
const purchaseTotalStmt = db.prepare(
  `SELECT IFNULL(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM purchases WHERE status = '已付款'`
);
const purchaseTodayStmt = db.prepare(
  `SELECT IFNULL(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM purchases WHERE status = '已付款' AND date(created_at) = date('now','localtime')`
);

export function dashboardStats() {
  const total = countStmt.get().total;
  const today = statsTodayStmt.get().total;
  const purchaseAll = purchaseTotalStmt.get();
  const purchaseDay = purchaseTodayStmt.get();
  return {
    total,
    today,
    customers: customersCount(),
    services: servicesCount(),
    purchaseTotal: Math.round(purchaseAll.total * 100) / 100,
    purchaseCount: purchaseAll.cnt,
    purchaseTodayAmount: Math.round(purchaseDay.total * 100) / 100,
    purchaseTodayCount: purchaseDay.cnt,
    riskDistribution: statsRiskStmt.all().map((r) => ({ risk: r.k, count: r.v })),
    levelDistribution: statsLevelStmt.all().map((r) => ({ level: r.k, count: r.v })),
    recentHighRisk: statsHighRiskStmt.all(),
  };
}

export function getCustomerProfile(customerId) {
  const customer = getCustomer(customerId);
  if (!customer) return null;
  const consults = getCustomerConsults(customerId);
  const purchases = getCustomerPurchases(customerId);
  return {
    customer: {
      ...customer,
      consultCount: consults.length,
      highRiskCount: consults.filter((r) => r.risk_level === "立即急诊").length,
      purchaseCount: purchases.length,
      paidTotal: Math.round(purchases.filter((p) => p.status === "已付款").reduce((s, p) => s + p.amount, 0) * 100) / 100,
      amountTotal: Math.round(purchases.reduce((s, p) => s + p.amount, 0) * 100) / 100,
      firstAt: consults.length ? consults[consults.length - 1].created_at : customer.created_at,
      lastAt: consults.length ? consults[0].created_at : customer.updated_at,
    },
    consults,
    purchases,
    documents: getCustomerDocuments(customerId),
  };
}

/* ==================== 附件 / 病历材料（consult/purchase/member 材料库） ==================== */

const insertAttStmt = db.prepare(
  "INSERT INTO attachments (kind, label, mime, size, stored, consult_id, purchase_id, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
);
const attStmt = db.prepare("SELECT * FROM attachments WHERE id = ?");
const attByConsultStmt = db.prepare("SELECT * FROM attachments WHERE consult_id = ? ORDER BY id DESC");
const attByPurchaseStmt = db.prepare("SELECT * FROM attachments WHERE purchase_id = ? ORDER BY id DESC");
const attLibraryStmt = db.prepare("SELECT * FROM attachments WHERE customer_id = ? AND consult_id IS NULL AND purchase_id IS NULL ORDER BY id DESC");
const attDeleteStmt = db.prepare("DELETE FROM attachments WHERE id = ?");
const attCustomerAggStmt = db.prepare(`
SELECT a.*,
       (SELECT s.name FROM consultations s WHERE s.id = a.consult_id) AS consult_scene,
       (SELECT p.service_name FROM purchases p WHERE p.id = a.purchase_id) AS purchase_name
FROM attachments a
WHERE a.customer_id = ? OR a.consult_id IN (SELECT id FROM consultations WHERE customer_id = ?)
   OR a.purchase_id IN (SELECT id FROM purchases WHERE customer_id = ?)
ORDER BY a.id DESC
`);

export function addAttachment({ kind, label, mime, size, stored, consultId, purchaseId, customerId } = {}) {
  return Number(
    insertAttStmt.run(
      String(kind || "其他").slice(0, 20),
      String(label || "未命名").slice(0, 120),
      String(mime || "application/octet-stream").slice(0, 60),
      Number(size) || 0,
      String(stored || ""),
      consultId ? Number(consultId) : null,
      purchaseId ? Number(purchaseId) : null,
      customerId ? Number(customerId) : null
    ).lastInsertRowid
  );
}
export function getAttachment(id) {
  return attStmt.get(Number(id)) || null;
}
export function getConsultAttachments(consultId) {
  return attByConsultStmt.all(Number(consultId));
}
export function getPurchaseAttachments(purchaseId) {
  return attByPurchaseStmt.all(Number(purchaseId));
}
export function getMemberLibrary(customerId) {
  return attLibraryStmt.all(Number(customerId));
}
export function getCustomerDocuments(customerId) {
  const rows = attCustomerAggStmt.all(Number(customerId), Number(customerId), Number(customerId));
  return rows.map((r) => ({ ...r, consult_scene: r.consult_scene || "", purchase_name: r.purchase_name || "" }));
}
export function removeAttachment(id) {
  const row = getAttachment(id);
  if (!row) throw new Error("附件不存在");
  attDeleteStmt.run(Number(id));
  return row;
}
