#!/usr/bin/env bash
# 大气AI医院 一键部署脚本（在目标服务器上执行）
# 用法：
#   REPO_URL=... APP_DIR=/opt/aihospital bash scripts/deploy-server.sh
# 首次部署会生成 .env（需填入 LLM Key / 后台密码后重跑本脚本）。

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/aihospital}"
REPO_URL="${REPO_URL:-https://github.com/talleylinjg-ops/AIhospital.git}"
BRANCH="${BRANCH:-main}"
HEALTH_PORT="${HEALTH_PORT:-3001}"

command -v docker >/dev/null || { echo "[deploy] 未检测到 docker，请先安装 Docker Engine"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "[deploy] 未检测到 docker compose 插件"; exit 1; }

echo "[deploy] 同步代码 -> ${APP_DIR} (${BRANCH})"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "FETCH_HEAD"
else
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "[deploy] 已生成 ${APP_DIR}/.env —— 请填写 USER_LLM_API_KEY 与 ADMIN_PASSWORD 后重新执行本脚本"
  exit 1
fi

echo "[deploy] 构建并启动容器"
docker compose up -d --build

echo "[deploy] 等待健康检查"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${HEALTH_PORT}/api/status" >/dev/null 2>&1; then
    echo "[deploy] 部署完成：API 健康 http://127.0.0.1:${HEALTH_PORT}/api/status"
    echo "[deploy] 管理后台：http://<服务器域名>:${HEALTH_PORT}/admin/"
    echo "[deploy] 数据文件：${APP_DIR}/data（容器卷 aihospital-data）"
    echo "[deploy] 下一步：在 Cloudflare Pages 环境变量 BACKEND_ORIGIN 填入本服务器对外地址并重新部署前端"
    exit 0
  fi
  sleep 2
done

echo "[deploy] 健康检查超时，查看日志：docker compose logs --tail 50"
exit 1
