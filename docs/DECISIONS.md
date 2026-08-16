# 决策记录（Decision Log）

本文件按规格《MCP Vision Server 架构与接口规格说明书》V3.7 的**变更分类器**记录开发期决策。
Frozen Contract 不可在此变更；新问题必须归类为五类之一：
**Bug / Implementation Decision / Protocol Adapter Issue / Contract Clarification / Protocol Compliance Issue**。

## Implementation Decisions（规格 B 类：开发阶段确定）

| 决策项 | 取值 | 依据/备注 |
|---|---|---|
| Provider 适配策略 | 通用 `OpenAICompatibleAdapter`（可配置 providerId/baseUrl/apiKey/model）覆盖全部 OpenAI 兼容厂商（Agnes/千问/豆包/GPT/网关）；Agnes 为内置便捷配置形态（`AGNES_*` env 快捷方式，**非默认模型**）；非 OpenAI 兼容协议形态（Anthropic 原生/Gemini 原生）按 `VLMProvider` 接口新增 Adapter 类 | 规格一.2 模型独立；Agent 经 `provider_id` 显式选择，绝无自动路由；**本系统不预设默认模型，用哪个模型由用户配置决定** |
| Provider 装配 | `VISION_PROVIDERS_JSON` 数组（{providerId, apiKey, baseUrl?, model?, displayName?}）；`AGNES_*` env 兼容旧配置（追加注册，无优先地位）；多家并存 | 规格 B 类；用户配置顺序即 `provider_id` 缺省选择，非"默认模型" |
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
| Artifact 生产者 | V1 工具全部输出文本证据，无二进制产物生产者；Tier 1/2 机制（存储/读取/URI 模板）在位，待有产物工具（如 mask/裁剪）时启用 |
| label 语义边界防线 | Server 不做领域语义解释（感知边界）；detect 的 label 白名单由 Agent 声明，json_mode 的 label 来自模型输出——语义合规靠工具契约保证，运行时不过滤 |
| 坐标系 | V1 仅 `image_px`（规格 Future Extensions 允许视频/点云扩展） |
| IQA 实现范围 | `max_image_size`（字节）与 `max_dimension`（长边像素）约束 + 可解码性/尺寸解析（PNG/GIF/BMP/JPEG）；结果只进 ExecutabilityAssessment（Execution Metadata），绝不进图谱 |

## Protocol Adapter Issues（规格三类：Host 兼容性微调，不影响 Vision Core）

| 条目 | 内容 |
|---|---|
| SDK 参数预校验 | SDK 1.30 的 `registerTool` 会先按 inputSchema 校验参数，形状错误在 executor 之前以 isError 工具结果返回（事实陈述）；应用级语义错误（如 OPERATION_ID_CONFLICT）仍由 executor 以 `application_error_code` 返回 |
| SDK 资源回调签名 | `registerResource` 模板回调为 `(uri: URL, variables, extra)`，非 request 对象 |
| 无 key 优雅降级 | AGNES_API_KEY 缺失时服务器照常启动；observe 返回"不可执行 + 约束保留"评估事实（非错误） |

## 外部审查修复记录（2026 一次只读审查，9 项全部处置）

| # | 问题 | 处置 |
|---|---|---|
| 1 | operation.cancel 不中止执行，取消变 VISION_INTERNAL | 修复：in-flight 映射（operation_id → CancellationTokenSource），cancel 工具先 abort 再落状态；finish 幂等化（终态直接返回现有记录）；新增真实中止测试 |
| 2 | 超时与取消混淆 | 修复：`isTimeoutAbort`（AbortSignal.timeout reason 判定）；Fetch Boundary 超时 → SECURITY_URI_DENIED(reason=timeout)，Adapter 超时 → PROVIDER_TIMEOUT（该错误码首次被使用）；用户取消原样上抛 |
| 3 | CI 根目录跑 stdio 冒烟 MODULE_NOT_FOUND | 修复：脚本改绝对路径（fileURLToPath）+ workflow 加 working-directory |
| 4 | idempotentHint: true 与实现不一致 | 修复：observe/detect/ocr 标 false；幂等保证只来自显式 operation_id |
| 5 | closed Session 仍可用 | 修复：新增 SESSION_CLOSED；执行类操作拒绝 closed，读取保留证据（session.get/重复 delete）允许（allowClosed）；重复 delete 幂等 |
| 6 | 结构化结果不按契约校验 | 修复：graph.commitObservation 入库前 Observation.safeParse（Commit Boundary 前置校验）；detect 要求 bbox 合法（坐标序+图像边界），observe 模式非法 bbox 降级 full_image；confidence 超界置 null |
| 7 | content 数组/response_format 覆盖不足 | 修复：extractContent 支持 content block 数组；jsonMode 携带 response_format，400 时降级重试一次 |
| 8 | Registry 无 TTL + 串行探针 | 修复：启动探针并行（Promise.all）；新增 VISION_PROBE_INTERVAL_HOURS（默认 24h，0=关闭）定时刷新，unref 不阻塞退出 |
| 9 | 输入边界边缘问题 | 部分修复：非法 URI → VISION_INVALID_IMAGE_INPUT；inline 解码后字节复查；参数身份最小语义归一（URI WHATWG 归一、MIME 小写去参数）；完整语义等价规范化（默认值/数值形式）记为已知限制；InMemory 事务不回滚由 SQLite(:memory:) 真实事务测试覆盖 |

