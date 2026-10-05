// 支付签名/验签（WebCrypto 版）：支付宝 RSA2 + 微信 APIv3 AES-256-GCM
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

export async function paymentStatus() {
  const s = await readPaySettings();
  return {
    alipay: truthy(s.pay_alipay_enabled) && !!s.pay_alipay_app_id && !!s.pay_alipay_private_key && !!s.pay_alipay_public_key,
    wechat:
      truthy(s.pay_wechat_enabled) && !!s.pay_wechat_app_id && !!s.pay_wechat_mch_id && !!s.pay_wechat_private_key && !!s.pay_wechat_apiv3_key,
    notifyBaseUrl: s.pay_notify_base_url || "",
  };
}

/* PEM/裸 base64 → DER 字节 */
function pemToDer(key, type = "PRIVATE") {
  const k = String(key || "").trim().replace(/\\n/g, "\n");
  if (!k) throw new Error("缺少密钥");
  let body = k;
  if (k.includes("-----BEGIN")) {
    body = k
      .replace(/-----BEGIN [^-]+-----/, "")
      .replace(/-----END [^-]+-----/, "")
      .replace(/\s+/g, "");
  } else {
    body = k.replace(/\s+/g, "");
  }
  const bin = atob(body);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const enc = new TextEncoder();

/* RSA-SHA256 签名（PKCS#8 私钥） */
async function rsaSign(der, data) {
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/* RSA-SHA256 验签（SPKI 公钥；platformCert 为 X.509 证书时先提取 SPKI） */
async function rsaVerify(der, data, sigB64) {
  let spki = der;
  if (der[0] === 0x30 && enc.decode(der.slice(0, 40)).includes("Certificate")) {
    spki = extractSpkiFromCert(der);
  }
  const key = await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const sig = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, enc.encode(data));
}

/* 从 X.509 证书 DER 中提取 SubjectPublicKeyInfo（微信平台证书场景） */
function extractSpkiFromCert(der) {
  const buf = new DataView(der.buffer, der.byteOffset, der.byteLength);
  let pos = 0;
  const readLen = () => {
    let len = buf.getUint8(pos++);
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + buf.getUint8(pos++);
    }
    return len;
  };
  const expect = (tag) => {
    if (buf.getUint8(pos++) !== tag) throw new Error("证书格式解析失败");
    return readLen();
  };
  expect(0x30); // Certificate SEQUENCE
  const tbsLen = expect(0x30); // tbsCertificate
  const tbsEnd = pos + tbsLen;
  expect(0xa0); // [0] version (optional)
  pos += readLen();
  expect(0x02); // serialNumber INTEGER
  pos += readLen();
  expect(0x30); // signature AlgorithmIdentifier
  pos += readLen();
  expect(0x30); // issuer
  pos += readLen();
  expect(0x30); // validity
  pos += readLen();
  expect(0x30); // subject
  pos += readLen();
  if (pos >= tbsEnd) throw new Error("证书格式解析失败");
  // SubjectPublicKeyInfo SEQUENCE（含内容总长 = tag + len + payload）
  const spkiStart = pos - 1;
  const spkiLen = readLen();
  return der.slice(spkiStart, spkiStart + 2 + (spkiLen > 127 ? spkiLen : spkiLen) + (spkiLen >= 128 ? (spkiLen >= 256 ? 2 : 1) : 0));
}

/* ==================== 支付宝（RSA2） ==================== */

export function alipaySignContent(params) {
  return Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

export async function alipaySign(params, privateKey) {
  const content = alipaySignContent(params);
  return rsaSign(pemToDer(privateKey), content);
}

export async function alipayVerify(params, alipayPublicKey, signOverride) {
  const content = alipaySignContent(params);
  const sign = signOverride || params.sign || "";
  try {
    return await rsaVerify(pemToDer(alipayPublicKey, "PUBLIC"), content, sign);
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
    timestamp: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19).replace("T", " "),
    version: "1.0",
    biz_content: JSON.stringify({ out_trade_no: outTradeNo, total_amount: Number(amount).toFixed(2), subject }),
  };
  if (notifyUrl) p.notify_url = notifyUrl;
  p.sign = await alipaySign(p, cfg.pay_alipay_private_key);
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
export async function parseAlipayNotify(params, cfg) {
  const appId = String(params.app_id || "");
  if (cfg.pay_alipay_app_id && appId !== cfg.pay_alipay_app_id) return { ok: false, reason: "app_id 不匹配" };
  const verified = await alipayVerify(params, cfg.pay_alipay_public_key, params.sign);
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

export async function wechatAuthHeader({ method, urlPath, body, mchId, serialNo, privateKey }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = [...nonceBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = await rsaSign(pemToDer(privateKey), message);
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
  const authorization = await wechatAuthHeader({
    method: "POST",
    urlPath,
    body,
    mchId: cfg.pay_wechat_mch_id,
    serialNo: cfg.pay_wechat_serial_no,
    privateKey: cfg.pay_wechat_private_key,
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
export async function decryptWechatResource(resource, apiV3Key) {
  const key = enc.encode(String(apiV3Key));
  if (key.length !== 32) throw new Error("微信 APIv3 密钥必须为 32 位");
  const bin = atob(String(resource.ciphertext || ""));
  const data = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const ciphertext = data.subarray(0, data.length - 16);
  const authTag = data.subarray(data.length - 16);
  // WebCrypto 的 AES-GCM 密文格式为 ciphertext||tag
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);
  const additionalData = resource.associated_data ? enc.encode(resource.associated_data) : undefined;
  const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: enc.encode(String(resource.nonce || "")), additionalData },
    cryptoKey,
    combined
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

/* 校验微信回调签名（配置了平台证书时执行，RSA-SHA256） */
export async function verifyWechatNotify({ headers, body, platformCert }) {
  try {
    const timestamp = headers["wechatpay-timestamp"];
    const nonce = headers["wechatpay-nonce"];
    const signature = headers["wechatpay-signature"];
    if (!timestamp || !nonce || !signature || !platformCert) return false;
    const message = `${timestamp}\n${nonce}\n${body}\n`;
    return await rsaVerify(pemToDer(platformCert, "PUBLIC"), message, signature);
  } catch {
    return false;
  }
}
