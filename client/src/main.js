import { LEVEL_META, SECTIONS, FIELDS, isRequired, getRequiredFields, validate } from "./form-config.js";
import QRCode from "qrcode";
import * as memberUI from "./member.js";
import * as att from "./attachments.js";
import { netErrorText } from "./net.js";

const app = document.getElementById("app");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  level: null,
  formData: {},
  result: null,
  consultRecordId: null,
  attachWarn: "",
};

/* 结果页刷新后仍可回看：本次会话内暂存最近一次问诊结果 */
const LAST_RESULT_KEY = "mh_last_result";
function saveLastResult(level, result, recordId) {
  try {
    sessionStorage.setItem(LAST_RESULT_KEY, JSON.stringify({ level, result, recordId }));
  } catch {
    /* 隐私模式等场景忽略 */
  }
}
function restoreLastResult() {
  try {
    const raw = sessionStorage.getItem(LAST_RESULT_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || !d.result) return false;
    state.level = d.level;
    state.result = d.result;
    state.consultRecordId = d.recordId || null;
    return true;
  } catch {
    return false;
  }
}

const API = (window.__API_ORIGIN__ || "") + "/api";

/* 头部导航按钮文字：PC 用全称/tag，移动端用 2 字短称 */
const NAV_SHORT = { L1: "轻微快诊", L2: "中等症状", L3: "危重症", L4: "日常保健" };
const MOBILE_NAV_SHORT = { L1: "轻微", L2: "中等", L3: "危重症", L4: "保健", L5: "妇幼", L6: "中医", L7: "眼科", L8: "口腔", L9: "解读" };

/* 导航未激活文字用通道色相（比 LEVEL_META.color 提亮一档，保证在深青 header 上可读）；激活态仍用原色 */
const NAV_TEXT_COLOR = {
  L1: "#2dd4bf", L2: "#fbbf24", L3: "#f87171", L4: "#4ade80",
  L5: "#f472b6", L6: "#a78bfa", L7: "#22d3ee", L8: "#fbbf24", L9: "#60a5fa",
};

/* ===== Header ===== */
function header(showLevels = true) {
  const renderLevelBtn = ([key, m]) => {
    const active = state.level === key ? " active" : "";
    const text = NAV_SHORT[key] || m.tag;
    const mText = MOBILE_NAV_SHORT[key] || m.tag;
    return `<button class="nav-level-btn${active}" data-nav-level="${key}" title="${esc(m.name)}" aria-pressed="${active ? "true" : "false"}" style="--lv-color:${m.color};--nav-color:${NAV_TEXT_COLOR[key] || m.color}"><span class="t-pc">${esc(text)}</span><span class="t-m">${esc(mText)}</span></button>`;
  };
  const entries = Object.entries(LEVEL_META);
  /* PC 与移动端均为单行：9 通道按钮一排（移动端横向滚动、短称），登录/会员入口固定右侧 */
  const levelButtons = `<div class="nav-level-row">${entries.map(renderLevelBtn).join("")}</div>`;
  return `
  <header class="site-header">
    <div class="container header-inner">
      <div class="brand">
        <a href="#/" class="brand-link" aria-label="大气AI医院首页">
          <picture>
            <source media="(max-width: 900px)" srcset="/logo-m.png" />
            <img class="brand-logo" src="/logo.png" alt="大气AI医院" />
          </picture>
        </a>
      </div>
      ${showLevels ? `<nav class="nav-levels">${levelButtons}</nav>` : ""}
      <div class="header-actions">
        ${memberUI.headerChip()}
      </div>
    </div>
  </header>`;
}

function footer() {
  return "";
}

/* ===== Views ===== */

function homeView() {
  const cards = Object.entries(LEVEL_META)
    .map(([key, m]) => {
      const reqCount = getRequiredFields(key).length;
      return `
      <div class="level-card" data-level="${key}" role="button" tabindex="0" aria-label="${esc(m.name)}：${esc(m.subtitle)}">
        <span class="level-tag" style="background:${m.color}">${esc(m.tag)}</span>
        <div class="level-title">${esc(m.name)}</div>
        <div class="level-sub">${esc(m.subtitle)}</div>
        <div class="level-desc">${esc(m.desc)}</div>
        <div class="level-required">必填项：<b>${reqCount}</b> 项 · 完整病史表单共 ${FIELDS.length} 项</div>
      </div>`;
    })
    .join("");

  return `
    ${header()}
    <div class="container">
      <div class="hero">
        <div class="hero-row">
          <h1>AI 医院 · 智能预问诊</h1>
          <div class="notice">急危重症请直接拨打 120，本系统不能替代急诊</div>
        </div>
      </div>
      <div class="level-grid">${cards}</div>
      <div class="services-entry">
        <div>
          <div class="services-entry-title">健康服务购买</div>
          <div class="services-entry-sub">AI 慢病管理、复诊续方（合作持牌互联网医院）、就医绿通等服务，支持支付宝/微信在线支付，支付后即时开通</div>
        </div>
        <a class="btn btn-primary" href="#/services">进入服务购买</a>
      </div>
      <div class="home-mode-strip">
        <div><b>AI 预问诊</b><span>9 大通道完整病史采集，输出分诊与就医指引</span></div>
        <div><b>复诊续方</b><span>合作持牌互联网医院医生复核 + 药师审方，慢病续方合规开药</span></div>
        <div><b>医药商城</b><span>药品器械一件代发直邮，处方药凭电子处方配送</span></div>
      </div>

    </div>
    ${footer()}`;
}

/* ===== 问诊表单病历 / 报告材料（先暂存，提交问诊拿到 recordId 后统一归档） ===== */
let consultFiles = []; // { file, kind }
let consultFileKind = "报告单";

function drawConsultPicker() {
  const box = document.getElementById("consult-attach-picker");
  if (!box) return;
  const list = document.getElementById("ca-list");
  if (!list) return;
  const tip = document.getElementById("ca-tip");
  if (tip) tip.textContent = consultFiles.length ? `已选择 ${consultFiles.length} 份，提交问诊后自动归档到本次记录` : "尚未选择材料，可点击上方按钮添加（选填）";
  if (!consultFiles.length) {
    list.innerHTML = "";
    return;
  }
  list.innerHTML = consultFiles
    .map(
      (f, i) => `
    <div class="att-pending-row">
      <span class="att-file-ico">${att.isPdf(f.file.type) ? "PDF" : "IMG"}</span>
      <span class="att-pname" title="${att.esc(f.file.name)}">${att.esc(f.file.name)}</span>
      <select data-idx="${i}" class="att-row-kind">${att.kindOptions(f.kind)}</select>
      <span class="muted">${att.fmtSize(f.file.size)}</span>
      <button type="button" class="att-del" data-idx="${i}">移除</button>
    </div>`
    )
    .join("");
  list.querySelectorAll("select.att-row-kind").forEach((sel) =>
    sel.addEventListener("change", () => {
      consultFiles[Number(sel.dataset.idx)].kind = sel.value;
    })
  );
  list.querySelectorAll("button.att-del").forEach((btn) =>
    btn.addEventListener("click", () => {
      consultFiles.splice(Number(btn.dataset.idx), 1);
      drawConsultPicker();
    })
  );
}

