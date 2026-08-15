@echo off
rem ============================================================
rem  MCP Vision Server - Windows 启动（stdio 传输）
rem  密钥只经环境变量注入，绝不写入本脚本。
rem ============================================================
setlocal
chcp 65001 >nul

if "%AGNES_API_KEY%"=="" (
  echo [WARN] 未设置 AGNES_API_KEY：视觉工具将报告 provider 不可执行。
  echo        设置方法：  set AGNES_API_KEY=你的key
  echo        （也可配置在 MCP Host 的 env 里，见 README）
)
node "%~dp0bin\mcp-vision-server.mjs" %*
