# Lucida — MCP Vision Server

**Lucida** (Latin: bright / clear) — to see clearly.

A general-purpose visual perception infrastructure — **eyes, not brain**: it states
visual facts and limitations only, never outputs domain diagnoses, action suggestions,
or workflow orchestration. (中文版: [README.md](README.md))

## Project Positioning (Honest Statement)

**Purpose**: provide a standardized "visual perception organ" for AI that has no
native vision capability (pure text models) — via the standard MCP protocol, images
are handed to verifiable vision models and returned as **sourced visual evidence**
(who looked, with which model, at what time), making the act of "seeing" auditable,
verifiable, and honest.

**What it can do**: probe-verified visual fact statements — image description,
text extraction (OCR), structured detection (depends on the connected VLM); any
OpenAI-compatible vision model can be attached (config only); unverified
capabilities are honestly reported as "not executable".

**Honest boundaries (important)**:

1. **Ceiling = the connected VLM**. This system neither embellishes nor enhances:
   under equal conditions it does not reach the level of AI with native vision
   (e.g., GPT-4o / Claude native multimodal) looking at the image directly.
2. **Not a simple skill**: skills are "prompts + scripts"; this is protocol-level
   infrastructure — standard MCP protocol, Session/Operation/Observation domain
   model, capability probes, Provenance audit, idempotency & cancellation
   contracts, SSRF/authorization security boundaries, schema versioning, 122+
   automated tests.
3. **Different from typical vision MCPs**: capability probes (declared ∩ verified),
   per-observation immutable provenance (model version + timestamp), server-side
   image fetching protected by SSRF + origin policy, cancellation never destroys
   committed evidence.
4. **Lightweight production-grade**: engineering standards usable directly by
   individuals/small teams (tests, 3-platform CI, error-code system, audit,
   security boundaries, npm/zip/source distribution). **Not included**: enterprise
   features (multi-tenant auth, rate limiting, retention cleanup, distributed
   deployment) — added on demand.
5. **Fine-grained recognition**: precision depends on the connected VLM. The
   default Agnes (free model) is verified for detailed description and OCR;
   structured detection fails its probe and is honestly reported as "not executable".

## Installation Options (Important)

| Option | For whom | What it is | How to use |
|---|---|---|---|
| **npm install** (`mcp-vision-srv`) | Users comfortable with terminal commands | npm package (once published) | `npm install -g mcp-vision-srv`, or `npx -y mcp-vision-srv` to run without installing; offline: `npm install <tgz>` |
| **Release zip** (`mcp-vision-server-vX.Y.Z.zip`) | Users unsure whether their machine has dependencies | Compiled single-file program + launcher scripts + MCP host config template, ~112 KB | Unzip → `install.cmd` (auto-detects/installs Node, **never overwrites your environment**) → set your key → connect to an MCP host |
| **Source zip / git clone** | Developers (already have a toolchain) | All source + tests + CI, ~124 KB | `pnpm install && pnpm build` then run |

All three options deliver the same program (stdio, standard MCP protocol). The release
package includes launchers for Windows (`install.cmd`/`start.cmd`) and macOS/Linux
(`install.sh`/`start.sh`), plus bilingual instructions.

## Platform Support

| Platform | Status |
|---|---|
| **Windows** | ✅ Fully supported: verified locally + automated CI tests |
| **macOS** | ✅ Available: code and launcher scripts adapted, verified by CI automated tests; **not manually tested on local hardware** (dev environment is Windows) |
| **Linux** | ✅ Available: code and launcher scripts adapted, verified by CI automated tests; **not manually tested on local hardware** (dev environment is Windows) |

## Architecture (Four-Layer Responsibility Isolation)

```text
Agent Strategy (main AI side)      ← decision brain (outside this repo)
        │ MCP Protocol (Legacy / Modern Family)
MCP Compatibility Layer            ← protocol family adaptation / cancellation bridge / Identity Context
        │ Internal RPC
MCP Vision Interface               ← tool routing / idempotency / resource URI parsing / session sandbox
        │
Vision Core                       ← Observation graph / Operation lifecycle / IQA / Provider adapters
```

Dependency direction is strictly one-way:
`server → compatibility → vision-interface → vision-core → contracts`.
**Vision Core must never import any MCP protocol package** (physical guarantee of
protocol-family independence).

