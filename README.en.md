# lucida-vision-mcp

A pair of eyes for text-only AI: a general-purpose visual perception MCP server. It states verifiable visual facts — never diagnoses, never advises.

**eyes, not brain** — 通用视觉感知 MCP 服务器：只陈述可核验的视觉事实，不做诊断与决策。

[中文文档](README.md) · English (this page)

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