function bindConsultPicker(level) {
  const box = document.getElementById("consult-attach-picker");
  if (!box) return;
  const isL9 = level === "L9";
  /* L9 报告解读：统一双入口（拍照 / 扫一扫 + 从相册选择），kind 固定「报告单」 */
  box.innerHTML = isL9
    ? `
    <div class="report-btn-row">
      <button type="button" class="btn-outline report-btn" id="ca-add">拍照 / 扫一扫上传报告</button>
      <button type="button" class="btn-outline report-btn" id="ca-add-plain">从相册选择</button>
      <input type="file" id="ca-input" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden capture="environment" />
      <input type="file" id="ca-input-plain" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden />
      <span class="muted att-tip" id="ca-tip"></span>
    </div>
    <div id="ca-list"></div>`
    : `
    <div class="att-row">
      <select id="ca-kind">${att.kindOptions(consultFileKind)}</select>
      <button type="button" class="btn-outline" id="ca-add">选择病历 / 报告文件…</button>
      <input type="file" id="ca-input" accept="${att.DOC_ACCEPT}" multiple hidden />
      <span class="muted att-tip" id="ca-tip"></span>
    </div>
    <div id="ca-list"></div>`;
  const kindSel = box.querySelector("#ca-kind");
  if (kindSel) {
    kindSel.addEventListener("change", () => {
      consultFileKind = kindSel.value;
      consultFiles.forEach((f) => (f.kind = consultFileKind));
      drawConsultPicker();
    });
  }
  const handleFiles = (picked) => {
    for (const file of picked) {
      if (!file) continue;
      if (file.size > att.DOC_MAX_BYTES) {
        alert(`「${file.name}」超过 6MB 限制，已跳过，请压缩后重传`);
        continue;
      }
      const okMime = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(file.type);
      if (!okMime) {
        alert(`「${file.name}」格式不支持，仅支持图片或 PDF`);
        continue;
      }
      consultFiles.push({ file, kind: isL9 ? "报告单" : consultFileKind });
    }
    drawConsultPicker();
  };
  box.querySelector("#ca-add").addEventListener("click", () => box.querySelector("#ca-input").click());
  if (isL9) box.querySelector("#ca-add-plain").addEventListener("click", () => box.querySelector("#ca-input-plain").click());
  box.querySelector("#ca-input").addEventListener("change", (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    handleFiles(picked);
  });
  if (isL9) {
    box.querySelector("#ca-input-plain").addEventListener("change", (e) => {
      const picked = Array.from(e.target.files || []);
      e.target.value = "";
      handleFiles(picked);
    });
  }
}

function formView(level) {
  const m = LEVEL_META[level];
  if (!m) {
    location.hash = "#/";
    return;
  }

  const renderField = (f) => {
    const req = isRequired(f, level);
    const val = state.formData[f.id] ?? "";
    const optMark = req ? "" : `<span class="opt-mark">选填</span>`;
    const reqMark = req ? '<span class="req">*</span>' : "";
    const id = `f-${f.id}`;
    /* 语音输入按钮（浏览器支持时由 bindForm 激活） */
    const mic = f.type === "text" || f.type === "textarea" ? `<button type="button" class="mic-btn" data-mic="${f.id}" aria-label="语音输入" hidden><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg></button>` : "";

    let control = "";
    if (f.type === "select") {
      const opts = ['<option value="" disabled>请选择</option>']
        .concat(f.options.map((o) => `<option ${val === o ? "selected" : ""}>${esc(o)}</option>`))
        .join("");
      control = `<select id="${id}" data-field="${f.id}">${opts}</select>`;
    } else if (f.type === "radio") {
      const radios = f.options
        .map(
          (o) =>
            `<label><input type="radio" name="${f.id}" value="${esc(o)}" ${val === o ? "checked" : ""} data-field="${f.id}"/>${esc(o)}</label>`
        )
        .join("");
      control = `<div class="radio-group" id="${id}">${radios}</div>`;
    } else if (f.type === "number") {
      control = `<div class="input-with-mic"><input id="${id}" type="number" data-field="${f.id}" placeholder="${esc(f.placeholder || "")}" value="${esc(val)}" inputmode="decimal" />${mic}</div>`;
    } else if (f.type === "textarea") {
      control = `<div class="input-with-mic"><textarea id="${id}" data-field="${f.id}" placeholder="${esc(f.placeholder || "")}">${esc(val)}</textarea>${mic}</div>`;
    } else {
      control = `<div class="input-with-mic"><input id="${id}" type="text" data-field="${f.id}" placeholder="${esc(f.placeholder || "")}" value="${esc(val)}" />${mic}</div>`;
    }

    return `
      <div class="field" data-field-id="${f.id}">
        <label for="${id}">${esc(f.label)}${reqMark}${optMark}</label>
        ${control}
      </div>`;
  };

  /* 必填项统一置顶（PC 与移动端一致），其余字段按原分区渲染 */
  const requiredIds = new Set(getRequiredFields(level).map((f) => f.id));
  const requiredSection = requiredIds.size
    ? `<div class="section section-required"><div class="section-title">必填信息（请优先填写）<span class="req-note">共 ${requiredIds.size} 项，填完即可提交</span></div>${getRequiredFields(level).map(renderField).join("")}</div>`
    : "";

  const sectionsHtml = SECTIONS.map((sec) => {
    const fields = FIELDS.filter((f) => f.section === sec.id && !requiredIds.has(f.id));
    if (!fields.length) return "";
    const allRequired = fields.every((f) => isRequired(f, level));
    const sectionHasRequired = fields.some((f) => isRequired(f, level));
    const fieldsHtml = fields.map(renderField).join("");
    const optNote = allRequired ? "" : sectionHasRequired ? "" : `<span class="opt">(本部分选填)</span>`;
    return `<div class="section"><div class="section-title">${esc(sec.title)}${optNote}</div>${fieldsHtml}</div>`;
  }).join("");

  return `
    ${header()}
    <div class="container">
      ${memberUI.hasMember() ? `<div class="member-note">已登录会员：问诊记录将自动关联您的会员档案，健康档案（既往史/过敏史/家族史等）已为您预填，可按需修改。</div>` : ""}
      <div class="form-head">
        <span class="level-tag" style="background:${m.color}">${esc(m.tag)}</span>
        <h2>${esc(m.name)} · 结构化病史表单</h2>
        <p>${esc(m.desc)}</p>
      </div>
      <form id="consult-form" novalidate>
        <div class="attach-panel">
          <div class="section-title">${level === "L9" ? "报告照片上传（必填）" : "病历 / 检验 / 报告上传（选填）"}</div>
          <p class="attach-note">${level === "L9" ? "请拍照或扫一扫上传报告照片（可从相册选择，最多 2 张，单个不超过 6MB），AI 将对报告逐项解读；照片将随本次问诊一并归档。" : "支持上传病历卡、检验单、报告单、影像胶片或处方等（jpg/png/webp/gif/pdf，单个不超过 6MB）。材料将随本次问诊一并归档，供医师与后台快速核对。"}</p>
          <div id="consult-attach-picker"></div>
        </div>
        ${requiredSection}
        ${sectionsHtml}
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">提交 AI 问诊</button>
        </div>
      </form>
    </div>
    ${footer()}`;
}

