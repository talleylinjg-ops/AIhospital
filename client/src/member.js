import { LEVEL_META, FIELDS } from "./form-config.js";
import QRCode from "qrcode";
import * as att from "./attachments.js";

/* ===== 会员会话存储 ===== */
const TOKEN_KEY = "mh_token";
const MEM_KEY = "mh_member";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function loadMember() {
  try {
    return JSON.parse(localStorage.getItem(MEM_KEY) || "null");
  } catch {
    return null;
  }
}

export function persistAuth({ token, member }) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(MEM_KEY, JSON.stringify(member));
  } catch {
    /* ignore */
  }
}

export function clearAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MEM_KEY);
  } catch {
    /* ignore */
  }
}

export function hasMember() {
  return !!loadMember();
}

export function displayName(m) {
  const x = m || loadMember();
  if (!x) return "";
  if (x.name && x.name.trim()) return x.name.trim();
  return x.phone ? `会员${String(x.phone).slice(-4)}` : "会员";
}

export function memberDisplayPhone(m) {
  const p = String((m && m.phone) || "").trim();
  return p ? `${p.slice(0, 3)}****${p.slice(-4)}` : "";
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2).replace(/\.00$/, "") : String(v);
}

/* ===== 会员 API 封装 ===== */
export async function memberApi(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`/api/member${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({ error: "服务暂时不可用，请稍后重试" }));
  if (res.status === 401) {
    clearAuth();
    location.hash = "#/login";
    throw new Error(data.error || "登录已失效，请重新登录");
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || "请求失败，请稍后重试");
  return data;
}

/* ===== Header 会员入口 ===== */
export function headerChip() {
  const m = loadMember();
  if (!m) {
    return `<a class="nav-services nav-auth" href="#/login">登录 / 注册</a>`;
  }
  return `<a class="nav-services nav-member${location.hash.startsWith("#/member") ? " active" : ""}" href="#/member"><span class="member-dot"></span>会员中心</a>`;
}

/* ===== 登录 / 注册 ===== */
export function loginView() {
  return `
    <div class="auth-card">
      <div class="auth-tabs">
        <button class="auth-tab active" data-auth="login">登录</button>
        <button class="auth-tab" data-auth="register">注册新会员</button>
      </div>
      <div class="auth-form" id="auth-form">
        <label>手机号 <i>*</i></label>
        <input id="a-phone" type="tel" maxlength="11" placeholder="请输入 11 位大陆手机号" />
        <label id="a-name-row" style="display:none">称呼（选填）</label>
        <input id="a-name" type="text" maxlength="20" style="display:none" placeholder="如：张女士" />
        <label>密码 <i>*</i></label>
        <input id="a-password" type="password" maxlength="64" placeholder="6-64 位密码（注册时设置）" />
        <div class="error" id="a-error"></div>
        <button class="btn btn-primary" id="a-submit">登录</button>
        <p class="auth-tip">注册即享有限免费 AI 问诊额度；充值后可用余额支付健康服务。</p>
      </div>
    </div>`;
}

function bindAuthForm(mode) {
  const nameRow = document.getElementById("a-name-row");
  const nameInput = document.getElementById("a-name");
  const submitBtn = document.getElementById("a-submit");
  if (mode === "register") {
    nameRow.style.display = "";
    nameInput.style.display = "";
  } else {
    nameRow.style.display = "none";
    nameInput.style.display = "none";
  }
  submitBtn.textContent = mode === "register" ? "注册并登录" : "登录";
}

