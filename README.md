# lucida-vision-mcp

[English](#english) · [中文](#chinese)

---

<a id="english"></a>

# lucida-vision-mcp

A pair of eyes for text-only AI: a general-purpose visual perception MCP server. It states verifiable visual facts — never diagnoses, never advises.

> **eyes, not brain** — 只陈述可核验的视觉事实，不做诊断与决策。
>
> **Lucida** (Latin: bright) — to see clearly.

## What it is

Text-only models cannot see images. lucida-vision-mcp acts as their "visual organ" over the standard MCP protocol:

1. The AI calls a tool, handing an image (local path / URL / inline data) to this server;
2. The server sends it to **the vision model you configured** (any OpenAI-compatible API);
3. The AI gets back sourced visual evidence: which model, which version, when it looked, what it saw.

The capability ceiling is exactly the model you attach. What the model cannot do, the tools honestly report as "not executable" — never fabricated.

## The 8 tools

| Tool | What it does |
|---|---|
| `vision.session.create` / `.get` / `.delete` | Session management (authorization sandbox and isolation unit for observations) |
| `vision.observe` | General visual observation, returns evidence text; `json_mode=true` returns structured output (if verified for that model) |
| `vision.ocr` | Extracts text from the image |
| `vision.detect` | Structured detection for categories you declare, returns JSON bounding boxes (if verified for that model) |
| `vision.operation.get` / `.cancel` | Query and cancel in-flight tasks; committed evidence is never destroyed by cancellation |

## Quick start (npm)

Requires Node.js ≥ 24.

**Step 1**: merge this into your MCP host config (example: `claude_desktop_config.json` for Claude Desktop):

```json
{
  "mcpServers": {
    "vision": {
      "command": "npx",
      "args": ["-y", "lucida-vision-mcp"],
      "env": {
        "AGNES_API_KEY": "your vision model API key"
      }
    }
  }
}
```

> On Windows, if `npx` fails to start, use `"command": "cmd"` with `args` `["/c", "npx", "-y", "lucida-vision-mcp"]`.

**Step 2**: restart the MCP host. Then just ask the AI "take a look at this image" — it will call the tools.

You can also install globally and use the `lucida-vision-mcp` command directly: `npm install -g lucida-vision-mcp`.

> **Local images**: local paths work out of the box — pass `file:///C:/photos/a.png` and the image bytes never travel through the AI's context. Strict environments can remove `file` via `VISION_ALLOW_URI_SCHEMES=http,https`.

### Other install options

- **Release zip** (no environment setup): download `lucida-vision-mcp-vX.Y.Z.zip` from [Releases](https://github.com/dongyushenqi/lucida-vision-mcp/releases), unzip, run `install.cmd` (Windows) or `install.sh` (macOS / Linux). An MCP host config template and bilingual instructions are included.
- **Source** (developers): `pnpm install && pnpm build`.

## Configuring vision models (providers)

No model is preset — your configuration decides. Two ways:

**Shortcut** (single model) — set `AGNES_API_KEY`; it defaults to the free Agnes vision model. Point `AGNES_BASE_URL` / `AGNES_VISION_MODEL` at any OpenAI-compatible service.

**Standard** (multiple models) — set `VISION_PROVIDERS_JSON` (a JSON array, one entry per vendor). The Agent explicitly picks the executor via the `provider_id` argument; the server never auto-routes:

```json
[
  { "providerId": "qwen",   "apiKey": "<key>", "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "qwen-vl-max", "displayName": "Qwen" },
  { "providerId": "doubao", "apiKey": "<key>", "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",          "model": "doubao-1.5-vision-pro", "displayName": "Doubao" },
  { "providerId": "gpt",    "apiKey": "<key>", "baseUrl": "https://api.openai.com/v1",                        "model": "gpt-4o", "displayName": "GPT" }
]
```

Each provider's capabilities are verified by probes: once at boot, then re-verified every 24 hours. Capabilities a model does not support (e.g. structured detection on some models) are honestly reported as not executable.

Non-OpenAI-compatible protocols (Anthropic / Gemini native APIs, etc.) need one adapter class — see [docs/PROVIDERS.md](docs/PROVIDERS.md).

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `VISION_PROVIDERS_JSON` | — | Multi-provider configuration (JSON array) |
| `AGNES_API_KEY` | — | Single-model shortcut (backward-compatible entry) |
| `AGNES_BASE_URL` / `AGNES_VISION_MODEL` | Agnes defaults | Override the shortcut's endpoint and model |
| `VISION_PROBE_ON_BOOT` | `true` | Run capability probes at startup |
| `VISION_PROBE_INTERVAL_HOURS` | `24` | Probe re-verification interval (hours) |
| `VISION_ALLOWED_URI_ORIGINS` | empty | Allowlist of origins the server may fetch images from (comma-separated, SSRF protection) |
| `VISION_ALLOW_URI_SCHEMES` | `http,https,file` | URI scheme allowlist (comma-separated); `file` included by default for local images, removable for strict environments |
| `VISION_ALLOW_PRIVATE_ADDRESSES` | `false` | Allow private/loopback addresses (for serving images over local HTTP; SSRF protection stays on by default) |
| `VISION_MAX_INLINE_BYTES` | `10485760` | Maximum inline image size (bytes) |

## Capabilities and boundaries

- **Ceiling = the attached model.** Under equal conditions it does not reach native-multimodal AI (GPT-4o / Claude) looking at the image directly; this system never embellishes.
- **Never lies.** Capabilities open up only after probe verification; unverified ones are honestly reported as "not executable".
- **Auditable.** Every observation records model, version, and timestamp — immutably.
- **Positioning.** Lightweight production-grade for individuals and small teams (154 tests, 3-platform CI, error-code system, audit and security boundaries); enterprise features (multi-tenant, rate limiting, distributed deployment) are out of scope.

Full positioning statement, differences from skills and similar MCPs, architecture and package layout: [docs/OVERVIEW.md](docs/OVERVIEW.md).

## Security

- Server-side image fetching is guarded by SSRF protection plus an origin allowlist;
- API keys are injected via environment variables only — never written to disk, database, or git history;
- Cancellation never destroys committed evidence.

## Platform support

| Platform | Status |
|---|---|
| Windows | Fully supported: manually verified + automated CI |
| macOS / Linux | Available: code and scripts adapted, verified by automated CI (dev environment is Windows; no manual on-hardware testing) |

## Docs and development

- [docs/OVERVIEW.md](docs/OVERVIEW.md) — positioning, architecture, package layout, test status
- [docs/DECISIONS.md](docs/DECISIONS.md) — technical decision records
- [docs/PROVIDERS.md](docs/PROVIDERS.md) — guide for adding new providers

```bash
pnpm install
pnpm build
pnpm test    # 154 tests; real-API cases run when a key is present, auto-skip otherwise
```

## License

MIT

[切换到中文](#chinese)

---

<a id="chinese"></a>

# lucida-vision-mcp

给纯文本 AI 的一双眼睛：通用视觉感知 MCP 服务器。只陈述可核验的视觉事实，不做诊断、不给建议。

> **eyes, not brain** — states verifiable visual facts, never diagnoses or decides.
>
> **Lucida**（拉丁语：明亮）—— 清澈地看见。

## 它是什么

纯文本模型自己看不了图。lucida-vision-mcp 通过标准 MCP 协议充当它的"视觉器官"：

1. AI 发起工具调用，把图像（本地路径 / URL / 内联数据）交给本服务器；
2. 服务器调用**你配置的**视觉模型（任意 OpenAI 兼容接口）完成看图；
3. 返回带溯源的视觉证据：哪个模型、什么版本、何时看的、看到了什么。

能力上限就是你所接入的模型。模型做不到的，工具如实返回"不可执行"，绝不编造。

## 提供的 8 个工具

| 工具 | 作用 |
|---|---|
| `vision.session.create` / `.get` / `.delete` | 会话管理（观察的授权沙箱与隔离单位） |
| `vision.observe` | 通用视觉观察，返回视觉证据文本；`json_mode=true` 时返回结构化观察（需该模型验证通过） |
| `vision.ocr` | 提取图中的文字 |
| `vision.detect` | 按你声明的类别做结构化检测，返回 JSON 边界框（需该模型验证通过） |
| `vision.operation.get` / `.cancel` | 查询与取消执行中的任务；已提交的证据不会被取消销毁 |

## 快速开始（npm）

要求 Node.js ≥ 24。

**第 1 步**：把下面的片段并入 MCP Host 配置（以 Claude Desktop 的 `claude_desktop_config.json` 为例）：

```json
{
  "mcpServers": {
    "vision": {
      "command": "npx",
      "args": ["-y", "lucida-vision-mcp"],
      "env": {
        "AGNES_API_KEY": "你的视觉模型 API Key"
      }
    }
  }
}
```

> Windows 上如果 `npx` 启动失败，把 `command` 换成 `cmd`、`args` 改为 `["/c", "npx", "-y", "lucida-vision-mcp"]`。

**第 2 步**：重启 MCP Host。之后对 AI 说"看一下这张图"，它就会调用这些工具。

也可以全局安装后直接用 `lucida-vision-mcp` 命令：`npm install -g lucida-vision-mcp`。

> **本地图片**：开箱即用——直接传 `file:///C:/照片/a.png` 这样的本地路径即可，图片字节不需要经过 AI 的上下文，这是处理本地文件最快的方式。严格环境可通过 `VISION_ALLOW_URI_SCHEMES=http,https` 去掉 `file`。

### 其他安装方式

- **发布包**（不想配环境）：从 [Releases](https://github.com/dongyushenqi/lucida-vision-mcp/releases) 下载 `lucida-vision-mcp-vX.Y.Z.zip`，解压后运行 `install.cmd`（Windows）或 `install.sh`（macOS / Linux）。包内有 MCP Host 配置模板和中英双语说明；
- **源码**（开发者）：`pnpm install && pnpm build`。

## 配置视觉模型（Provider）

系统不预设任何模型，用哪个模型完全由你的配置决定。两种写法：

**快捷方式**（单模型）——设置 `AGNES_API_KEY`，默认接 Agnes 免费视觉模型；可用 `AGNES_BASE_URL`、`AGNES_VISION_MODEL` 指向任意 OpenAI 兼容服务。

**标准方式**（多模型）——设置 `VISION_PROVIDERS_JSON`（JSON 数组，每家一条），Agent 通过 `provider_id` 参数显式选择由谁执行，服务端不做自动路由：

```json
[
  { "providerId": "qwen",   "apiKey": "<key>", "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "qwen-vl-max", "displayName": "通义千问" },
  { "providerId": "doubao", "apiKey": "<key>", "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",          "model": "doubao-1.5-vision-pro", "displayName": "豆包" },
  { "providerId": "gpt",    "apiKey": "<key>", "baseUrl": "https://api.openai.com/v1",                        "model": "gpt-4o", "displayName": "GPT" }
]
```

每个 Provider 的能力由"探针"实测验证：启动时一次，此后每 24 小时复验。模型不支持的能力（例如部分模型不支持结构化检测），对应工具会如实返回不可执行。

非 OpenAI 兼容协议（Anthropic / Gemini 原生接口等）需要写一个适配器类，见 [docs/PROVIDERS.md](docs/PROVIDERS.md)。

### 环境变量一览

| 变量 | 默认值 | 说明 |
|---|---|---|
| `VISION_PROVIDERS_JSON` | — | 多 Provider 配置（JSON 数组） |
| `AGNES_API_KEY` | — | 单模型快捷配置（向后兼容入口） |
| `AGNES_BASE_URL` / `AGNES_VISION_MODEL` | Agnes 默认值 | 覆盖快捷方式的接口地址与模型 |
| `VISION_PROBE_ON_BOOT` | `true` | 启动时运行能力探针 |
| `VISION_PROBE_INTERVAL_HOURS` | `24` | 探针复验间隔（小时） |
| `VISION_ALLOWED_URI_ORIGINS` | 空 | 服务端取图的来源白名单（逗号分隔，SSRF 防护） |
| `VISION_ALLOW_URI_SCHEMES` | `http,https,file` | URI scheme 白名单（逗号分隔）；默认含 `file` 支持本地取图，严格环境可显式去掉 |
| `VISION_ALLOW_PRIVATE_ADDRESSES` | `false` | 放行私有/环回地址（本机 HTTP 提供图片的场景；SSRF 防护默认保持开启） |
| `VISION_MAX_INLINE_BYTES` | `10485760` | 内联图像大小上限（字节） |

## 能力与边界

- **上限 = 所接模型**。同等条件下，达不到 GPT-4o / Claude 原生多模态直接看图的水平；本系统不"加戏"。
- **不撒谎**。能力先经探针实测再开放；未验证的能力一律如实报"不可执行"。
- **可审计**。每次观察记录模型、版本与时间戳，不可篡改。
- **定位**。个人与小团队可直接使用的轻量生产级（154 个测试、三平台 CI、错误码体系、审计与安全边界）；不含多租户、限流、分布式等企业能力。

完整的项目定位声明、与 skill 及同类 MCP 的差异、架构与包布局，见 [docs/OVERVIEW.md](docs/OVERVIEW.md)。

## 安全

- 服务端抓取图像受 SSRF 防护与来源白名单双重限制；
- API Key 只经环境变量注入：不落盘、不入库、不进 git 历史；
- 取消操作不会销毁已提交的证据。

## 平台支持

| 平台 | 状态 |
|---|---|
| Windows | 完整支持：本地实测 + CI 自动测试 |
| macOS / Linux | 可用：代码与脚本已适配，经 CI 自动测试（开发环境为 Windows，未做本地人工实测） |

## 文档与开发

- [docs/OVERVIEW.md](docs/OVERVIEW.md) —— 项目定位、架构、包布局、测试状态
- [docs/DECISIONS.md](docs/DECISIONS.md) —— 技术决策记录
- [docs/PROVIDERS.md](docs/PROVIDERS.md) —— 接入新 Provider 指南

```bash
pnpm install
pnpm build
pnpm test    # 154 个测试；需真实 API 的用例：有 Key 自动跑，无 Key 自动跳过
```

## License

MIT

[Switch to English](#english)
