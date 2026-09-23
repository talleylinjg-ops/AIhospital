import { FIELDS, LEVEL_META } from "../src/form-config.js";

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const viewContent = document.getElementById("view-content");
const viewTitle = document.getElementById("view-title");
const exportBtn = document.getElementById("export-btn");
const logoutBtn = document.getElementById("logout-btn");
const sidebarUser = document.getElementById("sidebar-user");

const TOKEN_KEY = "ai-hospital-admin-token";
const USER_KEY = "ai-hospital-admin-user";
const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
const getUser = () => localStorage.getItem(USER_KEY) || "";
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => `¥${Number(n || 0).toFixed(2)}`;

let currentView = "dashboard";
const pages = { records: 1, members: 1, purchases: 1 };
const filters = {
  level: "", risk: "", keyword: "",
  memberKeyword: "",
  purchaseKeyword: "", purchaseStatus: "",
};

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...opts, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
    }
    const err = new Error(json.error || "请求失败");
    err.status = res.status;
    throw err;
  }
  return json;
}

/* ===== 登录 ===== */
function showLogin() {
  appView.hidden = true;
  loginView.hidden = false;
}
function showApp() {
  loginView.hidden = true;
  appView.hidden = false;
  sidebarUser.textContent = getUser() ? `当前账号：${getUser()}` : "";
}
function bindLogin() {
  const errEl = document.getElementById("login-error");
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "正在登录…";
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "登录失败");
      localStorage.setItem(TOKEN_KEY, json.token);
      localStorage.setItem(USER_KEY, json.username || username);
      showApp();
      switchView("dashboard");
    } catch (err) {
      errEl.textContent = "登录失败：" + err.message;
    }
  });
}

/* ===== 视图切换 ===== */
const VIEW_META = {
  dashboard: { title: "仪表盘" },
  members: { title: "会员中心" },
  records: { title: "问诊记录" },
  purchases: { title: "购买记录" },
  services: { title: "服务项目" },
  pay: { title: "支付设置" },
  recharges: { title: "充值单" },
  settings: { title: "系统设置" },
};

async function switchView(view) {
  currentView = view;
  document.querySelectorAll(".nav-item[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  viewTitle.textContent = VIEW_META[view].title;
  if (view === "dashboard") renderDashboard();
  else if (view === "members") renderMembers();
  else if (view === "records") renderRecords();
  else if (view === "purchases") renderPurchases();
  else if (view === "services") renderServices();
  else if (view === "pay") renderPaySettings();
  else if (view === "recharges") renderRechargeOrders();
  else if (view === "settings") renderSettings();
}

function bindSidebar() {
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
}

/* ===== 通用弹窗 ===== */
function openModal(title) {
  const mask = document.createElement("div");
  mask.className = "modal-mask";
  mask.innerHTML = `<div class="modal"><div class="modal-head"><h3>${title}</h3><button class="modal-close">×</button></div><div class="modal-body"></div></div>`;
  document.body.appendChild(mask);
  mask.addEventListener("click", (e) => { if (e.target === mask) mask.remove(); });
  mask.querySelector(".modal-close").addEventListener("click", () => mask.remove());
  return mask;
}

/* ===== 仪表盘 ===== */
function riskClass(r) {
  if (r === "立即急诊") return "急诊";
  if (r === "建议尽快门诊") return "门诊";
  return "无需";
}

async function renderDashboard() {
  viewContent.innerHTML = `<div class="panel" style="text-align:center;padding:40px">加载中…</div>`;
  try {
    const { stats } = await api("/api/admin/stats");
    const maxRisk = Math.max(1, ...stats.riskDistribution.map((r) => r.count));
    const maxLevel = Math.max(1, ...stats.levelDistribution.map((r) => r.count));

    const riskBars = stats.riskDistribution.length
      ? stats.riskDistribution
          .map((r) => {
            const cls = r.risk === "立即急诊" ? "danger" : r.risk === "建议尽快门诊" ? "amber" : "green";
            return `<div class="bar-row"><span class="bar-label">${esc(r.risk)}</span><div class="bar-track"><div class="bar-fill ${cls}" style="width:${Math.max(6, Math.round((r.count / maxRisk) * 100))}%">${r.count}</div></div></div>`;
          })
          .join("")
      : `<div class="hr-empty">暂无数据</div>`;

    const levelBars = stats.levelDistribution.length
      ? stats.levelDistribution
          .map((r) => {
            const m = LEVEL_META[r.level] || {};
            return `<div class="bar-row"><span class="bar-label" style="color:${m.color}">${esc(m.name || r.level)}</span><div class="bar-track"><div class="bar-fill gray" style="width:${Math.max(6, Math.round((r.count / maxLevel) * 100))}%">${r.count}</div></div></div>`;
          })
          .join("")
      : `<div class="hr-empty">暂无数据</div>`;

    const highRisk = stats.recentHighRisk.length
      ? stats.recentHighRisk
          .slice(0, 6)
          .map(
            (r) => `<div class="hr-item" data-id="${r.id}"><span class="hr-id">#${r.id}</span><span class="hr-text">${esc(r.chief_complaint || "-")} · ${esc(r.name || "未留名")}</span><span class="hr-id">${esc(r.created_at)}</span></div>`
          )
          .join("")
      : `<div class="hr-empty">暂无急诊预警记录</div>`;

    viewContent.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card accent"><div class="stat-label">累计问诊</div><div class="stat-value">${stats.total}</div><div class="stat-sub">全部通道合计</div></div>
        <div class="stat-card green"><div class="stat-label">今日新增</div><div class="stat-value">${stats.today}</div><div class="stat-sub">${new Date().toLocaleDateString("zh-CN")}</div></div>
        <div class="stat-card amber"><div class="stat-label">会员总数</div><div class="stat-value">${stats.customers}</div><div class="stat-sub">已建立健康档案</div></div>
        <div class="stat-card danger"><div class="stat-label">消费总额</div><div class="stat-value">${money(stats.purchaseTotal)}</div><div class="stat-sub">今日新增 ${money(stats.purchaseTodayAmount)} · ${stats.purchaseTodayCount} 单</div></div>
      </div>
      <div class="dash-cols">
        <div class="panel">
          <h3>风险等级分布</h3>
          ${riskBars}
        </div>
        <div class="panel">
          <h3>就诊通道分布</h3>
          ${levelBars}
        </div>
      </div>
      <div class="panel">
        <h3>最近急诊预警（立即急诊）</h3>
        <div class="highrisk-list">${highRisk}</div>
      </div>`;

    viewContent.querySelectorAll(".hr-item[data-id]").forEach((el) => {
      el.addEventListener("click", () => openDetail(Number(el.dataset.id)));
    });
  } catch (err) {
    if (err.status !== 401) viewContent.innerHTML = `<div class="panel"><div class="hr-empty">${esc(err.message)}</div></div>`;
  }
}

/* ===== 会员中心 ===== */
async function renderMembers() {
  viewContent.innerHTML = `
    <div class="toolbar">
      <h2>会员中心</h2>
      <input type="text" id="mkw" placeholder="搜索手机号 / 称呼 / 备注" value="${esc(filters.memberKeyword)}" />
      <button class="btn btn-primary" id="new-customer-btn">+ 新建会员</button>
      <span class="total" id="member-total"></span>
    </div>
    <div class="table-card">
      <table>
        <thead><tr><th>ID</th><th>会员</th><th>手机号</th><th>问诊次数</th><th>购买次数</th><th>余额</th><th>累计消费</th><th>最近问诊</th><th>急诊</th></tr></thead>
        <tbody id="members-body"><tr><td colspan="9" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>
    <div class="pagination" id="members-pager">
      <button id="mprev-btn">上一页</button><span class="info" id="mpage-info"></span><button id="mnext-btn">下一页</button>
    </div>`;

  const kwEl = document.getElementById("mkw");
  let timer;
  kwEl.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filters.memberKeyword = kwEl.value.trim();
      pages.members = 1;
      loadMembers();
    }, 400);
  });
  document.getElementById("new-customer-btn").addEventListener("click", () => editMember(null));
  document.getElementById("mprev-btn").addEventListener("click", () => { if (pages.members > 1) { pages.members -= 1; loadMembers(); } });
  document.getElementById("mnext-btn").addEventListener("click", () => loadMembers(true));

  await loadMembers();
}

async function loadMembers(next) {
  const body = document.getElementById("members-body");
  try {
    const params = new URLSearchParams({ page: pages.members, pageSize: 20, keyword: filters.memberKeyword });
    const data = await api(`/api/admin/customers?${params}`);
    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    if (next && pages.members < totalPages) pages.members += 1;
    document.getElementById("member-total").textContent = `共 ${data.total} 位会员`;
    document.getElementById("mpage-info").textContent = `第 ${pages.members} / ${totalPages} 页`;
    document.getElementById("mprev-btn").disabled = pages.members <= 1;
    document.getElementById("mnext-btn").disabled = pages.members >= totalPages;

    if (!data.records.length) {
      body.innerHTML = `<tr><td colspan="9" class="empty">暂无会员（客户问诊填写手机号/称呼后自动建档）</td></tr>`;
      return;
    }
    body.innerHTML = data.records
      .map(
        (c) => `
        <tr data-id="${c.id}">
          <td>#${c.id}</td>
          <td style="font-weight:600">${esc(c.name || "未命名")}${c.is_member ? `<span class="risk-pill">会员</span>` : ""}${c.note ? `<div style="font-size:12px;color:var(--ink-3)">${esc(c.note.slice(0, 20))}</div>` : ""}</td>
          <td>${esc(c.phone || "-")}</td>
          <td>${c.consult_count}</td>
          <td>${c.purchase_count}</td>
          <td style="font-weight:600">${money(c.balance)}</td>
          <td>${money(c.paid_total)}</td>
          <td>${esc(c.last_at || "-")}</td>
          <td>${c.high_risk_count ? `<span class="risk-pill 急诊">${c.high_risk_count}</span>` : "0"}</td>
        </tr>`
      )
      .join("");
    body.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => openMember(Number(tr.dataset.id))));
  } catch (err) {
    if (err.status !== 401) body.innerHTML = `<tr><td colspan="9" class="empty">${esc(err.message)}</td></tr>`;
  }
}

/* ===== 客户档案弹窗 ===== */
async function openMember(id) {
  const mask = openModal("会员档案");
  mask.querySelector(".modal-body").innerHTML = `<div style="text-align:center;padding:40px">加载中…</div>`;
  try {
    const { customer, consults, purchases, documents = [] } = await api(`/api/admin/customers/${id}`);
    const initial = customer.name ? customer.name.charAt(0) : customer.phone ? customer.phone.slice(-4) : "客";
    const consultRows = consults.length
      ? consults.map((r) => `
          <tr data-id="${r.id}">
            <td>#${r.id}</td>
            <td><span class="level-tag-small" style="background:${LEVEL_META[r.level]?.color || "#9ca3af"}">${esc(LEVEL_META[r.level]?.name || r.level)}</span></td>
            <td><span class="risk-pill ${riskClass(r.risk_level)}">${esc(r.risk_level || "-")}</span></td>
            <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.chief_complaint || "-")}</td>
            <td>${esc(r.created_at)}</td>
          </tr>`).join("")
      : `<tr><td colspan="5" class="empty">暂无问诊记录</td></tr>`;
    const purchaseRows = purchases.length
      ? purchases.map((p) => `
          <tr>
            <td>#${p.id}</td>
            <td>${esc(p.service_name)}</td>
            <td>${money(p.unit_price)} × ${p.qty}</td>
            <td style="font-weight:600">${money(p.amount)}</td>
            <td>${p.source === "前台下单" ? '<span class="badge-warn">前台</span>' : '<span class="badge-muted">后台</span>'}</td>
            <td><span class="status-pill ${p.status === "已付款" ? "paid" : "unpaid"}">${esc(p.status)}</span></td>
            <td>${esc(p.created_at)}</td>
          </tr>`).join("")
      : `<tr><td colspan="7" class="empty">暂无购买记录</td></tr>`;
    const docCards = documents.length
      ? documents.map((d) => {
          const isImg = /^image\//.test(d.mime || "");
          const media = isImg
            ? `<img src="/api/attachments/${d.id}/file" class="doc-thumb" loading="lazy" alt="" />`
            : `<div class="doc-file">PDF</div>`;
          const src = d.consult_id ? `问诊 #${d.consult_id}` : d.purchase_id ? `订单 #${d.purchase_id}` : "材料库";
          return `<div class="doc-card" data-doc="${d.id}">
            ${media}
            <div class="doc-info"><b>${esc(d.label || "附件")}</b><span>${esc(d.kind || "其他")} · ${src} · ${esc((d.created_at || "").slice(0, 16))}</span></div>
            <div class="doc-ops"><a href="/api/attachments/${d.id}/file" target="_blank" rel="noopener">查看</a><button class="doc-del" data-del="${d.id}">删除</button></div>
          </div>`;
        }).join("")
      : `<p class="empty">暂无上传材料</p>`;

    mask.querySelector(".modal-body").innerHTML = `
      <div class="customer-hero">
        <div class="avatar">${esc(initial)}</div>
        <div>
          <div class="c-name">${esc(customer.name || "未命名")}${customer.balance > 0 ? ` <span class="risk-pill">余额 ¥${money(customer.balance)}</span>` : ""}</div>
          <div class="c-meta">手机号：${esc(customer.phone || "-")} · 建档：${esc((customer.firstAt || "").slice(0, 10))}</div>
          ${customer.note ? `<div class="c-meta" style="margin-top:4px">备注：${esc(customer.note)}</div>` : ""}
        </div>
        <div class="customer-stats">
          <div class="c-stat"><div class="v">${customer.consultCount}</div><div class="l">问诊次数</div></div>
          <div class="c-stat"><div class="v">${customer.purchaseCount}</div><div class="l">购买次数</div></div>
          <div class="c-stat"><div class="v">${money(customer.paidTotal)}</div><div class="l">累计消费</div></div>
        </div>
        <div class="hero-actions">
          <button class="btn btn-primary" id="profile-purchase-btn">登记购买</button>
          <button class="btn-outline" id="profile-edit-btn">编辑资料</button>
        </div>
      </div>
      <div class="modal-section"><h4>购买记录（${purchases.length}）</h4>
        <div class="table-card"><table>
          <thead><tr><th>ID</th><th>项目</th><th>单价 × 数量</th><th>金额</th><th>来源</th><th>状态</th><th>时间</th></tr></thead>
          <tbody>${purchaseRows}</tbody>
        </table></div>
      </div>
      <div class="modal-section"><h4>问诊记录（${consults.length}）</h4>
        <div class="table-card"><table>
          <thead><tr><th>ID</th><th>通道</th><th>风险</th><th>主诉</th><th>时间</th></tr></thead>
          <tbody>${consultRows}</tbody>
        </table></div>
      </div>
      <div class="modal-section"><h4>上传材料（${documents.length}）</h4>
        <div class="doc-list">${docCards}</div>
      </div>`;

    mask.querySelector("#profile-purchase-btn").addEventListener("click", () => openPurchaseForm(customer.id));
    mask.querySelector("#profile-edit-btn").addEventListener("click", () => { mask.remove(); editMember(customer.id); });
    mask.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => openDetail(Number(tr.dataset.id))));
    mask.querySelectorAll(".doc-del").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!window.confirm("确定删除该附件材料吗？")) return;
        try {
          await api(`/api/admin/attachments/${btn.dataset.del}`, { method: "DELETE" });
          const card = btn.closest(".doc-card");
          if (card) card.remove();
        } catch (err) {
          window.alert(err.message);
        }
      })
    );
  } catch (err) {
    mask.querySelector(".modal-body").innerHTML = `<p style="color:var(--danger)">${esc(err.message)}</p>`;
  }
}