export function bindLogin() {
  const tabs = document.querySelectorAll(".auth-tab");
  const phoneEl = document.getElementById("a-phone");
  const passwordEl = document.getElementById("a-password");
  const nameEl = document.getElementById("a-name");
  const errEl = document.getElementById("a-error");
  let mode = "login";
  tabs.forEach((tab) =>
    tab.addEventListener("click", () => {
      mode = tab.dataset.auth;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      errEl.textContent = "";
      bindAuthForm(mode);
    })
  );
  document.getElementById("a-submit").addEventListener("click", async () => {
    errEl.textContent = "";
    const phone = phoneEl.value.trim();
    const password = passwordEl.value;
    if (!/^1\d{10}$/.test(phone)) return (errEl.textContent = "请输入 11 位大陆手机号");
    if (password.length < 6) return (errEl.textContent = "密码至少 6 位");
    try {
      const data =
        mode === "register"
          ? await memberApi("/register", { method: "POST", body: { phone, password, name: nameEl.value.trim() } })
          : await memberApi("/login", { method: "POST", body: { phone, password } });
      persistAuth({ token: data.token, member: data.member });
      location.hash = "#/member";
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
  phoneEl.addEventListener("keydown", (e) => e.key === "Enter" && document.getElementById("a-submit").click());
  passwordEl.addEventListener("keydown", (e) => e.key === "Enter" && document.getElementById("a-submit").click());
}

/* ===== 会员中心骨架 ===== */
const TABS = [
  { tab: "", label: "概览" },
  { tab: "profile", label: "健康档案" },
  { tab: "records", label: "医疗记录" },
  { tab: "orders", label: "使用与充值" },
  { tab: "account", label: "账号设置" },
];

export function parseTab(hash) {
  const m = hash.match(/^#\/member\/([\w-]*)/);
  const tab = m ? m[1] : "";
  return TABS.some((t) => t.tab === tab) ? tab : "";
}

export function memberShell() {
  const active = parseTab(location.hash);
  return `
    <div class="member-layout">
      <div class="member-side">
        <div class="member-user">
          <div class="member-avatar">${esc(displayName().slice(0, 1))}</div>
          <div class="member-who"><b>${esc(displayName())}</b><span>${esc(memberDisplayPhone())}</span></div>
        </div>
        <nav class="member-tabs">
          ${TABS.map((t) => `<a class="member-tab${t.tab === active ? " active" : ""}" href="#/member/${t.tab}">${esc(t.label)}</a>`).join("")}
        </nav>
      </div>
      <div class="member-main" id="member-content"><div class="loading-inline">加载中…</div></div>
    </div>`;
}

async function loadContent(tab) {
  const el = document.getElementById("member-content");
  el.innerHTML = `<div class="loading-inline">加载中…</div>`;
  try {
    if (tab === "profile") {
      await renderHealth(el);
    } else if (tab === "records") {
      await renderRecords(el);
    } else if (tab === "orders") {
      await renderOrders(el);
    } else if (tab === "account") {
      await renderAccount(el);
    } else {
      await renderOverview(el);
    }
  } catch (err) {
    el.innerHTML = `<div class="error-box"><h3>加载失败</h3><p>${esc(err.message)}</p></div>`;
  }
}

export function memberBinder(tab) {
  document.querySelectorAll(".member-tab").forEach((a) => a.classList.toggle("active", parseTab(a.getAttribute("href")) === tab));
  loadContent(tab);
}

/* ===== 概览 ===== */
async function renderOverview(el) {
  const [me, consults, orders, wallet] = await Promise.all([
    memberApi("/me"),
    memberApi("/consults"),
    memberApi("/orders"),
    memberApi("/wallet?limit=6"),
  ]);
  const m = me.member || {};
  const stats = [
    { k: "账户余额", v: `¥${money(m.balance)}`, link: "#/member/orders" },
    { k: "问诊次数", v: m.consultCount ?? 0, link: "#/member/records" },
    { k: "服务订单", v: m.purchaseCount ?? 0, link: "#/member/orders" },
    { k: "高危提醒", v: m.highRiskCount ?? 0, link: "#/member/records" },
  ];
  const consultRows = (consults.items || []).slice(0, 5).map(
    (c) => `<a class="mini-row" href="#/member/records" data-jump="records">
        <span class="level-tag" style="background:${LEVEL_META[c.level]?.color || "#9ca3af"}">${esc(LEVEL_META[c.level]?.tag || c.level)}</span>
        <span class="mini-main">${esc(c.chief_complaint || "（无主诉）")}</span>
        <span class="risk-badge risk-${c.risk_level === "立即急诊" ? "急诊" : c.risk_level === "建议尽快门诊" ? "门诊" : "无需"}">${esc(c.risk_level || "—")}</span>
        <span class="mini-time">${esc((c.created_at || "").slice(0, 16))}</span>
      </a>`
  ).join("");
  const orderRows = (orders.items || []).slice(0, 5).map(
    (o) => `<div class="mini-row">
        <span class="mini-main">${esc(o.service_name)}</span>
        <b>¥${money(o.amount)}</b>
        <span class="status-badge status-${o.status === "已付款" ? "paid" : "pending"}">${esc(o.status)}</span>
        <span class="mini-time">${esc((o.created_at || "").slice(0, 16))}</span>
      </div>`
  ).join("");
  const ledgerRows = (wallet.items || []).slice(0, 5).map(
    (l) => `<div class="mini-row">
        <span class="mini-main">${esc(l.title || (l.kind === "充值" ? "余额充值" : "余额消费"))}</span>
        <b class="${l.kind === "充值" ? "ledger-in" : "ledger-out"}">${l.amount > 0 ? "+" : ""}¥${money(l.amount)}</b>
        <span class="mini-time">${esc((l.created_at || "").slice(0, 16))}</span>
      </div>`
  ).join("");
  el.innerHTML = `
    <div class="ov-stats">${stats
      .map((s) => `<a class="stat-card" href="${s.link}"><b>${esc(s.v)}</b><span>${esc(s.k)}</span></a>`)
      .join("")}</div>
    <div class="block"><h3>最近问诊</h3>${consultRows || '<p class="muted">暂无问诊记录，可在首页选择就诊通道开始一次 AI 问诊</p>'}</div>
    <div class="block"><h3>最近订单</h3>${orderRows || '<p class="muted">暂无服务订单，可前往<a href="#/services">服务购买</a></p>'}</div>
    <div class="block"><h3>账户明细</h3>${ledgerRows || '<p class="muted">暂无充值 / 消费记录</p>'}</div>`;
  el.querySelectorAll('[data-jump="records"]').forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      location.hash = "#/member/records";
    })
  );
}

/* ===== 健康档案（疾病史等，可带入问诊表单） ===== */
const PROFILE_GROUPS = [
  { title: "基础与生活", keys: ["gender", "age", "height_weight", "region", "occupation_lifestyle", "smoking_alcohol", "daily_habits"] },
  { title: "既往病史 / 手术史", keys: ["chronic_history", "past_major_events", "rare_disease_history", "prior_exams"] },
  { title: "用药史与过敏史", keys: ["current_medications", "recent_medications", "drug_allergies", "food_allergies"] },
  { title: "家族史与女性专项", keys: ["family_history", "family_similar", "female_special"] },
];
const PROFILE_IDS = PROFILE_GROUPS.flatMap((g) => g.keys);

function fieldById(id) {
  return FIELDS.find((f) => f.id === id);
}

function profileControlHtml(f, val) {
  const id = `pf-${f.id}`;
  if (f.type === "select") {
    return `<select id="${id}" data-pf="${f.id}"><option value="" ${!val ? "selected" : ""} disabled>请选择</option>${f.options
      .map((o) => `<option ${val === o ? "selected" : ""}>${esc(o)}</option>`)
      .join("")}</select>`;
  }
  if (f.type === "number") return `<input id="${id}" type="number" data-pf="${f.id}" value="${esc(val)}" />`;
  if (f.type === "textarea") return `<textarea id="${id}" data-pf="${f.id}" placeholder="${esc(f.placeholder || "")}" rows="2">${esc(val)}</textarea>`;
  return `<input id="${id}" type="text" data-pf="${f.id}" placeholder="${esc(f.placeholder || "")}" value="${esc(val)}" />`;
}

async function renderHealth(el) {
  const { health } = await memberApi("/health");
  const groupHtml = PROFILE_GROUPS.map((g) => {
    const rows = g.keys
      .map((key) => {
        const f = fieldById(key);
        if (!f) return "";
        return `<div class="field" data-field-id="${key}"><label>${esc(f.label)}</label>${profileControlHtml(f, (health || {})[key])}</div>`;
      })
      .join("");
    return `<div class="section"><div class="section-title">${esc(g.title)}</div>${rows}</div>`;
  }).join("");
  el.innerHTML = `
    <div class="member-head"><h2>健康档案（疾病史等）</h2><p>如实维护后可一键带入 AI 问诊表单，减少重复填写。患重大疾病或有变化时请及时更新。</p></div>
    <form id="health-form">${groupHtml}
      <div class="error" id="pf-error"></div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">保存健康档案</button>
      </div>
    </form>
    <div class="block" style="margin-top:22px">
      <h3>我的材料库（病历 / 检验 / 报告）</h3>
      <p class="muted">长期保存的病历卡、检验单、报告单、影像等，便于每次问诊或服务办理时快速查阅与补传。</p>
      <div id="member-library-body"></div>
    </div>`;
  att.mountUploader(document.getElementById("member-library-body"), {
    target: "member",
    id: null,
    list: true,
    deletable: true,
    kind: "病历卡",
    hint: "上传后长期保存在此，仅供本人与后台核对使用。",
  });
  document.getElementById("health-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("pf-error");
    err.textContent = "";
    const out = {};
    for (const key of PROFILE_IDS) {
      const elx = document.querySelector(`[data-pf="${key}"]`);
      if (elx) out[key] = elx.value.trim();
    }
    try {
      await memberApi("/health", { method: "PUT", body: { health: out } });
      err.textContent = "健康档案已保存";
      err.style.color = "var(--primary)";
    } catch (ex) {
      err.textContent = ex.message;
      err.style.color = "var(--danger)";
    }
  });
}

