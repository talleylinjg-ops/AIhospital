// 管理端路由（/api/admin/*）：JWT 会话（30 分钟有效）
import { Hono } from "hono";
import { bearerToken, signJwt, verifyJwt } from "../auth.js";
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
} from "../db.js";
import { testProvider } from "../llm.js";
import { PAY_SETTING_KEYS, SECRET_PAY_KEYS, readPaySettings, paymentStatus } from "../pay.js";

const ADMIN_TTL_MS = 30 * 60 * 1000;
const router = new Hono();

/* 中间件：Bearer JWT → c.user */
async function authAdmin(c, next) {
  const payload = await verifyJwt(bearerToken(c.req.raw));
  if (!payload || payload.typ !== "admin") return c.json({ error: "未登录或登录已过期" }, 401);
  const user = await getUser(payload.uid);
  if (!user) return c.json({ error: "账号不存在，请重新登录" }, 401);
  c.set("user", user);
  await next();
}

/* 包装：业务异常统一转 400 {error} */
const safe = (fn) => async (c) => {
  try {
    return await fn(c);
  } catch (err) {
    return c.json({ error: err.message || "操作失败" }, 400);
  }
};

router.post("/login", async (c) => {
  const { username, password } = await c.req.json().catch(() => ({}));
  if (!username || !password) return c.json({ error: "请输入账号和密码" }, 400);
  const user = await checkUserPassword(username, password);
  if (!user) return c.json({ error: "账号或密码错误" }, 401);
  return c.json({
    ok: true,
    token: await signJwt({ typ: "admin", uid: user.id }, ADMIN_TTL_MS),
    expiresIn: ADMIN_TTL_MS / 1000,
    username: user.username,
  });
});

router.get("/me", authAdmin, (c) => {
  const u = c.get("user");
  return c.json({ ok: true, user: { id: u.id, username: u.username, createdAt: u.created_at } });
});

router.put(
  "/account",
  authAdmin,
  safe(async (c) => {
    const user = c.get("user");
    const { currentPassword, username, newPassword } = await c.req.json().catch(() => ({}));
    if (!currentPassword) throw new Error("请输入当前密码");
    const checked = await checkUserPassword(user.username, currentPassword);
    if (!checked) throw new Error("当前密码错误");
    const hasUsernameChange = username !== undefined && String(username).trim() !== user.username;
    const hasPasswordChange = Boolean(newPassword);
    if (!hasUsernameChange && !hasPasswordChange) throw new Error("没有需要修改的内容");
    const fresh = await updateUserAccount(user.id, { username, newPassword });
    return c.json({ ok: true, user: { id: fresh.id, username: fresh.username } });
  })
);

/* ===== 仪表盘 ===== */

router.get("/stats", authAdmin, async (c) => {
  return c.json({ ok: true, stats: await dashboardStats() });
});

/* ===== 问诊记录（使用记录） ===== */

router.get("/records", authAdmin, async (c) => {
  const q = c.req.query();
  const data = await listConsultations({
    page: Number(q.page) || 1,
    pageSize: Math.min(100, Number(q.pageSize) || 20),
    level: String(q.level || ""),
    riskLevel: String(q.riskLevel || ""),
    keyword: String(q.keyword || "").slice(0, 50),
  });
  return c.json({ ok: true, ...data });
});

router.get("/records/:id", authAdmin, async (c) => {
  const record = await getConsultation(Number(c.req.param("id")));
  if (!record) return c.json({ error: "记录不存在" }, 404);
  return c.json({ ok: true, record });
});

/* ===== 会员中心 ===== */

router.get("/customers", authAdmin, async (c) => {
  const q = c.req.query();
  const data = await listCustomers({
    page: Number(q.page) || 1,
    pageSize: Math.min(100, Number(q.pageSize) || 20),
    keyword: String(q.keyword || "").slice(0, 50),
  });
  return c.json({ ok: true, ...data });
});

router.post(
  "/customers",
  authAdmin,
  safe(async (c) => {
    const id = await createCustomer(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, customer: await getCustomer(id) });
  })
);

router.get("/customers/:id", authAdmin, async (c) => {
  const profile = await getCustomerProfile(Number(c.req.param("id")));
  if (!profile) return c.json({ error: "客户不存在" }, 404);
  return c.json({ ok: true, ...profile });
});

/* 后台删除附件（问诊 / 订单 / 材料库均可），同时清理 R2 对象 */
router.delete(
  "/attachments/:id",
  authAdmin,
  safe(async (c) => {
    const row = await removeAttachment(Number(c.req.param("id")));
    if (row && row.stored.startsWith("uploads/") && c.env.ATTACH) {
      await c.env.ATTACH.delete(row.stored).catch(() => {});
    }
    return c.json({ ok: true });
  })
);

router.put(
  "/customers/:id",
  authAdmin,
  safe(async (c) => {
    const customer = await updateCustomer(Number(c.req.param("id")), await c.req.json().catch(() => ({})));
    return c.json({ ok: true, customer });
  })
);

router.delete(
  "/customers/:id",
  authAdmin,
  safe(async (c) => {
    await removeCustomer(Number(c.req.param("id")));
    return c.json({ ok: true });
  })
);

/* ===== 服务项目 ===== */

router.get("/services", authAdmin, async (c) => {
  return c.json({ ok: true, services: await listServices() });
});

