// Cloudflare Worker 入口：公开 API + 各路由挂载
// 签名对齐 server/index.js（Express 版）；并发信号量省略（上游 429 透传给调用链主备切换）
import { Hono } from "hono";
import { initDb } from "./db.js";
import { callLLM, callLLMWithProvider, getLLMStatus } from "./llm.js";
import { retrieveGuidelines } from "./rag.js";
import { LEVELS } from "./prompts.js";
import { insertConsultation, listActiveServices, createGuestPurchase, listEnabledProviders } from "./db.js";
import adminRouter from "./routes/admin.js";
import memberRouter, { resolveMemberByToken } from "./routes/member.js";
import payRouter from "./routes/pay.js";
import uploadsRouter from "./routes/uploads.js";

const app = new Hono();

app.use("*", async (c, next) => {
  await initDb(c.env);
  await next();
});

app.use("/api/*", async (c, next) => {
  await next();
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
});
app.options("/api/*", (c) => c.text("", 204));

function collectHistoryText(formData) {
  if (!formData || typeof formData !== "object") return "";
  return Object.entries(formData)
    .map(([k, v]) => `${k}:${Array.isArray(v) ? v.join("、") : String(v ?? "")}`)
    .join(" ");
}

app.get("/api/status", async (c) => {
  return c.json({
    ok: true,
    levels: Object.keys(LEVELS),
    llm: await getLLMStatus(),
  });
});

app.post("/api/consult", async (c) => {
  const { level, formData } = await c.req.json().catch(() => ({}));

  if (!level || !LEVELS[level]) {
    return c.json({ error: "无效的分诊等级" }, 400);
  }
  if (!formData || typeof formData !== "object") {
    return c.json({ error: "缺少病史表单数据" }, 400);
  }

  const historyText = collectHistoryText(formData);
  const ragContext = retrieveGuidelines(historyText, 3);

  try {
    const result = await callLLM({ level, formData, ragContext }, c.env);
    let recordId = null;
    try {
      const ah = c.req.header("Authorization") || "";
      const token = ah.toLowerCase().startsWith("bearer ") ? ah.slice(7) : "";
      const member = token ? await resolveMemberByToken(token) : null;
      recordId = await insertConsultation({ level, formData, result, memberCustomerId: member ? member.id : null });
    } catch (dbErr) {
      console.error("[ai-hospital] 问诊记录落库失败:", dbErr.message);
    }
    return c.json({
      ok: true,
      level,
      recordId,
      rag: ragContext.map((g) => ({ id: g.id, category: g.category, title: g.title })),
      result,
    });
  } catch (err) {
    console.error("[ai-hospital] consult 失败:", err && err.stack);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return c.json({ error: err.message || "AI 服务暂时不可用，请稍后重试" }, status);
  }
});

/* 前台服务购买（公开） */
app.get("/api/services", async (c) => {
  return c.json({ ok: true, services: await listActiveServices() });
});

/* 已启用模型清单（不含任何密钥） */
app.get("/api/providers", async (c) => {
  const providers = (await listEnabledProviders()).map((p) => ({
    id: p.id,
    name: p.name,
    model: p.model,
    category: p.category,
    scene_labels: p.scene_labels,
    priority: p.priority,
  }));
  return c.json({ ok: true, providers });
});

/* 换模型对比分析（公开，不入库） */
app.post("/api/compare", async (c) => {
  const { providerId, level, formData } = await c.req.json().catch(() => ({}));
  if (!LEVELS[level]) return c.json({ error: "无效的分诊等级" }, 400);
  if (!formData || typeof formData !== "object") return c.json({ error: "缺少病史表单数据" }, 400);
  if (!providerId) return c.json({ error: "缺少模型 ID" }, 400);

  const historyText = collectHistoryText(formData);
  const ragContext = retrieveGuidelines(historyText, 3);

  try {
    const result = await callLLMWithProvider(providerId, { level, formData, ragContext }, c.env);
    return c.json({ ok: true, level, result });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return c.json({ error: err.message || "模型调用失败，请稍后重试" }, status);
  }
});

app.post("/api/purchase", async (c) => {
  try {
    const orderId = await createGuestPurchase(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, orderId, message: "下单成功，客服将尽快与您联系确认付款" });
  } catch (err) {
    return c.json({ error: err.message || "下单失败" }, 400);
  }
});

/* ===== 路由挂载 ===== */

app.route("/api/admin", adminRouter);
app.route("/api/member", memberRouter);
app.route("/api", payRouter); // 内部路径：/pay/status、/pay/notify/*、/purchase/:id/pay*
app.route("/api", uploadsRouter); // 内部路径：/consult/:id/attachments 等

export default {
  fetch: app.fetch,
};