function loadingView() {
  return `
    ${header()}
    <div class="container">
      <div class="loading">
        <div class="pulse"></div>
        <h3>AI 医生正在为您推理</h3>
        <p>已收到您的完整病史，正在执行严谨的临床分诊与鉴别推理…</p>
        <div class="steps">
          <span class="done">✓ 信息提取</span>
          <span class="done">✓ 指南检索</span>
          <span>鉴别诊断</span>
          <span>风险分级</span>
        </div>
      </div>
    </div>
    ${footer()}`;
}

const PROB_ORDER = { 高: 0, 中: 1, 低: 2 };

function resultView() {
  const r = state.result;
  const m = LEVEL_META[state.level];
  if (!r) {
    location.hash = "#/";
    return "";
  }

  const riskClass = r.risk_level === "立即急诊" ? "急诊" : r.risk_level === "建议尽快门诊" ? "门诊" : "无需";

  const redFlag = r.red_flags && r.red_flags.length
    ? `<div class="red-flag">
        <h3>⚠ 红色危险警示</h3>
        <ul>${r.red_flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      </div>`
    : "";

  const differential = (r.differential || [])
    .slice()
    .sort((a, b) => (PROB_ORDER[a.probability] ?? 9) - (PROB_ORDER[b.probability] ?? 9))
    .map(
      (d, i) => `
      <div class="diff-item">
        <span class="diff-rank">${i + 1}</span>
        <div class="diff-body">
          <div class="diff-name">${esc(d.disease)}${d.probability ? `<span class="prob">可能性：${esc(d.probability)}</span>` : ""}</div>
          <div class="diff-reason">${esc(d.reason)}</div>
        </div>
      </div>`
    )
    .join("");

  const exams = (r.recommended_exams || [])
    .slice()
    .sort((a, b) => (a.priority === "必做" ? 0 : 1) - (b.priority === "必做" ? 0 : 1))
    .map(
      (e) => `
      <div class="exam-item">
        <span class="exam-priority ${esc(e.priority)}">${esc(e.priority)}</span>
        <div>
          <div class="exam-name">${esc(e.item)}</div>
          <div class="exam-reason">${esc(e.reason)}</div>
        </div>
      </div>`
    )
    .join("");

  const plan = r.plan || {};
  const planCells = [
    ["居家观察方案", plan.home_care],
    ["建议就诊科室", plan.department],
    ["生活禁忌与注意事项", plan.contraindications],
    ["用药参考（不替代处方）", plan.medication_reference],
    ["复诊时机", plan.follow_up],
    ["处方服务说明", r.level === "L9" ? "" : "如需线上开具处方，须为您已在实体医院确诊的慢病复诊续方：完成本报告后可购买互联网诊疗服务，由合作持牌互联网医院医生复核、药师审方后开具电子处方，药品由合作医药供应链一件代发。首诊请前往实体医疗机构。"],
  ]
    .map(
      ([t, v]) =>
        v
          ? `<div class="plan-cell"><h4>${esc(t)}</h4><p>${esc(v)}</p></div>`
          : ""
    )
    .join("");

  const uncertainty = r.uncertainties && r.uncertainties.length
    ? `<ul class="list-plain">${r.uncertainties.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>`
    : "<p style='color:var(--ink-3)'>暂无</p>";

  const confidence =
    typeof r.confidence === "number"
      ? `<div class="confidence">置信度：<b>${Math.round(r.confidence * 100)}%</b></div>`
      : "";

  const channelTag = (LEVEL_META[state.level] && LEVEL_META[state.level].tag) || (r.route && r.route.scene_label) || "";
  const routeTag = (channelTag || r.route?.fallback_used || r.route?.degraded)
    ? `<div class="route-tag">${channelTag ? `<span class="badge-muted">${esc(channelTag)}通道</span>` : ""}${r.route?.fallback_used ? ` <span class="badge-muted">已自动切换备用模型</span>` : ""}${r.route?.degraded ? ` <span class="badge-warn">该通道未专属配置，已用可用模型兜底</span>` : ""}</div>`
    : "";

  return `
    ${header()}
    <div class="container">
      <div class="result-head">
        <span class="level-tag" style="background:${m.color}">${esc(m.tag)}</span>
        <span class="risk-badge risk-${riskClass}">${esc(r.risk_level)}</span>
        ${confidence}
      </div>
      ${routeTag}
      ${redFlag}
      <div class="block">
        <h3><span class="ico" style="background:var(--primary)">1</span>关键信息汇总</h3>
        <p>${esc(r.key_findings)}</p>
        ${r.risk_reason ? `<p style="margin-top:10px;color:var(--ink-2);font-size:13px"><b>危险依据：</b>${esc(r.risk_reason)}</p>` : ""}
      </div>
      <div class="block">
        <h3><span class="ico" style="background:var(--primary)">2</span>鉴别诊断列表（按可能性排序）</h3>
        ${differential || "<p style='color:var(--ink-3)'>暂无</p>"}
      </div>
      <div class="block">
        <h3><span class="ico" style="background:var(--amber)">3</span>最大不确定点 &amp; 信息缺口</h3>
        ${uncertainty}
      </div>
      <div class="block">
        <h3><span class="ico" style="background:var(--amber)">4</span>推荐检查项目</h3>
        ${exams || "<p style='color:var(--ink-3)'>暂无</p>"}
      </div>
      <div class="block">
        <h3><span class="ico" style="background:var(--primary)">5</span>分层处理建议</h3>
        <div class="plan-grid">${planCells || "<p style='color:var(--ink-3)'>暂无</p>"}</div>
      </div>
      <div class="block" id="record-docs-block">
        <h3><span class="ico" style="background:var(--primary)">附</span>本记录附件（病历 / 检验 / 报告）</h3>
        <div id="record-docs-body"></div>
      </div>
    </div>
    ${footer()}`;
}

