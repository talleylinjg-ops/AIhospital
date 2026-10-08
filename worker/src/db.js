// D1 数据层：函数签名对齐 server/db.js，全部异步化
// 时间策略：D1 的 datetime('now') 为 UTC，为与原 Node 版 localtime(UTC+8) 行为一致，
// 所有写入显式传 Asia/Shanghai 时间字符串，日期统计用 :today 参数
import LLM_PRESETS from "./llm-presets.js";
import { hashPassword, verifyPassword } from "./auth.js";

export const PROVIDER_CATEGORIES = ["国内通用", "海外通用", "国内垂直", "海外垂直"];
export const PROVIDER_SCENES = ["fast", "clinic", "emergency", "wellness", "maternal"];
export const SCENE_LABELS = { fast: "快诊", clinic: "门诊", emergency: "急诊", wellness: "保健", maternal: "妇幼" };

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS consultations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  risk_level TEXT,
  chief_complaint TEXT,
  name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  customer_id INTEGER,
  form_data TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  note TEXT DEFAULT '',
  password_hash TEXT DEFAULT '',
  balance REAL NOT NULL DEFAULT 0,
  profile TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  balance_after REAL NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  ref_type TEXT DEFAULT '',
  ref_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  unit TEXT DEFAULT '次',
  description TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 10,
  needs_doc INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  service_id INTEGER,
  service_name TEXT NOT NULL,
  unit_price REAL NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL DEFAULT 1,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '已付款',
  note TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT '后台登记',
  out_trade_no TEXT DEFAULT '',
  pay_channel TEXT DEFAULT '',
  pay_qr TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS llm_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  base_url TEXT DEFAULT '',
  model TEXT DEFAULT '',
  api_key TEXT DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  category TEXT DEFAULT '国内通用',
  note TEXT DEFAULT '',
  scenes TEXT NOT NULL DEFAULT 'clinic',
  priority INTEGER NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS recharge_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  channel TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT '待支付',
  out_trade_no TEXT DEFAULT '',
  qr TEXT DEFAULT '',
  trade_no TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT '其他',
  label TEXT NOT NULL DEFAULT '未命名',
  mime TEXT DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  stored TEXT NOT NULL,
  consult_id INTEGER,
  purchase_id INTEGER,
  customer_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consult_level ON consultations(level);
