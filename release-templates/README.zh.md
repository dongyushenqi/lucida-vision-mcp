# lucida-vision-mcp（发布包）

**Lucida**（拉丁语：明亮）—— 清澈地看见。

通用视觉感知基础设施——"眼睛不是大脑"：只陈述视觉事实，不做诊断、不替你做决策。

## 项目定位（诚实声明）

**开发目的**：为不具备原生识图能力的 AI 提供标准化的"视觉感知器官"——通过标准
MCP 协议把图像交给可验证的视觉模型，返回带来源记录（谁、什么模型、何时看的）
的视觉证据，让"看"这个过程可审计、可验证、不撒谎。

**诚实的边界**：
1. 识别质量的上限 = 所接视觉模型；同等条件下，**达不到自带识图 AI**（如 GPT-4o / Claude 原生多模态）直接看图的水平；
2. 不同于简单 skill：本系统是协议级基础设施（标准 MCP 协议、领域模型、能力探针、审计、幂等、安全边界）；
3. **轻量生产级**：可投入个人/小团队生产使用；不含企业级能力（多租户认证、限流、数据清理、分布式）；
4. 精细识别取决于所接模型，能力经探针验证后如实披露；**本系统不预设默认模型**——用哪个模型由你的接入决定；

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
2. **配置视觉模型 Key**（只经环境变量，绝不写入文件；二选一）：
   - **标准方式**（任意 OpenAI 兼容模型）：在 MCP Host 配置的 `env` 里设
     `VISION_PROVIDERS_JSON`（JSON 数组，字段：providerId / apiKey / baseUrl /
     model / displayName；示例见仓库 README）
   - **快捷方式**（如 Agnes 免费模型）：`set AGNES_API_KEY=你的key`
   （系统不预设默认模型，用哪个由你的配置决定）
3. **接入 MCP Host**（如 Claude Desktop）：
   - 打开 Host 的 MCP 配置文件，参照 `config/claude-desktop.example.json`，
     `args` 里的路径改成你解压后的实际路径（`...\bin\lucida-vision-mcp.mjs`）
   - 重启 Host，即可看到 `vision.*` 系列工具

也可以先直接跑 `start.cmd` 验证服务能启动。

## 三步安装（macOS / Linux）

1. **检查环境**：终端运行 `./install.sh`（没有 Node 时按提示安装）
2. **配置视觉模型 Key**（二选一，同 Windows 第 2 步）：
   - 标准方式：`env` 里设 `VISION_PROVIDERS_JSON`（任意 OpenAI 兼容模型）
   - 快捷方式：`export AGNES_API_KEY=你的key`（如 Agnes 免费模型）
3. **接入 MCP Host**：同 Windows 第 3 步，`command: "node"`，`args` 指向
   `.../bin/lucida-vision-mcp.mjs`

## 多厂商支持（模型独立）

任何 OpenAI 兼容视觉模型（千问/豆包/GPT/Agnes 等）都可用，无需改代码，
通过环境变量 `VISION_PROVIDERS_JSON` 配置（JSON 数组，字段：
providerId / apiKey / baseUrl / model / displayName）。详见仓库 docs/PROVIDERS.md。

## 密钥安全

所有密钥只经环境变量注入；本包不包含、不读取、不写入任何密钥文件。