/* ===== 服务购买（访客） ===== */
function servicesView() {
  return `
    ${header()}
    <div class="container">
      <div class="hero services-hero">
        <h1>服务购买</h1>
        <p>浏览并选择所需的健康服务，可选择支付宝 / 微信在线支付，支付成功后即时开通；也可选择线下付款，客服会及时与您联系确认付款</p>
        <div class="notice">在线支付以实际可用渠道为准；未登录用户选择在线支付时需填写下单手机号</div>
      </div>
      <div class="telemed-block">
        <div class="telemed-card">
          <b>互联网诊疗（复诊续方）</b>
          <span>本平台的 AI 预问诊、健康档案与会员服务由大气 AI 医院提供；在线问诊、医生复核、电子处方与药师审方由<b>合作持牌互联网医院</b>的备案执业医师完成，处方归档与监管上报由合作方兜底。</span>
          <span class="telemed-warn">合规提示：依据监管规定，线上仅面向已在实体医院确诊的慢病复诊患者提供续方服务；首次就诊请前往实体医疗机构，线上可先完成 AI 预问诊与健康咨询。</span>
        </div>
        <div class="telemed-card">
          <b>医药商城（一件代发）</b>
          <span>处方药、非处方药与人用器械由独立医药供应链一件代发直邮到家；处方药品类凭合作互联网医院开具的电子处方下单配送，全程可追溯。</span>
        </div>
        <div class="telemed-card">
          <b>就医绿色通道（付费可选）</b>
          <span>AI 线上评估提示重症或疑难情况时，可选购第三方就医服务平台提供的门诊绿通、专家预约、陪诊与代挂号服务，由持牌服务商承接，本平台提供渠道对接与订单跟进。</span>
        </div>
      </div>
      <div class="services-grid" id="services-grid"><div class="loading-inline">加载中…</div></div>
    </div>
    <div class="modal-mask" id="buy-mask" hidden>
      <div class="modal-box" role="dialog" aria-modal="true">
        <div class="modal-head">
          <b id="buy-title">确认购买</b>
          <button class="modal-close" id="buy-close" aria-label="关闭">×</button>
        </div>
        <div class="modal-body" id="buy-body"></div>
      </div>
    </div>
    ${footer()}`;
}

async function bindServices() {
  const grid = document.getElementById("services-grid");
  try {
    const res = await fetch(`${API}/services`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "加载失败");
    const services = data.services || [];
    if (!services.length) {
      grid.innerHTML = '<div class="loading-inline">暂无上架服务，请稍后再来</div>';
      return;
    }
    grid.innerHTML = services
      .map(
        (s) => `
      <div class="service-card">
        <div class="service-name">${esc(s.name)}</div>
        <div class="service-desc">${esc(s.description || "详情请咨询客服")}</div>
        <div class="service-foot">
          <div class="service-price">${Number(s.price) > 0 ? `¥${money2(s.price)}<span class="service-unit">/ ${esc(s.unit || "次")}</span>` : `<span class="service-unit">免费</span>`}</div>
          <button class="btn btn-primary" data-buy="${s.id}" data-name="${esc(s.name)}" data-price="${s.price}" data-unit="${esc(s.unit || "次")}" data-needsdoc="${s.needs_doc || 0}">${Number(s.price) > 0 ? "立即购买" : "免费开通"}</button>
        </div>
      </div>`
      )
      .join("");
    grid.querySelectorAll("[data-buy]").forEach((btn) =>
      btn.addEventListener("click", () =>
        openBuyDialog({
          id: btn.dataset.buy,
          name: btn.dataset.name,
          price: btn.dataset.price,
          unit: btn.dataset.unit,
          needsDoc: btn.dataset.needsdoc === "1",
        })
      )
    );
  } catch (err) {
    grid.innerHTML = `<div class="loading-inline">${esc(netErrorText(err) || "服务加载失败，请稍后重试")}</div>`;
  }
}

function money2(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2).replace(/\.00$/, "") : String(v);
}