/* ===== 医疗记录（AI 问诊） ===== */
async function renderRecords(el) {
  const { items } = await memberApi("/consults");
  if (!items.length) {
    el.innerHTML = `<div class="member-head"><h2>医疗记录</h2><p>暂无问诊记录</p></div>`;
    return;
  }
  const rows = items
    .map(
      (c) => `<div class="record-item" data-rid="${c.id}">
        <div class="record-head">
          <span class="level-tag" style="background:${LEVEL_META[c.level]?.color || "#9ca3af"}">${esc(LEVEL_META[c.level]?.tag || c.level)}</span>
          <span class="risk-badge risk-${c.risk_level === "立即急诊" ? "急诊" : c.risk_level === "建议尽快门诊" ? "门诊" : "无需"}">${esc(c.risk_level || "—")}</span>
          <b class="record-title">${esc(c.chief_complaint || "（无主诉）")}</b>
          <span class="record-time">${esc(c.created_at)}</span>
          <button class="btn-outline btn-sm" data-toggle="1">查看详情</button>
        </div>
        <div class="record-detail" hidden></div>
      </div>`
    )
    .join("");
  el.innerHTML = `<div class="member-head"><h2>医疗记录</h2><p>共 ${items.length} 次 AI 问诊，点击查看完整评估结果</p></div><div id="record-list">${rows}</div>`;
  el.querySelectorAll("[data-toggle]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const item = btn.closest(".record-item");
      const box = item.querySelector(".record-detail");
      const rid = item.dataset.rid;
      if (box.hidden) {
        box.hidden = false;
        btn.textContent = "收起";
        box.innerHTML = `<div class="loading-inline">加载中…</div>`;
        try {
          const { item: rec } = await memberApi(`/consults/${rid}`);
          const r = rec.result || {};
          const diff = (r.differential || [])
            .slice()
            .sort((a, b) => a.probability === "高" ? -1 : a.probability === "中" ? (b.probability === "低" ? -1 : 1) : 1)
            .map((d, i) => `<li><b>${i + 1}. ${esc(d.disease)}</b>${d.probability ? `（可能性：${esc(d.probability)}）` : ""} — ${esc(d.reason)}</li>`)
            .join("");
          const flags = (r.red_flags || []).map((f) => `<li>${esc(f)}</li>`).join("");
          const plan = r.plan || {};
          box.innerHTML = `
            <div class="block"><h3>关键信息汇总</h3><p>${esc(r.key_findings || "")}</p>${r.risk_reason ? `<p class="muted"><b>危险依据：</b>${esc(r.risk_reason)}</p>` : ""}</div>
            ${flags ? `<div class="block"><h3>红色危险警示</h3><ul class="list-plain">${flags}</ul></div>` : ""}
            <div class="block"><h3>鉴别诊断</h3>${diff ? `<ul class="list-plain">${diff}</ul>` : "<p class='muted'>暂无</p>"}</div>
            <div class="block"><h3>建议</h3><p>${esc(plan.home_care || "")}</p>${plan.department ? `<p class="muted"><b>建议就诊：</b>${esc(plan.department)}</p>` : ""}${plan.follow_up ? `<p class="muted"><b>复诊时机：</b>${esc(plan.follow_up)}</p>` : ""}</div>
            <div class="block"><h3>附件材料</h3><div id="rec-att-${rid}"></div></div>`;
          att.mountUploader(document.getElementById(`rec-att-${rid}`), {
            target: "consult",
            id: rid,
            list: true,
            kind: "检验单",
            hint: "本次问诊的病历 / 检验单 / 报告等材料，可继续补充上传。",
          });
        } catch (err) {
          box.innerHTML = `<p class="error">${esc(err.message)}</p>`;
        }
      } else {
        box.hidden = true;
        btn.textContent = "查看详情";
      }
    })
  );
}

