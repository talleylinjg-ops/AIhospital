import { Router } from "express";
import crypto from "node:crypto";
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
} from "./db.js";
import { paymentStatus, readPaySettings, alipayPrecreate, wechatNative } from "./pay.js";

const router = Router();
const MEMBER_TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;
const memberTokens = new Map(); // token -> { customerId, expiresAt }

function signToken(customerId) {
  const token = crypto.randomBytes(24).toString("hex");
  memberTokens.set(token, { customerId: Number(customerId), expiresAt: Date.now() + MEMBER_TOKEN_TTL_MS });
  return token;
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const entry = memberTokens.get(token);
  if (!entry) return res.status(401).json({ error: "登录已失效，请重新登录" });
  if (Date.now() > entry.expiresAt) {
    memberTokens.delete(token);
    return res.status(401).json({ error: "登录已过期，请重新登录" });
  }
  const member = getCustomer(entry.customerId);
  if (!member) {
    memberTokens.delete(token);
    return res.status(401).json({ error: "账号不存在，请重新登录" });
  }
  req.memberId = member.id;
  req.member = member;
  next();
}

export function resolveMemberByToken(token) {
  const entry = memberTokens.get(String(token || ""));
  if (!entry || Date.now() > entry.expiresAt) return null;
  return getCustomer(entry.customerId) || null;
}

function publicMember(row) {
  return row && { id: row.id, name: row.name, phone: row.phone, balance: row.balance, created_at: row.created_at };
}

function authPayload(customerId) {
  return { token: signToken(customerId), member: publicMember(getCustomer(customerId)) };
}

function memberStats(member) {
  const consults = getMemberConsults(member.id);
  const purchases = getCustomerPurchases(member.id);
  return {
    ...publicMember(member),
    consultCount: consults.length,
    highRiskCount: consults.filter((c) => c.risk_level === "立即急诊").length,
    purchaseCount: purchases.length,
    paidTotal: Math.round(purchases.filter((p) => p.status === "已付款").reduce((s, p) => s + p.amount, 0) * 100) / 100,
    lastAt: consults.length ? consults[0].created_at : null,
  };
}

router.post("/register", (req, res) => {
  try {
    const { phone, password, name } = req.body || {};
    const member = registerMember({ phone, password, name });
    res.json({ ok: true, ...authPayload(member.id) });
  } catch (err) {
    res.status(400).json({ error: err.message || "注册失败" });
  }
});

router.post("/login", (req, res) => {
  try {
    const phone = String((req.body || {}).phone || "").trim();
    const password = String((req.body || {}).password || "");
    if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: "请输入 11 位大陆手机号" });
    const id = findMemberIdByPhone(phone);
    if (!id) return res.status(400).json({ error: "该手机号尚未注册，请先注册" });
    if (!verifyMemberPassword(id, password)) return res.status(400).json({ error: "密码不正确，请重试" });
    res.json({ ok: true, ...authPayload(id) });
  } catch (err) {
    res.status(400).json({ error: err.message || "登录失败" });
  }
});

router.post("/logout", auth, (_req, res) => {
  const header = _req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  memberTokens.delete(token);
  res.json({ ok: true });
});

router.get("/me", auth, (_req, res) => {
  res.json({ ok: true, member: memberStats(_req.member) });
});

router.put("/account", auth, (req, res) => {
  try {
    const { password, name, newPhone } = req.body || {};
    if (!verifyMemberPassword(req.member.id, password)) {
      return res.status(400).json({ error: "请输入当前密码以确认修改" });
    }
    const next = { name: String(name ?? req.member.name).trim() };
    const p = String(newPhone || "").trim();
    if (p) {
      if (!/^1\d{10}$/.test(p)) return res.status(400).json({ error: "请输入 11 位大陆手机号" });
      const dup = findMemberIdByPhone(p);
      if (dup && dup !== req.member.id) return res.status(400).json({ error: "该手机号已被其他账号使用" });
      next.phone = p;
    }
    if (!next.name && !next.phone) return res.status(400).json({ error: "没有需要修改的内容" });
    updateCustomer(req.member.id, { name: next.name || req.member.name, phone: next.phone || req.member.phone, note: req.member.note });
    res.json({ ok: true, member: memberStats(getCustomer(req.member.id)) });
  } catch (err) {
    res.status(400).json({ error: err.message || "修改失败" });
  }
});

