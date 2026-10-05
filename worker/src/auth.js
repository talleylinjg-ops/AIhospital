// 认证工具：密码哈希（PBKDF2 新格式 + scrypt 旧格式兼容）与 JWT 会话
// Workers 无 node:crypto，scrypt 旧哈希用纯 JS scrypt-js 验证，验证通过后自动升级为 PBKDF2
import scrypt from "scrypt-js";

const PBKDF2_ITERATIONS = 100000;
const KEY_LEN = 64;

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDecode = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (h) => Uint8Array.from(h.match(/.{2}/g), (c) => parseInt(c, 16));

function subtle() {
  return globalThis.crypto.subtle;
}

/* ===== 密码哈希 ===== */

async function pbkdf2Hash(password) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await subtle().importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, KEY_LEN * 8);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex(salt)}$${hex(bits)}`;
}

async function pbkdf2Verify(password, stored) {
  const [, iterStr, saltHex, hashHex] = stored.split("$");
  const key = await subtle().importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: Number(iterStr) },
    key,
    hashHex.length * 4
  );
  return hex(bits) === hashHex;
}

/* 旧版 Node scrypt 哈希格式：salt(16B hex 字符串):hash(64B hex)
   注意：原实现直接把 hex 字符串（utf8 字节，32B）作为 scrypt 的 salt，参数 (N=16384, r=8, p=1) */
async function scryptVerify(password, stored) {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const derived = await scrypt.scrypt(
      new TextEncoder().encode(password),
      new TextEncoder().encode(saltHex),
      16384,
      8,
      1,
      hashHex.length / 2
    );
    return hex(derived) === hashHex;
  } catch {
    return false;
  }
}

export async function hashPassword(password) {
  return pbkdf2Hash(String(password || ""));
}

/* 验证密码；legacy 为 true 表示命中旧 scrypt 哈希，调用方应重哈希升级 */
export async function verifyPassword(password, stored) {
  const s = String(stored || "");
  if (!s) return { ok: false };
  if (s.startsWith("pbkdf2$")) return { ok: await pbkdf2Verify(password, s) };
  return { ok: await scryptVerify(password, s), legacy: true };
}

/* ===== JWT（HS256） ===== */

function jwtKey() {
  const secret = String(globalThis.JWT_SECRET || "");
  if (!secret) throw new Error("JWT_SECRET 未配置");
  return subtle().importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signJwt(payload, ttlMs) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + Math.floor(ttlMs / 1000) })));
  const sig = await subtle().sign("HMAC", await jwtKey(), new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(sig)}`;
}

/* 返回 payload 或 null */
export async function verifyJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const ok = await subtle().verify("HMAC", await jwtKey(), b64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    if (!payload.exp || Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function bearerToken(request) {
  const h = String(request.headers.get("Authorization") || "");
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

export function randomToken(bytes = 12) {
  return hex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}
