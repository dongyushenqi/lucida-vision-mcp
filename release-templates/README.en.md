# lucida-vision-mcp (Release Package)

A pair of eyes for text-only AI: a general-purpose visual perception MCP server. It states verifiable visual facts — never diagnoses, never advises.

**eyes, not brain** — this package is the compiled, ready-to-use artifact (single-file program + launcher scripts + config template).

## What it does

- Gives vision to AI without native image understanding via the standard MCP protocol: describe, extract text, structured detection;
- Any OpenAI-compatible vision model works (Qwen, Doubao, GPT, Agnes, etc.) — **no default model is preset**;
- Every observation is sourced: which model, which version, when it looked. Capabilities open only after probe verification; what a model cannot do is honestly reported as "not executable" — never fabricated;
- 9 tools: `vision.observe` (observe), `vision.summarize` (batch overview of 1–16 images), `vision.ocr` (text), `vision.detect` (structured detection), `vision.session.*` (sessions), `vision.operation.*` (query/cancel tasks).

## Capabilities and boundaries

- **Ceiling = the attached model.** A model looking at an image directly is always at least as capable as the same model used through this server — we make seeing auditable, traceable, and honest, never stronger;
- **Subject-focused by default**: the main subject is described, watermarks and minor signage are ignored; use `vision.ocr` when you need text;
- **Recognition ≠ deep analysis**: recognizing the image type (invoice / design drawing / doodle, …) is a native ability of default observation; deep analysis happens only when the user explicitly asks for "more professional / deeper";
- **No fabrication**: unseen things are not invented, uncertainty is flagged; subjective evaluation is not volunteered by default and, when explicitly requested, is grounded in observable features;
- **Positioning**: lightweight production-grade for individuals and small teams; no multi-tenant, rate limiting, or distributed features.

## Install in 3 Steps (Windows)

1. **Check environment**: run `install.cmd`
   - Node.js already present → continue (your environment is never overwritten)
   - Not present → the script auto-installs via winget (falls back to the official link)
2. **Configure your vision model key** (environment variable only, never written to disk; pick one):
   - **Standard** (any OpenAI-compatible model): set `VISION_PROVIDERS_JSON` in the host config's `env` (JSON array — providerId / apiKey / baseUrl / model / displayName; examples in the repo README)
   - **Shortcut** (e.g. the free Agnes model): `set AGNES_API_KEY=your-key`
3. **Connect to an MCP host** (e.g., Claude Desktop):
   - Open the host's MCP config file, see `config/claude-desktop.example.json`, and point `args` to your extracted path (`...\bin\lucida-vision-mcp.mjs`)
   - Restart the host; the `vision.*` tools will appear

You can also run `start.cmd` directly to verify the server boots.

## Install in 3 Steps (macOS / Linux)

1. **Check environment**: run `./install.sh` in a terminal (follow the hints if Node is missing)
2. **Configure your vision model key** (pick one, same as Windows step 2): standard — `VISION_PROVIDERS_JSON` in `env`; shortcut — `export AGNES_API_KEY=your-key`
3. **Connect to an MCP host**: same as Windows step 3 — `command: "node"`, `args` pointing to `.../bin/lucida-vision-mcp.mjs`

## Key Security

All keys are injected via environment variables only; this package never stores, reads, or writes any key files.

## More

Full documentation (config examples, environment variable table, platform support): https://github.com/dongyushenqi/lucida-vision-mcp