function openBuyDialog({ id, name, price, unit, needsDoc }) {
  const mask = document.getElementById("buy-mask");
  const body = document.getElementById("buy-body");
  const unitPrice = Number(price) || 0;
  document.getElementById("buy-title").textContent = `购买 · ${name}`;
  const acc = memberUI.memberNamePhone();
  body.innerHTML = `
    <div class="buy-summary">
      <div class="buy-line"><span>服务项目</span><b>${esc(name)}</b></div>
      <div class="buy-line"><span>单价</span><b>${unitPrice > 0 ? `¥${money2(unitPrice)} / ${esc(unit)}` : "免费"}</b></div>
      <div class="buy-line" id="bf-member-line" style="display:none"><span>我的账户</span><b id="bf-member-txt"></b></div>
    </div>
    ${needsDoc ? `<p class="buy-note">该服务需要提供相关病历 / 检验 / 报告材料，下单成功后可直接上传，客服将据此安排解读或随访。</p>` : ""}
    <form class="buy-form" id="buy-form">
      <label for="bf-qty">数量</label>
      <input id="bf-qty" type="number" min="1" max="99" value="1" inputmode="numeric" required />
      <div id="bf-payopts"></div>
      <div id="bf-contact">
        <label for="bf-name">您的姓名</label>
        <input id="bf-name" type="text" maxlength="50" autocomplete="name" placeholder="用于客服联系与建档" value="${esc(acc.name)}" />
        <label for="bf-phone">手机号 <i>*</i></label>
        <input id="bf-phone" type="tel" maxlength="20" autocomplete="tel" inputmode="tel" placeholder="请填写手机号" value="${esc(acc.phone)}" required />
      </div>
      <label for="bf-note">备注（选填）</label>
      <input id="bf-note" type="text" maxlength="300" placeholder="如期望的就诊时间等" />
      <div class="buy-total">应付金额：<b id="bf-total"></b></div>
      <div class="error" id="bf-error"></div>
      <div class="buy-actions">
        <button type="button" class="btn-outline" id="bf-cancel">取消</button>
        <button type="submit" class="btn btn-primary" id="bf-submit">提交订单</button>
      </div>
    </form>`;

  let balance = null;
  let memberValid = false;
  let payMode = "offline";
  let purchaseId = null;
  let payTimer = null;
  const payChannels = [];
  const isFree = unitPrice === 0;
  const isMemberOnline = memberUI.hasMember();
  const isOnlineMode = (m) => m === "alipay" || m === "wechat";
  const submitLabel = (m) => (m === "balance" ? "余额支付" : isOnlineMode(m) ? "立即支付" : "提交订单（线下）");

  const qtyEl = document.getElementById("bf-qty");
  const totalEl = document.getElementById("bf-total");
  const contact = document.getElementById("bf-contact");
  const phoneEl = document.getElementById("bf-phone");
  const payopts = document.getElementById("bf-payopts");
  const submitBtn = document.getElementById("bf-submit");
  const errEl = document.getElementById("bf-error");
  const memberLine = document.getElementById("bf-member-line");
  const memberTxt = document.getElementById("bf-member-txt");

  const clampQty = () => Math.max(1, Math.min(99, Number(qtyEl.value) || 1));
  const total = () => unitPrice * clampQty();

  function paintModes() {
    if (memberValid) {
      memberLine.style.display = "";
      memberTxt.innerHTML = `${esc(memberUI.displayName())} · 余额 ¥${money2(balance)}`;
    } else {
      memberLine.style.display = "none";
    }
    const enough = memberValid && balance >= total();
    if (isFree) {
      if (memberValid) {
        payMode = "balance";
        submitBtn.textContent = "免费开通";
        contact.style.display = "none";
        phoneEl.required = false;
        payopts.innerHTML = `<p class="buy-note">已登录会员：基础/免费档直接为您开通，无需填写联系方式。</p>`;
        return;
      }
      payMode = "offline";
      submitBtn.textContent = "免费开通";
      contact.style.display = "";
      phoneEl.required = true;
      payopts.innerHTML = "";
      return;
    }
    const modes = [];
    if (memberValid) modes.push({ value: "balance", label: `余额支付（可用 ¥${money2(balance)}，${enough ? "足够" : "不足"}）`, disabled: !enough });
    payChannels.forEach((c) => modes.push({ value: c.id, label: `${c.label}在线支付（支付后即时开通）` }));
    modes.push({ value: "offline", label: "客服线下付款（客服联系确认后安排）" });
    if (!modes.some((m) => m.value === payMode && !m.disabled)) {
      payMode = enough ? "balance" : payChannels.length ? payChannels[0].id : "offline";
    }
    const contactNeeded = payMode === "offline" || (isOnlineMode(payMode) && !memberValid);
    contact.style.display = contactNeeded ? "" : "none";
    phoneEl.required = contactNeeded;
    payopts.innerHTML = modes
      .map(
        (m) => `<p class="buy-opt"><label><input type="radio" name="paymode" value="${m.value}" ${payMode === m.value ? "checked" : ""} ${m.disabled ? "disabled" : ""} />${m.label}</label></p>`
      )
      .join("");
    submitBtn.textContent = submitLabel(payMode);
    payopts.querySelectorAll('input[name="paymode"]').forEach((r) =>
      r.addEventListener("change", () => {
        payMode = r.value;
        const need = payMode === "offline" || (isOnlineMode(payMode) && !memberValid);
        contact.style.display = need ? "" : "none";
        phoneEl.required = need;
        submitBtn.textContent = submitLabel(payMode);
      })
    );
    if (memberValid && !enough && payChannels.length === 0) {
      payopts.insertAdjacentHTML(
        "beforeend",
        `<p class="buy-note">余额不足，可先<a href="#/member/orders" class="link-primary">去充值</a>，或选择客服线下付款。</p>`
      );
    }
  }

  const updateTotal = () => {
    totalEl.textContent = `¥${money2(total())}`;
    paintModes();
  };

  /* 校验登录态并获取最新余额 */
  if (isMemberOnline) {
    memberApiMe()
      .then((me) => {
        balance = me.member.balance;
        memberValid = true;
        paintModes();
        updateTotal();
      })
      .catch(() => {
        memberValid = false;
        paintModes();
      });
  }

  qtyEl.addEventListener("input", updateTotal);
  updateTotal();

  /* 读取可用在线支付渠道 */
  fetch(`${API}/pay/status`)
    .then((r) => r.json())
    .then((st) => {
      if (st && st.alipay) payChannels.push({ id: "alipay", label: "支付宝" });
      if (st && st.wechat) payChannels.push({ id: "wechat", label: "微信支付" });
      paintModes();
    })
    .catch(() => {});

  mask.hidden = false;
  const closeDialog = () => {
    if (payTimer) {
      clearInterval(payTimer);
      payTimer = null;
    }
    mask.hidden = true;
  };
  document.getElementById("buy-close").addEventListener("click", closeDialog);
  document.getElementById("bf-cancel").addEventListener("click", closeDialog);
  mask.addEventListener("click", (e) => {
    if (e.target === mask) closeDialog();
  });

  document.getElementById("buy-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    const oldText = submitBtn.textContent;
    if (contact.style.display !== "none") {
      const pv = (phoneEl.value || "").trim();
      if (!/^1[3-9]\d{9}$/.test(pv)) {
        errEl.textContent = "请填写正确的 11 位手机号";
        return;
      }
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "提交中…";

    const authHeaders = () => {
      const t = memberUI.getToken();
      return t ? { Authorization: `Bearer ${t}` } : {};
    };
    const showPaid = (pid, msg) => {
      if (payTimer) {
        clearInterval(payTimer);
        payTimer = null;
      }
      purchaseId = pid;
      body.innerHTML = `
        <div class="buy-success">
          <div class="buy-success-icon"></div>
          <h3>支付成功</h3>
          <p>${msg}</p>
          ${needsDoc ? `<div id="buy-attach"></div>` : ""}
          <button class="btn btn-primary" id="buy-done">完成</button>
        </div>`;
      if (needsDoc) {
        att.mountUploader(document.getElementById("buy-attach"), {
          target: "purchase",
          id: pid,
          list: true,
          kind: "报告单",
          hint: `「${name}」需要病历 / 检验 / 报告材料，可在此上传（可多份），客服将据此安排解读或随访。`,
        });
      }
      document.getElementById("buy-done").addEventListener("click", closeDialog);
    };
    const renderPurchasePay = (pay) => {
      const phone = (document.getElementById("bf-phone").value || "").trim();
      body.innerHTML = `
        <div class="buy-success">
          <h3>扫码支付 ¥${money2(pay.amount)}</h3>
          <p>订单编号 #${pay.orderId}，使用${pay.channel === "alipay" ? "支付宝" : "微信"}扫码完成支付，支付成功后自动开通。</p>
          <div class="pay-panel">
            <canvas id="buy-qr" width="210" height="210"></canvas>
            <p class="muted">支付完成后将自动开通；若已支付未更新，请点击下方按钮刷新。</p>
            <button class="btn-outline" id="buy-recheck">我已完成支付</button>
            <div class="error" id="buy-pay-error"></div>
          </div>
          <button class="btn btn-primary" id="buy-done">稍后支付</button>
        </div>`;
      try {
        QRCode.toCanvas(document.getElementById("buy-qr"), pay.code, { width: 210, margin: 1 });
      } catch {
        document.getElementById("buy-qr").insertAdjacentHTML("afterend", `<p class="muted" style="word-break:break-all">${esc(pay.code)}</p>`);
      }
      const check = async () => {
        try {
          const r = await fetch(`${API}/purchase/${pay.orderId}/pay-status?phone=${encodeURIComponent(phone)}`, { headers: authHeaders() });
          const s = await r.json();
          if (r.ok && s.paid) {
            showPaid(pay.orderId, `订单 #${pay.orderId} 支付成功，服务已开通。`);
            return true;
          }
          document.getElementById("buy-pay-error").textContent = "尚未收到付款，请完成扫码支付后重试。";
        } catch (ex) {
          document.getElementById("buy-pay-error").textContent = netErrorText(ex);
        }
        return false;
      };
      document.getElementById("buy-recheck").addEventListener("click", check);
      document.getElementById("buy-done").addEventListener("click", closeDialog);
      if (payTimer) clearInterval(payTimer);
      payTimer = setInterval(() => {
        if (!document.getElementById("buy-qr")) {
          clearInterval(payTimer);
          payTimer = null;
          return;
        }
        check();
      }, 3000);
    };

    try {
      if (memberValid && payMode === "balance") {
        const data = await memberUI.memberApi("/pay", {
          method: "POST",
          body: { serviceId: Number(id), qty: clampQty(), note: document.getElementById("bf-note").value.trim() },
        });
        purchaseId = data.purchaseId;
        body.innerHTML = `
          <div class="buy-success">
            <div class="buy-success-icon"></div>
            <h3>${isFree ? "开通成功" : "支付成功"}</h3>
            <p>${isFree ? "免费档已开通" : `已从余额支付 ¥${money2(data.amount)}，订单 #${data.purchaseId}。`}</p>
            <p class="muted">当前账户余额：¥${money2(data.balance)}</p>
            ${needsDoc ? `<div id="buy-attach"></div>` : ""}
            <button class="btn btn-primary" id="buy-done">完成</button>
          </div>`;
        if (needsDoc) {
          att.mountUploader(document.getElementById("buy-attach"), {
            target: "purchase",
            id: data.purchaseId,
            list: true,
            kind: "报告单",
            hint: `「${name}」需要病历 / 检验 / 报告材料，可在此上传（可多份），客服将据此安排解读或随访。`,
          });
        }
        document.getElementById("buy-done").addEventListener("click", closeDialog);
      } else {
        const res = await fetch(`${API}/purchase`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serviceId: Number(id),
            name: document.getElementById("bf-name").value.trim(),
            phone: document.getElementById("bf-phone").value.trim(),
            qty: clampQty(),
            note: document.getElementById("bf-note").value.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "下单失败");
        purchaseId = data.orderId;
        if (isOnlineMode(payMode)) {
          const phone = document.getElementById("bf-phone").value.trim();
          const pr = await fetch(`${API}/purchase/${data.orderId}/pay`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ channel: payMode, phone }),
          });
          const pay = await pr.json();
          if (!pr.ok || !pay.ok) throw new Error(pay.error || "发起支付失败");
          renderPurchasePay(pay);
        } else {
          body.innerHTML = `
            <div class="buy-success">
              <div class="buy-success-icon"></div>
              <h3>下单成功</h3>
              <p>订单编号 #${data.orderId}，客服将尽快与您联系确认付款与就诊安排。如需立即支付，可在订单页选择在线支付。</p>
              ${needsDoc ? `<div id="buy-attach"></div>` : ""}
              <button class="btn btn-primary" id="buy-done">完成</button>
            </div>`;
          if (needsDoc) {
            att.mountUploader(document.getElementById("buy-attach"), {
              target: "purchase",
              id: data.orderId,
              list: true,
              kind: "报告单",
              hint: `「${name}」需要病历 / 检验 / 报告材料，可在此上传（可多份），客服将据此安排解读或随访。`,
            });
          }
          document.getElementById("buy-done").addEventListener("click", closeDialog);
        }
      }
      submitBtn.disabled = false;
      submitBtn.textContent = oldText;
    } catch (err) {
      errEl.textContent = netErrorText(err);
      submitBtn.disabled = false;
      submitBtn.textContent = oldText;
    }
  });
}

async function memberApiMe() {
  return memberUI.memberApi("/me");
}

function errorView(msg) {
  return `
    ${header()}
    <div class="container">
      <div class="error-box">
        <h3>问诊服务暂时不可用</h3>
        <p>${esc(msg || "AI 服务连接失败，请稍后重试")}</p>
        <button class="btn btn-primary" style="margin-top:18px" id="back-btn">返回重试</button>
      </div>
    </div>
    ${footer()}`;
}

/* ===== 移动端底部导航（≤900px 显示） ===== */
function tabbar() {
  const active = (prefix) =>
    (prefix === "#/" ? location.hash === "#/" || location.hash === "" : location.hash.startsWith(prefix)) ? " active" : "";
  return `
  <nav class="tabbar" aria-label="底部导航">
    <a href="#/chat" class="tab-item${active("#/chat")}"><span class="tab-ico">💬</span><span>大气</span></a>
    <a href="#/monitor" class="tab-item${active("#/monitor")}"><span class="tab-ico">📈</span><span>监控</span></a>
    <a href="#/services" class="tab-item${active("#/services")}"><span class="tab-ico">🛒</span><span>服务</span></a>
    <a href="#/member" class="tab-item${active("#/member")}"><span class="tab-ico">👤</span><span>我的</span></a>
  </nav>`;
}

function renderTabbar() {
  const old = document.querySelector(".tabbar");
  if (old) old.remove();
  document.body.insertAdjacentHTML("beforeend", tabbar());
}

/* ===== 健康监控页（移动端底部「监控」入口） ===== */
function monitorPageView() {
  const logged = memberUI.hasMember();
  return `
    ${header(false)}
    <div class="container page-narrow">
      <div class="hero">
        <h1>健康监控</h1>
        <p>体重 · 血压 · 血糖 · 心率 · 睡眠 · 经期 · 饮食，记录与追踪您的健康指标</p>
      </div>
      ${
        logged
          ? `<div id="monitor-page-body"><div class="loading-inline">加载中…</div></div>`
          : `<div class="error-box"><h3>请先登录</h3><p>登录后即可记录健康指标、查看趋势并管理家庭成员。</p><a class="btn btn-primary" href="#/member" style="margin-top:14px;display:inline-block">去登录 / 注册</a></div>`
      }
    </div>
    ${footer()}`;
}

async function bindMonitorPage() {
  if (!memberUI.hasMember()) return;
  const body = document.getElementById("monitor-page-body");
  try {
    await memberUI.renderMonitor(body);
  } catch (err) {
    body.innerHTML = `<div class="error-box"><h3>加载失败</h3><p>${esc(netErrorText(err))}</p></div>`;
  }
}

/* ===== AI 客服「大气」（移动端底部入口） ===== */
const CHAT_HISTORY_KEY = "xiaoqi_chat_history";

function loadChatHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || "[]");
    return Array.isArray(arr) ? arr.slice(-30) : [];
  } catch {
    return [];
  }
}

function saveChatHistory(list) {
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(list.slice(-30)));
  } catch {
    /* 存储失败静默 */
  }
}

function chatBubble(m) {
  if (m.role === "user") return `<div class="chat-row me"><div class="chat-bubble">${esc(m.content)}</div></div>`;
  return `<div class="chat-row bot"><div class="chat-bubble">${esc(m.content)}</div></div>`;
}

function chatPageView() {
  const history = loadChatHistory();
  const initMsg = { role: "assistant", content: "您好，我是大气AI医院的智能客服大气。可以帮您：解答平台使用与服务购买问题、根据您的症状推荐合适的就诊通道、引导您补充病史信息提升问诊准确率。请问有什么可以帮您？" };
  const list = history.length ? history : [initMsg];
  if (!history.length) saveChatHistory(list);
  return `
    ${header()}
    <div class="container page-narrow chat-page">
      <div class="chat-header">
        <button type="button" class="btn btn-ghost btn-sm" id="chat-clear">清空对话</button>
      </div>
      <div class="chat-box" id="chat-box">${list.map(chatBubble).join("")}</div>
      <form class="chat-input-row" id="chat-form">
        <input id="chat-input" placeholder="描述您的症状或想咨询的问题…" maxlength="2000" autocomplete="off" />
        <button type="submit" class="btn btn-primary" id="chat-send">发送</button>
      </form>
      <div class="chat-disclaimer">AI 客服回复仅供参考，不能替代执业医师诊断。急危重症请立即拨打 120。</div>
    </div>
    ${footer()}`;
}

function bindChatPage() {
  const box = document.getElementById("chat-box");
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  box.scrollTop = box.scrollHeight;

  document.getElementById("chat-clear").addEventListener("click", () => {
    localStorage.removeItem(CHAT_HISTORY_KEY);
    location.reload();
  });

  document.getElementById("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    const history = loadChatHistory();
    history.push({ role: "user", content: text });
    saveChatHistory(history);
    box.insertAdjacentHTML("beforeend", chatBubble({ role: "user", content: text }));
    input.value = "";
    box.scrollTop = box.scrollHeight;

    const waitingId = "chat-waiting-" + Date.now();
    box.insertAdjacentHTML("beforeend", `<div class="chat-row bot" id="${waitingId}"><div class="chat-bubble chat-typing">正在输入…</div></div>`);
    box.scrollTop = box.scrollHeight;
    sendBtn.disabled = true;

    try {
      const payload = history.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload }),
      });
      const data = await res.json().catch(() => ({}));
      document.getElementById(waitingId)?.remove();
      const reply = res.ok && data.reply ? data.reply : data.error || "客服暂时不可用，请稍后重试";
      history.push({ role: "assistant", content: reply });
      saveChatHistory(history);
      box.insertAdjacentHTML("beforeend", chatBubble({ role: "assistant", content: reply }));
      box.scrollTop = box.scrollHeight;
    } catch (err) {
      document.getElementById(waitingId)?.remove();
      const msg = netErrorText(err);
      box.insertAdjacentHTML("beforeend", `<div class="chat-row bot"><div class="chat-bubble">${esc(msg)}</div></div>`);
      box.scrollTop = box.scrollHeight;
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  });
}

/* ===== Router ===== */
function render() {
  const hash = location.hash || "#/";
  state.route = hash.startsWith("#/services") ? "services" : "";
  if (hash.startsWith("#/form/")) {
    const level = hash.slice(7);
    app.innerHTML = formView(level);
    bindForm(level);
  } else if (hash.startsWith("#/services")) {
    app.innerHTML = servicesView();
    bindServices();
  } else if (hash.startsWith("#/monitor")) {
    app.innerHTML = monitorPageView();
    bindMonitorPage();
  } else if (hash.startsWith("#/chat")) {
    app.innerHTML = chatPageView();
    bindChatPage();
  } else if (hash.startsWith("#/member")) {
    const tab = memberUI.parseTab(hash);
    if (!memberUI.hasMember()) {
      /* 未登录：「我的」页内嵌登录/注册（移动端底部 tab 唯一入口），登录成功后原地进入会员中心 */
      app.innerHTML = `
        ${header(false)}
        <div class="container page-narrow">
          <div class="hero">
            <h1>我的</h1>
            <p>登录后可管理健康档案、家庭成员、健康监控与订单充值</p>
          </div>
          ${memberUI.loginView()}
        </div>
        ${footer()}`;
      memberUI.bindLogin();
      return;
    }
    app.innerHTML = `${header()}<div class="container">${memberUI.memberShell()}</div>${footer()}`;
    memberUI.memberBinder(tab);
  } else if (hash.startsWith("#/login")) {
    app.innerHTML = `${header()}<div class="container">${memberUI.loginView()}</div>${footer()}`;
    memberUI.bindLogin();
  } else if (hash.startsWith("#/result")) {
    if (!state.result) restoreLastResult();
    app.innerHTML = resultView();
    loadResultDocs();
  } else if (hash.startsWith("#/error")) {
    const msg = decodeURIComponent(hash.slice(7));
    app.innerHTML = errorView(msg);
    bindBack();
  } else {
    app.innerHTML = homeView();
    bindHome();
  }
  bindHeader();
  renderTabbar();
  window.scrollTo(0, 0);
}

function bindHeader() {
  document.querySelectorAll("[data-nav-level]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.level = btn.dataset.navLevel;
      location.hash = `#/form/${state.level}`;
    });
  });
}

