-- 大气AI医院 Cloudflare D1 数据库 schema
-- 与 server/db.js（better-sqlite3）最终表结构保持一致

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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_consult_level ON consultations(level);
CREATE INDEX IF NOT EXISTS idx_consult_risk ON consultations(risk_level);
CREATE INDEX IF NOT EXISTS idx_consult_created ON consultations(created_at);
CREATE INDEX IF NOT EXISTS idx_consult_phone ON consultations(phone);
CREATE INDEX IF NOT EXISTS idx_consult_customer ON consultations(customer_id);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  note TEXT DEFAULT '',
  password_hash TEXT DEFAULT '',
  balance REAL NOT NULL DEFAULT 0,
  profile TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE phone <> '';

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  balance_after REAL NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  ref_type TEXT DEFAULT '',
  ref_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_out_trade ON purchases(out_trade_no) WHERE out_trade_no <> '';

CREATE TABLE IF NOT EXISTS llm_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  api_key TEXT DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '国内通用',
  note TEXT NOT NULL DEFAULT '',
  scenes TEXT NOT NULL DEFAULT 'clinic',
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT '其他',
  label TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  stored TEXT NOT NULL DEFAULT '',
  consult_id INTEGER DEFAULT NULL,
  purchase_id INTEGER DEFAULT NULL,
  customer_id INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS recharge_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  channel TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT '待支付',
  out_trade_no TEXT NOT NULL,
  trade_no TEXT DEFAULT '',
  qr TEXT DEFAULT '',
  paid_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recharge_out_trade ON recharge_orders(out_trade_no);
