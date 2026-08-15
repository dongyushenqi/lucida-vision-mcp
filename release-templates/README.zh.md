# MCP Vision Server（发布包）

通用视觉感知基础设施——"眼睛不是大脑"：只陈述视觉事实，不做诊断、不替你做决策。

## 平台支持声明（重要）

| 平台 | 状态 |
|---|---|
| **Windows** | ✅ 完整支持：本地实测 + 自动测试（CI） |
| **macOS** | ✅ 可用：代码与引导脚本已适配，经 CI 自动测试验证；**未经本地人工实测**（开发环境为 Windows） |
| **Linux** | ✅ 可用：代码与引导脚本已适配，经 CI 自动测试验证；**未经本地人工实测**（开发环境为 Windows） |

macOS/Linux 上如遇问题，欢迎反馈（附系统版本与报错信息）。

## 三步安装（Windows）

1. **检查环境**：双击 `install.cmd`
   - 已有 Node.js → 直接继续（不覆盖你的任何环境）
   - 没有 → 脚本自动用 winget 安装（装不上会给官网链接）
2. **设置密钥**（只经环境变量，绝不写入文件）：
   ```
   set AGNES_API_KEY=你的key
   ```
3. **接入 MCP Host**（如 Claude Desktop）：
   - 打开 Host 的 MCP 配置文件，参照 `config/claude-desktop.example.json`，
     `args` 里的路径改成你解压后的实际路径（`...\bin\mcp-vision-server.mjs`）
   - 重启 Host，即可看到 `vision.*` 系列工具

也可以先直接跑 `start.cmd` 验证服务能启动。

## 三步安装（macOS / Linux）

1. **检查环境**：终端运行 `./install.sh`（没有 Node 时按提示安装）
2. **设置密钥**：`export AGNES_API_KEY=你的key`
3. **接入 MCP Host**：同 Windows 第 3 步，`command: "node"`，`args` 指向
   `.../bin/mcp-vision-server.mjs`

## 多厂商支持（模型独立）

任何 OpenAI 兼容视觉模型（千问/豆包/GPT/Agnes 等）都可用，无需改代码，
通过环境变量 `VISION_PROVIDERS_JSON` 配置（JSON 数组，字段：
providerId / apiKey / baseUrl / model / displayName）。详见仓库 docs/PROVIDERS.md。

## 密钥安全

所有密钥只经环境变量注入；本包不包含、不读取、不写入任何密钥文件。