## 待办决策（不阻塞 V1 当前进度）

- 并发/限流：令牌桶参数（vision-interface 实现时定）
- Session 级并发队列深度（同上）
- Retention 自动清理任务（Operation 7 天 / Artifact 24h 的定时器实现）
- V1 工具实为 8 个（决策清单中"7 个"为笔误，实际枚举即 8 个：session.create/get/delete + observe/detect/ocr + operation.get/cancel）

## v0.2.1 / v0.3 观察档位与结构化观察契约（2026-08 讨论收敛）

### profile 定位（v0.2.1）
- `profile: "default" | "deep"`（工具参数，缺省 default；服务端 `VISION_DEFAULT_PROFILE` 定部署基调）。
- **Profile 是指令预设（instruction preset），不是能力预设（capability preset）**：deep 只替换发给 VLM 的默认指令（纳入水印/细小文字/细粒度特征），
  绝不自动开启结构化观察、不增加观察维度、不切换模型、不改变失败策略、不启用其他工具。
- 触发语义：**仅当用户明确要求"更深入/更深层次/更专业"时才由 Agent 传递 profile=deep；无明确指示一律 default**。服务器不做自动检测/自动升级。
- `instruction`（Agent 显式提供）优先级高于 profile；`VISION_DEFAULT_INSTRUCTION` 仅作用于 default 档。

### v0.3 声明式结构化观察契约（Decisions，实现前钉死）
1. **两级门禁**：Declared Dimension → 能力探针验证（未验证 → NOT_EXECUTABLE）→ 当前输入 IQA（不可执行 → NOT_EXECUTABLE）→ 观察 → 逐字段 value/unknown。
   探针通过 ≠ 当前图片一定可可靠观察；探针只验证"能力存在"，可执行性由 IQA 逐次判定（对应 V3.7：Declared → Verified → Effective → Final Executable）。
2. **unknown 是证据值，reason 是证据状态**：字段级 unknown 必须携带 reason，枚举（封闭）：
   `insufficient_visual_evidence` / `occluded` / `ambiguous` / `not_applicable` / `unsupported` / `execution_unavailable`。
   其中 `unsupported`（维度未获探针支持）与 `execution_unavailable`（服务器/运行时不可执行）必须与普通视觉 unknown 严格区分——Agent 不得把"模型看到了但判断不了"与"服务器没有能力执行"混为一谈。
3. **DSL 边界**：声明式能力只允许描述"观察什么 + 结果以什么结构表达"；禁止推理/组合/筛选/比较/决策语义（如"若红色区域超过 30% 则判定……"属于大脑职责，挡在 Vision Server 之外）。
4. **失败语义两级**：字段 unknown（模型明说无法确定，合法证据）与整体 parse_failed（结构损坏/截断，如实失败）并行，各守其位。
5. **能力准入测试（长期原则）**：新增功能的唯一准入问题是"这是否是一个新的视觉事实获取能力？"；涉及判断/决策/审核语义的请求一律挡在边界外。

### 路线（一座碑一座碑）
v0.2.1（profile 指令预设 + instruction 第一接口文档化）→ v0.3（声明式结构化观察）→ v0.4（按需：审计导出/区域对应）。

## v0.4 Session 审计（2026-08 决策）
- 工具：`vision.session.audit`（第 10 个工具，专业模块）。
- **按需调用，绝不主动输出**：仅当用户明确要求审计/记录/汇总/导出时，Agent 才调用；无明确指示时不产生、不附带任何审计内容（与"识别≠深入分析"同一哲学：一切能力按需服务，绝不自动升级）。
- 被调用时：默认返回操作级汇总（时间/工具/状态/执行者/失败原因）；`include_observations=true` 附已提交观察的全量元数据（label/location/confidence/limitations/source；location 即区域对应，detect 的 bbox 原样呈现）。
- 数据来源：既有 Operation/Observation 记录（retention 窗口内：操作 7 天/证据 24h，超出自动清理后审计自然截断，如实呈现）。
