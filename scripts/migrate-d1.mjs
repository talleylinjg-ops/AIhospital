// 将现有 SQLite（server/data/consultations.db）关键表导出为 D1 可执行的 SQL
// 产物 worker/seed-local.sql 含 API Key 等机密，禁止提交 git（.gitignore 已包含）
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.argv[2] || path.join(__dirname, "..", "data", "consultations.db");
const OUT_PATH = path.join(__dirname, "..", "worker", "seed-local.sql");

const db = new Database(DB_PATH, { readonly: true });

const esc = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};

const table = (name, cols) => {
  const rows = db.prepare(`SELECT ${cols.join(", ")} FROM ${name}`).all();
  if (!rows.length) return [];
  const colList = cols.join(", ");
  return rows.map((r) => `INSERT OR REPLACE INTO ${name} (${colList}) VALUES (${cols.map((c) => esc(r[c])).join(", ")});`);
};

const out = [];
out.push("-- seed-local.sql: 由 scripts/migrate-d1.mjs 生成（含机密，禁止提交 git）");
out.push("BEGIN TRANSACTION;");
out.push(...table("admin_users", ["id", "username", "password_hash", "created_at"]));
out.push(...table("llm_providers", ["id", "name", "base_url", "model", "api_key", "enabled", "category", "note", "scenes", "priority"]));
out.push(...table("settings", ["key", "value", "updated_at"]));
out.push(...table("services", ["id", "name", "price", "unit", "description", "active", "sort_order", "needs_doc", "created_at"]));
out.push(...table("customers", ["id", "name", "phone", "note", "password_hash", "balance", "profile", "created_at", "updated_at"]));
out.push("COMMIT;");

fs.writeFileSync(OUT_PATH, out.join("\n") + "\n");
const counts = out.filter((l) => l.startsWith("INSERT")).length;
console.log(`导出完成: ${OUT_PATH}（${counts} 条 INSERT）`);
