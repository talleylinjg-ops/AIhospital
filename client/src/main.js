import { LEVEL_META, SECTIONS, FIELDS, isRequired, getRequiredFields, validate } from "./form-config.js";
import QRCode from "qrcode";
import * as memberUI from "./member.js";
import * as att from "./attachments.js";

const app = document.getElementById("app");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* 把浏览器网络层报错翻译成面向用户的中文提示 */
const netErrorText = (err) => {
  const m = String((err && err.message) || err || "");
  if (/Failed to fetch|NetworkError|Load failed|fetch failed|ECONNREFUSED|network/i.test(m)) {
    return "无法连接问诊服务，请检查网络后重试";
  }
  return m || "网络异常，请重试";
};

const state = {
  level: null,
  formData: {},
  result: null,
  consultRecordId: null,
  attachWarn: "",
};

const API = "/api";

/* 头部导航按钮文字：前四通道显示名称（危重症按钮取 4 字短称），其余显示 tag */
const NAV_SHORT = { L1: "轻微快诊", L2: "中等症状", L3: "危重症", L4: "日常保健" };

/* 导航未激活文字用通道色相（比 LEVEL_META.color 提亮一档，保证在深青 header 上可读）；激活态仍用原色 */
const NAV_TEXT_COLOR = {
  L1: "#2dd4bf", L2: "#fbbf24", L3: "#f87171", L4: "#4ade80",
  L5: "#f472b6", L6: "#a78bfa", L7: "#22d3ee", L8: "#fbbf24",
};

/* ===== Header ===== */
function header(showLevels = true) {
  const renderLevelBtn = ([key, m]) => {
    const active = state.level === key ? " active" : "";
    const text = NAV_SHORT[key] || m.tag;
    return `<button class="nav-level-btn${active}" data-nav-level="${key}" title="${esc(m.name)}" style="--lv-color:${m.color};--nav-color:${NAV_TEXT_COLOR[key] || m.color}">${esc(text)}</button>`;
  };
  const entries = Object.entries(LEVEL_META);
  /* 固定两行：第 1 行 L1-L4（快诊/门诊/急诊/保健），自 L5 妇幼起排到第 2 行 */
  const levelButtons = [entries.slice(0, 4), entries.slice(4)]
    .map((row) => `<div class="nav-level-row">${row.map(renderLevelBtn).join("")}</div>`)
    .join("");
  return `
  <header class="site-header">
    <div class="container header-inner">
      <div class="brand">
        <a href="#/" class="brand-link">
          <div class="brand-badge">医</div>
          <div>
            <div>大气AI医院</div>
            <div class="brand-sub">智能预问诊与分诊系统</div>
          </div>
        </a>
      </div>
      <div class="header-right">
        ${showLevels ? `<nav class="nav-levels">${levelButtons}</nav>` : ""}
        <a class="nav-services${state.route === "services" ? " active" : ""}" href="#/services">服务购买</a>
        ${memberUI.headerChip()}
      </div>
    </div>
  </header>`;
}

function footer() {
  return `
  <footer class="site-footer">
    <div class="container">
      <div class="strong">免责声明：本系统为 AI 辅助预问诊，所有输出仅供参考，不能替代执业医师的诊断与治疗。</div>
      <div>如出现胸痛、呼吸困难、意识改变、大出血等急危情况，请立即拨打 120 或前往急诊。</div>
    </div>
  </footer>`;
}

/* ===== Views ===== */
/* 就诊通道 → 路由场景：L5 妇幼独用 maternal；L6 中医复用保健组；L7 眼科/L8 口腔复用门诊组 */
const CHANNEL_SCENE = { L1: "fast", L2: "clinic", L3: "emergency", L4: "wellness", L5: "maternal", L6: "wellness", L7: "clinic", L8: "clinic" };
/* 复用他组场景的通道：标注实际承接的评估组 */
const SHARED_GROUP = { L6: { scene: "wellness", group: "保健" }, L7: { scene: "clinic", group: "门诊" }, L8: { scene: "clinic", group: "门诊" } };

