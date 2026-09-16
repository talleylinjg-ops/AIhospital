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
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[Project Knowledge Summary]
- Date: 2026-08-26
- Context: Discovered by Agent while running AI 医院 web project preview
- Category: Operations & Deployment / Environment Configuration
- Instructions:
  - 本项目启动方式：`./start.sh`（或分别 `node server/index.js` 后端 3001 + `npm run dev -w client` 前端 Vite 5173）；预览端口为 5173，前端 `/api` 反向代理到 3001。
  - 管理后台入口 `/admin`（独立页面），管理 API 在 `/api/admin/*`，问诊数据存 SQLite `/workspace/data/consultations.db`。
  - 后台为账号+密码登录（SQLite admin_users 表，scrypt 哈希）。首次启动自动创建默认账号 admin / ADMIN_PASSWORD（.env，当前 admin123456）。账号密码可在后台「系统设置」中修改；删除 data 目录会重置为 .env 默认密码。
  - 后台 CSS 有 `[hidden]{display:none!important}` 全局规则：任何带 hidden 属性的视图容器，其 class 不得再声明 display 覆盖，否则视图叠加显示（曾导致"登录成功但登录框仍在"的故障）。
  - admin 三件套位于 client/public/admin/，前端引用带版本参数（?v=日期字母），每次改动需同步更新 index.html 中的版本号以绕过浏览器/代理缓存。
  - 本环境的后台终端（background terminal）会被平台周期性回收（约数小时），导致 Web 服务中断、预览返回 530「目标端口未监听」。这不是代码故障。
  - 服务中断后的恢复方式：在会话中重新用 background_terminal 启动两个服务即可，无需改动代码；创建后台终端时 timeout 参数设为 0（不限时）以排除超时被杀的可能。
  - 平台禁止使用定时器/保活工具规避环境进程回收机制，不要提供此类方案。
  - 项目为前后端分离 Node.js 应用，如需 7x24 稳定对外服务应部署到正式服务器（`npm run build` + `npm start` 单进程模式），而非开发沙箱。

[Project Knowledge Summary]
- Date: 2026-08-29
- Context: Discovered by Agent while implementing guest purchase flow and LLM provider management
- Category: Operations & Deployment / Build Methods / Testing Methods
- Instructions:
  - 大模型配置存 SQLite llm_providers 表，后台「系统设置」按分类分组管理，支持增改删/启用/连接测试/备注。LLM_PRESETS 预置 19 条（国内通用 6 / 海外通用 5 / 国内垂直 6 / 海外垂直 2），initLLMProviders 幂等补种（按 name 查重），老库自动获得新预置；DeepSeek 预置已更名为 DeepSeek-R1（deepseek-reasoner）。api_key 不回传明文（has_key/key_masked）。医联 MedGPT/MedSeek/小荷/联影/Med-PaLM2/Med-Gemini 无公开 API（base_url 留空），启用前需填 Key 与地址。2026-09-03 场景词汇已从 general/complex/maternal 迁移为 fast/clinic/emergency/wellness/maternal 五通道。
  - 前台访客购买：GET /api/services（公开）+ POST /api/purchase（无鉴权，自动建档，订单 status=待付款 source=前台下单）；后台购买记录含来源列（前台下单/后台登记）。
  - jsdom E2E 脚本在 /tmp/opencode/admin-e2e.mjs：自动复制 admin.js 到 /tmp/opencode/admin/（Node ESM file:// 相对解析需要等价目录结构）；mock fetch 需覆盖全部 admin API（新加路由要同步补 mock）。
  - 后台弹窗是动态创建的 .modal-mask（无固定 id），E2E 用 .modal-mask .modal-body 选取；openModal 返回 mask，闭包内用 mask.querySelector(".modal-body") 与 mask.remove()。
  - 验证用例：admin/admin123456 登录；订单金额=单价×数量（99×2=198）；LLM 配置测试连接会真实发请求（example.com 返回 HTTP 405 属预期）。

