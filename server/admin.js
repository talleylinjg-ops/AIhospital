import { Router } from "express";
import crypto from "node:crypto";
import {
  listConsultations,
  getConsultation,
  exportConsultations,
  listCustomers,
  createCustomer,
  getCustomerProfile,
  updateCustomer,
  removeCustomer,
  getCustomer,
  listServices,
  createService,
  updateService,
  removeService,
  listPurchases,
  createPurchase,
  getPurchase,
  updatePurchaseStatus,
  removePurchase,
  dashboardStats,
  checkUserPassword,
  getUser,
  updateUserAccount,
  listLLMProviders,
  getLLMProviderRow,
  createLLMProvider,
  updateLLMProvider,
  removeLLMProvider,
  enableLLMProvider,
  removeAttachment,
  setSetting,
  listRechargeOrders,
  getRechargeOrder,
  confirmRechargeOrder,
} from "./db.js";
import { testProvider } from "./llm.js";
import { PAY_SETTING_KEYS, SECRET_PAY_KEYS, readPaySettings, paymentStatus } from "./pay.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ATTACH_ROOT = path.join(__dirname, "..", "data", "uploads");

const TOKEN_TTL_MS = 30 * 60 * 1000;
const tokens = new Map(); // token -> { userId, expiresAt }

function createToken(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  tokens.set(token, { userId, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const entry = tokens.get(token);
  if (!token || !entry) {
    return res.status(401).json({ error: "未登录或登录已过期" });
  }
  if (Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return res.status(401).json({ error: "登录已过期，请重新登录" });
  }
  const user = getUser(entry.userId);
  if (!user) {
    tokens.delete(token);
    return res.status(401).json({ error: "账号不存在，请重新登录" });
  }
  req.user = user;
  next();
}

function safe(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      res.status(400).json({ error: err.message || "操作失败" });
    }
  };
}

const router = Router();

/* ===== 账号 ===== */

router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "请输入账号和密码" });
  }
  const user = checkUserPassword(username, password);
  if (!user) {
    return res.status(401).json({ error: "账号或密码错误" });
  }
  res.json({ ok: true, token: createToken(user.id), expiresIn: TOKEN_TTL_MS / 1000, username: user.username });
});

router.get("/me", auth, (req, res) => {
  res.json({ ok: true, user: { id: req.user.id, username: req.user.username, createdAt: req.user.created_at } });
});

router.put(
  "/account",
  auth,
  safe((req, res) => {
    const { currentPassword, username, newPassword } = req.body || {};
    if (!currentPassword) throw new Error("请输入当前密码");
    const checked = checkUserPassword(req.user.username, currentPassword);
    if (!checked) throw new Error("当前密码错误");
    const hasUsernameChange = username !== undefined && String(username).trim() !== req.user.username;
    const hasPasswordChange = Boolean(newPassword);
    if (!hasUsernameChange && !hasPasswordChange) throw new Error("没有需要修改的内容");
    const user = updateUserAccount(req.user.id, { username, newPassword });
    res.json({ ok: true, user: { id: user.id, username: user.username } });
  })
);

/* ===== 仪表盘 ===== */

router.get("/stats", auth, (_req, res) => {
  res.json({ ok: true, stats: dashboardStats() });
});

/* ===== 问诊记录（使用记录） ===== */

router.get("/records", auth, (req, res) => {
  const { page = 1, pageSize = 20, level = "", riskLevel = "", keyword = "" } = req.query;
  const data = listConsultations({
    page: Number(page) || 1,
    pageSize: Math.min(100, Number(pageSize) || 20),
    level: String(level),
    riskLevel: String(riskLevel),
    keyword: String(keyword).slice(0, 50),
  });
  res.json({ ok: true, ...data });
});

router.get("/records/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  const record = getConsultation(id);
  if (!record) return res.status(404).json({ error: "记录不存在" });
  res.json({ ok: true, record });
});

/* ===== 会员中心 ===== */

router.get("/customers", auth, (req, res) => {
  const { page = 1, pageSize = 20, keyword = "" } = req.query;
  const data = listCustomers({
    page: Number(page) || 1,
    pageSize: Math.min(100, Number(pageSize) || 20),
    keyword: String(keyword).slice(0, 50),
  });
  res.json({ ok: true, ...data });
});

router.post(
  "/customers",
  auth,
  safe((req, res) => {
    const id = createCustomer(req.body || {});
    res.json({ ok: true, customer: getCustomer(id) });
  })
);

router.get("/customers/:id", auth, (req, res) => {
  const profile = getCustomerProfile(Number(req.params.id));
  if (!profile) return res.status(404).json({ error: "客户不存在" });
  res.json({ ok: true, ...profile });
});

/* 后台删除附件（问诊 / 订单 / 材料库均可），同时清理磁盘文件 */
router.delete(
  "/attachments/:id",
  auth,
  safe((req, res) => {
    const row = removeAttachment(Number(req.params.id));
    if (row && row.stored.startsWith("uploads/")) {
      const fsPath = path.join(ATTACH_ROOT, ...row.stored.split("/").slice(1));
      try {
        if (fs.existsSync(fsPath)) fs.unlinkSync(fsPath);
      } catch {
        /* 磁盘文件不存在时忽略 */
      }
    }
    res.json({ ok: true });
  })
);

router.put(
  "/customers/:id",
  auth,
  safe((req, res) => {
    const customer = updateCustomer(Number(req.params.id), req.body || {});
    res.json({ ok: true, customer });
  })
);