## Packages (pnpm workspaces, prefix `@mcp-vision/*`)

| Package | Responsibility |
|---|---|
| `contracts` | Domain types + zod schemas + schema_version evolution + error-code namespaces + JCS canonicalization |
| `vision-core` | Observation graph, Operation lifecycle & commit boundary, Capability Registry, unified Fetch Boundary, Provider adapters |
| `vision-interface` | 8 tools (session.create/get/delete, observe, detect, ocr, operation.get/cancel), idempotency/dedup/conflict, session authorization sandbox |
| `compatibility` | Legacy protocol family (official MCP SDK), protocol-cancellation bridge, Modern placeholder |
| `server` | Assembly shell + stdio transport entry |

## V1 Decisions (details in `docs/DECISIONS.md`)

- Language: TypeScript (NodeNext / ESM) / official `@modelcontextprotocol/sdk`
- Storage: SQLite (Node built-in `node:sqlite`, WAL)
- First provider: Agnes `agnes-2.5-flash` (OpenAI-compatible: `https://apihub.agnes-ai.com/v1`, Bearer key)
- Transport: stdio (local single-machine)

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## Multi-Provider Configuration (Model Independence)

Any OpenAI-compatible vision model can be attached directly; each vendor is one
config instance (`VISION_PROVIDERS_JSON`), and the Agent explicitly picks the
executor via the `provider_id` tool argument (the server never auto-routes or
fails over):

```bash
VISION_PROVIDERS_JSON='[
  {"providerId":"qwen","apiKey":"<key>","baseUrl":"https://dashscope.aliyuncs.com/compatible-mode/v1","model":"qwen-vl-max","displayName":"Qwen"},
  {"providerId":"doubao","apiKey":"<key>","baseUrl":"https://ark.cn-beijing.volces.com/api/v3","model":"doubao-1.5-vision-pro","displayName":"Doubao"},
  {"providerId":"gpt","apiKey":"<key>","baseUrl":"https://api.openai.com/v1","model":"gpt-4o","displayName":"GPT"}
]' node lib/index.js
```

Each vendor's capabilities are verified independently at boot by probes
(Declared ∩ Verified → Effective); unverified capabilities (e.g. structured
detection) are honestly reported as "not executable" — the server never pretends.
`AGNES_API_KEY` env remains the backward-compatible default provider (registered first).

**Two-class rule** (integration): mainstream protocol (OpenAI-compatible) → config
only, see above; non-mainstream protocols (Anthropic native / Gemini native, etc.)
→ implement one adapter class against the `VLMProvider` interface. See
[docs/PROVIDERS.md](docs/PROVIDERS.md).

## Status

- [x] M0 contracts (domain contracts) 31 tests
- [x] M1 vision-core (graph/Operation/Fetch Boundary/IQA/Provider adapters) 56 tests
- [x] M2 vision-interface (8 tools + idempotency + sandbox) 19 tests
- [x] M3 compatibility + server (Legacy Family + stdio + release package) 16 tests
- [x] M4 E2E smoke acceptance (InMemoryTransport protocol-level + stdio real subprocess + release bundle handshake)
- 122 tests green (`pnpm test`); CI runs on Windows / macOS / Linux automatically

## Real-Provider Testing (requires an API key; keys are never committed)

**Security rule**: `AGNES_API_KEY` is injected via environment variables only
(local shell / GitHub Secret); real keys must never appear in source, tests, docs,
or git history.

```bash
# 1) stdio full-chain smoke (real probe + real execution)
cd packages/server
AGNES_API_KEY=<key> node stdio-smoke.mjs

# 2) Real API full-chain acceptance (probe/observe/json_mode/ocr/detect/idempotency/conflict)
AGNES_API_KEY=<key> node e2e-real.mjs

# 3) vitest real-API cases (run automatically when a key is present, skipped otherwise)
AGNES_API_KEY=<key> pnpm -r run test
```

GitHub scenarios:
- `CI` workflow (push/PR): full regression without a key (real cases auto-skip);
- `E2E Real Agnes API` workflow (manual trigger): injects the repository Secret `AGNES_API_KEY` and runs `e2e-real.mjs`.

Free-tier note: each real test run consumes ~7 API calls (3 probes + 4 executions) — mind the rate limit.