/* ===== 编辑/新建会员 ===== */
async function editMember(id) {
  const mask = openModal(id ? "编辑会员资料" : "新建会员");
  let customer = { name: "", phone: "", note: "" };
  if (id) {
    try {
      const data = await api(`/api/admin/customers/${id}`);
      customer = data.customer;
    } catch (err) {
      mask.querySelector(".modal-body").innerHTML = `<p style="color:var(--danger)">${esc(err.message)}</p>`;
      return;
    }
  }
  mask.querySelector(".modal-body").innerHTML = `
    <form class="form" id="member-form">
      <label>称呼 / 姓名</label>
      <input id="mf-name" type="text" value="${esc(customer.name)}" placeholder="例如：张先生" />
      <label>手机号</label>
      <input id="mf-phone" type="text" value="${esc(customer.phone)}" placeholder="用于识别会员身份" />
      <label>备注</label>
      <textarea id="mf-note" rows="3" placeholder="会员标签、偏好、健康状况备注等">${esc(customer.note)}</textarea>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">保存</button>
        ${id ? `<button type="button" class="btn btn-danger" id="mf-delete">删除会员</button>` : ""}
      </div>
      <div class="error" id="mf-error"></div>
    </form>`;
  const form = mask.querySelector("#member-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = mask.querySelector("#mf-error");
    errEl.textContent = "保存中…";
    try {
      const payload = {
        name: mask.querySelector("#mf-name").value.trim(),
        phone: mask.querySelector("#mf-phone").value.trim(),
        note: mask.querySelector("#mf-note").value.trim(),
      };
      if (id) await api(`/api/admin/customers/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api("/api/admin/customers", { method: "POST", body: JSON.stringify(payload) });
      mask.remove();
      if (currentView === "members") renderMembers();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
  const delBtn = mask.querySelector("#mf-delete");
  if (delBtn) {
    delBtn.addEventListener("click", async () => {
      if (!window.confirm("确定删除该会员档案吗？其问诊记录将保留但解除关联。")) return;
      try {
        await api(`/api/admin/customers/${id}`, { method: "DELETE" });
        mask.remove();
        if (currentView === "members") renderMembers();
      } catch (err) {
        mask.querySelector("#mf-error").textContent = err.message;
      }
    });
  }
}

/* ===== 问诊记录 ===== */
async function renderRecords() {
  viewContent.innerHTML = `
    <div class="toolbar">
      <h2>问诊记录</h2>
      <input type="text" id="kw" placeholder="搜索手机号 / 称呼 / 主诉" value="${esc(filters.keyword)}" />
      <select id="filter-level">
        <option value="">全部通道</option>
        ${Object.entries(LEVEL_META).map(([k, m]) => `<option value="${k}" ${filters.level === k ? "selected" : ""}>${esc(m.name)}</option>`).join("")}
      </select>
      <select id="filter-risk">
        <option value="">全部风险</option>
        <option ${filters.risk === "立即急诊" ? "selected" : ""}>立即急诊</option>
        <option ${filters.risk === "建议尽快门诊" ? "selected" : ""}>建议尽快门诊</option>
        <option ${filters.risk === "无需急诊" ? "selected" : ""}>无需急诊</option>
      </select>
      <span class="total" id="total-label"></span>
    </div>
    <div class="table-card">
      <table>
        <thead><tr><th>ID</th><th>通道</th><th>风险</th><th>主诉</th><th>称呼</th><th>手机号</th><th>时间</th></tr></thead>
        <tbody id="records-body"><tr><td colspan="7" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>
    <div class="pagination" id="records-pager">
      <button id="prev-btn">上一页</button><span class="info" id="page-info"></span><button id="next-btn">下一页</button>
    </div>`;

  const kwEl = document.getElementById("kw");
  let searchTimer;
  kwEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.keyword = kwEl.value.trim();
      pages.records = 1;
      loadRecords();
    }, 400);
  });
  document.getElementById("filter-level").addEventListener("change", (e) => { filters.level = e.target.value; pages.records = 1; loadRecords(); });
  document.getElementById("filter-risk").addEventListener("change", (e) => { filters.risk = e.target.value; pages.records = 1; loadRecords(); });
  document.getElementById("prev-btn").addEventListener("click", () => { if (pages.records > 1) { pages.records -= 1; loadRecords(); } });
  document.getElementById("next-btn").addEventListener("click", () => loadRecords(true));

  await loadRecords();
}

async function loadRecords(next) {
  const body = document.getElementById("records-body");
  try {
    const params = new URLSearchParams({
      page: pages.records,
      pageSize: 20,
      level: filters.level,
      riskLevel: filters.risk,
      keyword: filters.keyword,
    });
    const data = await api(`/api/admin/records?${params}`);
    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    if (next && pages.records < totalPages) pages.records += 1;
    document.getElementById("total-label").textContent = `共 ${data.total} 条`;
    document.getElementById("page-info").textContent = `第 ${pages.records} / ${totalPages} 页`;
    document.getElementById("prev-btn").disabled = pages.records <= 1;
    document.getElementById("next-btn").disabled = pages.records >= totalPages;

    if (!data.records.length) {
      body.innerHTML = `<tr><td colspan="7" class="empty">暂无记录</td></tr>`;
      return;
    }
    body.innerHTML = data.records
      .map(
        (r) => `
        <tr data-id="${r.id}">
          <td>#${r.id}</td>
          <td><span class="level-tag-small" style="background:${LEVEL_META[r.level]?.color || "#9ca3af"}">${esc(LEVEL_META[r.level]?.name || r.level)}</span></td>
          <td><span class="risk-pill ${riskClass(r.risk_level)}">${esc(r.risk_level || "-")}</span></td>
          <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.chief_complaint || "-")}</td>
          <td>${esc(r.name || "-")}</td>
          <td>${esc(r.phone || "-")}</td>
          <td>${esc(r.created_at)}</td>
        </tr>`
      )
      .join("");
    body.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => openDetail(Number(tr.dataset.id))));
  } catch (err) {
    if (err.status !== 401) body.innerHTML = `<tr><td colspan="7" class="empty">${esc(err.message)}</td></tr>`;
  }
}

/* ===== 购买记录 ===== */
async function renderPurchases() {
  viewContent.innerHTML = `
    <div class="toolbar">
      <h2>购买记录</h2>
      <input type="text" id="pkw" placeholder="搜索客户 / 手机号 / 项目" value="${esc(filters.purchaseKeyword)}" />
      <select id="pfilter-status">
        <option value="">全部状态</option>
        <option ${filters.purchaseStatus === "已付款" ? "selected" : ""}>已付款</option>
        <option ${filters.purchaseStatus === "待付款" ? "selected" : ""}>待付款</option>
      </select>
      <button class="btn btn-primary" id="new-purchase-btn">+ 登记购买</button>
      <span class="total" id="purchase-total"></span>
    </div>
    <div class="table-card">
      <table>
        <thead><tr><th>ID</th><th>客户</th><th>项目</th><th>单价 × 数量</th><th>金额</th><th>来源</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
        <tbody id="purchases-body"><tr><td colspan="9" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>
    <div class="pagination" id="purchases-pager">
      <button id="pprev-btn">上一页</button><span class="info" id="ppage-info"></span><button id="pnext-btn">下一页</button>
    </div>`;

  const kwEl = document.getElementById("pkw");
  let timer;
  kwEl.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filters.purchaseKeyword = kwEl.value.trim();
      pages.purchases = 1;
      loadPurchases();
    }, 400);
  });
  document.getElementById("pfilter-status").addEventListener("change", (e) => { filters.purchaseStatus = e.target.value; pages.purchases = 1; loadPurchases(); });
  document.getElementById("new-purchase-btn").addEventListener("click", () => openPurchaseForm(null));
  document.getElementById("pprev-btn").addEventListener("click", () => { if (pages.purchases > 1) { pages.purchases -= 1; loadPurchases(); } });
  document.getElementById("pnext-btn").addEventListener("click", () => loadPurchases(true));

  await loadPurchases();
}

async function loadPurchases(next) {
  const body = document.getElementById("purchases-body");
  try {
    const params = new URLSearchParams({ page: pages.purchases, pageSize: 20, keyword: filters.purchaseKeyword, status: filters.purchaseStatus });
    const data = await api(`/api/admin/purchases?${params}`);
    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    if (next && pages.purchases < totalPages) pages.purchases += 1;
    document.getElementById("purchase-total").textContent = `共 ${data.total} 条`;
    document.getElementById("ppage-info").textContent = `第 ${pages.purchases} / ${totalPages} 页`;
    document.getElementById("pprev-btn").disabled = pages.purchases <= 1;
    document.getElementById("pnext-btn").disabled = pages.purchases >= totalPages;

    if (!data.records.length) {
      body.innerHTML = `<tr><td colspan="9" class="empty">暂无购买记录（先在「服务项目」中添加项目，再为客户登记购买）</td></tr>`;
      return;
    }
    body.innerHTML = data.records
      .map(
        (p) => `
        <tr>
          <td>#${p.id}</td>
          <td style="font-weight:600">${esc(p.customer_name || "未知客户")}</td>
          <td>${esc(p.service_name)}</td>
          <td>${money(p.unit_price)} × ${p.qty}</td>
          <td style="font-weight:600">${money(p.amount)}</td>
          <td>${p.source === "前台下单" ? '<span class="badge-warn">前台下单</span>' : '<span class="badge-muted">后台登记</span>'}</td>
          <td><button class="status-toggle status-pill ${p.status === "已付款" ? "paid" : "unpaid"}" data-id="${p.id}" data-status="${p.status}">${esc(p.status)}</button></td>
          <td>${esc(p.created_at)}</td>
          <td><button class="link-danger" data-del="${p.id}">删除</button></td>
        </tr>`
      )
      .join("");
    body.querySelectorAll(".status-toggle").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const next = btn.dataset.status === "已付款" ? "待付款" : "已付款";
        try {
          await api(`/api/admin/purchases/${btn.dataset.id}`, { method: "PUT", body: JSON.stringify({ status: next }) });
          loadPurchases();
        } catch (err) { alert(err.message); }
      })
    );
    body.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!window.confirm("确定删除该购买记录吗？")) return;
        try {
          await api(`/api/admin/purchases/${btn.dataset.del}`, { method: "DELETE" });
          loadPurchases();
        } catch (err) { alert(err.message); }
      })
    );
  } catch (err) {
    if (err.status !== 401) body.innerHTML = `<tr><td colspan="9" class="empty">${esc(err.message)}</td></tr>`;
  }
}

/* ===== 登记购买弹窗 ===== */
async function openPurchaseForm(presetCustomerId) {
  const mask = openModal("登记购买");
  mask.querySelector(".modal-body").innerHTML = `<div style="text-align:center;padding:40px">加载中…</div>`;
  try {
    const [{ records: customers }, { services }] = await Promise.all([
      api("/api/admin/customers?pageSize=100"),
      api("/api/admin/services"),
    ]);
    if (!customers.length) {
      mask.querySelector(".modal-body").innerHTML = `<p style="color:var(--danger)">暂无会员，请先在会员中心建档（客户问诊填写手机号/称呼即可自动建档）。</p>`;
      return;
    }
    if (!services.length) {
      mask.querySelector(".modal-body").innerHTML = `<p style="color:var(--danger)">暂无服务项目，请先到「服务项目」菜单添加。</p>`;
      return;
    }
    const activeServices = services.filter((s) => s.active);
    mask.querySelector(".modal-body").innerHTML = `
      <form class="form" id="purchase-form">
        <label>会员客户</label>
        <select id="pf-customer">
          ${customers.map((c) => `<option value="${c.id}" ${c.id === presetCustomerId ? "selected" : ""}>${esc(c.name || "未命名")}${c.phone ? "（" + esc(c.phone) + "）" : ""}</option>`).join("")}
        </select>
        <label>服务项目</label>
        <select id="pf-service">
          ${activeServices.map((s) => `<option value="${s.id}">${esc(s.name)} — ${money(s.price)}/${esc(s.unit)}</option>`).join("")}
        </select>
        <label>数量</label>
        <input id="pf-qty" type="number" min="1" max="999" value="1" />
        <label>付款状态</label>
        <select id="pf-status"><option>已付款</option><option>待付款</option></select>
        <label>备注</label>
        <textarea id="pf-note" rows="2" placeholder="可选，如线下收款方式、有效期等"></textarea>
        <div class="purchase-amount">合计：<b id="pf-amount"></b></div>
        <div class="form-actions"><button type="submit" class="btn btn-primary">保存</button></div>
        <div class="error" id="pf-error"></div>
      </form>`;

    const serviceSel = mask.querySelector("#pf-service");
    const qtyInput = mask.querySelector("#pf-qty");
    const amountEl = mask.querySelector("#pf-amount");
    const updateAmount = () => {
      const s = activeServices.find((x) => x.id === Number(serviceSel.value));
      amountEl.textContent = money((s ? s.price : 0) * (Number(qtyInput.value) || 0));
    };
    serviceSel.addEventListener("change", updateAmount);
    qtyInput.addEventListener("input", updateAmount);
    updateAmount();

    mask.querySelector("#purchase-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = mask.querySelector("#pf-error");
      errEl.textContent = "保存中…";
      try {
        await api("/api/admin/purchases", {
          method: "POST",
          body: JSON.stringify({
            customerId: Number(mask.querySelector("#pf-customer").value),
            serviceId: Number(serviceSel.value),
            qty: Number(qtyInput.value) || 1,
            status: mask.querySelector("#pf-status").value,
            note: mask.querySelector("#pf-note").value.trim(),
          }),
        });
        mask.remove();
        if (currentView === "purchases") renderPurchases();
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  } catch (err) {
    mask.querySelector(".modal-body").innerHTML = `<p style="color:var(--danger)">${esc(err.message)}</p>`;
  }
}

/* ===== 服务项目 ===== */
async function renderServices() {
  viewContent.innerHTML = `
    <div class="toolbar">
      <h2>服务项目</h2>
      <button class="btn btn-primary" id="new-service-btn">+ 新增项目</button>
      <span class="total" id="service-total"></span>
    </div>
    <div class="table-card">
      <table>
        <thead><tr><th>ID</th><th>项目名称</th><th>价格</th><th>计价单位</th><th>说明</th><th>状态</th><th>操作</th></tr></thead>
        <tbody id="services-body"><tr><td colspan="7" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>`;
  document.getElementById("new-service-btn").addEventListener("click", () => serviceForm(null));
  await loadServices();
}

async function loadServices() {
  const body = document.getElementById("services-body");
  try {
    const { services } = await api("/api/admin/services");
    document.getElementById("service-total").textContent = `共 ${services.length} 个项目`;
    if (!services.length) {
      body.innerHTML = `<tr><td colspan="7" class="empty">暂无服务项目，点击「新增项目」创建</td></tr>`;
      return;
    }
    body.innerHTML = services
      .map(
        (s) => `
        <tr>
          <td>#${s.id}</td>
          <td style="font-weight:600">${esc(s.name)}${s.needs_doc ? ' <span class="badge-warn">需上传材料</span>' : ""}</td>
          <td style="font-weight:600">${money(s.price)}</td>
          <td>${esc(s.unit)}</td>
          <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.description || "-")}</td>
          <td><span class="status-pill ${s.active ? "paid" : "off"}">${s.active ? "启用" : "停用"}</span></td>
          <td><button class="link" data-edit="${s.id}">编辑</button> <button class="link-danger" data-del="${s.id}">删除</button></td>
        </tr>`
      )
      .join("");
    body.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => serviceForm(Number(btn.dataset.edit))));
    body.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!window.confirm("确定删除该服务项目吗？已有购买记录将保留项目名称。")) return;
        try {
          await api(`/api/admin/services/${btn.dataset.del}`, { method: "DELETE" });
          loadServices();
        } catch (err) { alert(err.message); }
      })
    );
  } catch (err) {
    if (err.status !== 401) body.innerHTML = `<tr><td colspan="7" class="empty">${esc(err.message)}</td></tr>`;
  }
}

async function serviceForm(id) {
  const mask = openModal(id ? "编辑服务项目" : "新增服务项目");
  let s = { name: "", price: 0, unit: "次", description: "", active: 1, needs_doc: 0 };
  if (id) {
    try {
      const data = await api("/api/admin/services");
      s = data.services.find((x) => x.id === id) || s;
    } catch (err) {
      mask.querySelector(".modal-body").innerHTML = `<p style="color:var(--danger)">${esc(err.message)}</p>`;
      return;
    }
  }
  mask.querySelector(".modal-body").innerHTML = `
    <form class="form" id="service-form">
      <label>项目名称</label>
      <input id="sf-name" type="text" value="${esc(s.name)}" placeholder="例如：AI 慢病管理月度套餐" />
      <label>价格（元）</label>
      <input id="sf-price" type="number" min="0" step="0.01" value="${Number(s.price)}" />
      <label>计价单位</label>
      <input id="sf-unit" type="text" value="${esc(s.unit)}" placeholder="次 / 月 / 年" />
      <label>项目说明</label>
      <textarea id="sf-desc" rows="3" placeholder="服务内容、适用人群等">${esc(s.description)}</textarea>
      <label style="display:flex;align-items:center;gap:8px;font-weight:600">
        <input id="sf-active" type="checkbox" style="width:auto" ${s.active ? "checked" : ""} /> 启用（登记购买时可选）
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-weight:600">
        <input id="sf-needsdoc" type="checkbox" style="width:auto" ${s.needs_doc ? "checked" : ""} /> 需要客户上传病历 / 报告材料（下单后提示上传）
      </label>
      <div class="form-actions"><button type="submit" class="btn btn-primary">保存</button></div>
      <div class="error" id="sf-error"></div>
    </form>`;
  mask.querySelector("#service-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = mask.querySelector("#sf-error");
    errEl.textContent = "保存中…";
    try {
      const payload = {
        name: mask.querySelector("#sf-name").value.trim(),
        price: Number(mask.querySelector("#sf-price").value) || 0,
        unit: mask.querySelector("#sf-unit").value.trim() || "次",
        description: mask.querySelector("#sf-desc").value.trim(),
        active: mask.querySelector("#sf-active").checked ? 1 : 0,
        needs_doc: mask.querySelector("#sf-needsdoc").checked ? 1 : 0,
      };
      if (id) await api(`/api/admin/services/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api("/api/admin/services", { method: "POST", body: JSON.stringify(payload) });
      mask.remove();
      if (currentView === "services") renderServices();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

