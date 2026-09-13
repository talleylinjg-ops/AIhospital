import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addAttachment,
  getAttachment,
  removeAttachment,
  getConsultAttachments,
  getPurchaseAttachments,
  getMemberLibrary,
  getConsultation,
  getPurchase,
} from "./db.js";
import { resolveMemberByToken } from "./member.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = path.join(__dirname, "..", "data", "uploads");

fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const router = Router();

const ALLOWED_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};
const DOC_KINDS = ["病历卡", "检验单", "报告单", "影像胶片", "处方", "其他"];
const MAX_FILE_BYTES = 6 * 1024 * 1024;

function safeKind(kind) {
  const k = String(kind || "").trim();
  return DOC_KINDS.includes(k) ? k : "其他";
}

function acceptMember(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return resolveMemberByToken(token);
}

/* 将 data（base64 明文）落盘到 data/uploads/yyyyMMdd/，返回磁盘存储相对路径 */
function storeFile(label, mime, dataB64) {
  const mimeType = String(mime || "").toLowerCase();
  const ext = ALLOWED_MIME[mimeType];
  if (!ext) {
    const err = new Error("仅支持图片（png/jpg/webp/gif）或 PDF 文件");
    err.status = 415;
    throw err;
  }
  const buf = Buffer.from(dataB64, "base64");
  if (!buf.length || buf.length > MAX_FILE_BYTES) {
    const err = new Error(buf.length ? "单个文件不能超过 6MB，请压缩后重试" : "未收到有效的文件内容");
    err.status = 413;
    throw err;
  }
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const dir = path.join(UPLOAD_ROOT, day);
  fs.mkdirSync(dir, { recursive: true });
  const stored = `uploads/${day}/${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const full = path.join(UPLOAD_ROOT, day, path.basename(stored));
  fs.writeFileSync(full, buf);
  return { stored, label: String(label || "").trim().slice(0, 120), mime: mimeType, size: buf.length };
}

/* 通用解析一个上传请求体：{ kind?, label?, mime, data } data 为 base64 */
function parseUploadBody(req) {
  const b = req.body || {};
  if (typeof b.data !== "string" || !b.data) {
    const err = new Error("缺少上传文件内容");
    err.status = 400;
    throw err;
  }
  return b;
}

/* ---- 问诊记录附件（问诊后由用户补传，凭记录 id） ---- */
router.get("/consult/:id/attachments", (req, res) => {
  const consult = getConsultation(Number(req.params.id));
  if (!consult) return res.status(404).json({ error: "问诊记录不存在" });
  res.json({ ok: true, attachments: getConsultAttachments(consult.id) });
});

router.post("/consult/:id/attachments", (req, res) => {
  const consult = getConsultation(Number(req.params.id));
  if (!consult) return res.status(404).json({ error: "问诊记录不存在" });
  let file;
  try {
    file = parseUploadBody(req);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  try {
    const stored = storeFile(file.label, file.mime, file.data);
    const id = addAttachment({ kind: safeKind(file.kind), ...stored, consultId: consult.id });
    res.json({ ok: true, attachment: getAttachment(id) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/* ---- 服务订单附件（慢病套餐 / 报告解读等，购买后补传） ---- */
router.get("/purchase/:id/attachments", (req, res) => {
  const purchase = getPurchase(Number(req.params.id));
  if (!purchase) return res.status(404).json({ error: "订单不存在" });
  res.json({ ok: true, attachments: getPurchaseAttachments(purchase.id) });
});

router.post("/purchase/:id/attachments", (req, res) => {
  const purchase = getPurchase(Number(req.params.id));
  if (!purchase) return res.status(404).json({ error: "订单不存在" });
  let file;
  try {
    file = parseUploadBody(req);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  try {
    const stored = storeFile(file.label, file.mime, file.data);
    const id = addAttachment({ kind: safeKind(file.kind), ...stored, purchaseId: purchase.id });
    res.json({ ok: true, attachment: getAttachment(id) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/* ---- 会员材料库（长期保存的病历 / 报告 / 检验单） ---- */
router.get("/member/documents", (req, res) => {
  const member = acceptMember(req);
  if (!member) return res.status(401).json({ error: "登录已失效，请重新登录" });
  res.json({ ok: true, documents: getMemberLibrary(member.id) });
});

router.post("/member/documents", (req, res) => {
  const member = acceptMember(req);
  if (!member) return res.status(401).json({ error: "登录已失效，请重新登录" });
  let file;
  try {
    file = parseUploadBody(req);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  try {
    const stored = storeFile(file.label, file.mime, file.data);
    const id = addAttachment({ kind: safeKind(file.kind), ...stored, customerId: member.id });
    res.json({ ok: true, attachment: getAttachment(id) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete("/member/documents/:id", (req, res) => {
  const member = acceptMember(req);
  if (!member) return res.status(401).json({ error: "登录已失效，请重新登录" });
  try {
    const row = getAttachment(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "附件不存在" });
    if (!row.customer_id || Number(row.customer_id) !== member.id || row.consult_id || row.purchase_id) {
      return res.status(403).json({ error: "无权删除该附件" });
    }
    removeAttachment(row.id);
    const p = path.join(UPLOAD_ROOT, ...row.stored.split("/").slice(1));
    fs.unlink(p, () => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ---- 附件查看：图片/PDF 由浏览器直接渲染 ---- */
router.get("/attachments/:id/file", (req, res) => {
  const row = getAttachment(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "附件不存在" });
  const full = path.join(UPLOAD_ROOT, ...row.stored.split("/").slice(1));
  if (!fs.existsSync(full)) return res.status(404).json({ error: "文件已被清理或丢失" });
  res.setHeader("Content-Type", row.mime || "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const inline = row.mime && row.mime.startsWith("image/");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(row.label || "attachment")}"`);
  fs.createReadStream(full).pipe(res);
});

export default router;