function bindHome() {
  document.querySelectorAll(".level-card").forEach((card) => {
    const go = () => {
      state.level = card.dataset.level;
      location.hash = `#/form/${state.level}`;
    };
    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
  });
}

function collectForm(level) {
  const data = {};
  for (const f of FIELDS) {
    const el = document.querySelector(`[data-field="${f.id}"]`);
    if (!el) continue;
    if (f.type === "radio") {
      const checked = document.querySelector(`input[name="${f.id}"]:checked`);
      data[f.id] = checked ? checked.value : "";
    } else {
      data[f.id] = el.value.trim();
    }
  }
  return data;
}

function markInvalid(missingLabels) {
  document.querySelectorAll(".field .invalid").forEach((el) => el.classList.remove("invalid"));
  for (const f of FIELDS) {
    if (missingLabels.includes(f.label)) {
      document.querySelectorAll(`[data-field="${f.id}"]`).forEach((el) => el.classList.add("invalid"));
    }
  }
}

/* 语音输入（Web Speech API）：点击麦克风将识别文本追加到对应字段，安卓 Chrome / iOS Safari 可用 */
function bindVoiceInputs() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  document.querySelectorAll(".mic-btn[data-mic]").forEach((btn) => {
    if (!SR) return; /* 浏览器不支持则保持隐藏 */
    btn.hidden = false;
    const field = document.getElementById(`f-${btn.dataset.mic}`);
    if (!field) return;
    let rec = null;
    btn.addEventListener("click", () => {
      if (rec) {
        rec.stop();
        rec = null;
        btn.classList.remove("listening");
        return;
      }
      try {
        rec = new SR();
      } catch {
        btn.hidden = true;
        return;
      }
      rec.lang = "zh-CN";
      rec.interimResults = false;
      rec.continuous = false;
      const startText = field.value ? field.value + " " : "";
      rec.onresult = (e) => {
        const text = Array.from(e.results)
          .map((r) => r[0].transcript)
          .join("")
          .trim();
        if (text) {
          field.value = startText + text;
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.focus();
        }
      };
      rec.onend = () => {
        btn.classList.remove("listening");
        rec = null;
      };
      rec.onerror = () => {
        btn.classList.remove("listening");
        rec = null;
      };
      btn.classList.add("listening");
      rec.start();
    });
  });
}