/* ===== 使用与充值记录 ===== */
let rechargeTimer = null;
async function renderOrders(el) {
  if (rechargeTimer) {
    clearInterval(rechargeTimer);
    rechargeTimer = null;
  }
  const [wallet, orders, pay] = await Promise.all([
    memberApi("/wallet"),
    memberApi("/orders"),
    fetch("/api/pay/status").then((r) => r.json()).catch(() => ({ alipay: false, wechat: false })),
  ]);
  const channels = [];
  if (pay.alipay) channels.push({ id: "alipay", label: "支付宝" });
  if (pay.wechat) channels.push({ id: "wechat", label: "微信支付" });
  const online = channels.length > 0;
  const ledgerRows = (wallet.items || [])
    .map(
      (l) => `<tr><td>${esc((l.created_at || "").slice(0, 16))}</td><td>${esc(l.title || (l.kind === "充值" ? "余额充值" : "余额消费"))}</td><td class="ledger-${l.kind === "充值" ? "in" : "out"}">${l.amount > 0 ? "+" : ""}¥${money(l.amount)}</td><td>¥${money(l.balance_after)}</td></tr>`
    )
    .join("");
  const orderRows = (orders.items || [])
    .map(
      (o) => `<tr><td>${esc((o.created_at || "").slice(0, 16))}</td><td>${esc(o.service_name)}</td><td>×${o.qty}</td><td>¥${money(o.amount)}</td><td><span class="status-badge status-${o.status === "已付款" ? "paid" : "pending"}">${esc(o.status)}</span></td><td class="muted">${esc(o.source || "")}</td></tr>`
    )
    .join("");
  const quick = [50, 100, 200, 500];
  el.innerHTML = `
    <div class="member-head"><h2>使用与充值记录</h2><p>当前余额：<b class="balance-big">¥${money(wallet.balance)}</b>，${online ? "支持在线充值，支付成功后自动到账。" : "当前为演示环境，充值为模拟支付、实时到账。"}</p></div>
    <div class="block">
      <h3>余额充值</h3>
      <div class="recharge-row">
        ${quick.map((v) => `<button class="btn-outline" data-amt="${v}">¥${v}</button>`).join("")}
        <input id="rc-custom" type="number" min="1" max="10000" step="0.01" placeholder="自定义金额" />
      </div>
      ${
        online
          ? `<div class="field"><label>支付方式</label><div class="recharge-row" id="rc-channels">${channels
              .map((c, i) => `<button class="btn-outline rc-channel${i === 0 ? " active" : ""}" data-channel="${c.id}">${c.label}</button>`)
              .join("")}</div></div>`
          : ""
      }
      <div class="error" id="rc-error"></div>
      <button class="btn btn-primary" id="rc-submit">立即充值</button>
      <div id="rc-pay-panel"></div>
    </div>
    <div class="block"><h3>账户明细（充值 / 消费）</h3>
      <div class="table-wrap"><table><thead><tr><th>时间</th><th>说明</th><th>金额</th><th>余额</th></tr></thead><tbody>${ledgerRows || `<tr><td colspan="4" class="muted">暂无记录</td></tr>`}</tbody></table></div>
    </div>
    <div class="block"><h3>服务订单</h3>
      <div class="table-wrap"><table><thead><tr><th>时间</th><th>服务项目</th><th>数量</th><th>金额</th><th>状态</th><th>来源</th></tr></thead><tbody>${orderRows || `<tr><td colspan="6" class="muted">暂无订单</td></tr>`}</tbody></table></div>
    </div>`;
  document.querySelectorAll("[data-amt]").forEach((b) =>
    b.addEventListener("click", () => {
      document.getElementById("rc-custom").value = b.dataset.amt;
    })
  );
  let channel = channels.length ? channels[0].id : "";
  document.querySelectorAll(".rc-channel").forEach((b) =>
    b.addEventListener("click", () => {
      channel = b.dataset.channel;
      document.querySelectorAll(".rc-channel").forEach((x) => x.classList.toggle("active", x === b));
    })
  );
  document.getElementById("rc-submit").addEventListener("click", async () => {
    const err = document.getElementById("rc-error");
    err.textContent = "";
    err.style.color = "";
    const amount = Number(document.getElementById("rc-custom").value) || 0;
    if (!(amount > 0) || amount > 10000) return (err.textContent = "请输入 1-10000 之间的充值金额");
    const btn = document.getElementById("rc-submit");
    btn.disabled = true;
    btn.textContent = "提交中…";
    try {
      const res = await memberApi("/recharge", { method: "POST", body: { amount, channel } });
      if (res.mode === "simulated") {
        err.textContent = res.message || "充值成功，余额已更新";
        err.style.color = "var(--primary)";
        setTimeout(() => loadContent("orders"), 600);
        return;
      }
      renderRechargeQr(res, channels.find((c) => c.id === res.channel));
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "立即充值";
    }
  });
}