/* ===== 支付设置 ===== */
async function renderPaySettings() {
  viewContent.innerHTML = `<div class="panel" style="text-align:center;padding:40px">加载中…</div>`;
  try {
    const { settings, channels } = await api("/api/admin/pay-settings");
    const secretBox = (id, label, has, placeholder) => `
      <label>${label}${has ? ' <span class="status-pill paid" style="margin-left:6px">已配置</span>' : ""}</label>
      <textarea id="${id}" rows="3" placeholder="${placeholder}">${esc(settings[id] || "")}</textarea>`;
    viewContent.innerHTML = `
      <div class="panel">
        <h2>支付设置</h2>
        <p class="muted">在线支付为真实商户收款。密钥仅保存在服务端，读取时只返回是否已配置；密钥字段留空表示保持原值不变。</p>
        <div class="toolbar" style="margin:12px 0">
          <span class="status-pill ${channels.alipay ? "paid" : "off"}">支付宝：${channels.alipay ? "已启用" : "未启用"}</span>
          <span class="status-pill ${channels.wechat ? "paid" : "off"}">微信支付：${channels.wechat ? "已启用" : "未启用"}</span>
          <span class="status-pill ${channels.notifyBaseUrl ? "paid" : "off"}">回调域名：${channels.notifyBaseUrl ? esc(channels.notifyBaseUrl) : "未配置"}</span>
        </div>
        <form class="form" id="pay-form">
          <h3>通用</h3>
          <label>支付回调域名（公网可达）</label>
          <input id="pay_notify_base_url" type="text" value="${esc(settings.pay_notify_base_url || "")}" placeholder="例如：https://api.aihospital.com" />
          <p class="muted">支付宝 / 微信支付成功后，平台会回调到该域名下的 /api/pay/notify/*。未配置时会员无法发起在线充值。</p>

          <h3 style="margin-top:18px">支付宝（RSA2）</h3>
          <label style="display:flex;align-items:center;gap:8px;font-weight:600">
            <input id="pay_alipay_enabled" type="checkbox" style="width:auto" ${settings.pay_alipay_enabled === "1" ? "checked" : ""} /> 启用支付宝
          </label>
          <label>App ID</label>
          <input id="pay_alipay_app_id" type="text" value="${esc(settings.pay_alipay_app_id || "")}" placeholder="开放平台应用 App ID" />
          ${secretBox("pay_alipay_private_key", "应用私钥（PKCS8，可粘贴纯 base64）", settings.has.pay_alipay_private_key, settings.has.pay_alipay_private_key ? "已配置，留空则不修改" : "粘贴应用私钥")}
          <label>支付宝公钥</label>
          <textarea id="pay_alipay_public_key" rows="3" placeholder="用于校验异步通知签名">${esc(settings.pay_alipay_public_key || "")}</textarea>
          <label>网关地址</label>
          <input id="pay_alipay_gateway" type="text" value="${esc(settings.pay_alipay_gateway || "")}" placeholder="默认 https://openapi.alipay.com/gateway.do" />

          <h3 style="margin-top:18px">微信支付（APIv3 Native）</h3>
          <label style="display:flex;align-items:center;gap:8px;font-weight:600">
            <input id="pay_wechat_enabled" type="checkbox" style="width:auto" ${settings.pay_wechat_enabled === "1" ? "checked" : ""} /> 启用微信支付
          </label>
          <label>App ID</label>
          <input id="pay_wechat_app_id" type="text" value="${esc(settings.pay_wechat_app_id || "")}" />
          <label>商户号 MchID</label>
          <input id="pay_wechat_mch_id" type="text" value="${esc(settings.pay_wechat_mch_id || "")}" />
          <label>证书序列号</label>
          <input id="pay_wechat_serial_no" type="text" value="${esc(settings.pay_wechat_serial_no || "")}" />
          ${secretBox("pay_wechat_private_key", "商户 API 私钥", settings.has.pay_wechat_private_key, settings.has.pay_wechat_private_key ? "已配置，留空则不修改" : "粘贴商户私钥")}
          ${secretBox("pay_wechat_apiv3_key", "APIv3 密钥（32 位）", settings.has.pay_wechat_apiv3_key, settings.has.pay_wechat_apiv3_key ? "已配置，留空则不修改" : "32 位 APIv3 密钥")}
          ${secretBox("pay_wechat_platform_cert", "微信支付平台证书", settings.has.pay_wechat_platform_cert, settings.has.pay_wechat_platform_cert ? "已配置，留空则不修改" : "粘贴平台证书 PEM，用于校验回调")}

          <div class="form-actions"><button type="submit" class="btn btn-primary">保存支付设置</button></div>
          <div class="error" id="pay-error"></div>
        </form>
      </div>`;
    document.getElementById("pay-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("pay-error");
      errEl.textContent = "保存中…";
      const val = (id) => document.getElementById(id).value.trim();
      const payload = {
        pay_notify_base_url: val("pay_notify_base_url"),
        pay_alipay_enabled: document.getElementById("pay_alipay_enabled").checked ? "1" : "",
        pay_alipay_app_id: val("pay_alipay_app_id"),
        pay_alipay_private_key: val("pay_alipay_private_key"),
        pay_alipay_public_key: val("pay_alipay_public_key"),
        pay_alipay_gateway: val("pay_alipay_gateway"),
        pay_wechat_enabled: document.getElementById("pay_wechat_enabled").checked ? "1" : "",
        pay_wechat_app_id: val("pay_wechat_app_id"),
        pay_wechat_mch_id: val("pay_wechat_mch_id"),
        pay_wechat_serial_no: val("pay_wechat_serial_no"),
        pay_wechat_private_key: val("pay_wechat_private_key"),
        pay_wechat_apiv3_key: val("pay_wechat_apiv3_key"),
        pay_wechat_platform_cert: val("pay_wechat_platform_cert"),
      };
      try {
        await api("/api/admin/pay-settings", { method: "PUT", body: JSON.stringify(payload) });
        errEl.style.color = "var(--success, #16a34a)";
        errEl.textContent = "已保存";
        renderPaySettings();
      } catch (err) {
        errEl.style.color = "";
        errEl.textContent = err.message;
      }
    });
  } catch (err) {
    if (err.status !== 401) viewContent.innerHTML = `<div class="panel"><p class="muted">${esc(err.message)}</p></div>`;
  }
}