function homeView() {
  const cards = Object.entries(LEVEL_META)
    .map(([key, m]) => {
      const reqCount = getRequiredFields(key).length;
      return `
      <div class="level-card" data-level="${key}">
        <span class="level-tag" style="background:${m.color}">${esc(m.tag)}</span>
        <div class="level-title">${esc(m.name)}</div>
        <div class="level-sub">${esc(m.subtitle)}</div>
        <div class="level-desc">${esc(m.desc)}</div>
        <div class="level-model" data-level-model="${key}"><span class="model-dot" style="background:${m.color}"></span>模型配置读取中…</div>
        <div class="level-required">必填项：<b>${reqCount}</b> 项 · 完整病史表单共 ${FIELDS.length} 项</div>
      </div>`;
    })
    .join("");

  return `
    ${header()}
    <div class="container">
      <div class="hero">
        <h1>AI 医院 · 智能预问诊</h1>
        <p>选择与您情况相符的就诊通道，AI 医生将基于完整病史为您分诊、鉴别与就医指引</p>
        <div class="notice">急危重症请直接拨打 120，本系统不能替代急诊</div>
      </div>
      <div class="level-grid">${cards}</div>
      <div class="services-entry">
        <div>
          <div class="services-entry-title">健康服务购买</div>
          <div class="services-entry-sub">AI 慢病管理、体检报告解读等服务项目，支持支付宝/微信在线支付，支付后即时开通</div>
        </div>
        <a class="btn btn-primary" href="#/services">进入服务购买</a>
      </div>
      <section class="geo-content">
        <h2>关于大气AI医院</h2>
        <p>
          大气AI医院是基于大模型的 AI 智能预问诊与分诊平台。选择与您情况相符的就诊通道并填写完整病史后，系统会给出分诊建议、可能病因鉴别与就医指引，帮助您在就诊前理清思路、选择合适的科室与就医时机。
        </p>
        <h3>8 条就诊通道</h3>
        <p>
          平台提供轻微快诊、中等症状、危重症、日常保健、妇幼保健、中医、眼科、口腔共 8 条通道。每条通道有各自的必填病史项与评估重点，例如妇幼保健会额外关注孕产与哺乳情况，中医与口腔通道会聚焦相应症状。
        </p>
        <h3>在线健康服务</h3>
        <p>
          除预问诊外，平台还提供 AI 慢病管理月度套餐、体检报告解读等服务。进入服务购买页选择服务并下单，支持支付宝或微信在线支付，支付成功后即时开通；也可由客服电话确认后付款。注册会员还可使用账户余额支付并管理健康档案与历史记录。
        </p>
        <h3>常见问题</h3>
        <dl class="faq-list">
          <dt>大气AI医院是什么？</dt>
          <dd>基于大模型的 AI 智能预问诊与分诊平台，提供分诊建议与就医指引，并提供慢病管理、体检报告解读等在线健康服务。</dd>
          <dt>AI 问诊结果可以代替医生诊断吗？</dt>
          <dd>不能。本系统为 AI 辅助预问诊，所有输出仅供参考，不能替代执业医师的诊断与治疗。如出现胸痛、呼吸困难、意识改变、大出血等急危情况，请立即拨打 120 或前往急诊。</dd>
          <dt>如何购买服务并支付？</dt>
          <dd>在服务购买页选择服务并下单，支持支付宝/微信在线支付并即时开通，也可由客服电话确认后付款。</dd>
          <dt>上传的病历与报告如何使用？</dt>
          <dd>上传材料用于存档，便于医生或客服查看并据此安排解读与随访，支持图片与 PDF，单个文件不超过 6MB。</dd>
        </dl>
      </section>
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
  if (tip) tip.textContent = consultFiles.length ? `已选择 ${consultFiles.length} 份，提交问诊后自动归档到本次记录` : "";
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

function bindConsultPicker() {
  const box = document.getElementById("consult-attach-picker");
  if (!box) return;
  box.innerHTML = `
    <div class="att-row">
      <select id="ca-kind">${att.kindOptions(consultFileKind)}</select>
      <button type="button" class="btn-outline" id="ca-add">选择病历 / 报告文件…</button>
      <input type="file" id="ca-input" accept="${att.DOC_ACCEPT}" multiple hidden />
      <span class="muted att-tip" id="ca-tip"></span>
    </div>
    <div id="ca-list"></div>`;
  const kindSel = box.querySelector("#ca-kind");
  kindSel.addEventListener("change", () => {
    consultFileKind = kindSel.value;
    consultFiles.forEach((f) => (f.kind = consultFileKind));
    drawConsultPicker();
  });
  box.querySelector("#ca-add").addEventListener("click", () => box.querySelector("#ca-input").click());
  box.querySelector("#ca-input").addEventListener("change", (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
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
      consultFiles.push({ file, kind: consultFileKind });
    }
    drawConsultPicker();
  });
}

function formView(level) {
  const m = LEVEL_META[level];
  if (!m) {
    location.hash = "#/";
    return;
  }

  const sectionsHtml = SECTIONS.map((sec) => {
    const fields = FIELDS.filter((f) => f.section === sec.id);
    if (!fields.length) return "";
    const allRequired = fields.every((f) => isRequired(f, level));
    const sectionHasRequired = fields.some((f) => isRequired(f, level));

    const fieldsHtml = fields
      .map((f) => {
        const req = isRequired(f, level);
        const val = state.formData[f.id] ?? "";
        const optMark = req ? "" : `<span class="opt-mark">选填</span>`;
        const reqMark = req ? '<span class="req">*</span>' : "";
        const id = `f-${f.id}`;

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
          control = `<input id="${id}" type="number" data-field="${f.id}" placeholder="${esc(f.placeholder || "")}" value="${esc(val)}" />`;
        } else if (f.type === "textarea") {
          control = `<textarea id="${id}" data-field="${f.id}" placeholder="${esc(f.placeholder || "")}">${esc(val)}</textarea>`;
        } else {
          control = `<input id="${id}" type="text" data-field="${f.id}" placeholder="${esc(f.placeholder || "")}" value="${esc(val)}" />`;
        }

        return `
          <div class="field" data-field-id="${f.id}">
            <label for="${id}">${esc(f.label)}${reqMark}${optMark}</label>
            ${control}
          </div>`;
      })
      .join("");

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
          <div class="section-title">病历 / 检验 / 报告上传（选填）</div>
          <p class="attach-note">支持上传病历卡、检验单、报告单、影像胶片或处方等（jpg/png/webp/gif/pdf，单个不超过 6MB）。材料将随本次问诊一并归档，供医师与后台快速核对。</p>
          <div id="consult-attach-picker"></div>
        </div>
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
  const modelInfo = r.provider
    ? `<div class="model-tag">分析模型：${esc(r.provider)}${r.model ? ` · ${esc(r.model)}` : ""}${channelTag ? ` <span class="badge-muted">${esc(channelTag)}通道</span>` : ""}${r.route && r.route.fallback_used ? ` <span class="badge-muted">已自动切换备用模型</span>` : ""}${r.route && r.route.degraded ? ` <span class="badge-warn">该通道未专属配置，已用可用模型兜底</span>` : ""}</div>`
    : "";

  return `
    ${header()}
    <div class="container">
      <div class="result-head">
        <span class="level-tag" style="background:${m.color}">${esc(m.tag)}</span>
        <span class="risk-badge risk-${riskClass}">${esc(r.risk_level)}</span>
        ${confidence}
      </div>
      ${modelInfo}
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
      <div class="block" id="compare-block">
        <h3><span class="ico" style="background:var(--amber)">6</span>换一个模型对比分析</h3>
        <div class="compare-row">
          <select id="compare-select"><option value="">加载模型列表…</option></select>
          <button class="btn btn-primary" id="compare-btn" disabled>对比分析</button>
        </div>
        <div id="compare-result"></div>
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
        <p>浏览并选择所需的健康服务，可选择支付宝 / 微信在线支付，支付成功后即时开通；也可由客服电话确认付款</p>
        <div class="notice">在线支付以实际可用渠道为准；未登录用户选择在线支付时需填写下单手机号</div>
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
    const res = await fetch("/api/services");
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
    grid.innerHTML = `<div class="loading-inline">${esc(err.message || "服务加载失败，请稍后重试")}</div>`;
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
      <label>数量</label>
      <input id="bf-qty" type="number" min="1" max="99" value="1" required />
      <div id="bf-payopts"></div>
      <div id="bf-contact">
        <label>您的姓名</label>
        <input id="bf-name" type="text" maxlength="50" placeholder="用于客服联系与建档" value="${esc(acc.name)}" />
        <label>手机号 <i>*</i></label>
        <input id="bf-phone" type="tel" maxlength="20" placeholder="请填写手机号" value="${esc(acc.phone)}" required />
      </div>
      <label>备注（选填）</label>
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
  const payopts = document.getElementById("bf-payopts");
  const submitBtn = document.getElementById("bf-submit");
  const errEl = document.getElementById("bf-error");
  const memberLine = document.getElementById("bf-member-line");
  const memberTxt = document.getElementById("bf-member-txt");

  const total = () => {
    const q = Math.max(1, Math.min(99, Number(qtyEl.value) || 1));
    return unitPrice * q;
  };

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
        payopts.innerHTML = `<p class="buy-note">已登录会员：基础/免费档直接为您开通，无需填写联系方式。</p>`;
        return;
      }
      payMode = "offline";
      submitBtn.textContent = "免费开通";
      contact.style.display = "";
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
  fetch("/api/pay/status")
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
    submitBtn.disabled = true;
    const oldText = submitBtn.textContent;
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
      document.getElementById("buy-done").addEventListener("click", () => (mask.hidden = true));
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
          const r = await fetch(`/api/purchase/${pay.orderId}/pay-status?phone=${encodeURIComponent(phone)}`, { headers: authHeaders() });
          const s = await r.json();
          if (r.ok && s.paid) {
            showPaid(pay.orderId, `订单 #${pay.orderId} 支付成功，服务已开通。`);
            return true;
          }
          document.getElementById("buy-pay-error").textContent = "尚未收到付款，请完成扫码支付后重试。";
        } catch (ex) {
          document.getElementById("buy-pay-error").textContent = ex.message;
        }
        return false;
      };
      document.getElementById("buy-recheck").addEventListener("click", check);
      document.getElementById("buy-done").addEventListener("click", () => (mask.hidden = true));
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
          body: { serviceId: Number(id), qty: Number(qtyEl.value) || 1, note: document.getElementById("bf-note").value.trim() },
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
        document.getElementById("buy-done").addEventListener("click", () => (mask.hidden = true));
      } else {
        const res = await fetch("/api/purchase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serviceId: Number(id),
            name: document.getElementById("bf-name").value.trim(),
            phone: document.getElementById("bf-phone").value.trim(),
            qty: Number(qtyEl.value) || 1,
            note: document.getElementById("bf-note").value.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "下单失败");
        purchaseId = data.orderId;
        if (isOnlineMode(payMode)) {
          const phone = document.getElementById("bf-phone").value.trim();
          const pr = await fetch(`/api/purchase/${data.orderId}/pay`, {
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
          document.getElementById("buy-done").addEventListener("click", () => (mask.hidden = true));
        }
      }
      submitBtn.disabled = false;
      submitBtn.textContent = oldText;
    } catch (err) {
      errEl.textContent = err.message;
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
  } else if (hash.startsWith("#/member")) {
    const tab = memberUI.parseTab(hash);
    if (!memberUI.hasMember()) {
      location.hash = "#/login";
      return;
    }
    app.innerHTML = `${header()}<div class="container">${memberUI.memberShell()}</div>${footer()}`;
    memberUI.memberBinder(tab);
  } else if (hash.startsWith("#/login")) {
    app.innerHTML = `${header()}<div class="container">${memberUI.loginView()}</div>${footer()}`;
    memberUI.bindLogin();
  } else if (hash.startsWith("#/result")) {
    app.innerHTML = resultView();
    bindResult();
  } else if (hash.startsWith("#/error")) {
    const msg = decodeURIComponent(hash.slice(7));
    app.innerHTML = errorView(msg);
    bindBack();
  } else {
    app.innerHTML = homeView();
    bindHome();
  }
  bindHeader();
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
    card.addEventListener("click", () => {
      state.level = card.dataset.level;
      location.hash = `#/form/${state.level}`;
    });
  });
  renderChannelModels();
}