function renderRechargeQr(res, channel) {
  const panel = document.getElementById("rc-pay-panel");
  if (!panel) return;
  panel.innerHTML = `
    <div class="pay-panel">
      <h4>请使用${channel ? channel.label : "手机"}扫码支付 ¥${money(res.amount)}</h4>
      <canvas id="rc-qr" width="220" height="220"></canvas>
      <p class="muted">支付完成后将自动到账；若已支付但余额未更新，请点击下方按钮刷新。</p>
      <button class="btn-outline" id="rc-check">我已完成支付</button>
      <div class="error" id="rc-pay-error"></div>
    </div>`;
  try {
    QRCode.toCanvas(document.getElementById("rc-qr"), res.code, { width: 220, margin: 1 });
  } catch {
    document.getElementById("rc-qr").insertAdjacentHTML("afterend", `<p class="muted" style="word-break:break-all">${esc(res.code)}</p>`);
  }
  const check = async () => {
    try {
      const s = await memberApi(`/recharge/${res.orderId}/status`);
      if (s.status === "已付款") {
        if (rechargeTimer) {
          clearInterval(rechargeTimer);
          rechargeTimer = null;
        }
        panel.innerHTML = `<p class="pay-ok">支付成功，余额已更新。</p>`;
        setTimeout(() => loadContent("orders"), 800);
        return true;
      }
      document.getElementById("rc-pay-error").textContent = "尚未收到付款，请完成扫码支付后重试。";
    } catch (ex) {
      document.getElementById("rc-pay-error").textContent = ex.message;
    }
    return false;
  };
  document.getElementById("rc-check").addEventListener("click", check);
  if (rechargeTimer) clearInterval(rechargeTimer);
  rechargeTimer = setInterval(() => {
    if (!document.getElementById("rc-pay-panel")) {
      clearInterval(rechargeTimer);
      rechargeTimer = null;
      return;
    }
    check();
  }, 3000);
}

