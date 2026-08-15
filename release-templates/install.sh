#!/usr/bin/env sh
# ============================================================
#  lucida-vision-mcp - macOS / Linux 环境检查
#  原则：只检测，绝不覆盖你电脑上已有的任何环境。
#  没有 Node.js 时给出对应系统的安装命令。
# ============================================================

if command -v node >/dev/null 2>&1; then
  echo "[OK] 已检测到 Node.js $(node --version)（不覆盖）"
  echo "[OK] 你的环境已就绪，接下来："
  echo "     1. 设置密钥：  export AGNES_API_KEY=你的key"
  echo "     2. 启动服务：  ./start.sh"
  echo "     3. 接入 MCP Host：见 README.zh.md 或 README.en.md"
  exit 0
fi

echo "[INFO] 未检测到 Node.js，请按你的系统安装（任选其一）："
echo "  macOS (Homebrew):  brew install node"
echo "  Debian/Ubuntu:     sudo apt-get install -y nodejs npm"
echo "  Fedora/RHEL:       sudo dnf install -y nodejs npm"
echo "  或官方安装包:      https://nodejs.org/"
echo "安装完成后重新打开终端，再运行本脚本确认。"
exit 1