CREATE INDEX IF NOT EXISTS idx_consult_risk ON consultations(risk_level);
CREATE INDEX IF NOT EXISTS idx_consult_created ON consultations(created_at);
CREATE INDEX IF NOT EXISTS idx_consult_phone ON consultations(phone);
CREATE INDEX IF NOT EXISTS idx_consult_customer ON consultations(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE phone <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_out_trade ON purchases(out_trade_no) WHERE out_trade_no <> '';
CREATE INDEX IF NOT EXISTS idx_att_consult ON attachments(consult_id);
CREATE INDEX IF NOT EXISTS idx_att_purchase ON attachments(purchase_id);
CREATE INDEX IF NOT EXISTS idx_att_customer ON attachments(customer_id);
`;

const MEMBER_SEED = [
  { name: "会员服务 · 基础会员", price: 0, unit: "", description: "注册即享有限免费 AI 问诊与报告额度" },
  { name: "会员服务 · 月付会员", price: 9.9, unit: "月", description: "AI 健康问诊每月给定额流量" },
  { name: "会员服务 · 年付会员", price: 99.9, unit: "年", description: "AI 健康问诊每年给定额流量" },
];
const CHRONIC_SEED = [
  { name: "AI 慢病管理年度套餐", price: 999.5, unit: "年", description: "全年慢病随访 + 报告解读 + 用药与生活方式指导", sort: 9 },
  { name: "AI 慢病管理月度套餐", price: 99.9, unit: "月", description: "慢病随访 + 报告解读", sort: 10 },
];
const DOC_SERVICE_NAMES = ["AI 慢病管理年度套餐", "AI 慢病管理月度套餐"];

let db = null;
let initPromise = null;

export function nowSh(offsetMs = 0) {
  return new Date(Date.now() + 8 * 3600e3 + offsetMs).toISOString().slice(0, 19).replace("T", " ");
}
export function todaySh() {
  return nowSh().slice(0, 10);
}

/* 幂等初始化：建表 + 默认管理员 + 服务种子 + LLM 预置补种；同一隔离实例只执行一次 */
export function initDb(env) {
  if (initPromise) return initPromise;
  db = env.DB;
  // JWT 密钥由 env 注入（auth.js 从 globalThis 读取）
  globalThis.JWT_SECRET = String(env.JWT_SECRET || "");
  initPromise = (async () => {
    // D1 exec 按行切分会截断多行语句，改为按分号拆分逐条执行
    const stmts = SCHEMA_SQL.split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s));
    await db.batch(stmts);
    const now = nowSh();
    const adminCount = await db.prepare("SELECT COUNT(*) AS n FROM admin_users").first("n");
    if (adminCount === 0) {
      const username = String(env.ADMIN_USERNAME || "admin").trim() || "admin";
      const password = env.ADMIN_PASSWORD || "admin123456";
      await db
        .prepare("INSERT INTO admin_users (username, password_hash, created_at) VALUES (?, ?, ?)")
        .bind(username, await hashPassword(password), now)
        .run();
    }
    for (const s of [...MEMBER_SEED.map((x) => ({ ...x, sort: 1 })), ...CHRONIC_SEED]) {
      const hit = await db.prepare("SELECT 1 FROM services WHERE name = ?").bind(s.name).first();
      if (!hit) {
        await db
          .prepare("INSERT INTO services (name, price, unit, description, active, sort_order) VALUES (?, ?, ?, ?, 1, ?)")
          .bind(s.name, s.price, s.unit, s.description, s.sort ?? 1)
          .run();
      }
    }
    for (const n of DOC_SERVICE_NAMES) {
      await db.prepare("UPDATE services SET needs_doc = 1 WHERE name = ?").bind(n).run();
    }
    await initLLMProviders(env, now);
  })();
  return initPromise;
}

async function initLLMProviders(env, now) {
  const insert = db.prepare(
    "INSERT INTO llm_providers (name, base_url, model, api_key, enabled, category, note, scenes, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const envKey = String(env.USER_LLM_API_KEY || "").trim();
  const hasRealEnvKey = Boolean(envKey) && envKey !== "your-api-key-here";
  const envBaseUrl = String(env.USER_LLM_BASE_URL || "").trim().replace(/\/+$/, "");
  const envModel = String(env.USER_LLM_MODEL || "").trim();
  const existingRows = await db.prepare("SELECT name FROM llm_providers").all();
  const existing = new Set(existingRows.results.map((r) => r.name));
  for (const p of LLM_PRESETS) {
    if (existing.has(p.name)) continue;
    const isDeepSeek = p.name === "DeepSeek V4-Pro";
    await insert
      .bind(
        p.name,
        isDeepSeek && envBaseUrl ? envBaseUrl : p.base_url,
        isDeepSeek && envModel ? envModel : p.model,
        isDeepSeek && hasRealEnvKey ? envKey : "",
        0,
        p.category,
        p.note,
        p.scenes,
        p.priority
      )
      .run();
  }
  // 未填 Key 的预置行始终跟随最新预置元数据（用户填过 Key 的行不被覆盖）
  const syncPreset = db.prepare(
    "UPDATE llm_providers SET base_url = ?, model = ?, category = ?, note = ?, scenes = ?, priority = ? WHERE name = ? AND api_key = ''"
  );
  for (const p of LLM_PRESETS) {
    await syncPreset.bind(p.base_url, p.model, p.category, p.note, p.scenes, p.priority, p.name).run();
  }
  const anyEnabled = await db.prepare("SELECT COUNT(*) AS n FROM llm_providers WHERE enabled = 1").first("n");
  if (!anyEnabled) {
    const preferred =
      (await db.prepare("SELECT id FROM llm_providers WHERE name = 'DeepSeek V4-Pro' AND api_key <> ''").first("id")) ||
      (await db.prepare("SELECT id FROM llm_providers WHERE name = 'DeepSeek V4-Pro'").first("id"));
    if (preferred) {
      await db.prepare("UPDATE llm_providers SET enabled = 1 WHERE id = ?").bind(preferred).run();
    }
  }
}

/* ==================== 大模型配置 ==================== */

export function normalizeScenes(input, fallback = "clinic") {
  const parts = String(input || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => PROVIDER_SCENES.includes(s));
  return parts.length ? [...new Set(parts)].join(",") : fallback;
}

function maskKey(key) {
  const k = String(key || "");
  if (!k) return "";
  if (k.length <= 8) return k.slice(0, 2) + "****";
  return k.slice(0, 5) + "****" + k.slice(-4);
}

function toPublicProvider(row) {
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    model: row.model,
    enabled: row.enabled,
    category: PROVIDER_CATEGORIES.includes(row.category) ? row.category : "国内通用",
    note: row.note || "",
    scenes: normalizeScenes(row.scenes),
    scene_labels: normalizeScenes(row.scenes).split(",").map((s) => SCENE_LABELS[s] || s),
    priority: Number(row.priority) || 100,
    has_key: Boolean(row.api_key),
    key_masked: maskKey(row.api_key),
  };
}

export async function listLLMProviders() {
  const r = await db.prepare("SELECT * FROM llm_providers ORDER BY enabled DESC, id ASC").all();
  return r.results.map(toPublicProvider);
}
export async function getLLMProviderRow(id) {
  return (await db.prepare("SELECT * FROM llm_providers WHERE id = ?").bind(Number(id)).first()) || null;
}
export async function createLLMProvider({ name, base_url, model, api_key, enabled, category, note, scenes, priority } = {}) {
  const n = String(name || "").trim();
  if (!n) throw new Error("配置名称不能为空");
  const url = String(base_url || "").trim().replace(/\/+$/, "");
  if (url && !/^https?:\/\//.test(url)) throw new Error("API 地址需以 http(s):// 开头");
  const m = String(model || "").trim();
  if (!m) throw new Error("模型名称不能为空");
  const cat = PROVIDER_CATEGORIES.includes(category) ? category : "国内通用";
  const prio = Math.max(1, Math.min(999, Number(priority) || 100));
  const r = await db
    .prepare(
      "INSERT INTO llm_providers (name, base_url, model, api_key, enabled, category, note, scenes, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(n, url, m, String(api_key || "").trim(), enabled ? 1 : 0, cat, String(note || "").trim(), normalizeScenes(scenes), prio)
    .run();
  return r.meta.last_row_id;
}
export async function updateLLMProvider(id, data = {}) {
  const cur = await getLLMProviderRow(id);
  if (!cur) throw new Error("配置不存在");
  const n = String(data.name ?? cur.name).trim();
  if (!n) throw new Error("配置名称不能为空");
  const url = String(data.base_url ?? cur.base_url).trim().replace(/\/+$/, "");
  if (url && !/^https?:\/\//.test(url)) throw new Error("API 地址需以 http(s):// 开头");
  const m = String(data.model ?? cur.model).trim();
  if (!m) throw new Error("模型名称不能为空");
  const cat = PROVIDER_CATEGORIES.includes(data.category)
    ? data.category
    : PROVIDER_CATEGORIES.includes(cur.category)
      ? cur.category
      : "国内通用";
  const key = String(data.api_key ?? "").trim();
  const note = String(data.note ?? cur.note).trim();
  const scenes = data.scenes === undefined ? normalizeScenes(cur.scenes) : normalizeScenes(data.scenes);
  const prio = data.priority === undefined ? Number(cur.priority) || 100 : Math.max(1, Math.min(999, Number(data.priority) || 100));
  await db
    .prepare("UPDATE llm_providers SET name = ?, base_url = ?, model = ?, api_key = ?, category = ?, note = ?, scenes = ?, priority = ? WHERE id = ?")
    .bind(n, url, m, key || cur.api_key, cat, note, scenes, prio, Number(id))
    .run();
  return toPublicProvider(await getLLMProviderRow(id));
}
export async function removeLLMProvider(id) {
  const cur = await getLLMProviderRow(id);
  if (!cur) throw new Error("配置不存在");
  await db.prepare("DELETE FROM llm_providers WHERE id = ?").bind(Number(id)).run();
  return (await providersCount()) === 0;
}
export async function toggleLLMProvider(id, enabled) {
  const cur = await getLLMProviderRow(id);
  if (!cur) throw new Error("配置不存在");
  if (enabled && !cur.api_key) throw new Error("请先编辑该配置并填入 API Key");
  await db.prepare("UPDATE llm_providers SET enabled = ? WHERE id = ?").bind(enabled ? 1 : 0, Number(id)).run();
  return toPublicProvider(await getLLMProviderRow(id));
}
export async function enableLLMProvider(id) {
  return toggleLLMProvider(id, true);
}
export async function listProviderRowsForScene(scene) {
  const s = PROVIDER_SCENES.includes(scene) ? scene : "clinic";
  const r = await db
    .prepare(
      "SELECT * FROM llm_providers WHERE enabled = 1 AND api_key <> '' AND base_url <> '' AND (',' || scenes || ',') LIKE ?1 ORDER BY priority ASC, id ASC"
    )
    .bind(`%,${s},%`)
    .all();
  return r.results;
}
export async function listProvidersForScene(scene) {
  return (await listProviderRowsForScene(scene)).map(toPublicProvider);
}
export async function listAllEnabledProviderRows() {
  const r = await db
    .prepare("SELECT * FROM llm_providers WHERE enabled = 1 AND api_key <> '' AND base_url <> '' ORDER BY priority ASC, id ASC")
    .all();
  return r.results;
}
export async function listEnabledProviders() {
  const r = await listAllEnabledProviderRows();
  return r.map(toPublicProvider);
}
export async function providersCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM llm_providers").first("n");
}

/* ==================== 管理员账号 ==================== */

export async function findUser(username) {
  return (
    (await db
      .prepare("SELECT * FROM admin_users WHERE username = ?")
      .bind(String(username || "").trim())
      .first()) || null
  );
}
export async function getUser(id) {
  return (
    (await db
      .prepare("SELECT id, username, created_at FROM admin_users WHERE id = ?")
      .bind(id)
      .first()) || null
  );
}
export async function checkUserPassword(username, password) {
  const user = await findUser(username);
  if (!user) return null;
  const { ok, legacy } = await verifyPassword(String(password || ""), user.password_hash);
  if (!ok) return null;
  if (legacy) {
    await db
      .prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?")
      .bind(await hashPassword(String(password)), user.id)
      .run();
  }
  return user;
}
export async function updateUserAccount(userId, { username, newPassword }) {
  const user = await getUser(userId);
  if (!user) throw new Error("账号不存在");
  if (username !== undefined && username !== user.username) {
    const name = String(username).trim();
    if (name.length < 2 || name.length > 30) throw new Error("账号长度需在 2-30 个字符");
    const exists = await findUser(name);
    if (exists) throw new Error("该账号已被使用");
    await db.prepare("UPDATE admin_users SET username = ? WHERE id = ?").bind(name, userId).run();
  }
  if (newPassword) {
    const pw = String(newPassword);
    if (pw.length < 6) throw new Error("新密码至少 6 位");
    await db
      .prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?")
      .bind(await hashPassword(pw), userId)
      .run();
  }
  return getUser(userId);
}

/* ==================== 客户 / 会员 ==================== */

export async function ensureCustomer(name, phone) {
  const n = String(name || "").trim();
  const p = String(phone || "").trim();
  if (!n && !p) return null;
  if (p) {
    const byPhone = await db.prepare("SELECT id FROM customers WHERE phone = ? AND phone <> ''").bind(p).first("id");
    if (byPhone) return byPhone;
  }
  if (n && !p) {
    const byName = await db
      .prepare("SELECT id FROM customers WHERE name = ? AND name <> '' AND (phone = '' OR phone IS NULL)")
      .bind(n)
      .first("id");
    if (byName) return byName;
  }
  const r = await db.prepare("INSERT INTO customers (name, phone, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(n, p, nowSh(), nowSh()).run();
  return r.meta.last_row_id;
}

export async function listCustomers({ page = 1, pageSize = 20, keyword = "" } = {}) {
  const kw = keyword ? `%${keyword}%` : null;
  const offset = (Math.max(1, page) - 1) * pageSize;
  const where = "WHERE (?1 IS NULL OR c.phone LIKE ?1 OR c.name LIKE ?1 OR c.note LIKE ?1)";
  const total =
    (
      await db
        .prepare(`SELECT COUNT(*) AS total FROM customers c ${where}`)
        .bind(kw)
        .first("total")
    ) || 0;
  const r = await db
    .prepare(`
    SELECT c.id, c.name, c.phone, c.note, c.balance, c.profile, c.created_at, c.updated_at,
      (c.password_hash <> '') AS is_member,
      (SELECT COUNT(*) FROM consultations cs WHERE cs.customer_id = c.id) AS consult_count,
      (SELECT MIN(created_at) FROM consultations cs WHERE cs.customer_id = c.id) AS first_at,
      (SELECT MAX(created_at) FROM consultations cs WHERE cs.customer_id = c.id) AS last_at,
      (SELECT COUNT(*) FROM consultations cs WHERE cs.customer_id = c.id AND cs.risk_level = '立即急诊') AS high_risk_count,
      (SELECT COUNT(*) FROM purchases p WHERE p.customer_id = c.id) AS purchase_count,
      (SELECT IFNULL(SUM(amount), 0) FROM purchases p WHERE p.customer_id = c.id AND p.status = '已付款') AS paid_total,
      (SELECT IFNULL(SUM(amount), 0) FROM purchases p WHERE p.customer_id = c.id) AS amount_total
    FROM customers c
    ${where}
    ORDER BY (SELECT MAX(created_at) FROM consultations cs WHERE cs.customer_id = c.id) DESC, c.id DESC
    LIMIT ?2 OFFSET ?3
  `)
    .bind(kw, pageSize, offset)
    .all();
  return { total, page: Math.max(1, page), pageSize, records: r.results };
}

export async function getCustomer(id) {
  return (
    (await db
      .prepare("SELECT id, name, phone, note, balance, profile, created_at, updated_at FROM customers WHERE id = ?")
      .bind(Number(id))
      .first()) || null
  );
}
export async function getCustomerAuthRow(id) {
  return (await db.prepare("SELECT * FROM customers WHERE id = ?").bind(Number(id)).first()) || null;
}

export async function createCustomer({ name, phone, note } = {}) {
  const n = String(name || "").trim();
  const p = String(phone || "").trim();
  if (!n && !p) throw new Error("称呼和手机号至少填一项");
  if (p) {
    const dup = await db.prepare("SELECT id FROM customers WHERE phone = ? AND phone <> ''").bind(p).first();
    if (dup) throw new Error("该手机号已存在会员档案");
  }
  const r = await db
    .prepare("INSERT INTO customers (name, phone, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(n, p, nowSh(), nowSh())
    .run();
  const id = r.meta.last_row_id;
  if (note) await updateCustomer(id, { name: n, phone: p, note });
  return id;
}

export async function updateCustomer(id, { name, phone, note }) {
  const cur = await getCustomer(id);
  if (!cur) throw new Error("客户不存在");
  const n = String(name ?? cur.name).trim();
  const p = String(phone ?? cur.phone).trim();
  if (p) {
    const dup = await db.prepare("SELECT id FROM customers WHERE phone = ? AND phone <> ''").bind(p).first("id");
    if (dup && dup !== Number(id)) throw new Error("该手机号已属于其他客户");
  }
  await db
    .prepare("UPDATE customers SET name = ?, phone = ?, note = ?, updated_at = ? WHERE id = ?")
    .bind(n, p, String(note ?? cur.note).slice(0, 500), nowSh(), Number(id))
    .run();
  return getCustomer(id);
}

export async function removeCustomer(id) {
  const cur = await getCustomer(id);
  if (!cur) throw new Error("客户不存在");
  await db.batch([
    db.prepare("DELETE FROM customers WHERE id = ?").bind(Number(id)),
    db.prepare("UPDATE consultations SET customer_id = NULL WHERE customer_id = ?").bind(Number(id)),
  ]);
}

export async function customersCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM customers").first("n");
}

export async function getMemberAuth(id) {
  return getCustomerAuthRow(id);
}

export async function registerMember({ phone, password, name } = {}) {
  const p = String(phone || "").trim();
  const pw = String(password || "");
  const n = String(name || "").trim().slice(0, 20);
  if (!/^1\d{10}$/.test(p)) throw new Error("请输入 11 位大陆手机号");
  if (pw.length < 6 || pw.length > 64) throw new Error("密码长度需为 6-64 位");
  const exist = await db.prepare("SELECT id FROM customers WHERE phone = ? AND phone <> ''").bind(p).first("id");
  if (exist) {
    const cur = await getCustomerAuthRow(exist);
    if (cur && cur.password_hash) throw new Error("该手机号已注册为会员，请直接登录");
    await db
      .prepare("UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?")
      .bind(await hashPassword(pw), nowSh(), exist)
      .run();
    if (n) await db.prepare("UPDATE customers SET name = ? WHERE id = ?").bind(n, exist).run();
    return getCustomer(exist);
  }
  const r = await db
    .prepare("INSERT INTO customers (name, phone, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(n || `会员${p.slice(-4)}`, p, nowSh(), nowSh())
    .run();
  const id = r.meta.last_row_id;
  await db
    .prepare("UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?")
    .bind(await hashPassword(pw), nowSh(), id)
    .run();
  return getCustomer(id);
}

export async function verifyMemberPassword(id, password) {
  const cur = await getCustomerAuthRow(Number(id));
  if (!cur || !cur.password_hash) return { ok: false };
  const { ok, legacy } = await verifyPassword(String(password || ""), cur.password_hash);
  if (ok && legacy) {
    await db
      .prepare("UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?")
      .bind(await hashPassword(String(password)), nowSh(), cur.id)
      .run();
  }
  return { ok };
}

export async function setMemberPassword(id, newPassword) {
  const pw = String(newPassword || "");
  if (pw.length < 6 || pw.length > 64) throw new Error("密码长度需为 6-64 位");
  await db
    .prepare("UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?")
    .bind(await hashPassword(pw), nowSh(), Number(id))
    .run();
}

export async function findMemberIdByPhone(phone) {
  const r = await db.prepare("SELECT id FROM customers WHERE phone = ? AND phone <> ''").bind(String(phone || "").trim()).first("id");
  return r || null;
}

const HEALTH_KEYS = [
  "gender", "age", "height_weight", "region", "occupation_lifestyle",
  "chronic_history", "past_major_events", "rare_disease_history",
  "current_medications", "recent_medications", "drug_allergies", "food_allergies",
  "family_history", "family_similar", "smoking_alcohol", "daily_habits",
  "female_special", "prior_exams",
];

function parseProfile(row) {
  try {
    return JSON.parse(row?.profile || "{}");
  } catch {
    return {};
  }
}

export async function readHealthProfile(id) {
  return parseProfile(await getCustomer(Number(id)));
}

export async function saveHealthProfile(id, data = {}) {
  const c = await getCustomer(Number(id));
  if (!c) throw new Error("客户不存在");
  const base = parseProfile(c);
  for (const k of HEALTH_KEYS) {
    if (k in data) {
      const v = data[k];
      base[k] = Array.isArray(v) ? v.join("、") : String(v ?? "").trim();
    }
  }
  await db
    .prepare("UPDATE customers SET profile = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(base), nowSh(), Number(id))
    .run();
  return base;
}

export async function rechargeBalance(customerId, amountRaw, title = "余额充值") {
  const id = Number(customerId);
  const c = await getCustomer(id);
  if (!c) throw new Error("客户不存在");
  const amt = Math.round(Number(amountRaw) * 100) / 100;
  if (!(amt > 0) || amt > 10000) throw new Error("充值金额需在 1-10000 元之间");
  const next = Math.round((c.balance + amt) * 100) / 100;
  await db.batch([
    db.prepare("UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?").bind(next, nowSh(), id),
    db
      .prepare("INSERT INTO wallet_ledger (customer_id, kind, amount, balance_after, title, ref_type, ref_id, created_at) VALUES (?, ?, ?, ?, ?, '', NULL, ?)")
      .bind(id, "充值", amt, next, String(title).slice(0, 50), nowSh()),
  ]);
  return next;
}

export async function payServiceByBalance(customerId, { serviceId, qty = 1, note = "" } = {}) {
  const id = Number(customerId);
  const c = await getCustomer(id);
  if (!c) throw new Error("客户不存在");
  const sid = Number(serviceId);
  const service = await getService(sid);
  if (!service || !service.active) throw new Error("服务项目不存在或已停用");
  const q = Math.max(1, Math.min(99, Number(qty) || 1));
  const amount = Math.round(service.price * q * 100) / 100;
  if (amount > 0 && c.balance < amount) {
    throw new Error(`余额不足（当前余额 ¥${Number(c.balance).toFixed(2)}），请先充值或选择客服线下付款`);
  }
  const now = nowSh();
  // D1 batch 为单事务：先建订单，余额扣减与流水在后续语句中执行；
  // 流水的 ref_id 用子查询引用同事务内刚插入的订单
  const stmts = [
    db
      .prepare(
        "INSERT INTO purchases (customer_id, service_id, service_name, unit_price, qty, amount, status, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?, '已付款', ?, '余额支付', ?)"
      )
      .bind(id, sid, service.name, service.price, q, amount, String(note || "").slice(0, 300), now),
  ];
  let balance = Number(c.balance);
  if (amount > 0) {
    balance = Math.round((c.balance - amount) * 100) / 100;
    stmts.push(db.prepare("UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?").bind(balance, now, id));
    stmts.push(
      db
        .prepare(
          "INSERT INTO wallet_ledger (customer_id, kind, amount, balance_after, title, ref_type, ref_id, created_at) VALUES (?, '消费', ?, ?, ?, 'purchase', (SELECT id FROM purchases WHERE customer_id = ? ORDER BY id DESC LIMIT 1), ?)"
        )
        .bind(id, -amount, balance, `购买：${service.name}`, id, now)
    );
  }
  const results = await db.batch(stmts);
  const purchaseId = results[0].meta.last_row_id;
  return { purchaseId, balance, amount };
}

export async function walletLedger(customerId, limit = 200) {
  const r = await db
    .prepare(`
    SELECT id, kind, amount, balance_after, title, ref_type, created_at
    FROM wallet_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT ?
  `)
    .bind(Number(customerId), Math.min(500, Math.max(1, Number(limit) || 200)))
    .all();
  return r.results;
}

/* ==================== 系统设置 ==================== */

export async function getSetting(key) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(String(key)).first("value");
  return r || "";
}
export async function setSetting(key, value) {
  await db
    .prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    )
    .bind(String(key), String(value ?? ""), nowSh())
    .run();
}
export async function getSettings(keys = []) {
  const out = {};
  for (const k of keys) out[k] = await getSetting(k);
  return out;
}

/* ==================== 在线充值订单 ==================== */

export async function createRechargeOrder({ customerId, amount, channel, outTradeNo, qr = "" } = {}) {
  const id = Number(customerId);
  const c = await getCustomer(id);
  if (!c) throw new Error("客户不存在");
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!(amt > 0) || amt > 10000) throw new Error("充值金额需在 1-10000 元之间");
  const r = await db
    .prepare("INSERT INTO recharge_orders (customer_id, amount, channel, status, out_trade_no, qr, created_at) VALUES (?, ?, ?, '待支付', ?, ?, ?)")
    .bind(id, amt, String(channel || "manual"), String(outTradeNo || ""), String(qr || ""), nowSh())
    .run();
  return r.meta.last_row_id;
}
export async function getRechargeOrder(id) {
  return (await db.prepare("SELECT * FROM recharge_orders WHERE id = ?").bind(Number(id)).first()) || null;
}
export async function getRechargeOrderByOutTradeNo(outTradeNo) {
  return (await db.prepare("SELECT * FROM recharge_orders WHERE out_trade_no = ?").bind(String(outTradeNo)).first()) || null;
}
export async function listRechargeOrders({ status = "" } = {}) {
  const r = await db
    .prepare(`
    SELECT r.*, c.name AS customer_name, c.phone AS customer_phone
    FROM recharge_orders r LEFT JOIN customers c ON c.id = r.customer_id
    WHERE (?1 IS NULL OR r.status = ?1)
    ORDER BY r.id DESC LIMIT 200
  `)
    .bind(status || null)
    .all();
  return r.results;
}

/* 订单到账（幂等）：入账并记流水 */
export async function confirmRechargeOrder(id, tradeNo = "") {
  const row = await getRechargeOrder(id);
  if (!row) throw new Error("充值订单不存在");
  if (row.status === "已付款") return { order: row, alreadyPaid: true };
  const changed = await db
    .prepare("UPDATE recharge_orders SET status = '已付款', trade_no = ?, paid_at = ? WHERE id = ? AND status <> '已付款'")
    .bind(String(tradeNo || ""), nowSh(), Number(id))
    .run();
  if (!changed.meta.changes) return { order: await getRechargeOrder(id), alreadyPaid: true };
  const c = await getCustomer(row.customer_id);
  const next = Math.round(((c ? Number(c.balance) : 0) + row.amount) * 100) / 100;
  const title = row.channel === "alipay" ? "支付宝充值" : row.channel === "wechat" ? "微信充值" : "在线充值（确认到账）";
  await db.batch([
    db.prepare("UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?").bind(next, nowSh(), row.customer_id),
    db
      .prepare("INSERT INTO wallet_ledger (customer_id, kind, amount, balance_after, title, ref_type, ref_id, created_at) VALUES (?, '充值', ?, ?, ?, 'recharge', ?, ?)")
      .bind(row.customer_id, row.amount, next, title, row.id, nowSh()),
  ]);
  return { order: await getRechargeOrder(id), balance: next, alreadyPaid: false };
}

/* ==================== 问诊记录 ==================== */

export async function getMemberConsults(customerId) {
  const r = await db
    .prepare(`
    SELECT id, level, risk_level, chief_complaint, name, phone, created_at
    FROM consultations WHERE customer_id = ? ORDER BY id DESC
  `)
    .bind(Number(customerId))
    .all();
  return r.results;
}

export async function getMemberConsult(customerId, consultId) {
  const r = await db
    .prepare(`
    SELECT id, level, risk_level, chief_complaint, name, phone, customer_id, created_at, form_data, result
    FROM consultations WHERE id = ? AND customer_id = ?
  `)
    .bind(Number(consultId), Number(customerId))
    .first();
  if (!r) return null;
  return { ...r, form_data: JSON.parse(r.form_data || "{}"), result: JSON.parse(r.result || "{}") };
}

function cleanStr(v, max = 50) {
  return String(v ?? "").trim().slice(0, max);
}

export async function insertConsultation({ level, formData, result, memberCustomerId = null } = {}) {
  const risk = result && result.risk_level ? String(result.risk_level) : "";
  const complaint = formData && formData.chief_complaint ? String(formData.chief_complaint).slice(0, 200) : "";
  const name = cleanStr(formData?.name);
  const phone = cleanStr(formData?.phone);
  const customerId = Number(memberCustomerId) > 0 ? Number(memberCustomerId) : await ensureCustomer(name, phone);
  const r = await db
    .prepare(`
    INSERT INTO consultations (level, risk_level, chief_complaint, name, phone, customer_id, form_data, result, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      level,
      risk,
      complaint,
      name,
      phone,
      customerId || null,
      JSON.stringify(formData || {}),
      JSON.stringify(result || {}),
      nowSh()
    )
    .run();
  return r.meta.last_row_id;
}