/* ===== 账号设置 ===== */
async function renderAccount(el) {
  const m = (await memberApi("/me")).member;
  const saved = loadMember();
  const saveToken = getToken();
  el.innerHTML = `
    <div class="acct-header">
      <h2>账号设置</h2>
      <p>管理登录信息与账号安全</p>
    </div>

    <section class="acct-profile">
      <div class="acct-avatar">${esc(displayName().slice(0, 1))}</div>
      <div class="acct-profile-main">
        <div class="acct-profile-name">${esc(displayName())}<span class="acct-badge">会员</span></div>
        <div class="acct-profile-meta">${esc(memberDisplayPhone())}</div>
      </div>
      <a class="acct-profile-link" href="#/member/orders">账户明细</a>
    </section>

    <div class="acct-panels">
      <section class="acct-panel">
        <div class="acct-panel-head"><h3>基本资料</h3><span class="acct-panel-desc">更新称呼或更换登录手机号</span></div>
        <div class="field"><label>登录手机号</label><input id="ac-phone" type="tel" maxlength="11" value="${esc(m.phone || "")}" placeholder="新手机号（留空则不修改）" /></div>
        <div class="field"><label>称呼</label><input id="ac-name" type="text" maxlength="20" value="${esc(m.name || "")}" placeholder="如何称呼您" /></div>
        <div class="field"><label>当前密码<span class="opt-mark">用于确认本次修改</span></label><input id="ac-cur1" type="password" maxlength="64" placeholder="请输入当前密码" /></div>
        <div class="error" id="ac-error"></div>
        <div class="acct-panel-foot"><button class="btn btn-primary" id="ac-save">保存资料</button></div>
      </section>

      <section class="acct-panel">
        <div class="acct-panel-head"><h3>修改密码</h3><span class="acct-panel-desc">建议使用 6 位以上、不易猜测的密码</span></div>
        <div class="field"><label>当前密码</label><input id="pw-old" type="password" maxlength="64" placeholder="请输入当前密码" /></div>
        <div class="field"><label>新密码</label><input id="pw-new" type="password" maxlength="64" placeholder="6-64 位新密码" /></div>
        <div class="field"><label>确认新密码</label><input id="pw-new2" type="password" maxlength="64" placeholder="再次输入新密码" /></div>
        <div class="error" id="pw-error"></div>
        <div class="acct-panel-foot"><button class="btn btn-primary" id="pw-save">修改密码</button></div>
      </section>
    </div>

    <div class="acct-logout-row">
      <button class="acct-logout" id="logout-btn">退出登录</button>
    </div>`;
  const flash = (idEl, msg, ok) => {
    const e = document.getElementById(idEl);
    e.textContent = msg;
    e.style.color = ok ? "var(--primary)" : "var(--danger)";
  };
  document.getElementById("ac-save").addEventListener("click", async () => {
    try {
      const newPhone = document.getElementById("ac-phone").value.trim();
      const name = document.getElementById("ac-name").value.trim();
      const password = document.getElementById("ac-cur1").value;
      if (newPhone && !/^1\d{10}$/.test(newPhone)) return flash("ac-error", "请输入 11 位大陆手机号", false);
      if (!password) return flash("ac-error", "请输入当前密码以确认修改", false);
      const r = await memberApi("/account", { method: "PUT", body: { password, name, newPhone } });
      persistAuth({ token: saveToken, member: r.member });
      flash("ac-error", "资料已保存", true);
      document.getElementById("ac-cur1").value = "";
    } catch (err) {
      flash("ac-error", err.message, false);
    }
  });
  document.getElementById("pw-save").addEventListener("click", async () => {
    try {
      const oldPassword = document.getElementById("pw-old").value;
      const newPassword = document.getElementById("pw-new").value;
      const confirm = document.getElementById("pw-new2").value;
      if (newPassword.length < 6) return flash("pw-error", "新密码至少 6 位", false);
      if (newPassword !== confirm) return flash("pw-error", "两次输入的新密码不一致", false);
      const r = await memberApi("/password", { method: "PUT", body: { oldPassword, newPassword } });
      persistAuth({ token: saveToken, member: r.ok ? saved : saved });
      flash("pw-error", "密码修改成功，下次登录请使用新密码", true);
      document.getElementById("pw-old").value = "";
      document.getElementById("pw-new").value = "";
      document.getElementById("pw-new2").value = "";
    } catch (err) {
      flash("pw-error", err.message, false);
    }
  });
  document.getElementById("logout-btn").addEventListener("click", async () => {
    try {
      await memberApi("/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    clearAuth();
    location.hash = "#/";
  });
}

/* ===== 导出给 main.js 使用：预填问诊表单 & 账号信息 ===== */
export function memberNamePhone() {
  const m = loadMember();
  return m ? { name: m.name || "", phone: m.phone || "" } : { name: "", phone: "" };
}

export async function prefillFormFromProfile() {
  if (!hasMember()) return;
  try {
    const { health } = await memberApi("/health");
    for (const key of PROFILE_IDS) {
      const val = (health || {})[key];
      if (val === undefined || val === null || String(val).trim() === "") continue;
      const el = document.querySelector(`[data-field="${key}"]`);
      if (!el) continue;
      if (el.matches("select")) {
        const opt = [...el.options].find((o) => o.value === String(val));
        if (opt) el.value = String(val);
      } else if (el.type === "radio") {
        const radio = document.querySelector(`input[name="${key}"][value="${val}"]`);
        if (radio) radio.checked = true;
      } else {
        el.value = String(val);
      }
    }
  } catch {
    /* 预填失败静默（如未登录/档案空） */
  }
}
