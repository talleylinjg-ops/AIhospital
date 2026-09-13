#!/bin/bash
# AI 医院启动脚本：同时启动后端(3001)与前端(5173)
# 首次运行请先: cp .env.example .env  并填入你的大模型 API Key

set -e

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "[ai-hospital] 未检测到 .env，已从 .env.example 生成（默认演示模式，填 Key 后生效）"
  cp .env.example .env
fi

if [ ! -d node_modules ]; then
  echo "[ai-hospital] 首次运行，安装依赖..."
  npm install
fi

npm run dev
