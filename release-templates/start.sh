#!/usr/bin/env sh
# ============================================================
#  MCP Vision Server - macOS / Linux 启动（stdio 传输）
#  密钥只经环境变量注入，绝不写入本脚本。
# ============================================================

if [ -z "$AGNES_API_KEY" ]; then
  echo "[WARN] 未设置 AGNES_API_KEY：视觉工具将报告 provider 不可执行。"
  echo "       设置方法：  export AGNES_API_KEY=你的key"
  echo "       （也可配置在 MCP Host 的 env 里，见 README）"
fi

node "$(dirname "$0")/bin/mcp-vision-server.mjs" "$@"
