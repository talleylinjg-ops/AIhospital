import { getToken } from "./member.js";

export const DOC_KINDS = ["病历卡", "检验单", "报告单", "影像胶片", "处方", "其他"];
export const DOC_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";
export const DOC_MAX_BYTES = 6 * 1024 * 1024;
export const API_BASE = "/api";

export function kindOptions(sel) {
  return DOC_KINDS.map((k) => `<option ${k === sel ? "selected" : ""}>${esc(k)}</option>`).join("");
}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function fmtSize(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

export function isPdf(mime) {
  return (mime || "").toLowerCase() === "application/pdf";
}

export function fileUrl(id) {
  return `${API_BASE}/attachments/${Number(id)}/file`;
}

export function thumbUrl(a) {
  return fileUrl(a.id);
}

/* 读取文件为 base64 payload */
export function readFilePayload(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("未选择文件"));
    if (file.size > DOC_MAX_BYTES) return reject(new Error(`单个文件不能超过 6MB（${file.name || ""}）`));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("文件读取失败，请重试"));
    fr.onload = () => {
      const data = String(fr.result || "").split(",")[1] || "";
      if (!data) return reject(new Error("无法读取文件内容"));
      resolve({ data, mime: file.type || "application/octet-stream", label: file.name || "未命名" });
    };
    fr.readAsDataURL(file);
  });
}

export function attEndpoint(target, id) {
  if (target === "consult") return `${API_BASE}/consult/${Number(id)}/attachments`;
  if (target === "purchase") return `${API_BASE}/purchase/${Number(id)}/attachments`;
  return `${API_BASE}/member/documents`;
}

/* 上传文件列表；files = [{ file, kind? }]，kind 可给默认。支持需要会员鉴权的 member 端点 */
export async function uploadAttachments(target, id, files, defaultKind = "其他") {
  const results = [];
  for (const item of files || []) {
    const payload = await readFilePayload(item.file);
    payload.kind = item.kind || defaultKind || "其他";
    const headers = { "Content-Type": "application/json" };
    if (target === "member") {
      const t = getToken();
      if (t) headers.Authorization = `Bearer ${t}`;
    }
    const res = await fetch(attEndpoint(target, id), { method: "POST", headers, body: JSON.stringify(payload) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.error || "上传失败，请重试");
    results.push(json.attachment);
  }
  return results;
}

export function docCardHtml(a, { deletable = false } = {}) {
  const isImg = !isPdf(a.mime) && /^image\//.test(a.mime || "");
  const media = isImg
    ? `<img class="att-thumb" src="${fileUrl(a.id)}" alt="" loading="lazy" />`
    : `<div class="att-file-icon">PDF</div>`;
  return `
    <div class="att-card" data-att="${a.id}">
      ${media}
      <div class="att-info">
        <span class="att-kind">${esc(a.kind || "其他")}</span>
        <div class="att-name" title="${esc(a.label)}">${esc(a.label || "附件")}</div>
        <div class="att-meta">${fmtSize(a.size)} · ${esc((a.created_at || "").slice(0, 16))}</div>
      </div>
      <div class="att-ops">
        <a class="att-open" href="${fileUrl(a.id)}" target="_blank" rel="noopener">查看</a>
        ${deletable ? `<button class="att-del" data-del="${a.id}" title="删除">删除</button>` : ""}
      </div>
    </div>`;
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
}

/* 拉取某个目标的附件列表（member 目标带会员鉴权） */
export async function loadAttachments(target, id) {
  const res = await fetch(attEndpoint(target, id), { headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || "加载附件失败");
  return target === "member" ? json.documents || [] : json.attachments || [];
}

/* 删除（member 材料库专用，带鉴权） */
export async function deleteMemberAttachment(id) {
  const res = await fetch(`${API_BASE}/member/documents/${Number(id)}`, { method: "DELETE", headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || "删除失败");
}

/*
 * 通用附件上传组件：选择文件即上传，随后刷新列表。
 * opts = { target:'consult'|'purchase'|'member', id, kind?, list=true, deletable=false,
 *          hint?, onChanged? }
 */
export function mountUploader(el, opts = {}) {
  if (!el) return;
  const o = Object.assign({ target: "member", list: true, deletable: false, kind: "报告单", hint: "" }, opts);
  const hint = o.hint
    ? `<p class="att-tip">${esc(o.hint)}</p>`
    : `<p class="att-tip">选择病历 / 检验单 / 报告单 / 影像等资料上传（jpg/png/webp/gif/pdf，单个不超过 6MB）。</p>`;

  el.innerHTML = `
    <div class="att-zone">
      ${hint}
      <div class="att-zone-head">
        <select class="att-kind-sel">${kindOptions(o.kind)}</select>
        <button type="button" class="btn-outline btn-sm att-add-btn">添加文件…</button>
        <input class="att-file-input" type="file" accept="${DOC_ACCEPT}" multiple hidden />
        <span class="att-status muted"></span>
      </div>
      <div class="att-zone-err" hidden></div>
      <div class="att-zone-list att-grid"></div>
    </div>`;

  const statusEl = el.querySelector(".att-status");
  const errEl = el.querySelector(".att-zone-err");
  const listEl = el.querySelector(".att-zone-list");
  const kindEl = el.querySelector(".att-kind-sel");
  const inputEl = el.querySelector(".att-file-input");
  const addBtn = el.querySelector(".att-add-btn");

  function err(text) {
    errEl.hidden = false;
    errEl.textContent = text;
  }
  function status(text) {
    statusEl.textContent = text || "";
  }

  async function reload() {
    if (!o.list) return;
    try {
      const rows = await loadAttachments(o.target, o.id);
      listEl.innerHTML =
        rows.map((a) => docCardHtml(a, { deletable: o.deletable })).join("") || `<p class="muted">尚未上传材料</p>`;
      listEl.querySelectorAll(".att-del").forEach((btn) =>
        btn.addEventListener("click", async () => {
          if (!window.confirm("确定删除该材料吗？")) return;
          try {
            await deleteMemberAttachment(Number(btn.dataset.del));
            await reload();
          } catch (ex) {
            err(ex.message);
          }
        })
      );
    } catch (ex) {
      listEl.innerHTML = `<p class="muted">${esc(ex.message)}</p>`;
    }
  }

  addBtn.addEventListener("click", () => inputEl.click());
  inputEl.addEventListener("change", async () => {
    const files = Array.from(inputEl.files || []);
    inputEl.value = "";
    if (!files.length) return;
    errEl.hidden = true;
    let done = 0;
    let failed = 0;
    const kind = kindEl.value || o.kind || "其他";
    for (const file of files) {
      status(`正在上传（${done + failed + 1}/${files.length}）：${esc(file.name)}…`);
      try {
        await uploadAttachments(o.target, o.id, [{ file, kind }], kind);
        done += 1;
      } catch (ex) {
        failed += 1;
        err(`${esc(file.name)}：${ex.message}`);
      }
    }
    status(done ? `已上传 ${done} 份` : "");
    await reload();
    if (o.onChanged) o.onChanged(done, failed);
  });

  reload();
}
