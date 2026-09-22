/**
 * 多通道 Prompt 模板 + 固定 JSON 结构化输出
 *
 * 等级：
 *   L1 轻微快诊（字段最少，输出简版）
 *   L2 中等（字段增多，完整 6 条）
 *   L3 危重症/疑难杂症（全量强制字段，罕见病/多系统叠加强化）
 *   L4 日常保健（健康咨询、体检解读、慢病随访）
 *   L5 妇幼保健（孕产妇/儿童，绑定妇幼垂直模型组）
 *   L6 中医问诊（复用保健模型组，中医药/体质调理视角）
 *   L7 眼科问诊（复用门诊模型组，眼科专科视角）
 *   L8 口腔问诊（复用门诊模型组，口腔专科视角）
 */

export const LEVELS = {
  L1: {
    key: "L1",
    name: "轻微快诊",
    desc: "适用于轻微不适、症状单一、无高危因素",
  },
  L2: {
    key: "L2",
    name: "中等症状",
    desc: "适用于症状明确、需规范评估与检查建议",
  },
  L3: {
    key: "L3",
    name: "危重症/疑难杂症",
    desc: "适用于高危、紧急、罕见病与多病叠加",
  },
  L4: {
    key: "L4",
    name: "日常保健",
    desc: "健康咨询、体检报告解读、慢病随访、膳食运动睡眠与亚健康调理",
  },
  L5: {
    key: "L5",
    name: "妇幼保健",
    desc: "孕产妇与儿童健康咨询、不适评估与安全用药指导",
  },
  L6: {
    key: "L6",
    name: "中医问诊",
    desc: "中医药辨证论治、体质调理与中西医结合建议",
  },
  L7: {
    key: "L7",
    name: "眼科问诊",
    desc: "眼部不适、视力问题与眼科专科评估",
  },
  L8: {
    key: "L8",
    name: "口腔问诊",
    desc: "口腔、牙齿、牙周问题与口腔专科评估",
  },
};

const JSON_SCHEMA = `
请输出严格的 JSON 对象，结构如下（禁止增删字段，禁止遗漏，禁止输出 JSON 之外的任何文本）：
{
  "key_findings": "关键信息汇总：提炼所有有效病史、症状、高危因素，精简无冗余。",
  "risk_level": "必须且只能取以下三值之一：无需急诊 / 建议尽快门诊 / 立即急诊",
  "risk_reason": "风险分级核心危险依据，写明支持该结论的具体病史条目。",
  "red_flags": ["红色危险警示列表：若存在危重、隐匿风险，逐条置顶；无则返回空数组"],
  "differential": [
    {"disease": "鉴别诊断名称", "reason": "推理依据，须引用具体病史字段", "probability": "高/中/低"}
  ],
  "uncertainties": ["最大不确定点与信息缺口：当前资料不足以确诊的所有问题，诚实标注，禁止自信幻觉"],
  "recommended_exams": [
    {"item": "检查项目名称", "priority": "必做 或 可选", "reason": "为何做，贴合国内医院常规检查"}
  ],
  "plan": {
    "home_care": "居家观察方案",
    "department": "建议就诊科室",
    "contraindications": "生活禁忌与注意事项",
    "medication_reference": "用药参考（标注仅参考，不替代处方）",
    "follow_up": "复诊时机与观察期限"
  },
  "confidence": "0 到 1 之间的置信度评分（数字）"
}`;

function buildHistoryText(formData) {
  if (!formData || typeof formData !== "object") return "";
  const labels = {
    gender: "性别",
    age: "年龄",
    height_weight: "身高体重",
    region: "所在地区",
    occupation_lifestyle: "职业/作息/劳作强度",
    is_emergency: "是否急性突发、剧痛、高热、呼吸困难、晕厥、出血、持续加重",
    impact_daily: "当前症状是否影响行动、睡眠、进食",
    chief_complaint: "核心症状主诉",
    symptom_onset: "症状起始时间、发作频率",
    symptom_location: "具体位置、范围、单侧/双侧",
    symptom_severity: "症状程度",
    aggravating: "加重因素",
    relieving: "缓解因素",
    accompanying: "伴随全部次要症状",
    triggers: "近期诱因",
    vital_changes: "近期体温、排便、睡眠、食欲、体重变化",
    chronic_history: "慢性病史",
    past_major_events: "既往重大疾病、手术史、住院史",
    rare_disease_history: "既往确诊罕见病/疑难病史",
    current_medications: "长期日常服用药物",
    recent_medications: "近期7天新增用药、保健品、中成药",
    drug_allergies: "药物过敏史",
    food_allergies: "食物、接触物过敏史",
    family_history: "直系亲属遗传病、肿瘤、心脑血管、免疫疾病史",
    family_similar: "家族相似症状聚集情况",
    smoking_alcohol: "吸烟/饮酒史",
    daily_habits: "饮食、作息、运动习惯",
    female_special: "女性专项（月经/孕期/哺乳/孕产史）",
    prior_exams: "近期检查异常指标",
    multi_disease: "是否多种疾病叠加",
  };
  const lines = [];
  for (const [key, value] of Object.entries(labels)) {
    const raw = formData[key];
    const val = Array.isArray(raw) ? raw.join("、") : String(raw ?? "").trim();
    if (val && val !== "") {
      lines.push(`${labels[key]}：${val}`);
    }
  }
  return lines.length ? lines.join("\n") : "（未提供任何病史信息）";
}

