// 预置模型库（与 server/db.js 保持同步；scenes 通道路由 / priority 主备顺序）
const LLM_PRESETS = [
  /* ---- 国内通用 ---- */
  { name: "DeepSeek V4-Pro", base_url: "https://api.deepseek.com/v1", model: "deepseek-v4-pro", category: "国内通用", scenes: "clinic,emergency", priority: 10, note: "门诊主推 + 急诊国内旗舰：复杂推理、多病共病、罕见病排查第一梯队，贴合国内指南" },
  { name: "DeepSeek V4-Flash", base_url: "https://api.deepseek.com/v1", model: "deepseek-v4-flash", category: "国内通用", scenes: "fast", priority: 31, note: "快诊：V4 高效经济版，1M 上下文，响应快、成本低，适合高并发问诊" },
  { name: "DeepSeek V4.1 Flash", base_url: "https://api.deepseek.com/v1", model: "deepseek-v4.1-flash", category: "国内通用", scenes: "fast,clinic", priority: 37, note: "快诊/门诊备选：V4 系列最新经济版，Agent 与长文本能力增强" },
  { name: "智谱 GLM-5.3", base_url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.3", category: "国内通用", scenes: "clinic,wellness,maternal", priority: 11, note: "门诊/保健主推：1M 上下文，长程任务与循证文本强" },
  { name: "智谱 GLM-5.3-Flash", base_url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.3-flash", category: "国内通用", scenes: "fast", priority: 30, note: "快诊主推：原生多模态、极致低成本，1M 上下文" },
  { name: "智谱 GLM-5.3-FlashX", base_url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.3-flashx", category: "国内通用", scenes: "fast", priority: 36, note: "快诊备选：同基座提速档，最高约 200 tokens/s" },
  { name: "通义千问 Qwen3.8-Max", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3.8-max", category: "国内通用", scenes: "wellness,maternal", priority: 8, note: "保健/妇幼主推：开源旗舰，长文本健康方案与患者教育强" },
  { name: "通义千问 Qwen3.7-Plus", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3.7-plus", category: "国内通用", scenes: "clinic", priority: 21, note: "门诊备选：性价比高，推理 + 视觉理解，1M 上下文" },
  { name: "通义千问 Qwen3.6-Flash", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3.6-flash", category: "国内通用", scenes: "fast", priority: 32, note: "快诊备选：轻量低成本，支持视觉理解" },
  { name: "Kimi K3", base_url: "https://api.moonshot.cn/v1", model: "kimi-k3", category: "国内通用", scenes: "clinic,wellness", priority: 12, note: "门诊/保健：1M 上下文 + 原生视觉，复杂推理与长文阅读" },
  { name: "Kimi K2.8 Preview", base_url: "https://api.moonshot.cn/v1", model: "kimi-k2.8-preview", category: "国内通用", scenes: "clinic", priority: 22, note: "门诊备选：思考效率高，长上下文指令遵循稳定" },
  { name: "豆包 Seed 2.1 Pro（火山方舟）", base_url: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-2.1-pro", category: "国内通用", scenes: "clinic,emergency", priority: 23, note: "门诊/急诊备选：中文创作与多模态强；model 需填方舟推理接入点 ID" },
  { name: "豆包 Seed 2.1 Turbo（火山方舟）", base_url: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-2.1-turbo", category: "国内通用", scenes: "fast", priority: 33, note: "快诊：效果与成本均衡，多模态与长链路执行升级；model 需填方舟推理接入点 ID" },
  { name: "豆包 Seed Evolving（火山方舟）", base_url: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-evolving", category: "国内通用", scenes: "clinic", priority: 24, note: "门诊备选：面向 Coding/Agent，1M 上下文，统一模型 ID 周级升级；需填方舟接入点 ID" },
  { name: "文心一言 ERNIE 6.0（千帆）", base_url: "https://qianfan.baidubce.com/v2", model: "ernie-6.0", category: "国内通用", scenes: "wellness", priority: 16, note: "保健：中医药知识、公卫宣教；model 名以千帆控制台为准" },
  { name: "腾讯混元 Pro", base_url: "https://api.hunyuan.cloud.tencent.com/v1", model: "hunyuan-pro", category: "国内通用", scenes: "clinic,wellness", priority: 25, note: "门诊/保健备选：中文理解与工具调用均衡" },
  { name: "腾讯混元 Hy4 Preview", base_url: "https://api.hunyuan.cloud.tencent.com/v1", model: "hy4-preview", category: "国内通用", scenes: "clinic", priority: 26, note: "门诊备选：约 770B 稀疏旗舰，1M 上下文，Agent 与代码优化；model 名以控制台为准" },
  { name: "MiniMax M3", base_url: "https://api.minimax.chat/v1", model: "MiniMax-M3", category: "国内通用", scenes: "clinic,emergency", priority: 27, note: "门诊/急诊备选：编码与智能体评测顶尖，长上下文" },
  { name: "硅基流动 SiliconFlow", base_url: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V4-Pro", category: "国内通用", scenes: "fast,clinic,emergency,wellness", priority: 40, note: "国内聚合网关，一个 Key 调多家开源模型（DeepSeek/Qwen/GLM/Kimi/MiniMax）；四通道兜底" },
  /* ---- 海外通用 ---- */
  { name: "OpenAI GPT-6 Astra", base_url: "https://api.openai.com/v1", model: "gpt-6-astra", category: "海外通用", scenes: "emergency", priority: 1, note: "急诊主推：当前旗舰，复杂推理/编码/Agent 最强；用药必须按国内指南复核，model 名以控制台为准" },
  { name: "OpenAI GPT-6 Sol", base_url: "https://api.openai.com/v1", model: "gpt-6-sol", category: "海外通用", scenes: "clinic", priority: 13, note: "门诊备选：复杂编码与 Agent 工作流，成本较旗舰大幅下降；model 名以控制台为准" },
  { name: "OpenAI GPT-6 Luna", base_url: "https://api.openai.com/v1", model: "gpt-6-luna", category: "海外通用", scenes: "fast", priority: 34, note: "快诊备选：面向信息提取/摘要等高容量低成本任务；model 名以控制台为准" },
  { name: "Claude Opus 5.5", base_url: "https://api.anthropic.com/v1", model: "claude-opus-5-5", category: "海外通用", scenes: "emergency", priority: 2, note: "急诊备选：超长病历/多页报告无损消化，输出稳定幻觉低；model 名以控制台为准" },
  { name: "Claude Sonnet 5", base_url: "https://api.anthropic.com/v1", model: "claude-sonnet-5", category: "海外通用", scenes: "clinic", priority: 17, note: "门诊备选：均衡性价比，长文本稳定；model 名以控制台为准" },
  { name: "Gemini 3 Pro", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3-pro", category: "海外通用", scenes: "emergency,wellness", priority: 14, note: "急诊/保健：医学多模态强，放射/皮肤/病理影像与体检报告解读" },
  { name: "Gemini 3.1 Pro", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.1-pro", category: "海外通用", scenes: "fast", priority: 35, note: "快诊备选：前沿档中成本最低，多模态" },
  { name: "Grok 4.7", base_url: "https://api.x.ai/v1", model: "grok-4.7", category: "海外通用", scenes: "emergency", priority: 15, note: "急诊备选：多智能体协作与实时信息接入，复杂推理；model 名以控制台为准" },
  { name: "OpenRouter", base_url: "https://openrouter.ai/api/v1", model: "openai/gpt-6-sol", category: "海外通用", scenes: "fast,clinic,emergency,wellness", priority: 41, note: "海外聚合网关，一个 Key 调多家模型；四通道兜底" },
  /* ---- 国内垂直 ---- */
  { name: "讯飞星火医疗（晓医）", base_url: "https://spark-api-open.xf-yun.com/v1", model: "Spark-X2.5", category: "国内垂直", scenes: "maternal", priority: 3, note: "妇幼主推：孕产妇/儿童健康评估与用药安全语义理解；医疗版需讯飞授权，model 名以控制台为准" },
  { name: "百川 Baichuan-M4", base_url: "https://api.baichuan-ai.com/v1", model: "Baichuan-M4", category: "国内垂直", scenes: "maternal", priority: 4, note: "妇幼备选：低幻觉强循证，儿科/肿瘤专科；医疗版需商务授权" },
  { name: "医联 MedGPT", base_url: "", model: "medgpt", category: "国内垂直", scenes: "wellness", priority: 90, note: "慢病随访/健康管理；无公开 API，需企业合作接入" },
  { name: "智愈 MedSeek（良医汇）", base_url: "", model: "medseek", category: "国内垂直", scenes: "emergency", priority: 90, note: "肿瘤专科循证检索（TNM 分期/化疗方案），面向医生；无公开 API" },
  { name: "小荷 AI 医生", base_url: "", model: "xiaohe", category: "国内垂直", scenes: "clinic", priority: 90, note: "门诊：化验单拍照解读、用药科普；无公开 API" },
  { name: "联影元智", base_url: "", model: "uyuanzhi", category: "国内垂直", scenes: "clinic,emergency", priority: 95, note: "医学影像辅助阅片（CT/核磁），医院端 B 端；无公开 API" },
  /* ---- 海外垂直 ---- */
  { name: "Med-PaLM 2", base_url: "", model: "med-palm-2", category: "海外垂直", scenes: "wellness", priority: 98, note: "体检报告总结/ICD 编码，欧美体系；面向 B 端，无公开 API" },
  { name: "Med-Gemini", base_url: "", model: "med-gemini", category: "海外垂直", scenes: "emergency", priority: 99, note: "医学影像+基因组多模态科研；面向 B 端，无公开 API" },
];

export default LLM_PRESETS;
