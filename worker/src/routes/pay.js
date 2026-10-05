// 支付路由：/api/pay/*（渠道状态 + 异步通知）与 /api/purchase/:id/pay*（服务订单在线支付）
import { Hono } from "hono";
import { bearerToken } from "../auth.js";
import {
  readPaySettings,
  paymentStatus,
  parseAlipayNotify,
  decryptWechatResource,
  verifyWechatNotify,
} from "../pay.js";
import {
  getRechargeOrderByOutTradeNo,
  confirmRechargeOrder,
  getPurchaseByOutTradeNo,
  getPurchase,
  getCustomer,
  setPurchaseOnlinePayment,
  confirmPurchasePayment,
} from "../db.js";
import { alipayPrecreate, wechatNative } from "../pay.js";
import { resolveMemberByToken } from "./member.js";

const router = new Hono();

/* 通过 out_trade_no 定位：充值单或服务订单 */
async function findPayTarget(outTradeNo) {
  const recharge = await getRechargeOrderByOutTradeNo(outTradeNo);
  if (recharge) return { type: "recharge", order: recharge };
  const purchase = await getPurchaseByOutTradeNo(outTradeNo);
  if (purchase) return { type: "purchase", order: purchase };
  return null;
}
function confirmPayTarget(target, tradeNo) {
  if (target.type === "recharge") return confirmRechargeOrder(target.order.id, tradeNo);
  return confirmPurchasePayment(target.order.out_trade_no);
}

async function pickChannel(pref) {
  const st = await paymentStatus();
  const enabled = [];
  if (st.alipay) enabled.push("alipay");
  if (st.wechat) enabled.push("wechat");
  let channel = String(pref || "");
  if (channel && !enabled.includes(channel)) channel = "";
  if (!channel) channel = enabled[0] || "";
  return { st, enabled, channel };
}

/* 服务订单支付授权：登录会员（本人订单）或持下单手机号的访客 */
async function authorizePurchase(c, purchase) {
  const member = await resolveMemberByToken(bearerToken(c.req.raw));
  if (member && Number(member.id) === Number(purchase.customer_id)) return { role: "member", member };
  const customer = await getCustomer(purchase.customer_id);
  let phone = "";
  if (c.req.method === "GET") {
    phone = String(c.req.query("phone") || "").trim();
  } else {
    const body = await c.req.json().catch(() => ({}));
    phone = String(body.phone || "").trim();
  }
  if (phone && customer && String(customer.phone || "") === phone) return { role: "guest", customer };
  return null;
}

function hexRand(n) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ===== 支付渠道状态（公开） ===== */

router.get("/pay/status", async (c) => {
  const st = await paymentStatus();
  return c.json({ ok: true, ...st });
});

/* ===== 支付宝异步通知（application/x-www-form-urlencoded） ===== */

router.post("/pay/notify/alipay", async (c) => {
  try {
    const params = {};
    for (const [k, v] of Object.entries(await c.req.parseBody())) {
      params[k] = typeof v === "string" ? v : "";
    }
    const cfg = await readPaySettings();
    const parsed = await parseAlipayNotify(params, cfg);
    if (!parsed.ok) return c.text("failure");
    const target = await findPayTarget(parsed.outTradeNo);
    if (!target) return c.text("failure");
    if (Math.abs(Number(target.order.amount) - Number(parsed.amount)) > 0.009) return c.text("failure");
    await confirmPayTarget(target, parsed.tradeNo);
    return c.text("success");
  } catch {
    return c.text("failure");
  }
});

/* ===== 微信支付异步通知（JSON，resource 用 APIv3 密钥 AES-256-GCM 解密） ===== */

router.post("/pay/notify/wechat", async (c) => {
  try {
    const cfg = await readPaySettings();
    const body = await c.req.text();
    let json = {};
    try {
      json = JSON.parse(body || "{}");
    } catch {
      json = {};
    }
    if (cfg.pay_wechat_platform_cert) {
      const ok = await verifyWechatNotify({ headers: Object.fromEntries(c.req.raw.headers), body, platformCert: cfg.pay_wechat_platform_cert });
      if (!ok) return c.json({ code: "FAIL", message: "签名校验失败" }, 401);
    }
    const resource = json.resource || {};
    let data;
    try {
      data = await decryptWechatResource(resource, cfg.pay_wechat_apiv3_key);
    } catch (err) {
      return c.json({ code: "FAIL", message: err.message }, 400);
    }
    const target = await findPayTarget(String(data.out_trade_no || ""));
    if (!target) return c.json({ code: "FAIL", message: "订单不存在" }, 404);
    const amtCents = data.amount && data.amount.total;
    if (Math.round(Number(target.order.amount) * 100) !== Number(amtCents)) {
      return c.json({ code: "FAIL", message: "金额不一致" }, 400);
    }
    await confirmPayTarget(target, String(data.transaction_id || ""));
    return c.json({ code: "SUCCESS", message: "成功" });
  } catch {
    return c.json({ code: "FAIL", message: "处理失败" }, 500);
  }
});

/* ===== 服务订单在线支付 ===== */

router.post("/purchase/:id/pay", async (c) => {
  try {
    const p = await getPurchase(Number(c.req.param("id")));
    if (!p) return c.json({ error: "订单不存在" }, 404);
    if (p.status === "已付款") return c.json({ error: "该订单已支付" }, 400);
    const who = await authorizePurchase(c, p);
    if (!who) return c.json({ error: "无权支付该订单，请使用下单手机号或登录会员账号" }, 403);

    const body = await c.req.json().catch(() => ({}));
    const { st, channel } = await pickChannel(body.channel);
    if (!channel) return c.json({ error: "尚未配置在线支付，请选择客服线下付款" }, 400);
    if (!st.notifyBaseUrl) return c.json({ error: "请先在后台配置支付回调域名，或选择客服线下付款" }, 400);

    const amount = Number(p.amount);
    if (!(amount > 0)) return c.json({ error: "该订单无需支付" }, 400);

    if (p.out_trade_no && p.pay_qr && p.pay_channel === channel) {
      return c.json({ ok: true, orderId: p.id, channel, code: p.pay_qr, amount, reused: true });
    }

    const outTradeNo = `MP${Date.now()}${hexRand(3)}`;
    const cfg = await readPaySettings();
    const notifyUrl = `${st.notifyBaseUrl.replace(/\/$/, "")}/api/pay/notify/${channel}`;
    const subject = `服务订单 #${p.id} ${p.service_name}`.slice(0, 120);
    const qr =
      channel === "alipay"
        ? await alipayPrecreate({ outTradeNo, amount, subject, notifyUrl }, cfg)
        : await wechatNative({ outTradeNo, amount, description: subject, notifyUrl }, cfg);
    await setPurchaseOnlinePayment({ id: p.id, outTradeNo, channel, qr });
    return c.json({ ok: true, orderId: p.id, channel, code: qr, amount });
  } catch (err) {
    return c.json({ error: err.message || "发起支付失败，请稍后重试" }, 502);
  }
});

router.get("/purchase/:id/pay-status", async (c) => {
  const p = await getPurchase(Number(c.req.param("id")));
  if (!p) return c.json({ error: "订单不存在" }, 404);
  if (!(await authorizePurchase(c, p))) return c.json({ error: "无权查看该订单" }, 403);
  return c.json({ ok: true, orderId: p.id, status: p.status, paid: p.status === "已付款" });
});

export default router;