function buildSystemPrompt(level, ragContext) {
  const levelMap = {
    L1: "你正在进行【轻微快诊】分诊：针对症状单一、低风险的轻微不适，给出简洁的快速分诊与居家指导，切勿过度检查、过度医疗。",
    L2: "你正在进行【中等程度症状】评估：针对症状明确、需要规范评估的患者，请执行完整的临床推理并给出规范的检查建议。",
    L3: "你正在评估【危重症/疑难杂症】患者：必须对高危信号保持最高警觉，逐条排查致命性疾病，不得遗漏罕见病与多系统疾病叠加的可能性，任何危险信号必须置顶红色警示。",
    L4: "你正在进行【日常保健】健康咨询：面向日常健康咨询、体检报告解读、慢病随访、膳食/运动/睡眠调理、亚健康调理等需求。请以健康管理师+全科医生的专业视角，结合患者的生活方式与基础体征，给出个性化、可执行、贴合国内居民生活习惯的健康管理方案。关注「治未病」与主动健康，避免过度医疗；若从资料中发现异常指标、潜在疾病风险或需要线下进一步确认的事项，必须如实提示并建议到对应科室就诊。",
    L5: "你正在评估【妇幼保健】患者（孕产妇/儿童）：必须具备妇产科与儿科双重专业视角。孕产妇须优先核对孕周、妊娠并发症（妊高征/妊娠糖尿病等）与用药禁忌（孕期禁用/慎用药物清单、哺乳期用药分级），任何孕产急症（阴道出血、胎动异常、剧烈腹痛、破水、规律宫缩等）必须红色置顶并明确建议尽快就诊产科；儿童须结合年龄与体重核对用药剂量，警惕高热惊厥、脱水、呼吸困难、意识异常等高危表现。涉及孕期用药或儿科用药时，只给出用药分级与「需由医生处方」的参考，严禁给具体剂量处方。",
    L6: "你正在进行【中医问诊】分诊与调理指导：请以中西医结合视角，运用中医辨证论治思维（八纲辨证、脏腑辨证、气血津液辨证），结合四诊信息（患者未提供舌脉时须在 uncertainties 中如实说明，并建议线下中医师面诊察舌切脉）与体质辨识（九种体质），给出中医调护方案（起居、情志、饮食宜忌、可参考的中成药/经典方剂思路——须标注「需中医师辨证后开方，不替代处方」）。同时用西医视角评估是否存在必须西医干预的危险信号（如剧烈疼痛、进行性加重、器质性病变），出现时必须红色置顶并转对应专科。建议就诊科室指向「中医科 / 中西医结合科」，必要时注明对应的西医专科。",
    L7: "你正在评估【眼科】患者：请以眼科专科视角评估眼部症状。必须重点排查眼科急症——突发/进行性视力下降或视野缺损、剧烈眼痛伴头痛恶心、急性闭角型青光眼征象、眼外伤/化学伤、眼前固定黑影/闪光感（警惕视网膜脱离）、角膜白斑或穿孔——出现时一律红色置顶并建议尽快就诊眼科急诊。就诊科室指向「眼科」。描述症状位置使用「左眼/右眼/双眼」口径，建议检查需符合眼科常规（视力、裂隙灯、眼压、眼底、OCT、视野等），并给出眼部居家护理与用眼卫生建议。",
    L8: "你正在评估【口腔】患者：请以口腔科专科视角评估口腔症状。重点排查口腔急症——剧烈牙痛伴面部肿胀发热（间隙感染）、颌面部外伤、下颌骨折、拔牙后出血不止、口腔内迅速增大的肿物——出现时红色置顶并建议尽快就诊口腔科/口腔急诊。就诊科室指向「口腔科」。建议检查符合口腔常规（曲面断层片/根尖片、牙周探查等），给出口腔卫生维护、饮食宜忌与就医时机建议。涉及用药时标注「仅供参考，需由医生处方」并避开常用致敏药物。",
  };

  const ragBlock = ragContext && ragContext.length
    ? `\n\n【参考知识库·国内临床指南要点（检索增强，结合病史文本检索所得）】\n${ragContext
        .map((g, i) => `${i + 1}. [${g.category}] ${g.title}\n${g.content}`)
        .join("\n\n")}\n请优先遵循其中与患者情况匹配的国内指南要点，但不得超出其适用范围。`
    : "";

  return `你是中国一位资深全科医生兼急诊分诊专家。请严格按照国内临床诊疗指南、中国人疾病谱、国内常用药物规范执行严谨临床推理。

你的职责是：基于患者填写的 100% 结构化病史信息进行分诊与健康咨询。禁止脑补、禁止遗漏字段、禁止过度乐观、禁止模糊话术。

${levelMap[level]}

【核心铁律】
1. 所有分析与结论必须逐条引用患者填写的病史字段，禁止凭空新增病史；
2. 区分「常见病结论」与「罕见病可能性」，必须分开说明；
3. 存在危重、隐匿风险时，必须将其置顶为红色警示（red_flags），并且 risk_level 必须给出「立即急诊」；
4. 对不确定的信息必须诚实写入 uncertainties，禁止自信幻觉；
5. 不使用模棱两可话术，不敷衍；
6. 用药建议必须标注「仅供参考，不替代处方」，贴合国内常用药物与禁忌；
7. 风险分级倾向保守兜底：宁高勿低，避免漏诊急症。
${ragBlock}

${JSON_SCHEMA}`;
}