/* ===== 充值单 ===== */
let rechargeStatusFilter = "";
async function renderRechargeOrders() {
  viewContent.innerHTML = `
    <div class="toolbar">
      <h2>在线充值单</h2>
      <span class="total" id="recharge-total"></span>
    </div>
    <div class="toolbar" style="gap:8px">
      <button class="btn-outline ${rechargeStatusFilter === "" ? "active" : ""}" data-rc-filter="">全部</button>
      <button class="btn-outline ${rechargeStatusFilter === "待支付" ? "active" : ""}" data-rc-filter="待支付">待支付</button>
      <button class="btn-outline ${rechargeStatusFilter === "已付款" ? "active" : ""}" data-rc-filter="已付款">已付款</button>
    </div>
    <div class="table-card">
      <table>
        <thead><tr><th>ID</th><th>时间</th><th>客户</th><th>手机号</th><th>金额</th><th>渠道</th><th>状态</th><th>交易号</th><th>操作</th></tr></thead>
        <tbody id="recharge-body"><tr><td colspan="9" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>`;
  document.querySelectorAll("[data-rc-filter]").forEach((btn) =>
    btn.addEventListener("click", () => {
      rechargeStatusFilter = btn.dataset.rcFilter;
      renderRechargeOrders();
    })
  );
  const body = document.getElementById("recharge-body");
  try {
    const { records } = await api(`/api/admin/recharge-orders?status=${encodeURIComponent(rechargeStatusFilter)}`);
    document.getElementById("recharge-total").textContent = `共 ${records.length} 笔`;
    if (!records.length) {
      body.innerHTML = `<tr><td colspan="9" class="empty">暂无充值单</td></tr>`;
      return;
    }
    const channelName = (c) => (c === "alipay" ? "支付宝" : c === "wechat" ? "微信支付" : "人工");
    body.innerHTML = records
      .map(
        (r) => `
        <tr>
          <td>#${r.id}</td>
          <td>${esc(r.created_at || "")}</td>
          <td>${esc(r.customer_name || "-")}</td>
          <td>${esc(r.customer_phone || "-")}</td>
          <td style="font-weight:600">${money(r.amount)}</td>
          <td>${channelName(r.channel)}</td>
          <td><span class="status-pill ${r.status === "已付款" ? "paid" : "off"}">${esc(r.status)}</span></td>
          <td class="muted">${esc(r.trade_no || r.out_trade_no || "-")}</td>
          <td>${r.status === "已付款" ? '<span class="muted">已到账</span>' : `<button class="link" data-confirm="${r.id}">确认到账</button>`}</td>
        </tr>`
      )
      .join("");
    body.querySelectorAll("[data-confirm]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!window.confirm(`确认该充值单已收到款项并为其入账？`)) return;
        try {
          await api(`/api/admin/recharge-orders/${btn.dataset.confirm}/confirm`, { method: "POST", body: JSON.stringify({ tradeNo: "后台人工确认" }) });
          renderRechargeOrders();
        } catch (err) {
          alert(err.message);
        }
      })
    );
  } catch (err) {
    if (err.status !== 401) body.innerHTML = `<tr><td colspan="9" class="empty">${esc(err.message)}</td></tr>`;
  }
}