export async function listConsultations({ page = 1, pageSize = 20, level = "", riskLevel = "", keyword = "" } = {}) {
  const lv = level || null;
  const risk = riskLevel || null;
  const kw = keyword ? `%${keyword}%` : null;
  const offset = (Math.max(1, page) - 1) * pageSize;
  const cols = "id, level, risk_level, chief_complaint, name, phone, created_at";
  const filter = "WHERE (?1 IS NULL OR level = ?1) AND (?2 IS NULL OR risk_level = ?2)";
  const search = `${filter} AND (?3 IS NULL OR phone LIKE ?3 OR name LIKE ?3 OR chief_complaint LIKE ?3)`;
  let total;
  let rows;
  if (kw) {
    total = await db.prepare(`SELECT COUNT(*) AS total FROM consultations ${search}`).bind(lv, risk, kw).first("total");
    rows = (
      await db
        .prepare(`SELECT ${cols} FROM consultations ${search} ORDER BY id DESC LIMIT ?4 OFFSET ?5`)
        .bind(lv, risk, kw, pageSize, offset)
        .all()
    ).results;
  } else if (lv || risk) {
    total = await db.prepare(`SELECT COUNT(*) AS total FROM consultations ${filter}`).bind(lv, risk).first("total");
    rows = (
      await db
        .prepare(`SELECT ${cols} FROM consultations ${filter} ORDER BY id DESC LIMIT ?3 OFFSET ?4`)
        .bind(lv, risk, pageSize, offset)
        .all()
    ).results;
  } else {
    total = await db.prepare(`SELECT COUNT(*) AS total FROM consultations`).first("total");
    rows = (
      await db.prepare(`SELECT ${cols} FROM consultations ORDER BY id DESC LIMIT ? OFFSET ?`).bind(pageSize, offset).all()
    ).results;
  }
  return { total, page: Math.max(1, page), pageSize, records: rows };
}