function bindForm(level) {
  if (memberUI.hasMember()) {
    const { name, phone } = memberUI.memberNamePhone();
    const nEl = document.querySelector('[data-field="name"]');
    const pEl = document.querySelector('[data-field="phone"]');
    if (nEl && !nEl.value.trim() && name) nEl.value = name;
    if (pEl && !pEl.value.trim() && phone) pEl.value = phone;
    memberUI.prefillFormFromProfile();
  }

  const form = document.getElementById("consult-form");
  bindConsultPicker(level);
  bindVoiceInputs();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = collectForm(level);
    const missing = validate(data, level);
    if (missing.length) {
      markInvalid(missing);
      const first = missing[0];
      alert(`还有 ${missing.length} 项必填信息未填写，请补全：\n\n${missing.join("、")}`);
      const target = FIELDS.find((f) => f.label === first);
      if (target) {
        const el = document.querySelector(`[data-field="${target.id}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.focus();
        }
      }
      return;
    }
    /* L9 报告解读：报告照片必传 */
    if (level === "L9" && !consultFiles.length) {
      const picker = document.getElementById("consult-attach-picker");
      if (picker) picker.scrollIntoView({ behavior: "smooth", block: "center" });
      alert("请先上传报告照片（可拍照 / 扫一扫 / 从相册选择），供 AI 逐项解读");
      return;
    }
    const ageVal = String(data.age ?? "").trim();
    if (ageVal !== "" && (!/^\d{1,3}$/.test(ageVal) || Number(ageVal) > 120)) {
      alert("年龄请填写 0-120 之间的数字");
      const el = document.querySelector('[data-field="age"]');
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
      }
      return;
    }
    const phoneVal = String(data.phone ?? "").trim();
    if (phoneVal && !/^1[3-9]\d{9}$/.test(phoneVal)) {
      alert("手机号格式不正确，请填写 11 位大陆手机号，或留空");
      const el = document.querySelector('[data-field="phone"]');
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
      }
      return;
    }
    state.formData = data;
    app.innerHTML = loadingView();
    bindHeader();
    try {
      const res = await fetch(`${API}/consult`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, formData: data, attachments: level === "L9" ? await readImageAttachments() : [] }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "AI 服务返回异常");
      state.result = json.result;
      state.consultRecordId = json.recordId || null;
      state.attachWarn = "";
      saveLastResult(level, json.result, state.consultRecordId);
      if (state.consultRecordId && consultFiles.length) {
        try {
          await att.uploadAttachments("consult", state.consultRecordId, consultFiles);
        } catch (upErr) {
          state.attachWarn = `材料归档失败：${netErrorText(upErr)}（可在结果页重新上传）`;
        } finally {
          consultFiles = [];
        }
      }
      location.hash = "#/result";
    } catch (err) {
      location.hash = `#/error/${encodeURIComponent(netErrorText(err))}`;
    }
  });
}

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const idx = s.indexOf(",");
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    r.onerror = () => reject(new Error("图片读取失败"));
    r.readAsDataURL(file);
  });
}

