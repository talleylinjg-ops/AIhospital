import express from "express";
import cors from "cors";
import "dotenv/config";
import { callLLM, callLLMWithProvider, getLLMStatus } from "./llm.js";
import { retrieveGuidelines } from "./rag.js";
import { LEVELS } from "./prompts.js";
import { insertConsultation, listActiveServices, createGuestPurchase, listEnabledProviders } from "./db.js";
import adminRouter from "./admin.js";
import memberRouter, { resolveMemberByToken } from "./member.js";
import uploadsRouter from "./uploads.js";
import payRouter from "./payroutes.js";
import purchasePayRouter from "./purchasepay.js";

const app = express();
const PORT = Number(process.env.PORT || 3001);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_LLM || 8);

app.use(cors());
app.use(
  express.json({
    limit: "18mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf && buf.length ? buf.toString("utf8") : "";
    },
  })
);
app.use("/api/pay/notify/alipay", express.urlencoded({ extended: false }));

let activeRequests = 0;
const waitQueue = [];

function acquireSlot() {
  return new Promise((resolve) => {
    if (activeRequests < MAX_CONCURRENT) {
      activeRequests += 1;
      resolve();
    } else {
      waitQueue.push(resolve);
    }
  });
}

function releaseSlot() {
  const next = waitQueue.shift();
  if (next) {
    next();
  } else {
    activeRequests -= 1;
  }
}

function collectHistoryText(formData) {
  if (!formData || typeof formData !== "object") return "";
  return Object.entries(formData)
    .map(([k, v]) => `${k}:${Array.isArray(v) ? v.join("、") : String(v ?? "")}`)
    .join(" ");
}

app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    levels: Object.keys(LEVELS),
    llm: getLLMStatus(),
  });
});

app.post("/api/consult", async (req, res) => {
  const { level, formData } = req.body || {};

  if (!level || !LEVELS[level]) {
    return res.status(400).json({ error: "无效的分诊等级" });
  }
  if (!formData || typeof formData !== "object") {
    return res.status(400).json({ error: "缺少病史表单数据" });
  }

  const historyText = collectHistoryText(formData);
  const ragContext = retrieveGuidelines(historyText, 3);

  await acquireSlot();
  try {
    const result = await callLLM({ level, formData, ragContext });
    let recordId = null;
    try {
      const ah = req.headers.authorization || "";
      const member = ah.startsWith("Bearer ") ? resolveMemberByToken(ah.slice(7)) : null;
      recordId = insertConsultation({ level, formData, result, memberCustomerId: member ? member.id : null });
    } catch (dbErr) {
      console.error("[ai-hospital] 问诊记录落库失败:", dbErr.message);
    }
    res.json({ ok: true, level, recordId, rag: ragContext.map((g) => ({ id: g.id, category: g.category, title: g.title })), result });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).json({ error: err.message || "AI 服务暂时不可用，请稍后重试" });
  } finally {
    releaseSlot();
  }
});

/* 前台服务购买（公开） */
app.get("/api/services", (_req, res) => {
  res.json({ ok: true, services: listActiveServices() });
});

/* 已启用模型清单（前台"换模型对比"下拉用，不含任何密钥） */
app.get("/api/providers", (_req, res) => {
  const providers = listEnabledProviders().map((p) => ({
    id: p.id,
    name: p.name,
    model: p.model,
    category: p.category,
    scene_labels: p.scene_labels,
    priority: p.priority,
  }));
  res.json({ ok: true, providers });
});

/* 换模型对比分析（公开，不入库） */
app.post("/api/compare", async (req, res) => {
  const { providerId, level, formData } = req.body || {};
  if (!LEVELS[level]) return res.status(400).json({ error: "无效的分诊等级" });
  if (!formData || typeof formData !== "object") return res.status(400).json({ error: "缺少病史表单数据" });
  if (!providerId) return res.status(400).json({ error: "缺少模型 ID" });

  const historyText = collectHistoryText(formData);
  const ragContext = retrieveGuidelines(historyText, 3);

  await acquireSlot();
  try {
    const result = await callLLMWithProvider(providerId, { level, formData, ragContext });
    res.json({ ok: true, level, result });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).json({ error: err.message || "模型调用失败，请稍后重试" });
  } finally {
    releaseSlot();
  }
});

app.post("/api/purchase", async (req, res) => {
  try {
    const orderId = createGuestPurchase(req.body || {});
    res.json({ ok: true, orderId, message: "下单成功，客服将尽快与您联系确认付款" });
  } catch (err) {
    res.status(400).json({ error: err.message || "下单失败" });
  }
});

app.use("/api/admin", adminRouter);
app.use("/api/member", memberRouter);
app.use("/api/pay", payRouter);
app.use("/api", purchasePayRouter);
app.use("/api", uploadsRouter);

const dist = new URL("../client/dist", import.meta.url).pathname;
app.use(express.static(dist));

const adminDir = new URL("../client/public/admin", import.meta.url).pathname;
app.use("/admin", express.static(adminDir));
const srcDir = new URL("../client/src", import.meta.url).pathname;
app.use("/src", express.static(srcDir));

app.listen(PORT, () => {
  console.log(`[ai-hospital] server listening on http://localhost:${PORT}`);
  console.log(`[ai-hospital] LLM status:`, JSON.stringify(getLLMStatus()));
});
