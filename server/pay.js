import crypto from "node:crypto";
import { getSettings } from "./db.js";

export const PAY_SETTING_KEYS = [
  "pay_notify_base_url",
  "pay_alipay_enabled",
  "pay_alipay_app_id",
  "pay_alipay_private_key",
  "pay_alipay_public_key",
  "pay_alipay_gateway",
  "pay_wechat_enabled",
  "pay_wechat_app_id",
  "pay_wechat_mch_id",
  "pay_wechat_serial_no",
  "pay_wechat_private_key",
  "pay_wechat_apiv3_key",
  "pay_wechat_platform_cert",
];

export const SECRET_PAY_KEYS = ["pay_alipay_private_key", "pay_wechat_private_key", "pay_wechat_apiv3_key", "pay_wechat_platform_cert"];

export function readPaySettings() {
  return getSettings(PAY_SETTING_KEYS);
}

function truthy(v) {
  return String(v || "") === "1" || String(v || "").toLowerCase() === "true";
}

export function paymentStatus() {
  const s = readPaySettings();
  return {
    alipay: truthy(s.pay_alipay_enabled) && !!s.pay_alipay_app_id && !!s.pay_alipay_private_key && !!s.pay_alipay_public_key,
    wechat:
      truthy(s.pay_wechat_enabled) &&
      !!s.pay_wechat_app_id &&
      !!s.pay_wechat_mch_id &&
      !!s.pay_wechat_private_key &&
      !!s.pay_wechat_apiv3_key,
    notifyBaseUrl: s.pay_notify_base_url || "",
  };
}

function normalizePem(key, type = "PRIVATE") {
  const k = String(key || "").trim().replace(/\\n/g, "\n");
  if (!k) throw new Error("缺少密钥");
  if (k.includes("-----BEGIN")) return k;
  const body = k.replace(/\s+/g, "").replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${type} KEY-----\n${body}\n-----END ${type} KEY-----`;
}

/* ==================== 支付宝（RSA2） ==================== */

export function alipaySignContent(params) {
  return Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

export function alipaySign(params, privateKey) {
  const content = alipaySignContent(params);
  return crypto.createSign("RSA-SHA256").update(content, "utf8").sign(normalizePem(privateKey), "base64");
}

export function alipayVerify(params, alipayPublicKey, signOverride) {
  const content = alipaySignContent(params);
  const sign = signOverride || params.sign || "";
  try {
    return crypto.createVerify("RSA-SHA256").update(content, "utf8").verify(normalizePem(alipayPublicKey, "PUBLIC"), sign, "base64");
  } catch {
    return false;
  }
}

export async function alipayPrecreate({ outTradeNo, amount, subject, notifyUrl }, cfg) {
  const p = {
    app_id: cfg.pay_alipay_app_id,
    method: "alipay.trade.precreate",
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
    version: "1.0",
    biz_content: JSON.stringify({ out_trade_no: outTradeNo, total_amount: Number(amount).toFixed(2), subject }),
  };
  if (notifyUrl) p.notify_url = notifyUrl;
  p.sign = alipaySign(p, cfg.pay_alipay_private_key);
  const gateway = cfg.pay_alipay_gateway || "https://openapi.alipay.com/gateway.do";
  const res = await fetch(gateway, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams(p).toString(),
  });
  const json = await res.json().catch(() => ({}));
  const r = json["alipay_trade_precreate_response"];
  if (!r || r.code !== "10000") throw new Error((r && (r.sub_msg || r.msg)) || "支付宝下单失败");
  return r.qr_code || "";
}

/* 解析并校验支付宝异步通知 */
export function parseAlipayNotify(params, cfg) {
  const appId = String(params.app_id || "");
  if (cfg.pay_alipay_app_id && appId !== cfg.pay_alipay_app_id) return { ok: false, reason: "app_id 不匹配" };
  const verified = alipayVerify(params, cfg.pay_alipay_public_key, params.sign);
  if (!verified) return { ok: false, reason: "签名校验失败" };
  const status = String(params.trade_status || "");
  if (status !== "TRADE_SUCCESS" && status !== "TRADE_FINISHED") return { ok: false, reason: "交易未成功" };
  return {
    ok: true,
    outTradeNo: String(params.out_trade_no || ""),
    tradeNo: String(params.trade_no || ""),
    amount: Number(params.total_amount || 0),
  };
}

/* ==================== 微信支付（APIv3 Native） ==================== */

export function wechatAuthHeader({ method, urlPath, body, mchId, serialNo, privateKey }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = crypto.createSign("RSA-SHA256").update(message, "utf8").sign(privateKey, "base64");
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`;
}

export async function wechatNative({ outTradeNo, amount, description, notifyUrl }, cfg) {
  const urlPath = "/v3/pay/transactions/native";
  const body = JSON.stringify({
    appid: cfg.pay_wechat_app_id,
    mchid: cfg.pay_wechat_mch_id,
    description: String(description || "余额充值").slice(0, 120),
    out_trade_no: outTradeNo,
    notify_url: notifyUrl,
    amount: { total: Math.round(Number(amount) * 100), currency: "CNY" },
  });
  const authorization = wechatAuthHeader({
    method: "POST",
    urlPath,
    body,
    mchId: cfg.pay_wechat_mch_id,
    serialNo: cfg.pay_wechat_serial_no,
    privateKey: normalizePem(cfg.pay_wechat_private_key),
  });
  const res = await fetch(`https://api.mch.weixin.qq.com${urlPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: authorization },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.code_url) throw new Error(json.message || "微信下单失败");
  return json.code_url;
}

/* 解密微信通知的 resource（AES-256-GCM，key = APIv3 密钥） */
export function decryptWechatResource(resource, apiV3Key) {
  const key = Buffer.from(String(apiV3Key), "utf8");
  if (key.length !== 32) throw new Error("微信 APIv3 密钥必须为 32 位");
  const data = Buffer.from(String(resource.ciphertext || ""), "base64");
  const authTag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(0, data.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(resource.nonce || "", "utf8"));
  decipher.setAuthTag(authTag);
  if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data, "utf8"));
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

/* 校验微信回调签名（配置了平台证书时执行，RSA-SHA256） */
export function verifyWechatNotify({ headers, body, platformCert }) {
  try {
    const timestamp = headers["wechatpay-timestamp"];
    const nonce = headers["wechatpay-nonce"];
    const signature = headers["wechatpay-signature"];
    if (!timestamp || !nonce || !signature || !platformCert) return false;
    const message = `${timestamp}\n${nonce}\n${body}\n`;
    return crypto.createVerify("RSA-SHA256").update(message, "utf8").verify(platformCert, signature, "base64");
  } catch {
    return false;
  }
}