export async function getConsultation(id) {
  const row = await db.prepare("SELECT * FROM consultations WHERE id = ?").bind(Number(id)).first();
  if (!row) return null;
  return {
    id: row.id,
    level: row.level,
    risk_level: row.risk_level,
    chief_complaint: row.chief_complaint,
    name: row.name,
    phone: row.phone,
    created_at: row.created_at,
    form_data: JSON.parse(row.form_data || "{}"),
    result: JSON.parse(row.result || "{}"),
  };
}

export async function getCustomerConsults(customerId) {
  const r = await db
    .prepare(`
    SELECT id, level, risk_level, chief_complaint, name, phone, created_at
    FROM consultations WHERE customer_id = ? ORDER BY id DESC
  `)
    .bind(Number(customerId))
    .all();
  return r.results;
}

export async function exportConsultations() {
  const r = await db
    .prepare("SELECT id, level, risk_level, chief_complaint, name, phone, created_at, form_data, result FROM consultations ORDER BY id DESC")
    .all();
  return r.results.map((row) => ({ ...row, form_data: JSON.parse(row.form_data || "{}"), result: JSON.parse(row.result || "{}") }));
}

/* ==================== 服务项目 ==================== */

export async function listServices() {
  const r = await db.prepare("SELECT * FROM services ORDER BY id DESC").all();
  return r.results;
}
export async function getService(id) {
  return (await db.prepare("SELECT * FROM services WHERE id = ?").bind(Number(id)).first()) || null;
}
export async function createService({ name, price, unit, description, active, needs_doc } = {}) {
  const n = String(name || "").trim();
  if (!n) throw new Error("项目名称不能为空");
  const r = await db
    .prepare(
      "INSERT INTO services (name, price, unit, description, active, needs_doc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(n, Number(price) || 0, String(unit || "次").slice(0, 10), String(description || "").slice(0, 300), active === 0 ? 0 : 1, needs_doc ? 1 : 0, nowSh())
    .run();
  return r.meta.last_row_id;
}
export async function updateService(id, data = {}) {
  const cur = await getService(id);
  if (!cur) throw new Error("项目不存在");
  const n = String(data.name ?? cur.name).trim();
  if (!n) throw new Error("项目名称不能为空");
  await db
    .prepare("UPDATE services SET name = ?, price = ?, unit = ?, description = ?, active = ?, needs_doc = ? WHERE id = ?")
    .bind(
      n,
      Number(data.price ?? cur.price) || 0,
      String(data.unit ?? cur.unit).slice(0, 10),
      String(data.description ?? cur.description).slice(0, 300),
      data.active === undefined ? cur.active : data.active ? 1 : 0,
      data.needs_doc === undefined ? cur.needs_doc : data.needs_doc ? 1 : 0,
      Number(id)
    )
    .run();
  return getService(id);
}
export async function removeService(id) {
  if (!(await getService(id))) throw new Error("项目不存在");
  await db.prepare("DELETE FROM services WHERE id = ?").bind(Number(id)).run();
}
export async function servicesCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM services").first("n");
}
export async function listActiveServices() {
  const r = await db
    .prepare("SELECT id, name, price, unit, description, sort_order, needs_doc FROM services WHERE active = 1 ORDER BY sort_order ASC, id ASC")
    .all();
  return r.results;
}

