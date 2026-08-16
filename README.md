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

## The 10 tools

| Tool | What it does |
|---|---|
| `vision.session.create` / `.get` / `.delete` | Session management (authorization sandbox and isolation unit for observations) |
| `vision.session.audit` | Session audit summary (professional, on-demand only): operation trail (time / tool / status / provider / failure reasons); `include_observations=true` adds full observation metadata (location = region correspondence) |
| `vision.observe` | General visual observation, returns evidence text; `json_mode=true` returns structured output (if verified for that model) |
| `vision.summarize` | Batch overview: 1–16 images → one prose-style summary (common themes, differences, overall impression), no per-image listing |
| `vision.ocr` | Extracts text from the image |
| `vision.detect` | Structured detection for categories you declare, returns JSON bounding boxes (if verified for that model) |
| `vision.operation.get` / `.cancel` | Query and cancel in-flight tasks; committed evidence is never destroyed by cancellation |

## Quick start (npm)

Requires Node.js ≥ 24.

**Step 1**: merge this into your MCP host config (example: `claude_desktop_config.json` for Claude Desktop), replacing `my-vlm` with your vision model:

```json
{
  "mcpServers": {
    "vision": {
      "command": "npx",
      "args": ["-y", "lucida-vision-mcp"],
      "env": {
        "VISION_PROVIDERS_JSON": "[{\"providerId\":\"my-vlm\",\"apiKey\":\"your vision model API key\",\"baseUrl\":\"https://your-endpoint/v1\",\"model\":\"your-model\",\"displayName\":\"My VLM\"}]"
      }
    }
  }
}
```

> Want to try free first? Just set `AGNES_API_KEY` (the free Agnes vision model — a shortcut, switch to any other model anytime).

> On Windows, if `npx` fails to start, use `"command": "cmd"` with `args` `["/c", "npx", "-y", "lucida-vision-mcp"]`.

**Step 2**: restart the MCP host. Then just ask the AI "take a look at this image" — it will call the tools.

You can also install globally and use the `lucida-vision-mcp` command directly: `npm install -g lucida-vision-mcp`.

> **Local images**: local paths work out of the box — pass `file:///C:/photos/a.png` and the image bytes never travel through the AI's context. Strict environments can remove `file` via `VISION_ALLOW_URI_SCHEMES=http,https`.

### Other install options

