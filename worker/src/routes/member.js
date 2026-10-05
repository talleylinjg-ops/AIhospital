// 会员路由（/api/member/*）：JWT 会话替换原内存 Map
import { Hono } from "hono";
import { bearerToken, signJwt, verifyJwt } from "../auth.js";
import {
  getCustomer,
  registerMember,
  verifyMemberPassword,
  setMemberPassword,
  updateCustomer,
  findMemberIdByPhone,
  readHealthProfile,
  saveHealthProfile,
  rechargeBalance,
  payServiceByBalance,
  walletLedger,
  getMemberConsults,
  getMemberConsult,
  getCustomerPurchases,
  createRechargeOrder,
  getRechargeOrder,
} from "../db.js";
import { paymentStatus, readPaySettings, alipayPrecreate, wechatNative } from "../pay.js";

const MEMBER_TTL_MS = 7 * 24 * 3600 * 1000;
const router = new Hono();

export async function resolveMemberByToken(token) {
  const payload = await verifyJwt(token);
  if (!payload || payload.typ !== "member") return null;
  return getCustomer(payload.cid);
}

/* 中间件：Bearer JWT → c.member */
export async function authMember(c, next) {
  const payload = await verifyJwt(bearerToken(c.req.raw));
  if (!payload || payload.typ !== "member") return c.json({ error: "登录已失效，请重新登录" }, 401);
  const member = await getCustomer(payload.cid);
  if (!member) return c.json({ error: "账号不存在，请重新登录" }, 401);
  c.set("memberId", member.id);
  c.set("member", member);
  await next();
}

function publicMember(row) {
  return row && { id: row.id, name: row.name, phone: row.phone, balance: row.balance, created_at: row.created_at };
}

async function authPayload(customerId) {
  return {
    token: await signJwt({ typ: "member", cid: Number(customerId) }, MEMBER_TTL_MS),
    member: publicMember(await getCustomer(customerId)),
  };
}

function hexRand(n) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

router.post("/register", async (c) => {
  try {
    const { phone, password, name } = await c.req.json().catch(() => ({}));
    const member = await registerMember({ phone, password, name });
    return c.json({ ok: true, ...(await authPayload(member.id)) });
  } catch (err) {
    return c.json({ error: err.message || "注册失败" }, 400);
  }
});

router.post("/login", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const phone = String(body.phone || "").trim();
    const password = String(body.password || "");
    if (!/^1\d{10}$/.test(phone)) return c.json({ error: "请输入 11 位大陆手机号" }, 400);
    const id = await findMemberIdByPhone(phone);
    if (!id) return c.json({ error: "该手机号尚未注册，请先注册" }, 400);
    const { ok } = await verifyMemberPassword(id, password);
    if (!ok) return c.json({ error: "密码不正确，请重试" }, 400);
    return c.json({ ok: true, ...(await authPayload(id)) });
  } catch (err) {
    return c.json({ error: err.message || "登录失败" }, 400);
  }
});

router.post("/logout", authMember, (c) => c.json({ ok: true }));

router.get("/me", authMember, async (c) => {
  const member = c.get("member");
  const consults = await getMemberConsults(member.id);
  const purchases = await getCustomerPurchases(member.id);
  const stats = {
    ...publicMember(member),
    consultCount: consults.length,
    highRiskCount: consults.filter((x) => x.risk_level === "立即急诊").length,
    purchaseCount: purchases.length,
    paidTotal: Math.round(purchases.filter((p) => p.status === "已付款").reduce((s, p) => s + Number(p.amount), 0) * 100) / 100,
    lastAt: consults.length ? consults[0].created_at : null,
  };
  return c.json({ ok: true, member: stats });
});

router.put("/account", authMember, async (c) => {
  try {
    const member = c.get("member");
    const { password, name, newPhone } = await c.req.json().catch(() => ({}));
    const { ok } = await verifyMemberPassword(member.id, password);
    if (!ok) return c.json({ error: "请输入当前密码以确认修改" }, 400);
    const next = { name: String(name ?? member.name).trim() };
    const p = String(newPhone || "").trim();
    if (p) {
      if (!/^1\d{10}$/.test(p)) return c.json({ error: "请输入 11 位大陆手机号" }, 400);
      const dup = await findMemberIdByPhone(p);
      if (dup && Number(dup) !== Number(member.id)) return c.json({ error: "该手机号已被其他账号使用" }, 400);
      next.phone = p;
    }
    if (!next.name && !next.phone) return c.json({ error: "没有需要修改的内容" }, 400);
    await updateCustomer(member.id, { name: next.name || member.name, phone: next.phone || member.phone, note: member.note });
    const fresh = await getCustomer(member.id);
    const consults = await getMemberConsults(member.id);
    const purchases = await getCustomerPurchases(member.id);
    return c.json({
      ok: true,
      member: {
        ...publicMember(fresh),
        consultCount: consults.length,
        highRiskCount: consults.filter((x) => x.risk_level === "立即急诊").length,
        purchaseCount: purchases.length,
        paidTotal: Math.round(purchases.filter((x) => x.status === "已付款").reduce((s, x) => s + Number(x.amount), 0) * 100) / 100,
        lastAt: consults.length ? consults[0].created_at : null,
      },
    });
  } catch (err) {
    return c.json({ error: err.message || "修改失败" }, 400);
  }
});