[Project Knowledge Summary]
- Date: 2026-09-03
- Context: Discovered by Agent while binding home four tabs to per-channel model groups (replacing old clinical-scene vocabulary)
- Category: Operations & Deployment / Troubleshooting & Debugging
- Instructions:
  - 多模型共用机制（用户选定方案：首页四通道各配一组主备模型）：llm_providers 表有 scenes 与 priority（小者为主）列，启用/停用为 toggle（多选共存）。
  - 通道路由词汇（2026-09-03 由 general/complex 迁移，2026-09-04 增补 L5，2026-09-06 增补 L6-L8 并调整顺序）：fast 快诊 / clinic 门诊 / emergency 急诊 / maternal 妇幼 / wellness 保健，逗号分隔。就诊通道→路由场景：L1=fast、L2=clinic、L3=emergency、L4=wellness、L5=maternal、L6=wellness（中医复用保健组）、L7=clinic、L8=clinic（眼科/口腔复用门诊组）。首页卡片与头部导航顺序即 LEVEL_META/LEVELS 对象键序 L1,L2,L3,L4,L5,L6,L7,L8（日常保健在妇幼之前，2026-09-06 调整；妇幼显示名改为"妇幼保健"）。
  - L5 妇幼 / L6 中医 / L7 眼科 / L8 口腔为专项通道（2026-09-04/09-06 新增）：妇幼由"按病例自动拦截"改为用户主动选择的显式通道，resolveScene 不再因 age<14 或 female_special 含孕/哺乳而强制跳 maternal；仅 level=L5 恒定返回 maternal 且不参与 multi/rare 升级，L6-L8 与 L1/L2/L4 一样受 multi_disease（"是"开头）与 rare_disease_history（非无/非不适用）升级到 emergency 的规则约束。专项通道必填集定义在 form-config.js 的 EXTRA_REQUIRED（L5 七项：+female_special；L6-L8 各六项：gender/age/is_emergency/chief_complaint/symptom_onset/symptom_severity），不逐字段改 requiredBy。
  - 前端展示要点：首页模型芯片经 CHANNEL_SCENE + SHARED_GROUP（main.js）读取 /api/status scene_models——自持场景通道显示"{tag}模型：主+备用"，复用组通道显示"{tag}通道（{组}模型组承接）· 主模型"，未启用统一兜底文案；结果页通道徽标改用 LEVEL_META[state.level].tag（而非 route.scene_label），保证中医/眼科/口腔显示本通道名而非保健/门诊。
  - 头部导航（2026-09-06 改为单行）：.nav-level-btn 文案前 4 个用 NAV_SHORT 的 4 字名称（轻微快诊/中等症状/危重症/日常保健，L3 急诊按钮取"危重症"短称），后 4 个显示 LEVEL_META.tag（妇幼/中医/眼科/口腔），悬停 title 才放全名；header-inner/header-right 用 flex nowrap，.nav-levels 内部 overflow-x:auto 横向滚动（隐藏滚动条）保证品牌标题与导航恒在同一行不换行；@media ≤900px 隐藏 .nav-services"服务购买"（放不下即删除入口，通道跳转不受影响）。
  - 通道降级兜底：某场景无专属启用模型时不再报错，callLLM 改用 listAllEnabledProviderRows（全部已启用）兜底，route.degraded=true 标记；前台结果页展示"该通道未专属配置，已用可用模型兜底"。
  - 智谱 GLM（id=4，fast 通道主模型，glm-4-flash，用户自填 Key 存 SQLite）当前唯一启用模型；其余预置 base_url 有值但未填 Key，启用需先填 Key。clinic/emergency/wellness/maternal 暂无专属启用模型，命中时走全局兜底（degraded）。
  - llm.js 主备链：callLLM 按场景取 listProviderRowsForScene（含 api_key 原始行）按 priority 升序，主失败切备用，全失败 502；callLLMWithProvider 供手动对比；公开 GET /api/providers + POST /api/compare。listProvidersForScene 返回脱敏行不能用（api_key 为空），必须用 listProviderRowsForScene 给 LLM 调用层。
  - 预置 19 条关键分配：fast=智谱(5)主/晓医(7)/豆包(14)；clinic=DeepSeek-R1(8)主/通义(12)/Kimi(24)/GPT-4o(20)；emergency=GPT-o1(3)主/Claude(6)/DeepSeek(8)/GPT-4o(20)；wellness=通义(12)主/豆包(14)/文心(16)/Gemini(26)；maternal=晓医(7)主/百川(30)。数字为 priority。
  - E2E mock：llm-providers 需含 scenes/scene_labels/priority，/api/status 需含 scene_models（五通道 fast/clinic/emergency/wellness/maternal）；admin-e2e 断言含通道徽章、启用/停用、弹窗场景多选。
  - 旧词汇迁移（initLLMProviders 启动时执行）：预置行按 LLM_PRESETS 同步 scenes/priority；用户自定义行 general→fast,clinic,wellness、complex→emergency。当前线上 DB 重启后端即自动完成迁移。