router.delete(
  "/customers/:id",
  auth,
  safe((req, res) => {
    removeCustomer(Number(req.params.id));
    res.json({ ok: true });
  })
);

/* ===== 服务项目 ===== */

router.get("/services", auth, (_req, res) => {
  res.json({ ok: true, services: listServices() });
});

router.post(
  "/services",
  auth,
  safe((req, res) => {
    const id = createService(req.body || {});
    res.json({ ok: true, service: listServices().find((s) => s.id === id) });
  })
);

router.put(
  "/services/:id",
  auth,
  safe((req, res) => {
    const service = updateService(Number(req.params.id), req.body || {});
    res.json({ ok: true, service });
  })
);

router.delete(
  "/services/:id",
  auth,
  safe((req, res) => {
    removeService(Number(req.params.id));
    res.json({ ok: true });
  })
);

/* ===== 购买记录 ===== */

router.get("/purchases", auth, (req, res) => {
  const { page = 1, pageSize = 20, keyword = "", status = "" } = req.query;
  const data = listPurchases({
    page: Number(page) || 1,
    pageSize: Math.min(100, Number(pageSize) || 20),
    keyword: String(keyword).slice(0, 50),
    status: String(status),
  });
  res.json({ ok: true, ...data });
});

router.post(
  "/purchases",
  auth,
  safe((req, res) => {
    const id = createPurchase(req.body || {});
    res.json({ ok: true, purchase: getPurchase(id) });
  })
);

router.put(
  "/purchases/:id",
  auth,
  safe((req, res) => {
    const purchase = updatePurchaseStatus(Number(req.params.id), (req.body || {}).status);
    res.json({ ok: true, purchase });
  })
);

router.delete(
  "/purchases/:id",
  auth,
  safe((req, res) => {
    removePurchase(Number(req.params.id));
    res.json({ ok: true });
  })
);

/* ===== 大模型配置 ===== */

router.get("/llm-providers", auth, (_req, res) => {
  res.json({ ok: true, providers: listLLMProviders() });
});

router.post(
  "/llm-providers",
  auth,
  safe((req, res) => {
    const id = createLLMProvider(req.body || {});
    res.json({ ok: true, provider: listLLMProviders().find((p) => p.id === id) });
  })
);

router.put(
  "/llm-providers/:id",
  auth,
  safe((req, res) => {
    const provider = updateLLMProvider(Number(req.params.id), req.body || {});
    res.json({ ok: true, provider });
  })
);

router.delete(
  "/llm-providers/:id",
  auth,
  safe((req, res) => {
    removeLLMProvider(Number(req.params.id));
    res.json({ ok: true });
  })
);

router.put(
  "/llm-providers/:id/enable",
  auth,
  safe((req, res) => {
    const provider = enableLLMProvider(Number(req.params.id));
    res.json({ ok: true, provider });
  })
);

router.post(
  "/llm-providers/:id/test",
  auth,
  safe(async (req, res) => {
    const row = getLLMProviderRow(Number(req.params.id));
    if (!row) throw new Error("配置不存在");
    const result = await testProvider({ base_url: row.base_url, model: row.model, api_key: row.api_key });
    res.json({ ok: true, ...result });
  })
);

/* ===== 支付设置 / 在线充值单 ===== */

function publicPaySettings() {
  const s = readPaySettings();
  const out = {};
  for (const k of PAY_SETTING_KEYS) {
    out[k] = SECRET_PAY_KEYS.includes(k) ? "" : s[k];
  }
  out.has = {};
  for (const k of SECRET_PAY_KEYS) out.has[k] = !!s[k];
  return out;
}

router.get("/pay-settings", auth, (_req, res) => {
  res.json({ ok: true, settings: publicPaySettings(), channels: paymentStatus() });
});

router.put(
  "/pay-settings",
  auth,
  safe((req, res) => {
    const body = req.body || {};
    for (const k of PAY_SETTING_KEYS) {
      if (!(k in body)) continue;
      // 密钥类字段留空表示保持原值不变
      if (SECRET_PAY_KEYS.includes(k) && !String(body[k] || "").trim()) continue;
      setSetting(k, body[k]);
    }
    res.json({ ok: true, settings: publicPaySettings(), channels: paymentStatus() });
  })
);

router.get("/recharge-orders", auth, (req, res) => {
  const status = String(req.query.status || "");
  res.json({ ok: true, records: listRechargeOrders({ status }) });
});

router.post(
  "/recharge-orders/:id/confirm",
  auth,
  safe((req, res) => {
    const order = getRechargeOrder(Number(req.params.id));
    if (!order) throw new Error("充值订单不存在");
    const r = confirmRechargeOrder(order.id, String((req.body || {}).tradeNo || ""));
    res.json({ ok: true, ...r });
  })
);

/* ===== 导出 ===== */

router.get("/export.csv", auth, (_req, res) => {
  const rows = exportConsultations();
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["ID", "就诊通道", "风险等级", "主诉", "称呼", "手机号", "问诊时间", "完整病史(JSON)", "AI结果(JSON)"];
  const lines = rows.map((r) =>
    [r.id, r.level, r.risk_level, r.chief_complaint, r.name, r.phone, r.created_at, r.form_data, r.result].map(esc).join(",")
  );
  const csv = "\uFEFF" + [header.join(","), ...lines].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"consultations.csv\"");
  res.send(csv);
});

export default router;
