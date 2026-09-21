/**
 * 前端表单配置：完整结构化病史表单 + 多档强制规则
 * 所有等级共用同一套字段，仅「必填项」不同。
 */

export const LEVEL_META = {
  L1: {
    name: "轻微快诊",
    tag: "快诊",
    color: "#0e7c86",
    subtitle: "轻微不适 · 症状单一 · 低风险",
    desc: "适合轻微感冒、轻微疼痛、小伤口等低风险不适。填写少量必填项，快速获得分诊与居家建议。",
  },
  L2: {
    name: "中等症状",
    tag: "门诊",
    color: "#d97706",
    subtitle: "症状明确 · 需规范评估",
    desc: "适合症状持续、需要规范评估与检查建议的情况。需填写较完整的病史，含紧急度判定、现病史、慢性病史与用药过敏史。",
  },
  L3: {
    name: "危重症 / 疑难杂症",
    tag: "急诊",
    color: "#dc2626",
    subtitle: "高危 · 紧急 · 罕见病 · 多病叠加",
    desc: "适合高危、紧急、罕见病或多种疾病叠加的情况。必须完整填写全部病史字段，包括既往史、家族史、用药过敏史、生活习惯等，以最大限度支撑严谨推理。",
  },
  L4: {
    name: "日常保健",
    tag: "保健",
    color: "#16a34a",
    subtitle: "健康咨询 · 体检解读 · 慢病随访",
    desc: "适合日常健康咨询、体检报告解读、慢病随访、膳食运动睡眠调理与亚健康管理。填写少量信息，AI 健康管理师为您定制个性化健康方案。",
  },
  L5: {
    name: "妇幼保健",
    tag: "妇幼",
    color: "#db2777",
    subtitle: "孕产妇 · 产后 · 儿童",
    desc: "适合孕产妇与儿童的健康咨询与不适评估：孕期/产后调理与用药安全、哺乳注意事项、儿童常见病与生长发育指导。请如实填写年龄（儿童）或女性专项（孕期/哺乳情况）。",
  },
  L6: {
    name: "中医问诊",
    tag: "中医",
    color: "#7c3aed",
    subtitle: "中医药辨证 · 体质调理",
    desc: "适合希望以中医药视角进行辨证论治、体质辨识与调理的人群，也可结合西医给出综合建议。注意：AI 无法察舌切脉，涉及开方请以线下中医师面诊为准。",
  },
  L7: {
    name: "眼科问诊",
    tag: "眼科",
    color: "#0891b2",
    subtitle: "眼部不适 · 视力问题",
    desc: "适合眼干、眼痛、红肿、视力下降、飞蚊、畏光流泪等眼部问题。请注明左眼/右眼/双眼及视力变化，突发视力下降或剧烈眼痛请优先选择急诊并尽快线下就医。",
  },
  L8: {
    name: "口腔问诊",
    tag: "口腔",
    color: "#d97706",
    subtitle: "口腔黏膜 · 颌面 · 口腔溃疡",
    desc: "适合口腔溃疡、口腔黏膜病变、口臭、颌面部不适等口腔问题。剧痛伴面部肿胀、颌面外伤等请优先急诊并尽快线下就医。",
  },
  L9: {
    name: "牙科问诊",
    tag: "牙科",
    color: "#4338ca",
    subtitle: "牙体牙髓 · 牙周 · 修复种植",
    desc: "适合龋齿、牙痛、牙髓炎、牙龈出血、牙周病、缺牙修复与种植、正畸、智齿等牙齿问题。请注明具体牙位与冷热刺激、咬合痛等诱因；剧痛伴面部肿胀发热或颌面外伤请优先急诊并尽快线下就医。",
  },
};

export const SECTIONS = [
  { id: "basic", title: "一、基础信息" },
  { id: "emergency", title: "二、紧急度判定（关键）" },
  { id: "present", title: "三、现病史（当前症状完整信息）" },
  { id: "past", title: "四、既往病史" },
  { id: "medication", title: "五、用药史 & 过敏史" },
  { id: "family", title: "六、家族病史" },
  { id: "lifestyle", title: "七、生活习惯 & 基础体征" },
  { id: "exam", title: "八、已做检查（如有）" },
  { id: "multi", title: "九、是否多种疾病叠加" },
];

/**
 * 字段定义
 * type: text | textarea | number | select | radio
 * requiredBy: 该字段在哪些等级下必填（L1/L2/L3/L4）；L5-L9 专项通道必填集见下方 EXTRA_REQUIRED
 */