async function readImageAttachments() {
  const imgs = consultFiles.filter((f) => /^image\//.test(f.file.type)).slice(0, 2);
  const out = [];
  for (const { file } of imgs) {
    try {
      out.push({ mime: file.type, dataBase64: await readFileBase64(file) });
    } catch (err) {
      console.warn("报告图片读取失败，已跳过:", err.message);
    }
  }
  return out;
}

function loadResultDocs() {  const box = document.getElementById("record-docs-body");
  const rid = state.consultRecordId;
  if (!box) return;
  if (!rid) {
    box.innerHTML = `<p class="muted">暂无关联的问诊记录，材料未归档</p>`;
    return;
  }
  box.innerHTML = `${state.attachWarn ? `<p class="att-err">${esc(state.attachWarn)}</p>` : ""}
    <div id="rd-attachments" class="att-grid"></div>
    <div id="rd-uploader"></div>`;
  const grid = box.querySelector("#rd-attachments");
  const up = box.querySelector("#rd-uploader");
  const render = (rows) => {
    grid.innerHTML = rows.length ? rows.map((a) => att.docCardHtml(a)).join("") : '<p class="muted">尚未上传材料</p>';
  };
  const renderErr = () => {
    grid.innerHTML = '<p class="att-err">材料列表读取失败，请刷新或稍后重试</p>';
  };
  att
    .loadAttachments("consult", rid)
    .then(render)
    .catch(renderErr);
  att.mountUploader(up, {
    target: "consult",
    id: rid,
    list: false,
    camera: state.level === "L9",
    hint: state.level === "L9" ? "补充或重传报告照片（拍照 / 扫一扫 / 从相册选择），将归入本次问诊记录。" : "补充上传病历卡、检验单、报告单、影像等材料，将归入本次问诊记录，供医师与后台核对。",
    onChanged: () => att.loadAttachments("consult", rid).then(render).catch(renderErr),
  });
}

function bindBack() {
  const back = document.getElementById("back-btn");
  if (back) back.addEventListener("click", () => (location.hash = "#/"));
}

/* ===== Boot ===== */
window.addEventListener("hashchange", render);
render();