[Project Knowledge Summary]
- Date: 2026-09-08
- Context: Discovered by Agent while implementing member center (会员中心) with account/password, wallet recharge, health records and auto-prefill of consult form
- Category: Operations & Deployment / Build Methods / Testing Methods / Troubleshooting & Debugging
- Instructions:
  - 会员= customers 表启用账号：password_hash（scrypt）/balance/profile(JSON) 由迁移 ALTER 补齐，均为默认空；表新加 wallet_ledger（kind 充值/消费，amount 有符号，含 balance_after）。对外 SELECT 一律显式列名剔除 password_hash（customerStmt/listCustomersStmt/customerByPhoneStmt 等），只有 customerAuthStmt 取含 hash 整行且仅供密码校验；listCustomersStmt 通过 (password_hash<>'') 输出 is_member 供后台标识会员。
  - 会员 API 在 server/member.js（mount /api/member，内存 Map token，7 天过期，无持久化重启失效属可接受）：/register /login /logout /me /account(改资料需验证当前密码) /password /health GET/PUT /recharge(模拟支付实时到账) /pay(余额付，免费档 amount0 直接已付款不扣款) /wallet /consults(/consults/:id 限定本人) /orders。鉴权与 admin 类似 Authorization Bearer；resolveMemberByToken 供 /api/consult 落库绑定 customer_id（登录态问诊自动挂会员）。
  - 健康档案=profile JSON，字段 key 与问诊表单 FIELDS 的 id 完全一致（既往/基础/生活类 18 项，不含现病史主诉等），member.js 前端「健康档案」页可编辑，打开问诊表单时自动带入预填（prefillFormFromProfile + name/phone 从账号带出）；若需扩展档案字段要同时改 db.js HEALTH_KEYS 与前端 PROFILE_GROUPS/PROFILE_IDS 两处白名单。
  - 前端会员逻辑集中在 client/src/member.js（localStorage: mh_token/mh_member；memberApi 统一带 Bearer，401 自动清登录态跳 #/login）。会员中心路由 #/member(/profile|records|orders|account)，登录页 #/login；概览/账号设置等依赖多个 /api/member 接口。
  - 服务购买支持登录会员余额支付：openBuyDialog 里 memberValid 时余额足够默认"余额支付"，不足自动切线下并提示去充值；memberApi('/pay') 走余额，否则 POST /api/purchase（游客/线下，免费档服务器自动置已付款，无需收款）。首页卡片免费档（基础会员）显示"免费 + 免费开通"。
  - 小屏(≤900px)隐藏"服务购买"但保留会员入口：CSS 媒体查询用 .nav-services:not(.nav-member):not(.nav-auth)，避免登录/会员中心一起被藏。
  - E2E：/tmp/opencode/member-e2e.mjs 走真实后端 3001 注册临时手机号→健康档案→会员中心各 tab→表单预填断言（注册前清 mh_token 影响：member 模块 try/catch localStorage，无 DOM 时静默返回空，回归脚本不受影响）。

[Project Knowledge Summary]
- Date: 2026-09-10
- Context: Discovered by Agent while implementing medical document upload (attachment) across consult form, service purchase and member center
- Category: Operations & Deployment / Build Methods / Testing Methods / Troubleshooting & Debugging
- Instructions:
  - 附件子系统：attachments 表（kind 病历卡/检验单/报告单/影像胶片/处方/其他，label/mime/size，stored 相对 data/ 的路径，consult_id/purchase_id/customer_id 三选一归属）；文件落盘 data/uploads/yyyyMMdd/<rand>.<ext>，DB 只存相对路径。旧库重启自动建表建索引，无需手工迁移。
  - 上传接口（server/uploads.js，挂 /api）：POST /api/consult/:id/attachments、/api/purchase/:id/attachments、/api/member/documents（会员鉴权）；GET 列表同名；GET /api/attachments/:id/file 直接输出图片/PDF；DELETE /api/member/documents/:id（仅材料库且限本人）、DELETE /api/admin/attachments/:id（后台任意删并清磁盘）。请求体是顶层 JSON { kind, label, mime, data(base64) }，不是 multipart，因此无 multer 依赖；express.json limit 已提到 18mb，单文件≤6MB，仅允许 png/jpg/webp/gif/pdf。
  - 服务项目新增 needs_doc 列（迁移补齐 + 按名称幂等给「AI 慢病管理月度套餐」「体检报告解读」置 1）；/api/services 返回 needs_doc，前台购买成功面板据此显示材料上传区；后台「服务项目」编辑表单有「需要客户上传病历/报告材料」勾选，列表显示「需上传材料」徽标。
  - 前端共享组件在 client/src/attachments.js：mountUploader(容器,{target:'consult'|'purchase'|'member',id,list,deletable,kind,hint}) 选择文件即上传并刷新；loadAttachments/uploadAttachments/docCardHtml/fileUrl。注意 attachments.js 与 member.js 互相 import（前者取 getToken，后者用 mountUploader），仅函数运行期调用，无 TDZ 问题。
  - 三处入口：问诊表单顶部「病历/检验/报告上传（选填）」（先暂存 consultFiles，提交拿到 recordId 后统一归档，失败时结果页给 attachWarn 并可补传）；服务购买成功面板（慢病/体检）；会员中心健康档案页材料库（可删）+ 医疗记录详情附件区。结果页「本记录附件」块可查看与继续补传。
  - 后台会员档案弹窗新增「上传材料」区（/api/admin/customers/:id 现在返回 documents 聚合：本人材料库 + 其问诊与订单附件），可查看/删除。
  - 测试：jsdom harness 需补 globalThis.File/FileReader = window.File/FileReader，否则 FileReader is not defined 导致上传失败；main-e2e 已覆盖真实 base64 上传（mock /api/consult/:id/attachments），member-e2e 覆盖真实后端材料库上传。

