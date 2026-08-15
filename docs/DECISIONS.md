# 决策记录（Decision Log）

本文件按规格《MCP Vision Server 架构与接口规格说明书》V3.7 的**变更分类器**记录开发期决策。
Frozen Contract 不可在此变更；新问题必须归类为五类之一：
**Bug / Implementation Decision / Protocol Adapter Issue / Contract Clarification / Protocol Compliance Issue**。

## Implementation Decisions（规格 B 类：开发阶段确定）

| 决策项 | 取值 | 依据/备注 |
|---|---|---|
| 包管理 | pnpm workspaces（`@mcp-vision/*`）；pnpm 11 构建审批用 `allowBuilds` | 拓扑构建顺序 |
| 语言/模块 | TypeScript，NodeNext / ESM，Node >= 24（实测 26.5.1） | 类型系统承载契约 |
| 存储 | SQLite（Node 内置 `node:sqlite` `DatabaseSync`，WAL） | 免原生编译依赖；V1 单机 |
| 默认身份 | Legacy Family 无协议级身份 → 配置默认 Principal/Tenant（`VISION_PRINCIPAL`/`VISION_TENANT`，默认 local/default） | 规格二.4；服务化时换真实认证 |
| 启动探针 | `VISION_PROBE_ON_BOOT`（默认 true）；key 缺失时优雅降级（Provider 未验证，工具如实报告） | 规格三.2 |
| Canonicalization | 自实现 RFC 8785 子集（`packages/contracts/src/canonical.ts`） | ES number 序列化；对象键按 UTF-16 码元排序 |
| Operation 参数身份 | `sha256:` + JCS({tool, args})；剔除传输/追踪/认证元数据键 | 规格五.2 |
| operation_id 不参与参数身份 | `operation_id` 属请求身份而非操作参数，列入非语义键（`NON_PARAMETER_METADATA_KEYS`） | 规格五.2 语义化 |
| inline 上限 | 10 MiB（Base64 解码**前**按字符串长度校验） | 规格四.1 |
| Fetch Boundary 超时 | 总 30s，重定向 ≤ 5 次，仅允许 http/https | 规格四.1 |
| Retention | Operation 记录 7 天 / Artifact 24h（配置项，默认开启自动清理） | 规格二.3 身份不可变 |
| Digest | SHA-256 | 规格四.2 |
| Agnes 超时/重试 | 180s；5xx 有界重试 1 次（简单退避），**绝不跨 Provider 路由** | 规格一.1 禁区 |
| Agnes 参数 | `temperature: 0.2` 固定；图片一律内联 `data:` URI 传给 Provider | 规格四.1 统一 Fetch Boundary |
| Probe 策略 | Provider 注册时 + TTL 24h 刷新；结果只写 Capability Registry | 规格三.2 副作用边界 |
| Sandbox | V1 进程内逻辑沙箱（无 Docker）；Provider 执行不引入任意代码执行路径 | 规格二.4 |
| 取消机制 | 内部 `CancellationToken`（AbortSignal 语义）；Compatibility Layer 翻译协议取消 | 规格二.2 |
| In-flight 暴露 | `vision.operation.get` 轮询 + 唯一索引兜底 | 规格五.2 |

## Contract Clarifications（规格四类：契约边缘解释，不引入新实体）

| 条目 | 内容 |
|---|---|
| Observation 证据文本 | `vision.observe` 的 Provider 原文证据承载于 Observation 可选字段 `text`（仅 `visual_evidence` 标签使用）；结构化结果走 ToolResult structuredContent |
| confidence 缺失 | Provider（如 Agnes）不提供置信度时，`confidence.value = null`，`limitations` 注明 `confidence_not_provided_by_provider`；字段存在性满足规格"必须包含" |
| model_version | Provider 无官方版本号时记录其实际模型标识（如 `agnes-2.5-flash`），属"实际执行来源"如实记录，永不漂移 |
| OperationRecord.result | Operation 执行结果（含失败错误信息）承载于可选字段 `result`/`error`，仅作状态暴露实现，不影响身份字段不可变性 |

## Protocol Adapter Issues（规格三类：Host 兼容性微调，不影响 Vision Core）

| 条目 | 内容 |
|---|---|
| SDK 参数预校验 | SDK 1.30 的 `registerTool` 会先按 inputSchema 校验参数，形状错误在 executor 之前以 isError 工具结果返回（事实陈述）；应用级语义错误（如 OPERATION_ID_CONFLICT）仍由 executor 以 `application_error_code` 返回 |
| SDK 资源回调签名 | `registerResource` 模板回调为 `(uri: URL, variables, extra)`，非 request 对象 |
| 无 key 优雅降级 | AGNES_API_KEY 缺失时服务器照常启动；observe 返回"不可执行 + 约束保留"评估事实（非错误） |

## 待办决策（不阻塞 V1 当前进度）

- 并发/限流：令牌桶参数（vision-interface 实现时定）
- Session 级并发队列深度（同上）
- Retention 自动清理任务（Operation 7 天 / Artifact 24h 的定时器实现）
- V1 工具实为 8 个（决策清单中"7 个"为笔误，实际枚举即 8 个：session.create/get/delete + observe/detect/ocr + operation.get/cancel）