/* ===== 系统设置 ===== */
async function renderSettings() {
  viewContent.innerHTML = `<div class="panel" style="text-align:center;padding:40px">加载中…</div>`;
  try {
    const [status, { stats }, { providers }] = await Promise.all([
      api("/api/status"),
      api("/api/admin/stats"),
      api("/api/admin/llm-providers"),
    ]);
    const llm = status.llm || {};
    const scenePills = (p) =>
      (p.scene_labels || []).map((s) => `<span class="scene-pill">${esc(s)}</span>`).join("");
    const renderProviderItem = (p) => `
      <div class="llm-item" data-id="${p.id}">
        <div class="llm-main">
          <div class="llm-name"><b>${esc(p.name)}</b> ${p.enabled ? '<span class="badge-ok">已启用</span>' : p.has_key ? '<span class="badge-muted">已填 Key</span>' : '<span class="badge-warn">未填 Key</span>'}</div>
          <div class="llm-sub">${esc(p.model)}${p.base_url ? ` · ${esc(p.base_url)}` : ' · <span class="llm-noapi">无公开 API，需商务接入</span>'}</div>
          <div class="llm-sub">路由场景：${scenePills(p)} · 优先级 <b>${p.priority}</b>${p.enabled && p.has_key && p.base_url ? " · <span class='badge-ok'>已启用</span>" : ""}</div>
          <div class="llm-sub">API Key：${p.has_key ? esc(p.key_masked) : "未配置"}</div>
          ${p.note ? `<div class="llm-note">${esc(p.note)}</div>` : ""}
          <div class="llm-test-result" data-test-result="${p.id}"></div>
        </div>
        <div class="llm-actions">
          ${p.enabled
            ? `<button class="btn-outline" data-enable="${p.id}">停用</button>`
            : `<button class="btn-outline" data-enable="${p.id}" ${p.has_key && p.base_url ? "" : 'disabled title="请先填入 API Key 与 API 地址"'}>启用</button>`}
          <button class="btn-outline" data-test="${p.id}" ${p.has_key && p.base_url ? "" : 'disabled title="请先填入 API Key 与 API 地址"'}>测试连接</button>
          <button class="link" data-edit="${p.id}">编辑</button>
          <button class="link-danger" data-del="${p.id}">删除</button>
        </div>
      </div>`;
    const providerRows = providers.length
      ? LLM_CATEGORIES.map((cat) => {
          const items = providers.filter((p) => (p.category || "国内通用") === cat);
          if (!items.length) return "";
          return `<div class="llm-group"><div class="llm-group-title">${cat}<span class="llm-group-count">${items.length} 个</span></div>${items.map(renderProviderItem).join("")}</div>`;
        }).join("")
      : `<div class="hr-empty">暂无配置，点击「新增配置」添加</div>`;

    const sceneStatusRows = (llm.scene_models || [])
      .map(
        (s) => `<div class="setting-item"><span class="k">${esc(s.label)}</span><span class="v">${s.configured ? `${esc(s.primary)}${s.backups ? ` <span class="badge-muted">+${s.backups} 备用</span>` : ""}` : '<span class="badge-warn">未配置</span>'}</span></div>`
      )
      .join("");

    viewContent.innerHTML = `
      <div class="settings-grid">
        <div class="panel wide">
          <div class="panel-head">
            <h3>大模型配置</h3>
            <button class="btn btn-primary" id="new-llm-btn">+ 新增配置</button>
          </div>
          <div class="setting-item"><span class="k">运行状态</span><span class="v">${llm.configured ? '<span class="badge-ok">正式推理（多模型路由）</span>' : '<span class="badge-warn">演示模式（AI 返回内置示例结果）</span>'}</span></div>
          ${sceneStatusRows}
          <div class="llm-list">${providerRows}</div>
        </div>
        <div class="panel">
          <h3>管理员账号</h3>
          <div class="setting-item"><span class="k">当前账号</span><span class="v" style="font-weight:700">${esc(getUser())}</span></div>
          <form class="form" id="account-form">
            <label>当前密码（验证身份）</label>
            <input id="af-current" type="password" autocomplete="current-password" placeholder="请输入当前密码" />
            <label>新账号（留空表示不修改）</label>
            <input id="af-username" type="text" autocomplete="username" placeholder="${esc(getUser())}" />
            <label>新密码（留空表示不修改）</label>
            <input id="af-new" type="password" autocomplete="new-password" placeholder="至少 6 位" />
            <label>确认新密码</label>
            <input id="af-confirm" type="password" autocomplete="new-password" placeholder="再次输入新密码" />
            <div class="form-actions"><button type="submit" class="btn btn-primary">更新账号信息</button></div>
            <div class="error" id="af-error"></div>
          </form>
        </div>
        <div class="panel">
          <h3>数据概览</h3>
          <div class="setting-item"><span class="k">累计问诊记录</span><span class="v">${stats.total} 条</span></div>
          <div class="setting-item"><span class="k">会员总数</span><span class="v">${stats.customers} 位</span></div>
          <div class="setting-item"><span class="k">服务项目</span><span class="v">${stats.services} 个</span></div>
          <div class="setting-item"><span class="k">购买记录</span><span class="v">${stats.purchaseCount} 单 · 已收 ${money(stats.purchaseTotal)}</span></div>
          <div class="setting-item"><span class="k">数据存储</span><span class="v">SQLite · /workspace/data/</span></div>
        </div>
        <div class="panel">
          <h3>就诊通道</h3>
          ${Object.entries(LEVEL_META).map(([k, m]) => `<div class="setting-item"><span class="k" style="color:${m.color}">${esc(m.name)}</span><span class="v">${esc(m.tag)}</span></div>`).join("")}
        </div>
      </div>`;

    /* 大模型配置事件 */
    document.getElementById("new-llm-btn").addEventListener("click", () => llmProviderForm(null));
    viewContent.querySelectorAll("[data-enable]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/admin/llm-providers/${btn.dataset.enable}/enable`, {
            method: "PUT",
            body: JSON.stringify({ enabled: btn.textContent.trim() === "启用" }),
          });
          renderSettings();
        } catch (err) { alert(err.message); }
      })
    );
    viewContent.querySelectorAll("[data-test]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const resultEl = viewContent.querySelector(`[data-test-result="${btn.dataset.test}"]`);
        btn.disabled = true;
        btn.textContent = "测试中…";
        if (resultEl) resultEl.textContent = "";
        try {
          const { ok, message } = await api(`/api/admin/llm-providers/${btn.dataset.test}/test`, { method: "POST" });
          if (resultEl) {
            resultEl.textContent = message;
            resultEl.className = "llm-test-result " + (ok ? "ok" : "fail");
          }
        } catch (err) {
          if (resultEl) {
            resultEl.textContent = err.message;
            resultEl.className = "llm-test-result fail";
          }
        }
        btn.disabled = false;
        btn.textContent = "测试连接";
      })
    );
    viewContent.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => llmProviderForm(Number(btn.dataset.edit)))
    );
    viewContent.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!window.confirm("确定删除该大模型配置吗？")) return;
        try {
          await api(`/api/admin/llm-providers/${btn.dataset.del}`, { method: "DELETE" });
          renderSettings();
        } catch (err) { alert(err.message); }
      })
    );

    document.getElementById("account-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("af-error");
      errEl.textContent = "提交中…";
      errEl.classList.remove("ok");
      try {
        const currentPassword = document.getElementById("af-current").value.trim();
        const username = document.getElementById("af-username").value.trim();
        const newPassword = document.getElementById("af-new").value;
        const confirm = document.getElementById("af-confirm").value;
        if (newPassword && newPassword !== confirm) throw new Error("两次输入的新密码不一致");
        const { user } = await api("/api/admin/account", {
          method: "PUT",
          body: JSON.stringify({ currentPassword, username: username || undefined, newPassword: newPassword || undefined }),
        });
        localStorage.setItem(USER_KEY, user.username);
        sidebarUser.textContent = `当前账号：${user.username}`;
        errEl.classList.add("ok");
        errEl.textContent = "账号信息已更新";
        document.getElementById("af-new").value = "";
        document.getElementById("af-confirm").value = "";
        renderSettings();
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  } catch (err) {
    if (err.status !== 401) viewContent.innerHTML = `<div class="panel"><div class="hr-empty">${esc(err.message)}</div></div>`;
  }
}

