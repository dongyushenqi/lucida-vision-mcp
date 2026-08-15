# MCP Vision Server (Release Package)

A general-purpose visual perception infrastructure — "eyes, not brain":
it states visual facts only, never diagnoses, and never makes decisions for you.

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
2. **Set your API key** (environment variable only, never written to disk):
   ```
   set AGNES_API_KEY=your-key
   ```
3. **Connect to an MCP host** (e.g., Claude Desktop):
   - Open the host's MCP config file, see `config/claude-desktop.example.json`,
     and point `args` to your extracted path (`...\bin\mcp-vision-server.mjs`)
   - Restart the host; the `vision.*` tools will appear

You can also run `start.cmd` directly to verify the server boots.

## Install in 3 Steps (macOS / Linux)

1. **Check environment**: run `./install.sh` in a terminal (follow the hints if Node is missing)
2. **Set your API key**: `export AGNES_API_KEY=your-key`
3. **Connect to an MCP host**: same as Windows step 3 — `command: "node"`,
   `args` pointing to `.../bin/mcp-vision-server.mjs`

## Multi-Provider Support (Model Independence)

Any OpenAI-compatible vision model (Qwen / Doubao / GPT / Agnes, etc.) works
without code changes — configure via the `VISION_PROVIDERS_JSON` environment
variable (JSON array; fields: providerId / apiKey / baseUrl / model / displayName).
See docs/PROVIDERS.md in the repository.

## Key Security

All keys are injected via environment variables only; this package never stores,
reads, or writes any key files.