[Project Knowledge Summary]
- Date: 2026-09-11
- Context: Discovered by Agent while integrating real Alipay / WeChat merchant payment framework for member balance recharge
- Category: Operations & Deployment / Build Methods / Testing Methods / Troubleshooting & Debugging
- Instructions:
  - 支付为真实商户框架，密钥只存 SQLite settings 表（键名 pay_alipay_* / pay_wechat_* / pay_notify_base_url）。后台读取时密钥字段回空、只回 has_* 布尔（SECRET_PAY_KEYS）；保存时密钥字段留空表示保持原值不变。禁止把密钥写入代码或聊天。
  - server/pay.js：支付宝 RSA2 签名/验签（normalizePem 兼容 PKCS8 私钥与纯 base64；公钥需显式传 type "PUBLIC"，勿用字符串替换 PRIVATE→PUBLIC）、alipay.trade.precreate 出 qr_code、parseAlipayNotify 校验 app_id/签名/trade_status；微信 APIv3 Native 下单与通知解密（AES-256-GCM，APIv3 密钥须 32 位）、verifyWechatNotify 用平台证书验签。paymentStatus() 判断渠道是否可用（启用 + 关键字段齐全）。
  - 回调入口 server/payroutes.js（挂 /api/pay）：GET /status 公开；POST /notify/alipay（urlencoded，验签+金额核对后到账，返回纯文本 success/failure）；POST /notify/wechat（JSON，签名校验+解密，返回 {code:SUCCESS}）。回调通过 findPayTarget(out_trade_no) 同时支持充值单（recharge_orders）与服务订单（purchases），分别走 confirmRechargeOrder / confirmPurchasePayment。微信验签需要原始 body，index.js 的 express.json 已加 verify 回调把原文存 req.rawBody；支付宝 urlencoded 解析挂在 /api/pay/notify/alipay。
  - 充值流程可退化为待支付单：member POST /recharge 在有可用渠道且已配置 pay_notify_base_url 时走统一下单（返回 orderId/channel/code），否则渠道未配置时退回演示环境模拟到账（mode:simulated）。订单落 recharge_orders 表（与 purchases 分离），到账统一走 db.confirmRechargeOrder（幂等：已付款直接返回，否则更新状态+加余额+wallet_ledger 记「充值」），回调与后台人工确认共用该入口。
  - 后台新增视图「支付设置」「充值单」：GET/PUT /api/admin/pay-settings、GET /api/admin/recharge-orders?status=、POST /api/admin/recharge-orders/:id/confirm。admin/index.html 资源版本已 bump 到 v=20260910b。
  - 前端会员充值（client/src/member.js）用 qrcode 依赖（client workspace 本地安装，vite 走 browser 入口，import QRCode from "qrcode" 后 QRCode.toCanvas）渲染二维码并每 3 秒轮询 /api/member/recharge/:id/status 自动到账；无渠道时提示模拟支付。
  - 服务订单在线直付（2026-09-11 增补，满足「直接支付」）：purchases 表加 out_trade_no/pay_channel/pay_qr 列（迁移 + 局部唯一索引 WHERE out_trade_no<>''）；server/purchasepay.js 挂 /api，POST /api/purchase/:id/pay（会员 token 或下单手机号授权，校验订单归属/未支付/金额）与 GET /api/purchase/:id/pay-status。发起支付复用未支付同渠道的收款码（reused），到账走 db.confirmPurchasePayment（幂等，不改余额、不记 wallet_ledger）。前台购买弹窗（client/src/main.js openBuyDialog）按 /api/pay/status 动态渲染「余额支付 / 支付宝 / 微信 / 客服线下」选项，在线支付先 POST /api/purchase 建单再取二维码轮询；main.js 也已 import qrcode。
  - 回调公网可达性限制：沙箱内无公网回调地址，真实支付回调只能在正式部署（独立静态站托管）后填真实参数验证；本地可用 gateway 指向本地假网关 + 自签密钥签名回调来做离线端到端验证（见 /tmp/opencode/pay-e2e.mjs 与 /tmp/opencode/purchase-pay-e2e.mjs）。会员测试账号 13800001234 当前密码为 newpass888。

