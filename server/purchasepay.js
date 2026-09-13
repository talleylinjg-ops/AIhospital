import { Router } from "express";
import crypto from "node:crypto";
import { getPurchase, getCustomer, setPurchaseOnlinePayment } from "./db.js";
import { paymentStatus, readPaySettings, alipayPrecreate, wechatNative } from "./pay.js";
import { resolveMemberByToken } from "./member.js";

const router = Router();

function bearer(req) {
  const h = String(req.headers.authorization || "");
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

/* 服务订单支付授权：登录会员（本人订单）或持下单手机号的访客 */
function authorize(req, purchase) {
  const member = resolveMemberByToken(bearer(req));
  if (member && Number(member.id) === Number(purchase.customer_id)) return { role: "member", member };
  const customer = getCustomer(purchase.customer_id);
  const phone = String((req.body && req.body.phone) || req.query.phone || "").trim();
  if (phone && customer && String(customer.phone || "") === phone) return { role: "guest", customer };
  return null;
}

function pickChannel(pref) {
  const st = paymentStatus();
  const enabled = [];
  if (st.alipay) enabled.push("alipay");
  if (st.wechat) enabled.push("wechat");
  let channel = String(pref || "");
  if (channel && !enabled.includes(channel)) channel = "";
  if (!channel) channel = enabled[0] || "";
  return { st, enabled, channel };
}

router.post("/purchase/:id/pay", async (req, res) => {
  try {
    const p = getPurchase(Number(req.params.id));
    if (!p) return res.status(404).json({ error: "订单不存在" });
    if (p.status === "已付款") return res.status(400).json({ error: "该订单已支付" });
    const who = authorize(req, p);
    if (!who) return res.status(403).json({ error: "无权支付该订单，请使用下单手机号或登录会员账号" });

    const { st, channel } = pickChannel((req.body || {}).channel);
    if (!channel) return res.status(400).json({ error: "尚未配置在线支付，请选择客服线下付款" });
    if (!st.notifyBaseUrl) return res.status(400).json({ error: "请先在后台配置支付回调域名，或选择客服线下付款" });

    const amount = Number(p.amount);
    if (!(amount > 0)) return res.status(400).json({ error: "该订单无需支付" });

    if (p.out_trade_no && p.pay_qr && p.pay_channel === channel) {
      return res.json({ ok: true, orderId: p.id, channel, code: p.pay_qr, amount, reused: true });
    }

    const outTradeNo = `MP${Date.now()}${crypto.randomBytes(3).toString("hex")}`;
    const cfg = readPaySettings();
    const notifyUrl = `${st.notifyBaseUrl.replace(/\/$/, "")}/api/pay/notify/${channel}`;
    const subject = `服务订单 #${p.id} ${p.service_name}`.slice(0, 120);
    const qr =
      channel === "alipay"
        ? await alipayPrecreate({ outTradeNo, amount, subject, notifyUrl }, cfg)
        : await wechatNative({ outTradeNo, amount, description: subject, notifyUrl }, cfg);
    setPurchaseOnlinePayment({ id: p.id, outTradeNo, channel, qr });
    res.json({ ok: true, orderId: p.id, channel, code: qr, amount });
  } catch (err) {
    res.status(502).json({ error: err.message || "发起支付失败，请稍后重试" });
  }
});

router.get("/purchase/:id/pay-status", (req, res) => {
  const p = getPurchase(Number(req.params.id));
  if (!p) return res.status(404).json({ error: "订单不存在" });
  if (!authorize(req, p)) return res.status(403).json({ error: "无权查看该订单" });
  res.json({ ok: true, orderId: p.id, status: p.status, paid: p.status === "已付款" });
});

export default router;
