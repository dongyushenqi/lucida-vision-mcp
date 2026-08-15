# MCP Vision Server

通用视觉感知基础设施 —— **眼睛不是大脑**：只陈述视觉事实与局限，绝不输出领域诊断、行动建议或工作流编排。
(English: [README.en.md](README.en.md))

## 两种下载形态（重要）

| 形态 | 给谁 | 是什么 | 怎么用 |
|---|---|---|---|
| **npm 安装**（`mcp-vision-srv`） | 习惯终端命令的用户 | npm 包（发布后） | `npm install -g mcp-vision-srv` 全局装，或 `npx -y mcp-vision-srv` 免安装直接跑；离线可 `npm install <tgz>` |
| **发布包**（Release zip，`mcp-vision-server-vX.Y.Z.zip`） | 不确定自己环境有没有依赖的用户 | 编译好的单文件程序 + 引导脚本 + MCP Host 配置模板，约 112 KB | 解压 → `install.cmd`（自动检测/安装 Node，**绝不覆盖已有环境**）→ 设 key → 接入 MCP Host |
| **源码包**（Source zip / git clone） | 开发者（已有依赖环境） | 全部源码 + 测试 + CI，约 124 KB | `pnpm install && pnpm build` 后运行 |

三种方式最终都是同一个程序（stdio 标准 MCP 协议）。发布包内部含 Windows
（`install.cmd`/`start.cmd`）与 macOS/Linux（`install.sh`/`start.sh`）引导脚本及中英双语说明。

## 平台支持声明

| 平台 | 状态 |
|---|---|
| **Windows** | ✅ 完整支持：本地实测 + CI 自动测试 |
| **macOS** | ✅ 可用：代码与引导脚本已适配，经 CI 自动测试验证；**未经本地人工实测**（开发环境为 Windows） |
| **Linux** | ✅ 可用：代码与引导脚本已适配，经 CI 自动测试验证；**未经本地人工实测**（开发环境为 Windows） |

## 架构（四层职责隔离）

```text
Agent Strategy (主 AI 端)          ← 决策大脑（本仓库之外）
        │ MCP Protocol (Legacy / Modern Family)
MCP Compatibility Layer            ← 协议家族适配 / 取消桥 / Identity Context
        │ Internal RPC
MCP Vision Interface               ← Tool 路由 / 幂等控制 / Resource URI 解析 / Session 沙箱
        │
Vision Core                       ← Observation 图谱 / Operation 生命周期 / IQA / Provider Adapter
```

依赖方向单向：`server → compatibility → vision-interface → vision-core → contracts`。
**Vision Core 禁止 import 任何 MCP 协议包**（协议家族独立的物理保证）。

## 包布局（pnpm workspaces，前缀 `@mcp-vision/*`）

| 包 | 职责 |
|---|---|
| `contracts` | 领域类型 + zod schema + schema_version 演进 + 错误码命名空间 + JCS 规范化 |
| `vision-core` | Observation Graph、Operation 生命周期与 Commit Boundary、Capability Registry、统一 Fetch Boundary、Provider Adapter |
| `vision-interface` | 8 个 Tool（session.create/get/delete、observe、detect、ocr、operation.get/cancel）、幂等/去重/冲突、Session 授权沙箱 |
| `compatibility` | Legacy 协议家族（官方 MCP SDK）、协议取消 → 内部 CancellationToken 桥、Modern 占位 |
| `server` | 装配壳 + stdio 传输入口 |

## V1 决策速览（详见 `docs/DECISIONS.md`）

- 语言：TypeScript（NodeNext / ESM）/ 官方 `@modelcontextprotocol/sdk`
- 存储：SQLite（Node 内置 `node:sqlite`，WAL）
- 首个 Provider：Agnes `agnes-2.5-flash`（OpenAI 兼容：`https://apihub.agnes-ai.com/v1`，Bearer key）
- 传输：stdio（本地单机）

## 开发

```bash
pnpm install
pnpm build
pnpm test
```

## 多 Provider 配置（模型独立）

任何 OpenAI 兼容视觉模型都可直接接入，每家 = 一份配置实例（`VISION_PROVIDERS_JSON`），
Agent 经工具参数 `provider_id` 显式选择执行者（服务端绝无自动路由/故障转移）：

```bash
VISION_PROVIDERS_JSON='[
  {"providerId":"qwen","apiKey":"<key>","baseUrl":"https://dashscope.aliyuncs.com/compatible-mode/v1","model":"qwen-vl-max","displayName":"通义千问"},
  {"providerId":"doubao","apiKey":"<key>","baseUrl":"https://ark.cn-beijing.volces.com/api/v3","model":"doubao-1.5-vision-pro","displayName":"豆包"},
  {"providerId":"gpt","apiKey":"<key>","baseUrl":"https://api.openai.com/v1","model":"gpt-4o","displayName":"GPT"}
]' node lib/index.js
```

各家能力由启动时探针独立验证（Declared ∩ Verified → Effective），
未验证的能力（如结构化检测）工具会如实报告"不可执行"，绝不撒谎。
`AGNES_API_KEY` env 为向后兼容的默认 Provider（优先注册）。

**两类分法**（接入规则）：主流协议（OpenAI 兼容）→ 配置即用，见上文；
非主流协议（Anthropic 原生 / Gemini 原生等）→ 按 `VLMProvider` 接口写一个适配器类，
详见 [docs/PROVIDERS.md](docs/PROVIDERS.md)。

## 状态

- [x] M0 contracts（领域契约）31 测试
- [x] M1 vision-core（图谱/Operation/Fetch Boundary/IQA/Provider Adapter）56 测试
- [x] M2 vision-interface（8 个工具 + 幂等 + 沙箱）19 测试
- [x] M3 compatibility + server（Legacy Family + stdio + 发布包）16 测试
- [x] M4 E2E 冒烟验收（InMemoryTransport 协议级 + stdio 真实子进程 + 发布包 bundle 握手）
- 合计 122 个测试全绿（`pnpm test`）；CI 在 Windows / macOS / Linux 三平台自动运行

## 真实 Provider 测试（需 API Key，Key 绝不入库）

**安全约定**：`AGNES_API_KEY` 只经环境变量注入（本地 shell / GitHub Secret），
源码、测试、文档、git 历史中均不得出现真实 Key。

```bash
# 1) stdio 全链路冒烟（真实探针 + 真实执行）
cd packages/server
AGNES_API_KEY=<key> node stdio-smoke.mjs

# 2) 真实 API 全链路验收（probe/observe/json_mode/ocr/detect/幂等/冲突）
AGNES_API_KEY=<key> node e2e-real.mjs

# 3) vitest 真实 API 用例（有 Key 自动跑，无 Key 自动跳过）
AGNES_API_KEY=<key> pnpm -r run test
```

GitHub 场景：
- `CI` workflow（push/PR）：无 Key 全量回归（真实用例自动跳过）；
- `E2E Real Agnes API` workflow（手动触发）：经仓库 Secret `AGNES_API_KEY` 注入后跑 `e2e-real.mjs`。

免费层注意：真实测试每次运行约消耗 7 次 API 调用（probe 3 次 + 执行 4 次），请控制频率。
