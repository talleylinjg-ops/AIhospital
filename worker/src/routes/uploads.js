// 附件路由（R2 版）：问诊附件 / 订单附件 / 会员材料库 / 附件查看
import { Hono } from "hono";
import { bearerToken } from "../auth.js";
import {
  addAttachment,
  getAttachment,
  removeAttachment,
  getConsultAttachments,
  getPurchaseAttachments,
  getMemberLibrary,
  getConsultation,
  getPurchase,
} from "../db.js";
import { resolveMemberByToken } from "./member.js";

const router = new Hono();

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

async function acceptMember(c) {
  return resolveMemberByToken(bearerToken(c.req.raw));
}

/* 将 base64 内容写入 R2：key = uploads/yyyyMMdd/<rand8>.<ext>（与原磁盘路径结构一致） */
function storeFile(label, mime, dataB64) {
  const mimeType = String(mime || "").toLowerCase();
  const ext = ALLOWED_MIME[mimeType];
  if (!ext) {
    const err = new Error("仅支持图片（png/jpg/webp/gif）或 PDF 文件");
    err.status = 415;
    throw err;
  }
  let bin;
  try {
    bin = atob(String(dataB64 || ""));
  } catch {
    bin = "";
  }
  const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (!buf.length || buf.length > MAX_FILE_BYTES) {
    const err = new Error(buf.length ? "单个文件不能超过 6MB，请压缩后重试" : "未收到有效的文件内容");
    err.status = 413;
    throw err;
  }
  const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
  const stored = `uploads/${day}/${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("")}.${ext}`;
  return { stored, buf, label: String(label || "").trim().slice(0, 120), mime: mimeType, size: buf.length };
}

async function parseUploadBody(c) {
  const b = await c.req.json().catch(() => ({}));
  if (typeof b.data !== "string" || !b.data) {
    const err = new Error("缺少上传文件内容");
    err.status = 400;
    throw err;
  }
  return b;
}

async function putToR2(c, file) {
  if (!c.env.ATTACH) {
    const err = new Error("对象存储未配置（R2 binding ATTACH）");
    err.status = 503;
    throw err;
  }
  await c.env.ATTACH.put(file.stored, file.buf);
}

/* ---- 问诊记录附件 ---- */

router.get("/consult/:id/attachments", async (c) => {
  const consult = await getConsultation(Number(c.req.param("id")));
  if (!consult) return c.json({ error: "问诊记录不存在" }, 404);
  return c.json({ ok: true, attachments: await getConsultAttachments(consult.id) });
});

router.post("/consult/:id/attachments", async (c) => {
  const consult = await getConsultation(Number(c.req.param("id")));
  if (!consult) return c.json({ error: "问诊记录不存在" }, 404);
  let file;
  try {
    file = await parseUploadBody(c);
  } catch (err) {
    return c.json({ error: err.message }, err.status || 400);
  }
  try {
    const stored = storeFile(file.label, file.mime, file.data);
    await putToR2(c, stored);
    const id = await addAttachment({ kind: safeKind(file.kind), label: stored.label, mime: stored.mime, size: stored.size, stored: stored.stored, consultId: consult.id });
    return c.json({ ok: true, attachment: await getAttachment(id) });
  } catch (err) {
    return c.json({ error: err.message }, err.status || 500);
  }
});

/* ---- 服务订单附件 ---- */

router.get("/purchase/:id/attachments", async (c) => {
  const purchase = await getPurchase(Number(c.req.param("id")));
  if (!purchase) return c.json({ error: "订单不存在" }, 404);
  return c.json({ ok: true, attachments: await getPurchaseAttachments(purchase.id) });
});

router.post("/purchase/:id/attachments", async (c) => {
  const purchase = await getPurchase(Number(c.req.param("id")));
  if (!purchase) return c.json({ error: "订单不存在" }, 404);
  let file;
  try {
    file = await parseUploadBody(c);
  } catch (err) {
    return c.json({ error: err.message }, err.status || 400);
  }
  try {
    const stored = storeFile(file.label, file.mime, file.data);
    await putToR2(c, stored);
    const id = await addAttachment({ kind: safeKind(file.kind), label: stored.label, mime: stored.mime, size: stored.size, stored: stored.stored, purchaseId: purchase.id });
    return c.json({ ok: true, attachment: await getAttachment(id) });
  } catch (err) {
    return c.json({ error: err.message }, err.status || 500);
  }
});

/* ---- 会员材料库 ---- */

router.get("/member/documents", async (c) => {
  const member = await acceptMember(c);
  if (!member) return c.json({ error: "登录已失效，请重新登录" }, 401);
  return c.json({ ok: true, documents: await getMemberLibrary(member.id) });
});

router.post("/member/documents", async (c) => {
  const member = await acceptMember(c);
  if (!member) return c.json({ error: "登录已失效，请重新登录" }, 401);
  let file;
  try {
    file = await parseUploadBody(c);
  } catch (err) {
    return c.json({ error: err.message }, err.status || 400);
  }
  try {
    const stored = storeFile(file.label, file.mime, file.data);
    await putToR2(c, stored);
    const id = await addAttachment({ kind: safeKind(file.kind), label: stored.label, mime: stored.mime, size: stored.size, stored: stored.stored, customerId: member.id });
    return c.json({ ok: true, attachment: await getAttachment(id) });
  } catch (err) {
    return c.json({ error: err.message }, err.status || 500);
  }
});

router.delete("/member/documents/:id", async (c) => {
  const member = await acceptMember(c);
  if (!member) return c.json({ error: "登录已失效，请重新登录" }, 401);
  try {
    const row = await getAttachment(Number(c.req.param("id")));
    if (!row) return c.json({ error: "附件不存在" }, 404);
    if (!row.customer_id || Number(row.customer_id) !== Number(member.id) || row.consult_id || row.purchase_id) {
      return c.json({ error: "无权删除该附件" }, 403);
    }
    await removeAttachment(row.id);
    if (c.env.ATTACH) await c.env.ATTACH.delete(row.stored).catch(() => {});
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }
});

/* ---- 附件查看：图片/PDF 由浏览器直接渲染 ---- */

router.get("/attachments/:id/file", async (c) => {
  const row = await getAttachment(Number(c.req.param("id")));
  if (!row) return c.json({ error: "附件不存在" }, 404);
  if (!c.env.ATTACH) return c.json({ error: "对象存储未配置" }, 503);
  const obj = await c.env.ATTACH.get(row.stored);
  if (!obj) return c.json({ error: "文件已被清理或丢失" }, 404);
  const headers = new Headers();
  headers.set("Content-Type", row.mime || "application/octet-stream");
  headers.set("X-Content-Type-Options", "nosniff");
  const inline = row.mime && row.mime.startsWith("image/");
  headers.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(row.label || "attachment")}"`);
  return new Response(obj.body, { headers });
});

export default router;