export const FIELDS = [
  // 零、联系方式（用于建立个人健康档案，全部选填）
  { id: "name", section: "basic", type: "text", label: "称呼（选填，用于建立个人健康档案）", placeholder: "如：张女士", requiredBy: [] },
  { id: "phone", section: "basic", type: "text", label: "手机号（选填，用于建立个人健康档案）", placeholder: "如 13800001234", requiredBy: [] },

  // 一、基础信息
  { id: "gender", section: "basic", type: "select", label: "性别", options: ["男", "女"], placeholder: "请选择性别", requiredBy: ["L1", "L2", "L3", "L4"] },
  { id: "age", section: "basic", type: "number", label: "年龄", placeholder: "如 35", requiredBy: ["L1", "L2", "L3", "L4"] },
  { id: "height_weight", section: "basic", type: "text", label: "身高体重", placeholder: "如 170cm / 65kg", requiredBy: ["L2", "L3"] },
  { id: "region", section: "basic", type: "text", label: "所在地区", placeholder: "用于适配流行病、常见病，如：北京", requiredBy: ["L2", "L3"] },
  { id: "occupation_lifestyle", section: "basic", type: "textarea", label: "职业 / 是否长期熬夜 / 久坐 / 高强度劳作", placeholder: "如：程序员，长期久坐熬夜；或：重体力劳动者", requiredBy: ["L2", "L3"] },

  // 二、紧急度判定
  { id: "is_emergency", section: "emergency", type: "radio", label: "是否急性突发、剧痛、高热、呼吸困难、晕厥、出血、持续加重", options: ["是", "否"], requiredBy: ["L2", "L3"] },
  { id: "impact_daily", section: "emergency", type: "radio", label: "当前症状是否影响行动、睡眠、进食", options: ["是", "否"], requiredBy: ["L2", "L3"] },

  // 三、现病史
  { id: "chief_complaint", section: "present", type: "textarea", label: "核心症状主诉（一句话概括不适）", placeholder: "如：右侧头痛伴恶心 2 天，搏动性", requiredBy: ["L1", "L2", "L3", "L4"] },
  { id: "symptom_onset", section: "present", type: "text", label: "症状起始时间、发作频率（偶尔 / 间断 / 持续）", placeholder: "如：3 天前开始，间断发作", requiredBy: ["L1", "L2", "L3"] },
  { id: "symptom_location", section: "present", type: "text", label: "具体位置、范围、单侧/双侧", placeholder: "如：右下腹，麦氏点附近", requiredBy: ["L2", "L3"] },
  { id: "symptom_severity", section: "present", type: "select", label: "症状程度", options: ["轻微", "中度", "重度"], placeholder: "请选择症状程度", requiredBy: ["L1", "L2", "L3"] },
  { id: "aggravating", section: "present", type: "textarea", label: "加重因素（劳累、饮食、冷热、体位、夜间等）", placeholder: "如：劳累后加重，夜间加重", requiredBy: ["L2", "L3"] },
  { id: "relieving", section: "present", type: "textarea", label: "缓解因素（休息、吃药、保暖等）", placeholder: "如：休息后缓解，无，无缓解因素", requiredBy: ["L2", "L3"] },
  { id: "accompanying", section: "present", type: "textarea", label: "伴随全部次要症状（逐条列全，无则填无）", placeholder: "如：伴低热、乏力，无其他", requiredBy: ["L2", "L3"] },
  { id: "triggers", section: "present", type: "textarea", label: "近期诱因（受凉、饮食、饮酒、劳累、外伤、情绪、感染、用药变更）", placeholder: "如：受凉后出现", requiredBy: ["L2", "L3"] },
  { id: "vital_changes", section: "present", type: "textarea", label: "近期体温、排便、睡眠、食欲、体重变化", placeholder: "如：体温 37.8℃，3 天未排便，睡眠差，食欲下降", requiredBy: ["L2", "L3"] },

  // 四、既往病史
  { id: "chronic_history", section: "past", type: "textarea", label: "慢性病史（高血压 / 糖尿病 / 胃病 / 甲亢 / 结节 / 心脑血管等，无则填无）", placeholder: "如：高血压 5 年", requiredBy: ["L2", "L3"] },
  { id: "past_major_events", section: "past", type: "textarea", label: "既往重大疾病、手术史、住院史", placeholder: "如：2020 年胆囊切除手术，无住院史", requiredBy: ["L3"] },
  { id: "rare_disease_history", section: "past", type: "text", label: "既往确诊罕见病 / 疑难病史（无则填无）", placeholder: "如：无；或填写具体名称", requiredBy: ["L3"] },

  // 五、用药史 & 过敏史
  { id: "current_medications", section: "medication", type: "textarea", label: "长期日常服用药物（名称、剂量、频次、服用时长）", placeholder: "如：氨氯地平 5mg 每日一次，5 年", requiredBy: ["L2", "L3"] },
  { id: "recent_medications", section: "medication", type: "textarea", label: "近期 7 天新增用药、保健品、中成药", placeholder: "如：2 天前服布洛芬 1 粒，无", requiredBy: ["L3"] },
  { id: "drug_allergies", section: "medication", type: "textarea", label: "药物过敏史（具体药物 + 反应，无则填无）", placeholder: "如：青霉素过敏，皮疹", requiredBy: ["L2", "L3"] },
  { id: "food_allergies", section: "medication", type: "textarea", label: "食物、接触物过敏史", placeholder: "如：海鲜过敏，无", requiredBy: ["L3"] },

  // 六、家族病史
  { id: "family_history", section: "family", type: "textarea", label: "直系亲属遗传病、肿瘤、心脑血管、免疫疾病史", placeholder: "如：父亲高血压，母亲糖尿病", requiredBy: ["L3"] },
  { id: "family_similar", section: "family", type: "textarea", label: "家族是否有相似症状聚集情况", placeholder: "如：无；或描述", requiredBy: ["L3"] },

  // 七、生活习惯 & 基础体征
  { id: "smoking_alcohol", section: "lifestyle", type: "textarea", label: "吸烟 / 饮酒史（年限、频次、量）", placeholder: "如：吸烟 10 年，每天 1 包；偶尔饮酒", requiredBy: ["L3"] },
  { id: "daily_habits", section: "lifestyle", type: "textarea", label: "饮食、作息、运动习惯", placeholder: "如：饮食偏油腻，作息规律，运动较少", requiredBy: ["L3", "L4"] },
  { id: "female_special", section: "lifestyle", type: "textarea", label: "女性专项：月经周期、是否孕期 / 哺乳期、孕产史", placeholder: "如：月经规律，未孕；或填「不适用」", requiredBy: ["L3"] },

  // 八、已做检查
  { id: "prior_exams", section: "exam", type: "textarea", label: "近期血常规、CT、彩超、核酸、体检异常指标（逐条列明，无则填无）", placeholder: "如：血常规白细胞 13.2×10⁹/L ↑", requiredBy: ["L2", "L3"] },

  // 九、多病叠加
  { id: "multi_disease", section: "multi", type: "textarea", label: "是否多种疾病叠加（是/否）？请列出具体疾病或症状", placeholder: "如：是，高血压 + 糖尿病 + 近期感染；或：否", requiredBy: ["L2", "L3"] },
];

