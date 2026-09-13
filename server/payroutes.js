import { Router } from "express";
import {
  readPaySettings,
  paymentStatus,
  parseAlipayNotify,
  decryptWechatResource,
  verifyWechatNotify,
} from "./pay.js";
import { getRechargeOrderByOutTradeNo, confirmRechargeOrder, getPurchaseByOutTradeNo, confirmPurchasePayment } from "./db.js";

const router = Router();

/* 通过 out_trade_no 定位：充值单或服务订单 */
function findPayTarget(outTradeNo) {
  const recharge = getRechargeOrderByOutTradeNo(outTradeNo);
  if (recharge) return { type: "recharge", order: recharge };
  const purchase = getPurchaseByOutTradeNo(outTradeNo);
  if (purchase) return { type: "purchase", order: purchase };
  return null;
}
function confirmPayTarget(target, tradeNo) {
  if (target.type === "recharge") return confirmRechargeOrder(target.order.id, tradeNo);
  return confirmPurchasePayment(target.order.out_trade_no);
}

/* 公开：当前可用的在线支付渠道 */
router.get("/status", (_req, res) => {
  res.json({ ok: true, ...paymentStatus() });
});

/* 支付宝异步通知（application/x-www-form-urlencoded） */
router.post("/notify/alipay", (req, res) => {
  try {
    const params = req.body || {};
    const cfg = readPaySettings();
    const parsed = parseAlipayNotify(params, cfg);
    if (!parsed.ok) return res.type("text/plain").send("failure");
    const target = findPayTarget(parsed.outTradeNo);
    if (!target) return res.type("text/plain").send("failure");
    if (Math.abs(Number(target.order.amount) - Number(parsed.amount)) > 0.009) return res.type("text/plain").send("failure");
    confirmPayTarget(target, parsed.tradeNo);
    res.type("text/plain").send("success");
  } catch {
    res.type("text/plain").send("failure");
  }
});

/* 微信支付异步通知（JSON，resource 使用 APIv3 密钥 AES-256-GCM 解密） */
router.post("/notify/wechat", (req, res) => {
  try {
    const cfg = readPaySettings();
    const body = req.rawBody || JSON.stringify(req.body || {});
    if (cfg.pay_wechat_platform_cert) {
      const ok = verifyWechatNotify({ headers: req.headers || {}, body, platformCert: cfg.pay_wechat_platform_cert });
      if (!ok) return res.status(401).json({ code: "FAIL", message: "签名校验失败" });
    }
    const resource = (req.body && req.body.resource) || {};
    let data;
    try {
      data = decryptWechatResource(resource, cfg.pay_wechat_apiv3_key);
    } catch (err) {
      return res.status(400).json({ code: "FAIL", message: err.message });
    }
    const target = findPayTarget(String(data.out_trade_no || ""));
    if (!target) return res.status(404).json({ code: "FAIL", message: "订单不存在" });
    const amtCents = data.amount && data.amount.total;
    if (Math.round(Number(target.order.amount) * 100) !== Number(amtCents)) {
      return res.status(400).json({ code: "FAIL", message: "金额不一致" });
    }
    confirmPayTarget(target, String(data.transaction_id || ""));
    res.json({ code: "SUCCESS", message: "成功" });
  } catch {
    res.status(500).json({ code: "FAIL", message: "处理失败" });
  }
});

export default router;