[Project Knowledge Summary]
- Date: 2026-09-13
- Context: Discovered by Agent while adding SEO/GEO assets and preparing Cloudflare Pages deployment
- Category: Operations & Deployment / Build Methods / Environment Configuration
- Instructions:
  - 生产域名确定为 aihospital.com；部署形态为 Cloudflare Pages 托管前端静态站 + 独立服务器跑 Express+SQLite 后端。wrangler.toml 中 pages_build_output_dir=client/dist，Pages 环境变量 BACKEND_ORIGIN 指向后端域名（默认示例 https://api.aihospital.com）；functions/api/[[path]].js 把 /api/* 反向代理到 BACKEND_ORIGIN，前端保持同源相对路径；支付回调域名应直接指向后端域名而非 Pages。
  - 部署步骤：`npm run build --workspace client` 后 `npx wrangler pages deploy --project-name aihospital`（需 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID）。前端为 hash 路由，无需 _redirects SPA 回退。
  - SEO/GEO 资源位于 client/public，构建后落到 dist 根：robots.txt（放行 GPTBot/ClaudeBot/PerplexityBot 等）、sitemap.xml、llms.txt、_headers（安全与缓存）、og-cover.png（1200x630，用 /tmp/opencode/make-og.mjs 纯 Node 生成，环境无 ImageMagick/Chromium）。canonical、OG/Twitter、JSON-LD（MedicalClinic/WebSite/WebPage/FAQPage）内联在 client/index.html；首页另有 GEO 介绍与 FAQ 文案。域名或文案变更需同步这四处。
  - 数据库由 server/db.js 在 data/consultations.db 自动建表（含旧库迁移），.gitignore 已忽略 data/ 与 *.db，禁止提交数据库文件（含密钥与患者数据）。admin 资源版本已 bump 到 v=20260913a。
  - 仓库此前无 remote，需用户提供仓库地址与访问令牌后再推送；提交前用 `git status --porcelain --untracked-files=all` 核对，确保 server/hospital.db、data/ 等不入库。

[Project Knowledge Summary]
- Date: 2026-09-16
- Context: Discovered by Agent while pushing to GitHub and deploying the frontend to Cloudflare Pages
- Category: Operations & Deployment / Environment Configuration / Workflow & Collaboration
- Instructions:
  - GitHub 仓库：https://github.com/talleylinjg-ops/AIhospital ，主分支为 `main`（本地已从 master 改名并跟踪 origin/main）。推送使用一次性凭据，不写入 .git/config：`git -c credential.helper='!f() { printf "username=%s\npassword=%s\n" <user> "$GH_PAT"; }; f' push origin main`。平台自带 git-credential-helper 对 github.com 返回空，不要依赖它。
  - Cloudflare：Pages 项目名 `aihospital`，账户 `Daqi Account`（account id 2e33f078edc00ade4b25e61526d6f544），生产分支 `main`，线上地址 https://aihospital-eq8.pages.dev 。部署命令：`wrangler pages project create aihospital --production-branch main` 与 `wrangler pages deploy client/dist --project-name aihospital --branch main`（需 CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID）。Pages 的 `[vars] BACKEND_ORIGIN` 从 wrangler.toml 读取并自动生效。
  - 沙箱出网限制：可以访问 api.cloudflare.com（wrangler 正常），但无法访问 *.pages.dev，验证部署请改用 Cloudflare API（`/accounts/{id}/pages/projects/aihospital/deployments`）而非 curl 站点。
  - 自动部署工作流已准备在 `.github/workflows/deploy-pages.yml`（push main 或手动触发即构建部署，未配置 Secrets 时跳过而非失败）。当前 PAT 只有 `repo` 作用域，GitHub 拒绝推送 workflow 文件；需换成含 `workflow` 作用域的令牌，或直接在 GitHub 网页端创建该文件。仓库还需在 Settings→Secrets→Actions 配置 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID 才会真正自动部署。
  - 后端仍是 Express+SQLite，需另有一台公网服务器并把 Pages 的 BACKEND_ORIGIN 指向它，否则线上 /api 不可用（前端可正常打开）。
