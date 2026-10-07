# 大气AI医院 上线部署手册

## 架构（当前生产形态：全 Cloudflare 无服务器）

```
用户浏览器
   │
   ├── https://daqihospital.net / www.daqihospital.net
   │     └─ Cloudflare Pages 项目 aihospital（前端静态站，构建产物 client/dist）
   │           └─ 页面内 bootstrap 按 hostname 注入 window.__API_ORIGIN__
   │
   └── API 请求 ──► https://api.daqihospital.com（跨域直连，Worker 已带 CORS 头）
         └─ Cloudflare Worker aihospital-api
               ├─ 静态资产托管（/api/* 先行，其余 assets 直出，静态请求免费）
               ├─ D1 数据库 aihospital（c0f0b608-2ded-489b-a514-4a432eb66b68，APAC）
               ├─ R2 桶 aihospital-attachments（问诊附件）
               └─ JWT_SECRET 通过 `wrangler secret put JWT_SECRET` 配置
```

- 前端规范域：**https://daqihospital.net/**（canonical/og/sitemap/robots/llms.txt 全部指向 .net）
- API 基址：生产域下前端直连 `https://api.daqihospital.com/api`（`window.__API_ORIGIN__`），本地/预览环境走同源 `/api`（Vite proxy → localhost:3001，或 Pages Functions）
- `functions/api/[[path]].js`（Pages 反代）保留在仓库但平台侧未生效，属备用通道；API 直连为当前主链路

## 域名与 DNS（daqihospital.net zone）

| 记录 | 类型 | 内容 | 代理 |
| ---- | ---- | ---- | ---- |
| daqihospital.net | CNAME | aihospital-eq8.pages.dev | 橙云 |
| www.daqihospital.net | CNAME | aihospital-eq8.pages.dev | 橙云 |
| api.daqihospital.com（.com zone） | Workers Custom Domain（由 CF 管理） | aihospital-api | 橙云 |

注意：环境内 API Token 为账号级（Account Owned Token），Cloudflare 限制其无法写 Zone DNS 与 Workers Domains 绑定，上述 DNS 记录需在 Dashboard 手动维护。

## 部署命令

```bash
# 前端构建（client/ 目录）
npm run build

# Pages 部署（仓库根执行）
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=2e33f078edc00ade4b25e61526d6f544 \
  npx --yes wrangler@4 pages deploy --project-name aihospital --branch main --commit-dirty=true

# Worker 部署（worker/ 目录执行，含静态资产同步）
CLOUDFLARE_API_TOKEN=... npx --yes wrangler@4 deploy
```

远程 D1 导入（沙箱内 `wrangler d1 execute --remote` 不可用，走 REST）：

```bash
node /tmp/opencode/d1-import.mjs   # 逐条 POST /accounts/{acc}/d1/database/{id}/query
```

## Workers 免费额度

- 免费版每日 10 万请求（**账号级共享**，账号内其他 Worker 会消耗同一额度）
- 额度耗尽时所有 Worker 请求返回 `error code: 1027`（workers.dev 为纯文本，自定义域为 "temporarily rate limited" HTML 页）
- 重置时间：UTC 0 点（北京时间早 8 点）
- 静态资产请求（Worker assets 与 Pages）不消耗该额度

## 上线检查清单

- [ ] `https://daqihospital.net/` 200，canonical 指向 .net
- [ ] `https://api.daqihospital.com/api/status` 返回 JSON（configured:true + 启用模型）
- [ ] 首页发起一次真实问诊（非 demo），确认 LLM 推理链主备路由
- [ ] 会员注册/登录（旧 scrypt 哈希自动升级 PBKDF2 已验证）、充值/消费记录
- [ ] 支付：后台填商户参数，回调地址 `https://api.daqihospital.com/api/pay/notify/*`，1 分钱订单端到端验证
- [ ] `/admin/` 管理后台（独立多页入口）登录与配置

## 自托管备选方案（Docker + Express）

若需脱离 Cloudflare，`server/` 仍是完整可运行后端（Express + better-sqlite3）：

```bash
bash scripts/deploy-server.sh   # 服务器上一键部署，.env 填 USER_LLM_API_KEY 与 ADMIN_PASSWORD
PORT=5173 node server/index.js  # 单进程演示模式
```

配套：Pages Functions 反代（`functions/api/[[path]].js`，环境变量 `BACKEND_ORIGIN=https://api.<你的域名>`）或 Vite dev proxy。

## 常见问题

| 现象 | 排查 |
| ---- | ---- |
| API 返回 "temporarily rate limited" 或 `error code: 1027` | Workers 免费日额度耗尽，等 UTC 0 重置或升级 Paid |
| 前端请求 404.html | 确认页面 hostname 匹配 `daqihospital.net`（__API_ORIGIN__ 注入条件） |
| 问诊返回"模型未配置" | /admin 后台配置模型（36 预置已导入，需启用并填 key） |
| 支付下单成功但未开通 | 回调地址不可达或签名校验失败；查 Worker 日志 pay/notify |
| admin 样式/脚本旧缓存 | admin 资源版本号 `?v=` 在 admin/index.html 中管理 |
