# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.

## Entries

[Project Knowledge Summary]
- Date: 2026-08-26
- Context: Discovered by Agent while running AI 医院 web project preview
- Category: Operations & Deployment / Environment Configuration
- Instructions:
  - 本地形态：生产单进程 `PORT=5173 node server/index.js`（托管 client/dist + /api + /admin + SQLite，5173 预览隧道此形态）；E2E 另起 `PORT=3001 node server/index.js`。后台入口 `/admin`，账号 admin/admin123456（.env ADMIN_PASSWORD），删 data 目录即重置密码。
  - 后台 CSS 有 `[hidden]{display:none!important}` 全局规则：带 hidden 属性的容器 class 不得再声明 display 覆盖，否则视图叠加。
  - admin 三件套在 client/public/admin/，引用带 `?v=日期字母`，改动需同步 bump index.html 版本号并重新 build。
  - 本环境后台终端会被平台周期性回收（预览 530），重新 background_terminal 启动即可（timeout=0）；禁止用定时器/保活工具规避回收。

[Project Knowledge Summary]
- Date: 2026-08-29
- Context: Discovered by Agent while implementing LLM provider management and E2E suites
- Category: Operations & Deployment / Build Methods / Testing Methods
- Instructions:
  - LLM 配置存 llm_providers 表（scenes/priority 小者主/启用 toggle），预置 36 条 initLLMProviders 幂等补种，PRESET_RENAMES 改名保留 Key；api_key 不回传明文（has_key/key_masked）。无公开 API 的垂直预置 base_url 留空。
  - 前台访客购买：GET /api/services 公开 + POST /api/purchase 无鉴权（订单 source=前台下单）。
  - jsdom E2E 全套在 /tmp/opencode/*.mjs（nav/channels/main/member/admin/maternity/acct-debug/pay/purchase-pay/pay-crypto/navcheck），需后端 3001 + client dev 5173；退出码非 0 即失败。mock 需覆盖全部 admin API 并含 scenes/scene_labels/priority、/api/status 含 scene_models。后台弹窗用 .modal-mask .modal-body 选取；换路由会重建 DOM，轮询每轮重新查询。

[Project Knowledge Summary]
- Date: 2026-09-03
- Context: Discovered by Agent while binding home channels to per-channel model groups
- Category: Operations & Deployment / Troubleshooting & Debugging
- Instructions:
  - 通道路由词汇：L1=fast、L2=clinic、L3=emergency、L4=wellness、L5=maternal、L6=wellness（中医）、L7/L8=clinic（眼科/口腔）。LEVELS 键序即页面顺序。
  - L5-L8 专项通道：resolveScene 仅 L5 恒定 maternal 且不参与升级；L6-L8 受 multi_disease/rare_disease_history 升级约束。专项必填集在 form-config.js EXTRA_REQUIRED。
  - 前台模型芯片/徽标用 CHANNEL_SCENE+SHARED_GROUP 与 LEVEL_META[state.level].tag；前台所有页面不展示模型名（用户明确要求，后台不受影响）。
  - 通道降级兜底：无专属启用模型时用全部已启用兜底，route.degraded=true。llm.js 主备链必须用 listProviderRowsForScene（含 api_key），脱敏版 listProvidersForScene 不能用于调用。
  - 主备分配（priority 小者主）：fast=GLM-5.3-Flash(30)，clinic=DeepSeek V4-Pro(10)，emergency=GPT-6 Astra(1)，wellness=Qwen3.8-Max(8)，maternal=Spark-X2.5(3)；完整备用链见 llm-presets.js。当前唯一启用带 Key：智谱 GLM。

[Project Knowledge Summary]
- Date: 2026-09-08
- Context: Discovered by Agent while implementing member center
- Category: Operations & Deployment / Build Methods
- Instructions:
  - 会员=customers 表账号（scrypt 哈希/profile JSON/wallet_ledger）；对外 SELECT 显式列名剔除 password_hash，仅 customerAuthStmt 取整行。
  - 会员 API server/member.js（内存 Map token 7 天）；resolveMemberByToken 供问诊落库挂会员。前端 member.js：localStorage mh_token/mh_member，401 清态跳 #/login；健康档案字段=问诊表单 18 项（HEALTH_KEYS 与 PROFILE_GROUPS 白名单两处同步）。
  - 购买弹窗：登录会员余额足够默认余额支付；免费档自动置已付款。小屏隐藏"服务购买"用 .nav-services:not(.nav-member):not(.nav-auth)。
  - 测试会员 13800001234/newpass888（旧 scrypt 哈希登录后自动升级 PBKDF2，Workers 版已验证 salt 为 hex 字符串原文 32B）。

[Project Knowledge Summary]
- Date: 2026-09-10
- Context: Discovered by Agent while implementing attachment uploads
- Category: Operations & Deployment / Build Methods
- Instructions:
  - 附件：attachments 表（kind/label/mime/size/stored 相对路径，consult/purchase/customer 三选一归属），文件 data/uploads/yyyyMMdd/。接口顶层 JSON {kind,label,mime,data(base64)}，单文件≤6MB，仅 png/jpg/webp/gif/pdf，express.json limit 18mb。
  - 前端共享 client/src/attachments.js mountUploader（三入口：问诊表单/购买成功面板/会员材料库）；与 member.js 互相 import 仅运行期调用无 TDZ。jsdom harness 需补 File/FileReader。
  - 服务项目 needs_doc 列（慢病管理/体检报告解读=1）；后台会员档案弹窗聚合 documents。

[Project Knowledge Summary]
- Date: 2026-09-11
- Context: Discovered by Agent while integrating real Alipay/WeChat payment
- Category: Operations & Deployment / Troubleshooting & Debugging
- Instructions:
  - 支付密钥只存 SQLite settings 表，后台回显只回 has_* 布尔，留空表示保持原值；禁止密钥入代码/聊天。
  - server/pay.js：支付宝 RSA2（normalizePem 兼容 PKCS8，公钥显式 type "PUBLIC"）+ 微信 APIv3（AES-256-GCM 32 位密钥，平台证书验签需原始 body，express.json verify 存 req.rawBody）。
  - 回调 /api/pay/notify/*，findPayTarget 同时支持充值单与服务订单，到账统一走 confirmRechargeOrder/confirmPurchasePayment（幂等）。
  - 充值有渠道走统一下单（QRCode.toCanvas + 3 秒轮询），无渠道退化模拟到账；服务订单在线直付复用同渠道未支付收款码。回调地址 pay_notify_base_url 指向 api.daqihospital.com（生产）。

[Project Knowledge Summary]
- Date: 2026-09-16
- Context: Discovered by Agent while pushing to GitHub
- Category: Workflow & Collaboration / Environment Configuration
- Instructions:
  - GitHub 仓库 https://github.com/talleylinjg-ops/AIhospital 主分支 main；有效推送命令（须先清系统 helper）：`export GH_PAT=...; git -c credential.helper= -c credential.helper='!f(){ printf "protocol=https\nhost=github.com\nusername=talleylinjg-ops\npassword=%s\n" "$GH_PAT"; }; f' push origin main`。平台 git-credential-helper 对 github 返回 500；PAT 无 workflow 作用域，.github/ 保持 untracked 不推送。
  - Cloudflare 账号 Daqi Account（acc 2e33f078edc00ade4b25e61526d6f544）；cfat_ 前缀=Account Token（用户级 verify 对它返回 Invalid 属正常）；可用令牌存 /root/.cloudflare-token（600）。沙箱访问不了 *.pages.dev 与 *.workers.dev（DNS 污染/tail 断连），部署验证走 Cloudflare API。
  - Pages 项目 aihospital（生产分支 main，wrangler.toml pages_build_output_dir=client/dist）；部署 `CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... wrangler@4 pages deploy --project-name aihospital --branch main --commit-dirty=true`。

[Project Knowledge Summary]
- Date: 2026-10-07
- Context: Discovered by Agent while migrating the brand domain to daqihospital.net and deploying the Workers backend
- Category: Operations & Deployment / Troubleshooting & Debugging / Environment Configuration
- Instructions:
  - **品牌域是 daqihospital.net**（.net zone ef85c4f6720ee545f59ea05218826c1d）；此前对 daqihospital.com（zone b462f899…）的绑定均为误方向已清理。规范域 50 处= index.html 31、llms-full 11、llms 4、sitemap 4、robots 1，改域名时同步 sitemap lastmod。
  - Account Owned Token（cfat_）硬限制：Zone DNS records 读写拒绝；POST /accounts/*/workers/domains 与 zone workers routes POST 返回 10405/No access（GET 可读）；Account API Tokens 无法创建超出父权限的子 token。DNS 记录改动必须由用户在 Dashboard 手动完成（.net 根域/www CNAME → aihospital-eq8.pages.dev 橙云，Pages 域几秒激活）。Pages domains POST 可用（Pages Write）。
  - **Pages Functions 反代平台侧失效**（多次部署+多域验证 /api/* 均返回 404.html，wrangler 编译上传日志正常、本地 functions build 正常，根因未明）。已改为前端直连：index.html/admin/index.html bootstrap 按 hostname 注入 `window.__API_ORIGIN__`（daqihospital.net → https://api.daqihospital.com），main.js API 常量、member.js、attachments.js API_BASE、admin.js api()/登录/img 全部拼接前缀；Worker CORS 已验证（OPTIONS 204 + Allow-Origin: *）。
  - Worker aihospital-api 兼管静态资产：wrangler.toml [assets] directory=../client/dist + not_found_handling=single-page-application + run_worker_first=["/api/*"]；assets 部署时一并上传（当前无流量入口，作冗余）。api.daqihospital.com 为 Workers Custom Domain（enabled:true，.com zone，CF 管理 DNS）。
  - Workers 免费日额度 10 万/天为**账号级共享**（账号内 16 个 Worker 分摊），耗尽返回 1027（workers.dev 纯文本/自定义域为 "temporarily rate limited" HTML 53KB，带 IE 条件注释易误判为旧站）；UTC 0（北京早 8 点）重置。用户已选等待重置。静态资产请求免费。
  - D1 aihospital c0f0b608-2ded-489b-a514-4a432eb66b68（APAC，165 条已导入，REST POST /accounts/{acc}/d1/database/{id}/query 逐条，`wrangler d1 execute --remote` 沙箱 fetch failed）；R2 aihospital-attachments；JWT_SECRET 已 wrangler secret put；seed-local.sql 含密钥已 gitignore。D1 exec 按行截断多行语句须按分号 batch；D1 本地不支持命名参数；datetime('now') 为 UTC 而 worker 用 nowSh() UTC+8。
  - 线上验证待额度重置后：api.daqihospital.com/api/status 应返回 JSON（智谱 GLM-4.5-Flash configured:true）、daqihospital.net 真实问诊、CORS 生效。沙箱实测可行 DoH：cloudflare-dns.com/dns-query。
