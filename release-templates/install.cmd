@echo off
rem ============================================================
rem  lucida-vision-mcp - Windows 环境检查/引导安装
rem  原则：只检测，绝不覆盖你电脑上已有的任何环境。
rem  没有 Node.js 时才尝试自动安装（winget 官方源），
rem  装不上则给出官网链接。
rem ============================================================
setlocal
chcp 65001 >nul

where node >nul 2>nul
if %errorlevel%==0 (
  for /f "delims=" %%v in ('node --version') do set NODE_VER=%%v
  echo [OK] 已检测到 Node.js %NODE_VER%（不覆盖）
  echo [OK] 你的环境已就绪，接下来：
  echo       1. 设置密钥：  set AGNES_API_KEY=你的key
  echo       2. 启动服务：  start.cmd
  echo       3. 接入 MCP Host：见 README.zh.md 或 README.en.md
  exit /b 0
)

echo [INFO] 未检测到 Node.js，尝试自动安装（winget，官方源）...
winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements >nul 2>nul
if %errorlevel%==0 (
  echo [OK] Node.js 安装完成。
  echo      请【重新打开】终端（让 PATH 生效），然后再次运行 install.cmd 确认。
) else (
  echo [WARN] 自动安装未成功。请手动安装 Node.js LTS：
  echo       官网下载: https://nodejs.org/
  echo       安装完成后重新打开终端，再运行 install.cmd。
)
exit /b 1