/* 专项通道独立必填集（不随 requiredBy 数组逐字段维护）
   L5 妇幼：基础信息 + 紧急度 + 现病史主干 + 女性专项（孕期/哺乳为安全核心，男性/儿童填「不适用」）
   L6 中医 / L7 眼科 / L8 口腔 / L9 牙科：基础信息 + 紧急度 + 现病史主干（专科细节靠选填字段补充） */
const EXTRA_REQUIRED = {
  L5: new Set(["gender", "age", "is_emergency", "chief_complaint", "symptom_onset", "symptom_severity", "female_special"]),
  L6: new Set(["gender", "age", "is_emergency", "chief_complaint", "symptom_onset", "symptom_severity"]),
  L7: new Set(["gender", "age", "is_emergency", "chief_complaint", "symptom_onset", "symptom_severity"]),
  L8: new Set(["gender", "age", "is_emergency", "chief_complaint", "symptom_onset", "symptom_severity"]),
  L9: new Set(["gender", "age", "is_emergency", "chief_complaint", "symptom_onset", "symptom_severity"]),
};

export function getRequiredFields(level) {
  const extra = EXTRA_REQUIRED[level];
  if (extra) return FIELDS.filter((f) => extra.has(f.id));
  return FIELDS.filter((f) => f.requiredBy.includes(level));
}

export function isRequired(field, level) {
  const extra = EXTRA_REQUIRED[level];
  if (extra) return extra.has(field.id);
  return field.requiredBy.includes(level);
}

export function validate(formData, level) {
  const missing = [];
  for (const field of getRequiredFields(level)) {
    const val = formData[field.id];
    const empty =
      val === undefined ||
      val === null ||
      (typeof val === "string" && val.trim() === "") ||
      (Array.isArray(val) && val.length === 0);
    if (empty) missing.push(field.label);
  }
  return missing;
}