- **Release zip** (no environment setup): download `lucida-vision-mcp-vX.Y.Z.zip` from [Releases](https://github.com/dongyushenqi/lucida-vision-mcp/releases), unzip, run `install.cmd` (Windows) or `install.sh` (macOS / Linux). An MCP host config template and bilingual instructions are included.
- **Source** (developers): `pnpm install && pnpm build`.

## Configuring vision models (providers)

No model is preset — your configuration decides. Two ways:

**Shortcut** (single model, optional) — set `AGNES_API_KEY` to use the free Agnes vision model (or point `AGNES_BASE_URL` / `AGNES_VISION_MODEL` at any OpenAI-compatible service). A convenience entry, **not a default** — switch anytime.

**Standard** (multiple models) — set `VISION_PROVIDERS_JSON` (a JSON array, one entry per vendor). The Agent explicitly picks the executor via the `provider_id` argument; the server never auto-routes:

```json
[
  { "providerId": "qwen",   "apiKey": "<key>", "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "qwen-vl-max", "displayName": "Qwen" },
  { "providerId": "doubao", "apiKey": "<key>", "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",          "model": "doubao-1.5-vision-pro", "displayName": "Doubao" },
  { "providerId": "gpt",    "apiKey": "<key>", "baseUrl": "https://api.openai.com/v1",                        "model": "gpt-4o", "displayName": "GPT" }
]
```

**No default model**: when multiple providers are registered and a call omits `provider_id`, the first registered provider executes (a static default, not auto-routing).

Each provider's capabilities are verified by probes: once at boot, then re-verified every 24 hours. Capabilities a model does not support (e.g. structured detection on some models) are honestly reported as not executable.

Non-OpenAI-compatible protocols (Anthropic / Gemini native APIs, etc.) need one adapter class — see [docs/PROVIDERS.md](docs/PROVIDERS.md).

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `VISION_PROVIDERS_JSON` | — | Multi-provider configuration (JSON array, the standard way) |
| `AGNES_API_KEY` | — | Single-model shortcut (optional; e.g. the free Agnes model). For general use see `VISION_PROVIDERS_JSON` |
| `AGNES_BASE_URL` / `AGNES_VISION_MODEL` | Agnes defaults | Override the shortcut's endpoint and model (any OpenAI-compatible service) |
| `VISION_PROBE_ON_BOOT` | `true` | Run capability probes at startup |
| `VISION_PROBE_INTERVAL_HOURS` | `24` | Probe re-verification interval (hours) |
| `VISION_ALLOWED_URI_ORIGINS` | empty | Allowlist of origins the server may fetch images from (comma-separated, SSRF protection) |
| `VISION_ALLOW_URI_SCHEMES` | `http,https,file` | URI scheme allowlist (comma-separated); `file` included by default for local images, removable for strict environments |
| `VISION_ALLOW_PRIVATE_ADDRESSES` | `false` | Allow private/loopback addresses (for serving images over local HTTP; SSRF protection stays on by default) |
| `VISION_DEFAULT_PROFILE` | `default` | Default observation profile (`deep` = deep-instruction preset; only for explicit deeper requests) |
| `VISION_MAX_INLINE_BYTES` | `10485760` | Maximum inline image size (bytes) |

## Capabilities and boundaries

- **Ceiling = the attached model.** A model looking at an image directly is always at least as capable as the same model used through this server — we never embellish or enhance; we make seeing auditable, traceable, and honest.
- **Never lies.** Capabilities open up only after probe verification; unverified ones are honestly reported as "not executable".
- **Auditable.** Every observation records model, version, and timestamp — immutably.
- **Positioning.** Lightweight production-grade for individuals and small teams (166 tests, 3-platform CI, error-code system, audit and security boundaries); enterprise features (multi-tenant, rate limiting, distributed deployment) are out of scope.

Full positioning statement, differences from skills and similar MCPs, architecture and package layout: [docs/OVERVIEW.md](docs/OVERVIEW.md).

## Professional use (instruction first, then profile)

**The mode is decided by "whether depth is requested" — never by image type**:

- **Default mode**: no explicit instruction, or an explicit "default / simple / general mode" request → concise general observation. Recognizing what an image is (invoice, design drawing, child's doodle, …) is the model's native ability and comes out in default observation — but **recognition ≠ deep analysis**; the default only gives a general description.
- **Professional mode**: entered only when the main AI understands from natural language that the user wants "more professional / deeper / more structured" — only then do deep analysis and structured evidence happen.

- **First interface: the `instruction` argument** — declare observation requirements and constraints in plain language (e.g. "describe only visible geometry, no inference" or "OCR all visible text, keep layout"). This is the main channel for any depth of observation.
- **Second interface: `profile: "deep"`** — a preset deep-observation instruction bundle (includes watermarks, small text, fine-grained features). Use it only when the user explicitly asks for "deeper / more professional"; without an explicit request the default always applies.
- **Third interface: `observation_schema` (declarative structured observation)** — declare the dimensions to observe (e.g. `{"dimensions": ["color", "shape", "count"]}`); the server returns per-dimension `value` or `unknown` with an evidence-state `reason` (six-enum closed set). Structure is server-enforced: undeclared keys or invalid reasons are honestly reported as `structured_parse_failed`, while field-level `unknown` is legitimate evidence. Requires a model that passes the structured-output probe. It declares *what to observe and how to express it* — never reasoning or decisions.
- **Trigger semantics**: the default is always the concise mode; only an explicit deeper request switches it. `profile` is an instruction preset — it never changes the model, failure policy, or other capabilities.
- Deployments can set `VISION_DEFAULT_PROFILE=deep` as the baseline.

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
- [CHANGELOG.md](CHANGELOG.md) — per-version bilingual change notes (what changed, how to use)
- [docs/DECISIONS.md](docs/DECISIONS.md) — technical decision records
- [docs/PROVIDERS.md](docs/PROVIDERS.md) — guide for adding new providers

```bash
pnpm install
pnpm build
pnpm test    # 166 tests; real-API cases run when a key is present, auto-skip otherwise
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

## 提供的 10 个工具

| 工具 | 作用 |
|---|---|
| `vision.session.create` / `.get` / `.delete` | 会话管理（观察的授权沙箱与隔离单位） |
| `vision.session.audit` | Session 审计汇总（专业模块，按需调用）：操作记录（时间/工具/状态/执行者/失败原因）；`include_observations=true` 附全量观察元数据（location 即区域对应） |
| `vision.observe` | 通用视觉观察，返回视觉证据文本；`json_mode=true` 时返回结构化观察（需该模型验证通过） |
| `vision.summarize` | 批量综合概述：1~16 张图 → 一篇散文式描述（共同主题/差异/整体印象），不逐张罗列 |
| `vision.ocr` | 提取图中的文字 |
| `vision.detect` | 按你声明的类别做结构化检测，返回 JSON 边界框（需该模型验证通过） |
| `vision.operation.get` / `.cancel` | 查询与取消执行中的任务；已提交的证据不会被取消销毁 |

## 快速开始（npm）

要求 Node.js ≥ 24。

**第 1 步**：把下面的片段并入 MCP Host 配置（以 Claude Desktop 的 `claude_desktop_config.json` 为例），把 `my-vlm` 换成你的视觉模型信息：

```json
{
  "mcpServers": {
    "vision": {
      "command": "npx",
      "args": ["-y", "lucida-vision-mcp"],
      "env": {
        "VISION_PROVIDERS_JSON": "[{\"providerId\":\"my-vlm\",\"apiKey\":\"你的视觉模型 API Key\",\"baseUrl\":\"https://你的服务地址/v1\",\"model\":\"你的模型名\",\"displayName\":\"我的模型\"}]"
      }
    }
  }
}
```

> 想先免费体验？只设 `AGNES_API_KEY` 即可（Agnes 免费模型，快捷方式，随时可换其他模型）。

> Windows 上如果 `npx` 启动失败，把 `command` 换成 `cmd`、`args` 改为 `["/c", "npx", "-y", "lucida-vision-mcp"]`。

**第 2 步**：重启 MCP Host。之后对 AI 说"看一下这张图"，它就会调用这些工具。

也可以全局安装后直接用 `lucida-vision-mcp` 命令：`npm install -g lucida-vision-mcp`。

> **本地图片**：开箱即用——直接传 `file:///C:/照片/a.png` 这样的本地路径即可，图片字节不需要经过 AI 的上下文，这是处理本地文件最快的方式。严格环境可通过 `VISION_ALLOW_URI_SCHEMES=http,https` 去掉 `file`。

### 其他安装方式

- **发布包**（不想配环境）：从 [Releases](https://github.com/dongyushenqi/lucida-vision-mcp/releases) 下载 `lucida-vision-mcp-vX.Y.Z.zip`，解压后运行 `install.cmd`（Windows）或 `install.sh`（macOS / Linux）。包内有 MCP Host 配置模板和中英双语说明；
- **源码**（开发者）：`pnpm install && pnpm build`。

## 配置视觉模型（Provider）

系统不预设任何模型，用哪个模型完全由你的配置决定。两种写法：

**快捷方式**（单模型，可选）——设 `AGNES_API_KEY` 即可接入 Agnes 免费视觉模型；也可用 `AGNES_BASE_URL`、`AGNES_VISION_MODEL` 指向任意 OpenAI 兼容服务。这只是一个简便入口，**不是默认模型**，随时可换。

**标准方式**（多模型）——设置 `VISION_PROVIDERS_JSON`（JSON 数组，每家一条），Agent 通过 `provider_id` 参数显式选择由谁执行，服务端不做自动路由：

```json
[
  { "providerId": "qwen",   "apiKey": "<key>", "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "qwen-vl-max", "displayName": "通义千问" },
  { "providerId": "doubao", "apiKey": "<key>", "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",          "model": "doubao-1.5-vision-pro", "displayName": "豆包" },
  { "providerId": "gpt",    "apiKey": "<key>", "baseUrl": "https://api.openai.com/v1",                        "model": "gpt-4o", "displayName": "GPT" }
]
```

**不预设默认模型**：多个 Provider 并存、且调用未指定 `provider_id` 时，按注册顺序取第一个作为执行者（静态默认，非自动路由/故障转移）。

每个 Provider 的能力由"探针"实测验证：启动时一次，此后每 24 小时复验。模型不支持的能力（例如部分模型不支持结构化检测），对应工具会如实返回不可执行。

非 OpenAI 兼容协议（Anthropic / Gemini 原生接口等）需要写一个适配器类，见 [docs/PROVIDERS.md](docs/PROVIDERS.md)。

### 环境变量一览

| 变量 | 默认值 | 说明 |
|---|---|---|
| `VISION_PROVIDERS_JSON` | — | 多 Provider 配置（JSON 数组，标准方式） |
| `AGNES_API_KEY` | — | 单模型快捷入口（可选；如 Agnes 免费模型）。通用配置见 `VISION_PROVIDERS_JSON` |
| `AGNES_BASE_URL` / `AGNES_VISION_MODEL` | Agnes 官方端点/模型 | 覆盖快捷方式的服务地址与模型（可指向任意 OpenAI 兼容服务） |
| `VISION_PROBE_ON_BOOT` | `true` | 启动时运行能力探针 |
| `VISION_PROBE_INTERVAL_HOURS` | `24` | 探针复验间隔（小时） |
| `VISION_ALLOWED_URI_ORIGINS` | 空 | 服务端取图的来源白名单（逗号分隔，SSRF 防护） |
| `VISION_ALLOW_URI_SCHEMES` | `http,https,file` | URI scheme 白名单（逗号分隔）；默认含 `file` 支持本地取图，严格环境可显式去掉 |
| `VISION_ALLOW_PRIVATE_ADDRESSES` | `false` | 放行私有/环回地址（本机 HTTP 提供图片的场景；SSRF 防护默认保持开启） |
| `VISION_DEFAULT_PROFILE` | `default` | 默认观察档位（`deep`=深入指令包；仅用于明确的深入要求） |
| `VISION_MAX_INLINE_BYTES` | `10485760` | 内联图像大小上限（字节） |

## 能力与边界

- **上限 = 所接模型**。同一个模型直接看图的能力，永远不低于「模型 + 本系统」的组合——本系统不"加戏"、不"变强"，只是让"看"可审计、可溯源、不撒谎。
- **不撒谎**。能力先经探针实测再开放；未验证的能力一律如实报"不可执行"。
- **可审计**。每次观察记录模型、版本与时间戳，不可篡改。
- **定位**。个人与小团队可直接使用的轻量生产级（166 个测试、三平台 CI、错误码体系、审计与安全边界）；不含多租户、限流、分布式等企业能力。

完整的项目定位声明、与 skill 及同类 MCP 的差异、架构与包布局，见 [docs/OVERVIEW.md](docs/OVERVIEW.md)。

## 专业化用法（先 instruction，再 profile）

**模式由「是否要求深度」决定，与图像类型无关**：

- **默认模式**：用户没有明确指示，或明确说「一般模式/默认模式/简单模式」→ 摘要级一般观察。识别图像是什么（发票、设计图、涂鸦……）是模型的天然能力，默认观察就会说出来——但**识别 ≠ 深入分析**，默认只做一般性描述；
- **专业模式**：只有当主 AI 从自然语言中理解到用户要求「更专业/更深入/更结构化」时，才进入——此时才有深入分析、结构化证据。

- **第一接口：`instruction` 参数**——直接用自然语言声明观察要求与约束（例如「只描述可见的几何结构，不做推断」「对所有可见文字做 OCR 并保持布局」）。这是专业化的主通道，任何深度要求都可以写在这里。
- **第二接口：`profile: "deep"`**——预置的深入观察指令包（纳入水印、细小文字、细粒度特征）。**仅当用户明确要求「更深入/更专业」时使用**；无明确指示一律 default。
- **第三接口：`observation_schema`（声明式结构化观察）**——声明观察维度（如 `{"dimensions": ["color", "shape", "count"]}`），服务器逐字段返回 `value` 或 `unknown + reason`（六种封闭的证据状态枚举）。结构由服务器强制校验：未声明键、非法 reason 如实报 `structured_parse_failed`；字段级 `unknown` 是合法证据。需模型通过结构化输出探针验证。只声明「观察什么、以什么结构表达」，不承载推理/决策语义。
- **触发语义**：默认永远是摘要级；只有明确的深入要求才切换。`profile` 只是指令预设——不改变模型、不改变失败策略、不自动开启其他能力。
- 部署方可用 `VISION_DEFAULT_PROFILE=deep` 设定基调。

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
- [CHANGELOG.md](CHANGELOG.md) —— 每版中英双语改动说明（改了什么、怎么用）
- [docs/DECISIONS.md](docs/DECISIONS.md) —— 技术决策记录
- [docs/PROVIDERS.md](docs/PROVIDERS.md) —— 接入新 Provider 指南

```bash
pnpm install
pnpm build
pnpm test    # 166 个测试；需真实 API 的用例：有 Key 自动跑，无 Key 自动跳过
```

## License

MIT

[Switch to English](#english)
