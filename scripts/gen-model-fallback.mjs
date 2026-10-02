// 生成首页通道模型配置快照 client/src/model-fallback.js
// 用途：静态站（Pages）后端不可达时，首页模型名称使用最近一次部署时的真实配置兜底展示；
// 后端可达时前端仍以 /api/status 实时配置为准。任何情况下构建都不应因此失败。
import { writeFileSync, existsSync, readFileSync } from "node:fs";

const FILE = new URL("../client/src/model-fallback.js", import.meta.url);
const url = process.env.AIHOSPITAL_STATUS_URL || "http://127.0.0.1:3001/api/status";

let rows = null;
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const list = json && json.llm && Array.isArray(json.llm.scene_models) ? json.llm.scene_models : [];
  if (!list.length) throw new Error("scene_models 为空");
  rows = list.map((s) => ({
    scene: s.scene,
    label: s.label || "",
    configured: !!s.configured,
    primary: s.primary || "",
    backups: Number(s.backups) || 0,
  }));
} catch (err) {
  if (existsSync(FILE)) {
    console.warn(`[gen-model-fallback] 获取 ${url} 失败（${err.message}），保留已有快照`);
  } else {
    console.warn(`[gen-model-fallback] 获取 ${url} 失败（${err.message}），写入空快照`);
    rows = [];
  }
}

if (rows) {
  const header =
    "/* 由 scripts/gen-model-fallback.mjs 自动生成：后端 /api/status 模型配置快照。\n" +
    "   静态部署且接口不可达时兜底展示；接口可达时前端以实时配置为准。 */\n";
  writeFileSync(FILE, header + `export default ${JSON.stringify(rows, null, 2)};\n`);
  console.log(`[gen-model-fallback] 已写入 ${rows.length} 条场景模型快照`);
}