router.put("/password", authMember, async (c) => {
  try {
    const member = c.get("member");
    const { oldPassword, newPassword } = await c.req.json().catch(() => ({}));
    const { ok } = await verifyMemberPassword(member.id, oldPassword);
    if (!ok) return c.json({ error: "当前密码不正确" }, 400);
    await setMemberPassword(member.id, newPassword);
    return c.json({ ok: true, message: "密码修改成功" });
  } catch (err) {
    return c.json({ error: err.message || "密码修改失败" }, 400);
  }
});

router.get("/health", authMember, async (c) => {
  return c.json({ ok: true, health: await readHealthProfile(c.get("memberId")) });
});

router.put("/health", authMember, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const health = await saveHealthProfile(c.get("memberId"), body.health || {});
    return c.json({ ok: true, health });
  } catch (err) {
    return c.json({ error: err.message || "健康档案保存失败" }, 400);
  }
});

router.post("/recharge", authMember, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const amount = Number(body.amount);
    if (!(amount > 0) || amount > 10000) return c.json({ error: "请输入 1-10000 之间的充值金额" }, 400);

    const st = await paymentStatus();
    const enabled = [];
    if (st.alipay) enabled.push("alipay");
    if (st.wechat) enabled.push("wechat");
    let channel = String(body.channel || "");
    if (channel && !enabled.includes(channel)) channel = "";
    if (!channel && enabled.length) channel = enabled[0];

    if (!channel) {
      const balance = await rechargeBalance(c.get("memberId"), amount, "余额充值（模拟支付）");
      return c.json({ ok: true, mode: "simulated", balance, message: "支付渠道未配置，演示环境已模拟到账" });
    }

    const notifyBase = st.notifyBaseUrl;
    if (!notifyBase) return c.json({ error: "请先在后台「支付设置」配置公网可达的回调域名" }, 400);
    const notifyUrl = `${notifyBase.replace(/\/$/, "")}/api/pay/notify/${channel}`;
    const outTradeNo = `MH${Date.now()}${hexRand(3)}`;
    const cfg = await readPaySettings();
    const qr =
      channel === "alipay"
        ? await alipayPrecreate({ outTradeNo, amount, subject: "大气AI医院-余额充值", notifyUrl }, cfg)
        : await wechatNative({ outTradeNo, amount, description: "大气AI医院-余额充值", notifyUrl }, cfg);
    const orderId = await createRechargeOrder({ customerId: c.get("memberId"), amount, channel, outTradeNo, qr });
    return c.json({ ok: true, mode: "online", orderId, channel, code: qr, amount });
  } catch (err) {
    return c.json({ error: err.message || "发起支付失败，请稍后重试" }, 502);
  }
});

router.get("/recharge/:id/status", authMember, async (c) => {
  const order = await getRechargeOrder(Number(c.req.param("id")));
  if (!order || Number(order.customer_id) !== Number(c.get("memberId"))) return c.json({ error: "订单不存在" }, 404);
  const member = await getCustomer(c.get("memberId"));
  return c.json({ ok: true, status: order.status, balance: member.balance });
});

router.get("/wallet", authMember, async (c) => {
  const limit = Number(c.req.query("limit")) || 200;
  const member = c.get("member");
  return c.json({ ok: true, balance: member.balance, items: await walletLedger(member.id, limit) });
});

router.post("/pay", authMember, async (c) => {
  try {
    const { serviceId, qty, note } = await c.req.json().catch(() => ({}));
    const r = await payServiceByBalance(c.get("memberId"), { serviceId: Number(serviceId), qty: Number(qty) || 1, note });
    return c.json({ ok: true, ...r });
  } catch (err) {
    return c.json({ error: err.message || "余额支付失败" }, 400);
  }
});

router.get("/consults", authMember, async (c) => {
  return c.json({ ok: true, items: await getMemberConsults(c.get("memberId")) });
});

router.get("/consults/:id", authMember, async (c) => {
  const item = await getMemberConsult(c.get("memberId"), Number(c.req.param("id")));
  if (!item) return c.json({ error: "记录不存在" }, 404);
  return c.json({ ok: true, item });
});

router.get("/orders", authMember, async (c) => {
  return c.json({ ok: true, items: await getCustomerPurchases(c.get("memberId")) });
});

export default router;
