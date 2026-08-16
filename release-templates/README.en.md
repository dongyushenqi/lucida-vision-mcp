# lucida-vision-mcp (Release Package)

**Lucida** (Latin: bright / clear) — to see clearly.

A general-purpose visual perception infrastructure — "eyes, not brain":
it states visual facts only, never diagnoses, and never makes decisions for you.

## Project Positioning (Honest Statement)

**Purpose**: provide a standardized "visual perception organ" for AI without native
vision — via the standard MCP protocol, images are handed to verifiable vision models
and returned as sourced visual evidence (who looked, with which model, at what time),
making "seeing" auditable, verifiable, and honest.

**Honest boundaries**:
1. Recognition quality is capped by the connected vision model; under equal
   conditions it **does not reach the level of AI with native vision** (e.g.,
   GPT-4o / Claude native multimodal);
2. Not a simple skill: this is protocol-level infrastructure (standard MCP
   protocol, domain model, capability probes, audit, idempotency, security);
3. **Lightweight production-grade**: usable by individuals/small teams; enterprise
   features (multi-tenant auth, rate limiting, retention cleanup, distributed
   deployment) are not included;
4. Fine-grained recognition depends on the connected model, disclosed honestly
   after probe verification; **this system presets no default model** — the model
   is entirely your choice;

## Platform Support (Important)

| Platform | Status |
|---|---|
| **Windows** | ✅ Fully supported: verified locally + automated tests (CI) |
| **macOS** | ✅ Available: code and launcher scripts adapted, verified by CI automated tests; **not manually tested on local hardware** (dev environment is Windows) |
| **Linux** | ✅ Available: code and launcher scripts adapted, verified by CI automated tests; **not manually tested on local hardware** (dev environment is Windows) |

If you hit an issue on macOS/Linux, please report it with your OS version and the error output.

## Install in 3 Steps (Windows)

1. **Check environment**: run `install.cmd`
   - Node.js already present → continue (your environment is never overwritten)
   - Not present → the script auto-installs via winget (falls back to the official link)
2. **Configure your vision model key** (environment variable only, never written to disk; pick one):
   - **Standard** (any OpenAI-compatible model): set `VISION_PROVIDERS_JSON`
     in the host config's `env` (JSON array — providerId / apiKey / baseUrl /
     model / displayName; examples in the repo README)
   - **Shortcut** (e.g. the free Agnes model): `set AGNES_API_KEY=your-key`
   (No default model is preset — your configuration decides.)
3. **Connect to an MCP host** (e.g., Claude Desktop):
   - Open the host's MCP config file, see `config/claude-desktop.example.json`,
     and point `args` to your extracted path (`...\bin\lucida-vision-mcp.mjs`)
   - Restart the host; the `vision.*` tools will appear

You can also run `start.cmd` directly to verify the server boots.

## Install in 3 Steps (macOS / Linux)

1. **Check environment**: run `./install.sh` in a terminal (follow the hints if Node is missing)
2. **Configure your vision model key** (pick one, same as Windows step 2):
   - Standard: set `VISION_PROVIDERS_JSON` in `env` (any OpenAI-compatible model)
   - Shortcut: `export AGNES_API_KEY=your-key` (e.g. the free Agnes model)
3. **Connect to an MCP host**: same as Windows step 3 — `command: "node"`,
   `args` pointing to `.../bin/lucida-vision-mcp.mjs`

## Multi-Provider Support (Model Independence)

Any OpenAI-compatible vision model (Qwen / Doubao / GPT / Agnes, etc.) works
without code changes — configure via the `VISION_PROVIDERS_JSON` environment
variable (JSON array; fields: providerId / apiKey / baseUrl / model / displayName).
See docs/PROVIDERS.md in the repository.

## Key Security

All keys are injected via environment variables only; this package never stores,
reads, or writes any key files.