/* ==================== 购买记录 ==================== */

export async function listPurchases({ page = 1, pageSize = 20, keyword = "", status = "" } = {}) {
  const kw = keyword ? `%${keyword}%` : null;
  const st = status || null;
  const offset = (Math.max(1, page) - 1) * pageSize;
  const where = "WHERE (?1 IS NULL OR c.name LIKE ?1 OR c.phone LIKE ?1 OR p.service_name LIKE ?1) AND (?2 IS NULL OR p.status = ?2)";
  const total = await db
    .prepare(`SELECT COUNT(*) AS total FROM purchases p LEFT JOIN customers c ON c.id = p.customer_id ${where}`)
    .bind(kw, st)
    .first("total");
  const r = await db
    .prepare(`
    SELECT p.*, c.name AS customer_name, c.phone AS customer_phone
    FROM purchases p LEFT JOIN customers c ON c.id = p.customer_id
    ${where}
    ORDER BY p.id DESC LIMIT ?3 OFFSET ?4
  `)
    .bind(kw, st, pageSize, offset)
    .all();
  return { total, page: Math.max(1, page), pageSize, records: r.results };
}

export async function getPurchase(id) {
  return (await db.prepare("SELECT * FROM purchases WHERE id = ?").bind(Number(id)).first()) || null;
}