router.post(
  "/services",
  authAdmin,
  safe(async (c) => {
    const id = await createService(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, service: (await listServices()).find((s) => s.id === id) });
  })
);

router.put(
  "/services/:id",
  authAdmin,
  safe(async (c) => {
    const service = await updateService(Number(c.req.param("id")), await c.req.json().catch(() => ({})));
    return c.json({ ok: true, service });
  })
);

router.delete(
  "/services/:id",
  authAdmin,
  safe(async (c) => {
    await removeService(Number(c.req.param("id")));
    return c.json({ ok: true });
  })
);

/* ===== 购买记录 ===== */

router.get("/purchases", authAdmin, async (c) => {
  const q = c.req.query();
  const data = await listPurchases({
    page: Number(q.page) || 1,
    pageSize: Math.min(100, Number(q.pageSize) || 20),
    keyword: String(q.keyword || "").slice(0, 50),
    status: String(q.status || ""),
  });
  return c.json({ ok: true, ...data });
});

router.post(
  "/purchases",
  authAdmin,
  safe(async (c) => {
    const id = await createPurchase(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, purchase: await getPurchase(id) });
  })
);

router.put(
  "/purchases/:id",
  authAdmin,
  safe(async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const purchase = await updatePurchaseStatus(Number(c.req.param("id")), body.status);
    return c.json({ ok: true, purchase });
  })
);

router.delete(
  "/purchases/:id",
  authAdmin,
  safe(async (c) => {
    await removePurchase(Number(c.req.param("id")));
    return c.json({ ok: true });
  })
);

/* ===== 大模型配置 ===== */

router.get("/llm-providers", authAdmin, async (c) => {
  return c.json({ ok: true, providers: await listLLMProviders() });
});

router.post(
  "/llm-providers",
  authAdmin,
  safe(async (c) => {
    const id = await createLLMProvider(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, provider: (await listLLMProviders()).find((p) => p.id === id) });
  })
);

router.put(
  "/llm-providers/:id",
  authAdmin,
  safe(async (c) => {
    const provider = await updateLLMProvider(Number(c.req.param("id")), await c.req.json().catch(() => ({})));
    return c.json({ ok: true, provider });
  })
);

router.delete(
  "/llm-providers/:id",
  authAdmin,
  safe(async (c) => {
    await removeLLMProvider(Number(c.req.param("id")));
    return c.json({ ok: true });
  })
);

router.put(
  "/llm-providers/:id/enable",
  authAdmin,
  safe(async (c) => {
    const provider = await enableLLMProvider(Number(c.req.param("id")));
    return c.json({ ok: true, provider });
  })
);

router.post(
  "/llm-providers/:id/test",
  authAdmin,
  safe(async (c) => {
    const row = await getLLMProviderRow(Number(c.req.param("id")));
    if (!row) throw new Error("配置不存在");
    const result = await testProvider({ base_url: row.base_url, model: row.model, api_key: row.api_key });
    return c.json({ ok: true, ...result });
  })
);

/* ===== 支付设置 / 在线充值单 ===== */

async function publicPaySettings() {
  const s = await readPaySettings();
  const out = {};
  for (const k of PAY_SETTING_KEYS) {
    out[k] = SECRET_PAY_KEYS.includes(k) ? "" : s[k];
  }
  out.has = {};
  for (const k of SECRET_PAY_KEYS) out.has[k] = !!s[k];
  return out;
}

router.get("/pay-settings", authAdmin, async (c) => {
  return c.json({ ok: true, settings: await publicPaySettings(), channels: await paymentStatus() });
});

router.put(
  "/pay-settings",
  authAdmin,
  safe(async (c) => {
    const body = await c.req.json().catch(() => ({}));
    for (const k of PAY_SETTING_KEYS) {
      if (!(k in body)) continue;
      // 密钥类字段留空表示保持原值不变
      if (SECRET_PAY_KEYS.includes(k) && !String(body[k] || "").trim()) continue;
      await setSetting(k, body[k]);
    }
    return c.json({ ok: true, settings: await publicPaySettings(), channels: await paymentStatus() });
  })
);

router.get("/recharge-orders", authAdmin, async (c) => {
  const status = String(c.req.query("status") || "");
  return c.json({ ok: true, records: await listRechargeOrders({ status }) });
});

router.post(
  "/recharge-orders/:id/confirm",
  authAdmin,
  safe(async (c) => {
    const order = await getRechargeOrder(Number(c.req.param("id")));
    if (!order) throw new Error("充值订单不存在");
    const body = await c.req.json().catch(() => ({}));
    const r = await confirmRechargeOrder(order.id, String(body.tradeNo || ""));
    return c.json({ ok: true, ...r });
  })
);

/* ===== 导出 ===== */

router.get("/export.csv", authAdmin, async (c) => {
  const rows = await exportConsultations();
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["ID", "就诊通道", "风险等级", "主诉", "称呼", "手机号", "问诊时间", "完整病史(JSON)", "AI结果(JSON)"];
  const lines = rows.map((r) =>
    [r.id, r.level, r.risk_level, r.chief_complaint, r.name, r.phone, r.created_at, JSON.stringify(r.form_data), JSON.stringify(r.result)]
      .map(esc)
      .join(",")
  );
  const csv = "\uFEFF" + [header.join(","), ...lines].join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="consultations.csv"',
    },
  });
});

export { authAdmin };
export default router;