/* 首页就诊通道卡片展示各通道当前承接模型（来自 /api/status，保证与后台配置一致） */
async function renderChannelModels() {
  try {
    const res = await fetch(`${API}/status`);
    const json = await res.json();
    const models = {};
    for (const s of json?.llm?.scene_models || []) models[s.scene] = s;
    document.querySelectorAll("[data-level-model]").forEach((el) => {
      const lv = el.dataset.levelModel;
      const info = models[CHANNEL_SCENE[lv]];
      const channelName = LEVEL_META[lv]?.tag || "";
      if (!info || !info.configured || !info.primary) {
        const shared = SHARED_GROUP[lv];
        const text = shared
          ? `${shared.group}评估组模型未启用，将使用已启用模型兜底`
          : `${channelName}通道推荐模型未启用，将使用已启用模型兜底`;
        el.innerHTML = `<span class="model-dot" style="background:#9ca3af"></span>${text}`;
        return;
      }
      const backupNote = info.backups > 0 ? ` +${info.backups} 备用` : "";
      const shared = SHARED_GROUP[lv];
      const text = shared
        ? `${channelName}通道（${shared.group}模型组承接）· ${esc(info.primary)}${backupNote}`
        : `${channelName}模型：${esc(info.primary)}${backupNote}`;
      el.innerHTML = `<span class="model-dot" style="background:#16a34a"></span>${text}`;
    });
  } catch {
    /* 拉取失败保持默认文案即可 */
  }
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

function bindForm(level) {
  bindHeader();
  if (memberUI.hasMember()) {
    const { name, phone } = memberUI.memberNamePhone();
    const nEl = document.querySelector('[data-field="name"]');
    const pEl = document.querySelector('[data-field="phone"]');
    if (nEl && !nEl.value.trim() && name) nEl.value = name;
    if (pEl && !pEl.value.trim() && phone) pEl.value = phone;
    memberUI.prefillFormFromProfile();
  }

  const form = document.getElementById("consult-form");
  bindConsultPicker();
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
    state.formData = data;
    app.innerHTML = loadingView();
    try {
      const res = await fetch(`${API}/consult`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, formData: data }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "AI 服务返回异常");
      state.result = json.result;
      state.consultRecordId = json.recordId || null;
      state.attachWarn = "";
      if (state.consultRecordId && consultFiles.length) {
        try {
          await att.uploadAttachments("consult", state.consultRecordId, consultFiles);
        } catch (upErr) {
          state.attachWarn = `材料归档失败：${upErr.message}（可在结果页重新上传）`;
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

function renderCompareResult(json) {
  const el = document.getElementById("compare-result");
  if (!el) return;
  if (!json.ok) {
    el.innerHTML = `<p class="compare-error">${esc(json.error || "对比分析失败，请重试")}</p>`;
    return;
  }
  const r = json.result || {};
  const riskClass = r.risk_level === "立即急诊" ? "急诊" : r.risk_level === "建议尽快门诊" ? "门诊" : "无需";
  const diff = (r.differential || [])
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
  const flags = (r.red_flags || []).map((f) => `<li>${esc(f)}</li>`).join("");
  el.innerHTML = `
    <div class="compare-result-box">
      ${r.provider ? `<div class="model-tag">分析模型：${esc(r.provider)}${r.model ? ` · ${esc(r.model)}` : ""}</div>` : ""}
      <div class="result-head">
        <span class="risk-badge risk-${riskClass}">${esc(r.risk_level)}</span>
        ${typeof r.confidence === "number" ? `<div class="confidence">置信度：<b>${Math.round(r.confidence * 100)}%</b></div>` : ""}
      </div>
      ${flags ? `<div class="red-flag"><h3>⚠ 红色危险警示</h3><ul>${flags}</ul></div>` : ""}
      <h4>关键信息汇总</h4>
      <p>${esc(r.key_findings)}</p>
      ${r.risk_reason ? `<p style="margin-top:10px;color:var(--ink-2);font-size:13px"><b>危险依据：</b>${esc(r.risk_reason)}</p>` : ""}
      <h4>鉴别诊断列表</h4>
      ${diff || "<p style='color:var(--ink-3)'>暂无</p>"}
      ${(r.uncertainties || []).length ? `<h4>最大不确定点</h4><ul class="list-plain">${r.uncertainties.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}
      ${(r.recommended_exams || []).length ? `<h4>推荐检查项目</h4><ul class="list-plain">${r.recommended_exams.map((e) => `<li>[${esc(e.priority)}] ${esc(e.item)} — ${esc(e.reason)}</li>`).join("")}</ul>` : ""}
    </div>`;
}

function loadResultDocs() {
  const box = document.getElementById("record-docs-body");
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
  att
    .loadAttachments("consult", rid)
    .then(render)
    .catch(() => render([]));
  att.mountUploader(up, {
    target: "consult",
    id: rid,
    list: false,
    hint: "补充上传病历卡、检验单、报告单、影像等材料，将归入本次问诊记录，供医师与后台核对。",
    onChanged: () => att.loadAttachments("consult", rid).then(render).catch(() => render([])),
  });
}

function bindResult() {
  bindHeader();
  loadResultDocs();
  const sel = document.getElementById("compare-select");
  const btn = document.getElementById("compare-btn");
  if (!sel || !btn) return;
  fetch(`${API}/providers`)
    .then((res) => res.json())
    .then((json) => {
      const list = (json.providers || []).filter((p) => !state.result || !state.result.provider || state.result.provider !== p.name);
      if (!list.length) {
        sel.innerHTML = `<option value="">暂无其他可用模型</option>`;
        return;
      }
      sel.innerHTML = `<option value="">选择要对比的模型…</option>${list
        .map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.model)}</option>`)
        .join("")}`;
      btn.disabled = false;
    })
    .catch(() => {
      sel.innerHTML = `<option value="">模型列表加载失败</option>`;
    });
  btn.addEventListener("click", async () => {
    if (!sel.value) return alert("请先选择要对比的模型");
    btn.disabled = true;
    btn.textContent = "对比中…";
    const el = document.getElementById("compare-result");
    if (el) el.innerHTML = `<p class="loading-inline">正在调用所选模型分析，请稍候…</p>`;
    try {
      const res = await fetch(`${API}/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: Number(sel.value), level: state.level, formData: state.formData }),
      });
      const json = await res.json();
      renderCompareResult(json);
    } catch (err) {
      if (el) el.innerHTML = `<p class="compare-error">${esc(netErrorText(err))}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "对比分析";
    }
  });
}

function bindBack() {
  bindHeader();
  const back = document.getElementById("back-btn");
  if (back) back.addEventListener("click", () => (location.hash = "#/"));
}

/* ===== Boot ===== */
window.addEventListener("hashchange", render);
render();