router.put("/password", auth, (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!verifyMemberPassword(req.member.id, oldPassword)) {
      return res.status(400).json({ error: "当前密码不正确" });
    }
    setMemberPassword(req.member.id, newPassword);
    res.json({ ok: true, message: "密码修改成功" });
  } catch (err) {
    res.status(400).json({ error: err.message || "密码修改失败" });
  }
});

router.get("/health", auth, (req, res) => {
  res.json({ ok: true, health: readHealthProfile(req.member.id) });
});

router.put("/health", auth, (req, res) => {
  try {
    const health = saveHealthProfile(req.member.id, (req.body || {}).health || {});
    res.json({ ok: true, health });
  } catch (err) {
    res.status(400).json({ error: err.message || "健康档案保存失败" });
  }
});

router.post("/recharge", auth, async (req, res) => {
  try {
    const amount = Number((req.body || {}).amount);
    if (!(amount > 0) || amount > 10000) return res.status(400).json({ error: "请输入 1-10000 之间的充值金额" });

    const st = paymentStatus();
    const enabled = [];
    if (st.alipay) enabled.push("alipay");
    if (st.wechat) enabled.push("wechat");
    let channel = String((req.body || {}).channel || "");
    if (channel && !enabled.includes(channel)) channel = "";
    if (!channel && enabled.length) channel = enabled[0];

    /* 未配置在线支付：退回演示环境模拟支付（实时到账） */
    if (!channel) {
      const balance = rechargeBalance(req.member.id, amount, "余额充值（模拟支付）");
      return res.json({ ok: true, mode: "simulated", balance, message: "支付渠道未配置，演示环境已模拟到账" });
    }

    const notifyBase = st.notifyBaseUrl;
    if (!notifyBase) return res.status(400).json({ error: "请先在后台「支付设置」配置公网可达的回调域名" });
    const notifyUrl = `${notifyBase.replace(/\/$/, "")}/api/pay/notify/${channel}`;
    const outTradeNo = `MH${Date.now()}${crypto.randomBytes(3).toString("hex")}`;
    const cfg = readPaySettings();
    const qr =
      channel === "alipay"
        ? await alipayPrecreate({ outTradeNo, amount, subject: "大气AI医院-余额充值", notifyUrl }, cfg)
        : await wechatNative({ outTradeNo, amount, description: "大气AI医院-余额充值", notifyUrl }, cfg);
    const orderId = createRechargeOrder({ customerId: req.member.id, amount, channel, outTradeNo, qr });
    res.json({ ok: true, mode: "online", orderId, channel, code: qr, amount });
  } catch (err) {
    res.status(502).json({ error: err.message || "发起支付失败，请稍后重试" });
  }
});

router.get("/recharge/:id/status", auth, (req, res) => {
  const order = getRechargeOrder(Number(req.params.id));
  if (!order || Number(order.customer_id) !== Number(req.member.id)) return res.status(404).json({ error: "订单不存在" });
  res.json({ ok: true, status: order.status, balance: req.member.balance });
});

router.get("/wallet", auth, (req, res) => {
  const limit = Number(req.query.limit) || 200;
  res.json({ ok: true, balance: req.member.balance, items: walletLedger(req.member.id, limit) });
});

router.post("/pay", auth, (req, res) => {
  try {
    const { serviceId, qty, note } = req.body || {};
    const r = payServiceByBalance(req.member.id, { serviceId: Number(serviceId), qty: Number(qty) || 1, note });
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message || "余额支付失败" });
  }
});

router.get("/consults", auth, (_req, res) => {
  res.json({ ok: true, items: getMemberConsults(_req.member.id) });
});

router.get("/consults/:id", auth, (req, res) => {
  const item = getMemberConsult(req.member.id, Number(req.params.id));
  if (!item) return res.status(404).json({ error: "记录不存在" });
  res.json({ ok: true, item });
});

router.get("/orders", auth, (_req, res) => {
  res.json({ ok: true, items: getCustomerPurchases(_req.member.id) });
});

export default router;