function buildUserPrompt(level, formData) {
  const historyText = buildHistoryText(formData);
  const levelName = LEVELS[level] ? LEVELS[level].name : level;

  return `患者选择了【${levelName}】就诊通道。

以下是患者填写的完整结构化病史信息（未列出的字段表示患者未填写）：

${historyText}

请基于以上信息执行严谨临床推理，严格按系统要求的 JSON 格式输出，逐条回应每一项病史字段，缺一不可。`;
}

export function buildMessages({ level, formData, ragContext }) {
  return [
    { role: "system", content: buildSystemPrompt(level, ragContext) },
    { role: "user", content: buildUserPrompt(level, formData) },
  ];
}

export function buildDemoResult(level, formData) {
  const complaint = formData?.chief_complaint || "未提供主诉";
  const isHighRisk = level === "L3";
  const isWellness = level === "L4";
  const isMaternal = level === "L5";
  const DEMO_DEPT = { L6: "中医科 / 中西医结合科", L7: "眼科", L8: "口腔科" };
  const keyFindings = [
    `咨询主题：${complaint}`,
    `年龄${formData?.age || "未填"}，性别${formData?.gender || "未填"}`,
    formData?.female_special ? `女性专项：${formData.female_special}` : "",
    formData?.daily_habits ? `生活习惯：${formData.daily_habits}` : "",
    formData?.chronic_history ? `慢性病史：${formData.chronic_history}` : "无明确慢性病史",
  ].filter(Boolean).join("；");

  return {
    demo: true,
    key_findings: keyFindings,
    risk_level: isHighRisk ? "立即急诊" : isWellness ? "无需急诊" : "建议尽快门诊",
    risk_reason: isHighRisk
      ? "危重症通道：存在高危因素，保守起见按最高风险分诊，须由线下急诊排除急症。"
      : isWellness
        ? "日常保健通道：当前为健康咨询/健康管理场景，未发现需要急诊处理的情况。"
        : isMaternal
          ? "妇幼通道：孕产妇/儿童情况需谨慎对待，孕周、体重等关键信息仍须由线下产科/儿科复核确认。"
          : "依据主诉与病史存在一定不确定性，建议尽快门诊明确诊断。",
    red_flags: isHighRisk
      ? ["危重症通道默认高亮警示：如有胸痛、呼吸困难、意识改变、大出血等表现请勿等待，立即拨打120。"]
      : [],
    differential: [
      { disease: "需进一步鉴别（示例）", reason: "当前为演示模式输出，配置真实 API Key 后由大模型生成", probability: "中" },
    ],
    uncertainties: ["演示模式下不进行真实推理；请配置 USER_LLM_API_KEY 后获得完整分析。"],
    recommended_exams: [
      { item: "血常规", priority: "必做", reason: "基础筛查，判断感染与血液异常" },
      { item: "相关专科检查", priority: "可选", reason: "由医生根据问诊与查体决定" },
    ],
    plan: {
      home_care: "保持休息，密切观察症状变化；如症状持续加重请及时就医。",
      department: isMaternal ? "产科 / 儿科 / 妇幼保健门诊" : DEMO_DEPT[level] || "全科医学科 / 对应专科门诊",
      contraindications: "避免自行用药掩盖症状，避免剧烈运动与饮酒。",
      medication_reference: "演示模式不提供用药参考（仅供参考，不替代处方）。",
      follow_up: "症状无缓解或加重时 1-3 天内复诊。",
    },
    confidence: 0.3,
  };
}
