# lucida-vision-mcp

> **lucida-vision-mcp** — 通用视觉感知 MCP 服务器（眼睛不是大脑：只陈述视觉事实，不做诊断与决策）
> **lucida-vision-mcp** — a general-purpose visual perception MCP server (eyes, not brain: states visual facts, never diagnoses or decides)
>
> 中文：[README.md](README.md) · English: [README.en.md](README.en.md)

**Lucida**（拉丁语：明亮）—— 清澈地看见。
**vision-mcp**：视觉感知类 MCP 的约定俗成归类后缀。

通用视觉感知基础设施 —— **眼睛不是大脑**：只陈述视觉事实与局限，绝不输出领域诊断、行动建议或工作流编排。

## 项目定位（诚实声明）

**开发目的**：为不具备原生识图能力的 AI（纯文本模型）提供标准化的"视觉感知器官"——通过标准 MCP 协议把图像交给可验证的视觉模型，返回**带来源记录**（谁、什么模型、何时看的）的视觉证据，让"看"这个过程可审计、可验证、不撒谎。

**能达到的状态**：经能力探针验证的视觉事实陈述——图像描述、文字提取（OCR）、结构化检测（视所接 VLM 而定）；任何 OpenAI 兼容视觉模型均可接入（配置即用），未经验证的能力如实报告"不可执行"。

**诚实的边界（重要）**：

1. **上限 = 所接 VLM**。本系统不"加戏"也不"变强"：同等条件下，达不到自带识图能力的 AI（如 GPT-4o / Claude 原生多模态）直接看图的水平。
2. **不同于简单 skill**：skill 是"提示词 + 脚本"；本系统是协议级基础设施——标准 MCP 协议、Session/Operation/Observation 领域模型、能力探针、Provenance 审计、幂等与取消契约、SSRF/授权安全边界、schema 版本化、154+ 自动化测试。
3. **不同于同类视觉 MCP**：能力探针（声明能力 ∩ 实测能力）、每次观察记录模型版本与时间戳（不可变溯源）、服务端取图受 SSRF 与来源策略双重防护、取消绝不销毁已提交证据。
4. **轻量生产级**：具备个人/小团队可直接投入使用的工程标准（测试、三平台 CI、错误码体系、审计、安全边界、npm/zip/源码三种发布形态）；**尚不包含**企业级能力（多租户认证、并发限流、数据保留期自动清理、分布式部署）——如需再补。
5. **精细识别**：精细度取决于所接 VLM；**本系统不预设默认模型**——用哪个模型完全由你的接入决定，各家能力经探针验证后如实披露。以当前测试环境接入的 Agnes（免费模型）为例：精细描述与 OCR 已实测通过，结构化检测未通过探针，工具如实报告"不可执行"；换用更强模型后，能力矩阵由探针自动重验。

## 三种安装方式（重要）

| 形态 | 给谁 | 是什么 | 怎么用 |
|---|---|---|---|
| **npm 安装**（`lucida-vision-mcp`） | 习惯终端命令的用户 | npm 包（发布后） | `npm install -g lucida-vision-mcp` 全局装，或 `npx -y lucida-vision-mcp` 免安装直接跑；离线可 `npm install <tgz>` |
| **发布包**（Release zip，`lucida-vision-mcp-vX.Y.Z.zip`） | 不确定自己环境有没有依赖的用户 | 编译好的单文件程序 + 引导脚本 + MCP Host 配置模板，约 112 KB | 解压 → `install.cmd`（自动检测/安装 Node，**绝不覆盖已有环境**）→ 设 key → 接入 MCP Host |
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
- Provider：**不预设默认模型**——任意 OpenAI 兼容视觉模型经配置接入（开发期以 Agnes agnes-2.5-flash 实测验证）
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
`AGNES_API_KEY` env 仅为向后兼容的快捷配置（追加注册，无优先地位）；
**本系统不预设默认模型**——用哪个模型由你的配置决定。

**两类分法**（接入规则）：主流协议（OpenAI 兼容）→ 配置即用，见上文；
非主流协议（Anthropic 原生 / Gemini 原生等）→ 按 `VLMProvider` 接口写一个适配器类，
详见 [docs/PROVIDERS.md](docs/PROVIDERS.md)。

## 状态

- [x] M0 contracts（领域契约）33 测试
- [x] M1 vision-core（图谱/Operation/Fetch Boundary/IQA/Provider Adapter）72 测试
- [x] M2 vision-interface（8 个工具 + 幂等 + 沙箱）28 测试
- [x] M3 compatibility + server（Legacy Family + stdio + 发布包）21 测试
- [x] M4 E2E 冒烟验收（InMemoryTransport 协议级 + stdio 真实子进程 + 发布包 bundle 握手）
- 合计 154 个测试全绿（`pnpm test`）；CI 在 Windows / macOS / Linux 三平台自动运行

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
