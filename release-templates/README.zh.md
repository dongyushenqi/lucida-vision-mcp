# lucida-vision-mcp（发布包）

给纯文本 AI 的一双眼睛：通用视觉感知 MCP 服务器。只陈述可核验的视觉事实，不做诊断、不给建议。

**eyes, not brain** — 本包是编译好的成品（单文件程序 + 引导脚本 + 配置模板），解压即用。

## 它能干什么

- 通过标准 MCP 协议，让不具备识图能力的 AI 获得视觉感知：看图、提取文字、结构化检测；
- 任意 OpenAI 兼容视觉模型都可接入（通义千问、豆包、GPT、Agnes 等），**不预设默认模型**；
- 每次观察带溯源：哪个模型、什么版本、何时看的；能力先经探针实测再开放，模型做不到的如实报"不可执行"，绝不编造；
- 提供 10 个工具：`vision.observe`（观察）、`vision.summarize`（1~16 张图批量综合概述）、`vision.ocr`（文字提取）、`vision.detect`（结构化检测）、`vision.session.*`（会话与审计）、`vision.operation.*`（任务查询/取消）。

## 能力与边界

- **上限 = 所接模型**：同一个模型直接看图的能力，永远不低于「模型 + 本系统」的组合——本系统不"加戏"、不"变强"，只是让"看"可审计、可溯源、不撒谎；
- **聚焦主体**：默认描述图片主题要素，忽略水印与细小标识；需要文字时请用 `vision.ocr`；
- **识别 ≠ 深入分析**：识别图像类型（票据/设计图/涂鸦等）是默认观察的天然能力；深入分析仅在用户明确要求"更专业/更深入"时进行；
- **不推断**：观察不到的不编造，不确定的会标明；主观评价默认不主动输出，用户明确要求时基于可观察特征给出；
- **定位**：个人与小团队可用的轻量生产级；不含多租户、限流、分布式等企业能力。

## 三步安装（Windows）

1. **检查环境**：双击 `install.cmd`
   - 已有 Node.js → 直接继续（不覆盖你的任何环境）
   - 没有 → 脚本自动用 winget 安装（装不上会给官网链接）
2. **配置视觉模型 Key**（只经环境变量，绝不写入文件；二选一）：
   - **标准方式**（任意 OpenAI 兼容模型）：在 MCP Host 配置的 `env` 里设 `VISION_PROVIDERS_JSON`（JSON 数组，字段：providerId / apiKey / baseUrl / model / displayName；示例见仓库 README）
   - **快捷方式**（如 Agnes 免费模型）：`set AGNES_API_KEY=你的key`
3. **接入 MCP Host**（如 Claude Desktop）：
   - 打开 Host 的 MCP 配置文件，参照 `config/claude-desktop.example.json`，`args` 里的路径改成你解压后的实际路径（`...\bin\lucida-vision-mcp.mjs`）
   - 重启 Host，即可看到 `vision.*` 系列工具

也可以先直接跑 `start.cmd` 验证服务能启动。

## 三步安装（macOS / Linux）

1. **检查环境**：终端运行 `./install.sh`（没有 Node 时按提示安装）
2. **配置视觉模型 Key**（二选一，同 Windows 第 2 步）：标准方式设 `VISION_PROVIDERS_JSON`；快捷方式 `export AGNES_API_KEY=你的key`
3. **接入 MCP Host**：同 Windows 第 3 步，`command: "node"`，`args` 指向 `.../bin/lucida-vision-mcp.mjs`

## 密钥安全

所有密钥只经环境变量注入；本包不包含、不读取、不写入任何密钥文件。

## 更多

完整文档（配置示例、环境变量表、平台支持）：https://github.com/dongyushenqi/lucida-vision-mcp