/* 大模型配置表单（providerId 为空 = 新增） */
const LLM_CATEGORIES = ["国内通用", "海外通用", "国内垂直", "海外垂直"];
const LLM_SCENES = [
  { value: "fast", label: "快诊" },
  { value: "clinic", label: "门诊" },
  { value: "emergency", label: "急诊" },
  { value: "wellness", label: "保健" },
  { value: "maternal", label: "妇幼" },
];
const LLM_TEMPLATES = [
  /* ---- 国内通用 ---- */
  { name: "DeepSeek V4-Pro", base_url: "https://api.deepseek.com/v1", model: "deepseek-v4-pro", category: "国内通用", scenes: ["clinic", "emergency"], priority: 10, note: "门诊主推 + 急诊国内旗舰：复杂推理、多病共病、罕见病排查第一梯队，贴合国内指南" },
  { name: "DeepSeek V4-Flash", base_url: "https://api.deepseek.com/v1", model: "deepseek-v4-flash", category: "国内通用", scenes: ["fast"], priority: 31, note: "快诊：V4 高效经济版，1M 上下文，响应快、成本低，适合高并发问诊" },
  { name: "DeepSeek V4.1 Flash", base_url: "https://api.deepseek.com/v1", model: "deepseek-v4.1-flash", category: "国内通用", scenes: ["fast", "clinic"], priority: 37, note: "快诊/门诊备选：V4 系列最新经济版，Agent 与长文本能力增强" },
  { name: "智谱 GLM-5.3", base_url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.3", category: "国内通用", scenes: ["clinic", "wellness", "maternal"], priority: 11, note: "门诊/保健主推：1M 上下文，长程任务与循证文本强" },
  { name: "智谱 GLM-5.3-Flash", base_url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.3-flash", category: "国内通用", scenes: ["fast"], priority: 30, note: "快诊主推：原生多模态、极致低成本，1M 上下文" },
  { name: "智谱 GLM-5.3-FlashX", base_url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.3-flashx", category: "国内通用", scenes: ["fast"], priority: 36, note: "快诊备选：同基座提速档，最高约 200 tokens/s" },
  { name: "通义千问 Qwen3.8-Max", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3.8-max", category: "国内通用", scenes: ["wellness", "maternal"], priority: 8, note: "保健/妇幼主推：开源旗舰，长文本健康方案与患者教育强" },
  { name: "通义千问 Qwen3.7-Plus", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3.7-plus", category: "国内通用", scenes: ["clinic"], priority: 21, note: "门诊备选：性价比高，推理 + 视觉理解，1M 上下文" },
  { name: "通义千问 Qwen3.6-Flash", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3.6-flash", category: "国内通用", scenes: ["fast"], priority: 32, note: "快诊备选：轻量低成本，支持视觉理解" },
  { name: "Kimi K3", base_url: "https://api.moonshot.cn/v1", model: "kimi-k3", category: "国内通用", scenes: ["clinic", "wellness"], priority: 12, note: "门诊/保健：1M 上下文 + 原生视觉，复杂推理与长文阅读" },
  { name: "Kimi K2.8 Preview", base_url: "https://api.moonshot.cn/v1", model: "kimi-k2.8-preview", category: "国内通用", scenes: ["clinic"], priority: 22, note: "门诊备选：思考效率高，长上下文指令遵循稳定" },
  { name: "豆包 Seed 2.1 Pro（火山方舟）", base_url: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-2.1-pro", category: "国内通用", scenes: ["clinic", "emergency"], priority: 23, note: "门诊/急诊备选：中文创作与多模态强；model 需填方舟推理接入点 ID" },
  { name: "豆包 Seed 2.1 Turbo（火山方舟）", base_url: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-2.1-turbo", category: "国内通用", scenes: ["fast"], priority: 33, note: "快诊：效果与成本均衡，多模态与长链路执行升级；model 需填方舟推理接入点 ID" },
  { name: "豆包 Seed Evolving（火山方舟）", base_url: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-evolving", category: "国内通用", scenes: ["clinic"], priority: 24, note: "门诊备选：面向 Coding/Agent，1M 上下文，统一模型 ID 周级升级；需填方舟接入点 ID" },
  { name: "文心一言 ERNIE 6.0（千帆）", base_url: "https://qianfan.baidubce.com/v2", model: "ernie-6.0", category: "国内通用", scenes: ["wellness"], priority: 16, note: "保健：中医药知识、公卫宣教；model 名以千帆控制台为准" },
  { name: "腾讯混元 Pro", base_url: "https://api.hunyuan.cloud.tencent.com/v1", model: "hunyuan-pro", category: "国内通用", scenes: ["clinic", "wellness"], priority: 25, note: "门诊/保健备选：中文理解与工具调用均衡" },
  { name: "腾讯混元 Hy4 Preview", base_url: "https://api.hunyuan.cloud.tencent.com/v1", model: "hy4-preview", category: "国内通用", scenes: ["clinic"], priority: 26, note: "门诊备选：约 770B 稀疏旗舰，1M 上下文，Agent 与代码优化；model 名以控制台为准" },
  { name: "MiniMax M3", base_url: "https://api.minimax.chat/v1", model: "MiniMax-M3", category: "国内通用", scenes: ["clinic", "emergency"], priority: 27, note: "门诊/急诊备选：编码与智能体评测顶尖，长上下文" },
  { name: "硅基流动 SiliconFlow", base_url: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V4-Pro", category: "国内通用", scenes: ["fast", "clinic", "emergency", "wellness"], priority: 40, note: "国内聚合网关，一个 Key 调多家开源模型（DeepSeek/Qwen/GLM/Kimi/MiniMax）；四通道兜底" },
  /* ---- 海外通用 ---- */
  { name: "OpenAI GPT-6 Astra", base_url: "https://api.openai.com/v1", model: "gpt-6-astra", category: "海外通用", scenes: ["emergency"], priority: 1, note: "急诊主推：当前旗舰，复杂推理/编码/Agent 最强；用药必须按国内指南复核，model 名以控制台为准" },
  { name: "OpenAI GPT-6 Sol", base_url: "https://api.openai.com/v1", model: "gpt-6-sol", category: "海外通用", scenes: ["clinic"], priority: 13, note: "门诊备选：复杂编码与 Agent 工作流，成本较旗舰大幅下降；model 名以控制台为准" },
  { name: "OpenAI GPT-6 Luna", base_url: "https://api.openai.com/v1", model: "gpt-6-luna", category: "海外通用", scenes: ["fast"], priority: 34, note: "快诊备选：面向信息提取/摘要等高容量低成本任务；model 名以控制台为准" },
  { name: "Claude Opus 5.5", base_url: "https://api.anthropic.com/v1", model: "claude-opus-5-5", category: "海外通用", scenes: ["emergency"], priority: 2, note: "急诊备选：超长病历/多页报告无损消化，输出稳定幻觉低；model 名以控制台为准" },
  { name: "Claude Sonnet 5", base_url: "https://api.anthropic.com/v1", model: "claude-sonnet-5", category: "海外通用", scenes: ["clinic"], priority: 17, note: "门诊备选：均衡性价比，长文本稳定；model 名以控制台为准" },
  { name: "Gemini 3 Pro", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3-pro", category: "海外通用", scenes: ["emergency", "wellness"], priority: 14, note: "急诊/保健：医学多模态强，放射/皮肤/病理影像与体检报告解读" },
  { name: "Gemini 3.1 Pro", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.1-pro", category: "海外通用", scenes: ["fast"], priority: 35, note: "快诊备选：前沿档中成本最低，多模态" },
  { name: "Grok 4.7", base_url: "https://api.x.ai/v1", model: "grok-4.7", category: "海外通用", scenes: ["emergency"], priority: 15, note: "急诊备选：多智能体协作与实时信息接入，复杂推理；model 名以控制台为准" },
  { name: "OpenRouter", base_url: "https://openrouter.ai/api/v1", model: "openai/gpt-6-sol", category: "海外通用", scenes: ["fast", "clinic", "emergency", "wellness"], priority: 41, note: "海外聚合网关，一个 Key 调多家模型；四通道兜底" },
  /* ---- 国内垂直 ---- */
  { name: "讯飞星火医疗（晓医）", base_url: "https://spark-api-open.xf-yun.com/v1", model: "Spark-X2.5", category: "国内垂直", scenes: ["maternal"], priority: 3, note: "妇幼主推：孕产妇/儿童健康评估与用药安全语义理解；医疗版需讯飞授权，model 名以控制台为准" },
  { name: "百川 Baichuan-M4", base_url: "https://api.baichuan-ai.com/v1", model: "Baichuan-M4", category: "国内垂直", scenes: ["maternal"], priority: 4, note: "妇幼备选：低幻觉强循证，儿科/肿瘤专科；医疗版需商务授权" },
  { name: "医联 MedGPT", base_url: "", model: "medgpt", category: "国内垂直", scenes: ["wellness"], priority: 90, note: "慢病随访/健康管理；无公开 API，需企业合作接入" },
  { name: "智愈 MedSeek（良医汇）", base_url: "", model: "medseek", category: "国内垂直", scenes: ["emergency"], priority: 90, note: "肿瘤专科循证检索（TNM 分期/化疗方案），面向医生；无公开 API" },
  { name: "小荷 AI 医生", base_url: "", model: "xiaohe", category: "国内垂直", scenes: ["clinic"], priority: 90, note: "门诊：化验单拍照解读、用药科普；无公开 API" },
  { name: "联影元智", base_url: "", model: "uyuanzhi", category: "国内垂直", scenes: ["clinic", "emergency"], priority: 95, note: "医学影像辅助阅片（CT/核磁），医院端 B 端；无公开 API" },
  /* ---- 海外垂直 ---- */
  { name: "Med-PaLM 2", base_url: "", model: "med-palm-2", category: "海外垂直", scenes: ["wellness"], priority: 98, note: "体检报告总结/ICD 编码，欧美体系；面向 B 端，无公开 API" },
  { name: "Med-Gemini", base_url: "", model: "med-gemini", category: "海外垂直", scenes: ["emergency"], priority: 99, note: "医学影像+基因组多模态科研；面向 B 端，无公开 API" },
];

async function llmProviderForm(providerId) {
  try {
    let provider = null;
    if (providerId) {
      const { providers } = await api("/api/admin/llm-providers");
      provider = providers.find((p) => p.id === providerId);
      if (!provider) throw new Error("配置不存在");
    }
    const catOptions = LLM_CATEGORIES.map((c) => `<option value="${c}" ${provider && provider.category === c ? "selected" : ""}>${c}</option>`).join("");
    const tplGroups = LLM_CATEGORIES
      .map((c) => {
        const items = LLM_TEMPLATES.filter((t) => t.category === c).map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join("");
        return `<optgroup label="${c}">${items}</optgroup>`;
      })
      .join("");
    const mask = openModal(provider ? `编辑大模型配置 · ${provider.name}` : "新增大模型配置");
    const modalBody = mask.querySelector(".modal-body");
    const closeModal = () => mask.remove();
    modalBody.innerHTML = `
      <form class="form" id="llm-form">
        ${provider ? "" : `<label>常用模板（按分类选择，自动填入地址与模型名，可再修改）</label><select id="lf-template"><option value="">手动填写</option>${tplGroups}</select>`}
        <label>名称（如：DeepSeek 主力）</label>
        <input id="lf-name" type="text" value="${provider ? esc(provider.name) : ""}" placeholder="自定义名称，方便识别" />
        <label>分类</label>
        <select id="lf-category">${catOptions}</select>
        <label>API 地址（OpenAI 兼容 /v1 地址，无公开 API 的垂直模型留空）</label>
        <input id="lf-url" type="text" value="${provider ? esc(provider.base_url) : ""}" placeholder="https://api.deepseek.com/v1" />
        <label>模型名称</label>
        <input id="lf-model" type="text" value="${provider ? esc(provider.model) : ""}" placeholder="如 deepseek-v4-pro" />
        <label>API Key ${provider && provider.has_key ? `（当前 ${esc(provider.key_masked)}，留空表示不修改）` : ""}</label>
        <input id="lf-key" type="password" autocomplete="new-password" placeholder="${provider && provider.has_key ? "留空保持现有 Key" : "sk-…"}" />
        <label>适用场景备注（展示在配置列表中）</label>
        <input id="lf-note" type="text" value="${provider ? esc(provider.note || "") : ""}" placeholder="如：普通问诊首选 / 影像解读 / 肿瘤循证" />
        <label>路由场景（可多选，命中该场景时启用此模型）</label>
        <div class="llm-scenes" id="lf-scenes">
          ${LLM_SCENES.map((s) => `<label class="scene-check"><input type="checkbox" value="${s.value}" ${provider && provider.scenes && provider.scenes.includes(s.value) ? "checked" : ""}>${s.label}</label>`).join("")}
        </div>
        <label>路由优先级（数字越小越优先，同场景多模型按此排序，首个为主模型）</label>
        <input id="lf-priority" type="number" min="0" value="${provider ? provider.priority : 100}" />
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">${provider ? "保存修改" : "创建配置"}</button>
          <button type="button" class="btn-outline" id="lf-cancel">取消</button>
        </div>
        <div class="error" id="lf-error"></div>
      </form>`;
    const tpl = document.getElementById("lf-template");
    if (tpl)
      tpl.addEventListener("change", () => {
        const t = LLM_TEMPLATES.find((x) => x.name === tpl.value);
        if (!t) return;
        document.getElementById("lf-name").value = t.name;
        document.getElementById("lf-category").value = t.category;
        document.getElementById("lf-url").value = t.base_url;
        document.getElementById("lf-model").value = t.model;
        document.getElementById("lf-note").value = t.note;
        document.getElementById("lf-scenes").querySelectorAll("input").forEach((cb) => {
          cb.checked = t.scenes && t.scenes.includes(cb.value);
        });
        document.getElementById("lf-priority").value = t.priority ?? 100;
        document.getElementById("lf-key").focus();
      });
    document.getElementById("lf-cancel").addEventListener("click", closeModal);
    document.getElementById("llm-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("lf-error");
      errEl.textContent = "提交中…";
      try {
        const body = {
          name: document.getElementById("lf-name").value.trim(),
          category: document.getElementById("lf-category").value,
          base_url: document.getElementById("lf-url").value.trim(),
          model: document.getElementById("lf-model").value.trim(),
          note: document.getElementById("lf-note").value.trim(),
          scenes: Array.from(document.querySelectorAll("#lf-scenes input:checked")).map((cb) => cb.value),
          priority: Number(document.getElementById("lf-priority").value) || 100,
        };
        const key = document.getElementById("lf-key").value.trim();
        if (key) body.api_key = key;
        if (!body.name) throw new Error("请填写名称");
        if (body.base_url && !/^https?:\/\//.test(body.base_url)) throw new Error("API 地址需以 http(s):// 开头");
        if (!body.model) throw new Error("请填写模型名称");
        if (provider) {
          await api(`/api/admin/llm-providers/${provider.id}`, { method: "PUT", body: JSON.stringify(body) });
        } else {
          await api("/api/admin/llm-providers", { method: "POST", body: JSON.stringify(body) });
        }
        closeModal();
        renderSettings();
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  } catch (err) {
    alert(err.message);
  }
}

/* ===== 记录详情 ===== */
function fieldLabel(id) {
  const f = FIELDS.find((x) => x.id === id);
  return f ? f.label : id;
}

function openDetail(id) {
  const mask = openModal("加载中…");
  api(`/api/admin/records/${id}`)
    .then(({ record }) => {
      const r = record;
      const meta = LEVEL_META[r.level] || {};
      const formCells = Object.entries(r.form_data)
        .map(([k, v]) => {
          const val = Array.isArray(v) ? v.join("、") : String(v ?? "").trim();
          if (!val) return "";
          return `<div class="cell"><b>${esc(fieldLabel(k))}</b><span>${esc(val)}</span></div>`;
        })
        .join("");
      const res = r.result || {};
      const diff = (res.differential || []).map((d, i) => `<li>${i + 1}. ${esc(d.disease)}${d.probability ? `（可能性：${esc(d.probability)}）` : ""} — ${esc(d.reason)}</li>`).join("");
      const exams = (res.recommended_exams || []).map((e) => `<li>[${esc(e.priority)}] ${esc(e.item)} — ${esc(e.reason)}</li>`).join("");
      const flags = (res.red_flags || []).map((f) => `<li>${esc(f)}</li>`).join("");
      const uncertainties = (res.uncertainties || []).map((u) => `<li>${esc(u)}</li>`).join("");
      const plan = res.plan || {};

      mask.querySelector(".modal-head h3").innerHTML = `<span class="level-tag-small" style="background:${meta.color || "#9ca3af"}">${esc(meta.name || r.level)}</span> <span class="risk-pill ${riskClass(r.risk_level)}">${esc(res.risk_level || "-")}</span>`;
      mask.querySelector(".modal-body").innerHTML = `
        <div style="font-size:12px;color:var(--ink-3);margin-bottom:16px">#${r.id} · ${esc(r.name || "未留名")}${r.phone ? " · " + esc(r.phone) : ""} · ${esc(r.created_at)}</div>
        <div class="modal-section"><h4>风险分级依据</h4><p class="plain">${esc(res.risk_reason || "-")}</p>${res.confidence !== undefined ? `<p style="font-size:12px;color:var(--ink-3);margin-top:6px">置信度：${Math.round(Number(res.confidence) * 100)}%</p>` : ""}</div>
        ${flags ? `<div class="modal-section"><h4 style="color:var(--danger)">红色危险警示</h4><ul class="plain" style="color:var(--danger)">${flags}</ul></div>` : ""}
        <div class="modal-section"><h4>完整病史</h4><div class="detail-grid">${formCells || "<div class='cell'>无</div>"}</div></div>
        <div class="modal-section"><h4>关键信息汇总</h4><p class="plain">${esc(res.key_findings || "-")}</p></div>
        ${diff ? `<div class="modal-section"><h4>鉴别诊断</h4><ul class="plain">${diff}</ul></div>` : ""}
        ${exams ? `<div class="modal-section"><h4>推荐检查</h4><ul class="plain">${exams}</ul></div>` : ""}
        ${uncertainties ? `<div class="modal-section"><h4>不确定点与信息缺口</h4><ul class="plain">${uncertainties}</ul></div>` : ""}
        <div class="modal-section"><h4>分层处理建议</h4><div class="detail-grid">
          ${[["居家观察方案", plan.home_care], ["就诊科室", plan.department], ["生活禁忌", plan.contraindications], ["用药参考", plan.medication_reference], ["复诊时机", plan.follow_up]].map(([t, v]) => (v ? `<div class="cell"><b>${esc(t)}</b><span>${esc(v)}</span></div>` : "")).join("")}
        </div></div>`;
    })
    .catch((err) => {
      mask.querySelector(".modal-body").innerHTML = `<p style="color:var(--danger)">${esc(err.message)}</p>`;
    });
}

/* ===== 导出 ===== */
async function exportCsv() {
  try {
    const res = await fetch("/api/admin/export.csv", { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || "导出失败");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `consultations_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  }
}

/* ===== 启动 ===== */
logoutBtn.addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  showLogin();
});
exportBtn.addEventListener("click", exportCsv);
bindLogin();
bindSidebar();

document.getElementById("topbar-date").textContent = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

(async () => {
  if (getToken()) {
    showApp();
    await switchView("dashboard");
  } else {
    showLogin();
  }
})();