export async function createPurchase({ customerId, serviceId, qty, status, note, source } = {}) {
  const cid = Number(customerId);
  const customer = await getCustomer(cid);
  if (!customer) throw new Error("客户不存在，请先在会员中心建档");
  const sid = Number(serviceId);
  const service = await getService(sid);
  if (!service) throw new Error("服务项目不存在");
  if (!service.active) throw new Error("该服务项目已停用");
  const q = Math.max(1, Math.min(999, Number(qty) || 1));
  const amount = Math.round(service.price * q * 100) / 100;
  const st = String(status || "已付款") === "待付款" ? "待付款" : "已付款";
  const src = String(source || "后台登记") === "前台下单" ? "前台下单" : "后台登记";
  const r = await db
    .prepare(
      "INSERT INTO purchases (customer_id, service_id, service_name, unit_price, qty, amount, status, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(cid, sid, service.name, service.price, q, amount, st, String(note || "").slice(0, 300), src, nowSh())
    .run();
  return r.meta.last_row_id;
}

export async function createGuestPurchase({ serviceId, name, phone, qty, note } = {}) {
  const n = String(name || "").trim().slice(0, 50);
  const p = String(phone || "").trim().slice(0, 20);
  if (!p) throw new Error("请填写手机号，方便客服与您确认订单");
  if (!/^[\d\s+-]{5,20}$/.test(p)) throw new Error("手机号格式不正确");
  const sid = Number(serviceId);
  const service = await getService(sid);
  if (!service || !service.active) throw new Error("服务项目不存在或已停用");
  const q = Math.max(1, Math.min(99, Number(qty) || 1));
  const amount = Math.round(service.price * q * 100) / 100;
  const customerId = await ensureCustomer(n, p);
  const st = amount === 0 ? "已付款" : "待付款";
  const r = await db
    .prepare(
      "INSERT INTO purchases (customer_id, service_id, service_name, unit_price, qty, amount, status, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '前台下单', ?)"
    )
    .bind(customerId, sid, service.name, service.price, q, amount, st, String(note || "").slice(0, 300), nowSh())
    .run();
  return r.meta.last_row_id;
}

export async function updatePurchaseStatus(id, status) {
  const cur = await getPurchase(id);
  if (!cur) throw new Error("购买记录不存在");
  const st = String(status) === "待付款" ? "待付款" : "已付款";
  await db.prepare("UPDATE purchases SET status = ? WHERE id = ?").bind(st, Number(id)).run();
  return getPurchase(id);
}

export async function removePurchase(id) {
  if (!(await getPurchase(id))) throw new Error("购买记录不存在");
  await db.prepare("DELETE FROM purchases WHERE id = ?").bind(Number(id)).run();
}

export async function getCustomerPurchases(customerId) {
  const r = await db.prepare("SELECT * FROM purchases WHERE customer_id = ? ORDER BY id DESC").bind(Number(customerId)).all();
  return r.results;
}

export async function setPurchaseOnlinePayment({ id, outTradeNo, channel, qr = "" } = {}) {
  const p = await getPurchase(id);
  if (!p) throw new Error("订单不存在");
  await db
    .prepare("UPDATE purchases SET out_trade_no = ?, pay_channel = ?, pay_qr = ? WHERE id = ?")
    .bind(String(outTradeNo || ""), String(channel || ""), String(qr || ""), Number(id))
    .run();
  return getPurchase(id);
}
export async function getPurchaseByOutTradeNo(outTradeNo) {
  return (await db.prepare("SELECT * FROM purchases WHERE out_trade_no = ?").bind(String(outTradeNo || "")).first()) || null;
}
export async function confirmPurchasePayment(outTradeNo) {
  const p = await getPurchaseByOutTradeNo(outTradeNo);
  if (!p) throw new Error("订单不存在");
  if (p.status === "已付款") return { purchase: p, alreadyPaid: true };
  const changed = await db
    .prepare("UPDATE purchases SET status = '已付款' WHERE id = ? AND status <> '已付款'")
    .bind(p.id)
    .run();
  return { purchase: await getPurchase(p.id), alreadyPaid: !changed.meta.changes };
}

/* ==================== 统计 ==================== */

export async function dashboardStats() {
  const today = todaySh();
  const total = await db.prepare("SELECT COUNT(*) AS total FROM consultations").first("total");
  const todayN = await db.prepare("SELECT COUNT(*) AS total FROM consultations WHERE date(created_at) = ?").bind(today).first("total");
  const purchaseAll = await db
    .prepare("SELECT IFNULL(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM purchases WHERE status = '已付款'")
    .first();
  const purchaseDay = await db
    .prepare("SELECT IFNULL(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM purchases WHERE status = '已付款' AND date(created_at) = ?")
    .bind(today)
    .first();
  const riskRows = (
    await db.prepare("SELECT risk_level AS k, COUNT(*) AS v FROM consultations WHERE risk_level <> '' GROUP BY risk_level ORDER BY v DESC").all()
  ).results;
  const levelRows = (await db.prepare("SELECT level AS k, COUNT(*) AS v FROM consultations GROUP BY level ORDER BY v DESC").all()).results;
  const highRisk = (
    await db
      .prepare(`
      SELECT id, level, risk_level, chief_complaint, name, phone, created_at
      FROM consultations WHERE risk_level = '立即急诊' ORDER BY id DESC LIMIT 10
    `)
      .all()
  ).results;
  return {
    total,
    today: todayN,
    customers: await customersCount(),
    services: await servicesCount(),
    purchaseTotal: Math.round(Number(purchaseAll.total) * 100) / 100,
    purchaseCount: purchaseAll.cnt,
    purchaseTodayAmount: Math.round(Number(purchaseDay.total) * 100) / 100,
    purchaseTodayCount: purchaseDay.cnt,
    riskDistribution: riskRows.map((r) => ({ risk: r.k, count: r.v })),
    levelDistribution: levelRows.map((r) => ({ level: r.k, count: r.v })),
    recentHighRisk: highRisk,
  };
}

export async function getCustomerProfile(customerId) {
  const customer = await getCustomer(customerId);
  if (!customer) return null;
  const consults = await getCustomerConsults(customerId);
  const purchases = await getCustomerPurchases(customerId);
  return {
    customer: {
      ...customer,
      consultCount: consults.length,
      highRiskCount: consults.filter((r) => r.risk_level === "立即急诊").length,
      purchaseCount: purchases.length,
      paidTotal: Math.round(purchases.filter((p) => p.status === "已付款").reduce((s, p) => s + Number(p.amount), 0) * 100) / 100,
      amountTotal: Math.round(purchases.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100,
      firstAt: consults.length ? consults[consults.length - 1].created_at : customer.created_at,
      lastAt: consults.length ? consults[0].created_at : customer.updated_at,
    },
    consults,
    purchases,
    documents: await getCustomerDocuments(customerId),
  };
}

/* ==================== 附件 ==================== */

export async function addAttachment({ kind, label, mime, size, stored, consultId, purchaseId, customerId } = {}) {
  const r = await db
    .prepare(
      "INSERT INTO attachments (kind, label, mime, size, stored, consult_id, purchase_id, customer_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      String(kind || "其他").slice(0, 20),
      String(label || "未命名").slice(0, 120),
      String(mime || "application/octet-stream").slice(0, 60),
      Number(size) || 0,
      String(stored || ""),
      consultId ? Number(consultId) : null,
      purchaseId ? Number(purchaseId) : null,
      customerId ? Number(customerId) : null,
      nowSh()
    )
    .run();
  return r.meta.last_row_id;
}
export async function getAttachment(id) {
  return (await db.prepare("SELECT * FROM attachments WHERE id = ?").bind(Number(id)).first()) || null;
}
export async function getConsultAttachments(consultId) {
  const r = await db.prepare("SELECT * FROM attachments WHERE consult_id = ? ORDER BY id DESC").bind(Number(consultId)).all();
  return r.results;
}
export async function getPurchaseAttachments(purchaseId) {
  const r = await db.prepare("SELECT * FROM attachments WHERE purchase_id = ? ORDER BY id DESC").bind(Number(purchaseId)).all();
  return r.results;
}
export async function getMemberLibrary(customerId) {
  const r = await db
    .prepare("SELECT * FROM attachments WHERE customer_id = ? AND consult_id IS NULL AND purchase_id IS NULL ORDER BY id DESC")
    .bind(Number(customerId))
    .all();
  return r.results;
}
export async function getCustomerDocuments(customerId) {
  const r = await db
    .prepare(`
    SELECT a.*,
           (SELECT s.name FROM consultations s WHERE s.id = a.consult_id) AS consult_scene,
           (SELECT p.service_name FROM purchases p WHERE p.id = a.purchase_id) AS purchase_name
    FROM attachments a
    WHERE a.customer_id = ?1 OR a.consult_id IN (SELECT id FROM consultations WHERE customer_id = ?1)
       OR a.purchase_id IN (SELECT id FROM purchases WHERE customer_id = ?1)
    ORDER BY a.id DESC
  `)
    .bind(Number(customerId))
    .all();
  return r.results.map((row) => ({ ...row, consult_scene: row.consult_scene || "", purchase_name: row.purchase_name || "" }));
}
export async function removeAttachment(id) {
  const row = await getAttachment(id);
  if (!row) throw new Error("附件不存在");
  await db.prepare("DELETE FROM attachments WHERE id = ?").bind(Number(id)).run();
  return row;
}
