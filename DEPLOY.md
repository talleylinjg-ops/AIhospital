# 大气AI医院 上线部署手册

## 架构

```
用户浏览器
   │
   ├── Cloudflare Pages（前端静态站 + Pages Functions）
   │     └─ functions/api/[[path]].js 把 /api/* 反代到 BACKEND_ORIGIN
   │
   └── /api/* ──► 独立服务器：Docker 容器（Express + better-sqlite3）
                      ├─ 托管 /admin 管理后台
                      └─ 数据卷 aihospital-data（SQLite：data/consultations.db）
```

前端已部署于 Cloudflare Pages 项目 `aihospital`（生产域名 https://aihospital-eq8.pages.dev/）。
后端需要一台公网可访问的服务器，由用户自行提供。

## 一、服务器要求

- 1 核 2GB 起步（LLM 并发默认 8，内存富余更稳）
- 已安装 Docker Engine 与 docker compose 插件
- 出网可访问所选 LLM 厂商 API（如 api.deepseek.com）
- 公网入站开放 80/443（或自定义端口）

## 二、一键部署后端

在服务器上执行：

```bash
bash scripts/deploy-server.sh
```

脚本行为：拉取 main 分支代码 → 首次运行生成 `.env`（退出并提示填写）→ `docker compose up -d --build` → 健康检查 `/api/status`。

首次部署流程：

```bash
bash scripts/deploy-server.sh
vi /opt/aihospital/.env        # 填 USER_LLM_API_KEY 与 ADMIN_PASSWORD（必改强密码）
bash scripts/deploy-server.sh  # 重跑完成启动
```

模型也可不写在 .env，启动后登录 `/admin/` 后台逐个配置（推荐，支持多模型路由与场景分组）。

## 三、对外暴露（二选一）

1. **Cloudflare 代理（推荐）**：服务器 IP 用 A 记录接入 Cloudflare（橙云开启），自动获得 HTTPS 与基础防护；回调与反代地址即 `https://api.<你的域名>`。
2. **自签证书/直连**：开放 3001 端口 + 自备反代（Caddy/Nginx）签发证书。

## 四、接入 Cloudflare Pages

```bash
# Pages 项目环境变量（wrangler.toml [vars] 或 Dashboard → Settings → Environment variables）
BACKEND_ORIGIN=https://api.<你的域名>
```

设置后重新执行 Pages 部署，前端 `/api/*` 即反代到后端。验证：

```bash
curl https://aihospital-eq8.pages.dev/api/status
curl https://aihospital-eq8.pages.dev/api/services
```

## 五、上线检查清单

- [ ] `ADMIN_PASSWORD` 已改为强密码，并用新密码登录 `/admin/` 验证
- [ ] `/admin/` 后台已配置 LLM 模型（场景分组：快诊/门诊/急诊/保健/妇幼 + 复用组）
- [ ] 首页通道卡显示正常；提交一次问诊走通（正式推理，非 demo）
- [ ] 会员注册/登录、余额充值记录、消费记录可用
- [ ] 支付：在后台填入支付宝/微信商户参数；回调地址指向 `https://api.<你的域名>/api/pay/notify/*`（以支付模块实际路径为准），并用 1 分钱订单端到端验证
- [ ] 定时备份：`0 3 * * * sqlite3 /opt/aihospital/data/consultations.db ".backup /opt/backup/db-$(date +\%F).db"`（或直接 cp，建议停写窗口内执行）
- [ ] `.env` 权限 600，且不入库（已在 .gitignore）
- [ ] HTTPS 证书生效，`curl -I https://api.<你的域名>/api/status` 返回 200

## 六、升级与回滚

```bash
# 升级（数据卷持久化，不丢数据）
bash scripts/deploy-server.sh

# 回滚到指定提交
cd /opt/aihospital && git fetch --depth 1 origin <commit> && git reset --hard FETCH_HEAD
docker compose up -d --build
```

## 七、常见问题

| 现象 | 排查 |
| ---- | ---- |
| Pages 上 /api 全部"服务暂时不可用" | BACKEND_ORIGIN 未设置或后端未启动；`docker compose logs --tail 50` |
| 问诊返回"模型未配置" | 登录 /admin 配置模型，或 .env 填 USER_LLM_API_KEY |
| 支付下单成功但未开通 | 回调地址不可达或签名校验失败；查容器日志中 pay/notify 记录 |
| 数据库写失败 | 检查数据卷权限与磁盘空间 |

## 八、沙箱内完整演示环境

开发沙箱内已用单进程模式跑通整站（前端构建产物 + /api + /admin 同端口 5173）：

```bash
PORT=5173 node server/index.js
```

预览地址：https://5173-e4fe61b5d236b680.monkeycode-ai.online/（含服务列表、会员、后台、问诊全流程；与 Pages 静态站共享同一套代码与验收标准）。
