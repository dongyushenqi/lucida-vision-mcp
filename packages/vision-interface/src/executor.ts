/**
 * Vision 工具执行编排（Layer 3 核心）。
 *
 * 职责：Tool 路由 + 幂等控制（operation_id 去重/冲突/In-flight）+ Session 授权沙箱
 * + 图像解析（统一 Fetch Boundary / resource_ref 授权 dereference）+ 能力门禁
 * + Observation 构建与提交（Commit Boundary）+ Operation 生命周期。
 *
 * 边界纪律：
 * - 输出只有视觉事实与操作状态，零建议字段（规格一.1）；
 * - 取消 → Operation cancelled（非错误）；能力不可执行 → 事实性评估（非错误）；
 * - provider 显式选择，无任何路由/故障转移逻辑。
 */
import {
  ApplicationErrorCode,
  VisionError,
  type CapabilityId,
  type Confidence,
  type ImageInput,
  type Location,
  type Observation,
  type OperationRecord,
  type ProviderSource,
} from "@mcp-vision/contracts";
import {
  genId,
  isOperationCancelled,
  readImageDimensions,
  type CancellationTokenSource,
  type FetchedImage,
  type VLMProvider,
  type VisionCore,
} from "@mcp-vision/vision-core";
import { assessImage } from "@mcp-vision/vision-core";
import { z } from "zod";
import {
  DetectArgs,
  ObserveArgs,
  OcrArgs,
  OperationCancelArgs,
  OperationGetArgs,
  SessionCreateArgs,
  SessionDeleteArgs,
  SessionGetArgs,
  SummarizeArgs,
  type ObservationSchema,
} from "./args.js";
import type { IdentityContext } from "./identity.js";
import { parseVisionResourceUri } from "./resources.js";
import { SessionSandbox } from "./session-sandbox.js";

/**
 * 默认综合概述指令（仅当 Agent 未提供 instruction 时使用；批量散文式，{n} 为图片张数）。
 * 与 observe 校准口径一致：客观特征必述 / 忽略水印等细碎元素 / 主观评价三档 / 不推断不编造。
 */
export const DEFAULT_SUMMARIZE_INSTRUCTION =
  "综合概述这批图片（共 {n} 张）：提炼共同主题、显著差异与整体印象，用连贯的散文呈现，" +
  "不要逐张罗列每张图的细节。" +
  "只描述可观察的客观特征，必须如实给出；主体是什么就描述什么（人物/风景/物品等）。" +
  "默认忽略水印与细小标识的文字转录、无关背景细节。\n" +
  "主观评价（美丑、性感、魅力等）因人而异，但存在多数人的审美共识：" +
  "默认不主动输出；当用户明确要求时，基于可观察的客观特征给出评价，" +
  "可参考普遍审美标准，并说明支撑评价的可见依据；分歧空间可如实提及，但不得以“主观”为由拒绝回答。\n" +
  "不推断、不编造：观察不到的不虚构；不确定的明确标注不确定；职业、健康状况、拍摄意图等推断不得输出。";

/**
 * 深入观察指令（profile=deep 预置包；仅当用户明确要求"更深入/更专业"时使用）。
 * 与默认档同一校准原则（主观三档 / 不推断不编造），差异仅在观察粒度：
 * 水印、细小文字与标识默认纳入，细粒度特征如实给出。指令预设，非能力预设。
 */
export const DEFAULT_DEEP_OBSERVE_INSTRUCTION =
  "深入观察这张图片，描述全部可观察的客观特征，务必包含通常会被忽略的细节：" +
  "水印、招牌、细小文字与标识（含其位置与内容）、材质与纹理、光线与阴影、细微差异。" +
  "主体是什么就描述什么（人物/风景/物品等），一切可观察的形态、颜色、质感、比例、细节都是事实；" +
  "示例仅为示意，切勿局限于示例，也不得编造示例之外类别的特征。\n" +
  "主观评价（美丑、性感、魅力等）因人而异，但存在多数人的审美共识：" +
  "默认不主动输出；当用户明确要求时，基于可观察的客观特征给出评价，" +
  "可参考普遍审美标准，并说明支撑评价的可见依据；分歧空间可如实提及，但不得以“主观”为由拒绝回答。\n" +
  "不推断、不编造：观察不到的不虚构；不确定的明确标注不确定；职业、健康状况、拍摄意图等推断不得输出。";

/**
 * 深入综合概述指令（summarize + profile=deep 预置包）：纳入水印/细小文字的异同比较，分主题组织，不逐张罗列。
 */
export const DEFAULT_DEEP_SUMMARIZE_INSTRUCTION =
  "综合概述这批图片（共 {n} 张），深入比较：共同出现的全部显著特征与差异（含水印、招牌、细小文字与标识的异同）、" +
  "细节差异、整体印象。用连贯的散文呈现，可以分主题组织，但不要为每张图单独罗列段落。" +
  "只描述可观察的客观特征，必须如实给出。\n" +
  "主观评价（美丑、性感、魅力等）因人而异，但存在多数人的审美共识：" +
  "默认不主动输出；当用户明确要求时，基于可观察的客观特征给出评价，" +
  "可参考普遍审美标准，并说明支撑评价的可见依据；分歧空间可如实提及，但不得以“主观”为由拒绝回答。\n" +
  "不推断、不编造：观察不到的不虚构；不确定的明确标注不确定；职业、健康状况、拍摄意图等推断不得输出。";

/** 默认观察指令（仅当 Agent 未提供 instruction 时使用；v0.1.3 校准版）：
 * 聚焦图片主体；水印/细小标识默认不转录；客观特征必须如实描述；
 * 主观评价默认不主动输出，用户明确要求时基于可观察特征按审美共识给出；
 * 不推断、不编造。
 */
export const DEFAULT_OBSERVE_INSTRUCTION =
  "描述图片中所有可观察的客观特征，必须如实给出。主体是什么就描述什么：" +
  "人物则描述动作、姿态与外观形态（如高矮胖瘦、胖瘦程度、匀称与否、穿着打扮等实际可见的特征）；" +
  "风景则描述场景构成（地形、植被、建筑、光线、天气等可见要素）；" +
  "物品则描述结构、材质与布局。" +
  "一切可观察的形态、颜色、质感、比例都是事实；示例仅为示意，切勿局限于示例，也不得编造示例之外类别的特征。\n" +
  "默认不输出：水印与细小标识的文字转录、无关背景细节。\n" +
  "主观评价（美丑、性感、魅力等）因人而异，但存在多数人的审美共识：" +
  "默认不主动输出；当用户明确要求时，基于可观察的客观特征给出评价，" +
  "可参考普遍审美标准，并说明支撑评价的可见依据；分歧空间可如实提及，但不得以“主观”为由拒绝回答。\n" +
  "不推断、不编造：观察不到的不虚构；不确定的明确标注不确定；职业、健康状况、拍摄意图等推断不得输出。";

export interface ToolResult {
  isError: boolean;
  textBlocks: string[];
  structured?: Record<string, unknown>;
  resourceRefs: string[];
}

export interface ExecuteRequest {
  toolName: string;
  args: Record<string, unknown>;
  identity: IdentityContext;
  cancel: CancellationTokenSource;
}

export interface ExecuteResponse {
  result: ToolResult;
  operation?: OperationRecord;
  deduplicated?: boolean;
  inFlight?: boolean;
}

type VisualKind = "observe" | "detect" | "ocr" | "summarize";

interface VisualArgs {
  vision_session_id: string;
  image_input?: ImageInput;
  image_inputs?: ImageInput[];
  provider_id?: string;
  operation_id?: string;
  json_mode?: boolean;
  instruction?: string;
  profile?: "default" | "deep";
  observation_schema?: ObservationSchema;
  labels?: string[];
  lang?: string;
}

export class VisionExecutor {
  private readonly sandbox: SessionSandbox;
  private readonly defaultProviderId: string;
  /** 默认观察/概述指令（VISION_DEFAULT_INSTRUCTION 注入，可为空；各工具回落各自内置默认） */
  private readonly defaultInstruction?: string;
  /** 默认观察档位（VISION_DEFAULT_PROFILE 注入；缺省 default；deep 仅当用户明确要求时使用） */
  private readonly defaultProfile: "default" | "deep";
  /** in-flight 取消映射（审查 #1）：operation_id → 执行中的 CancellationTokenSource */
  private readonly inflight = new Map<string, CancellationTokenSource>();
  /** 本请求结构化解析是否发生截断（膨胀防御，随 summary 输出后复位） */
  private lastStructuredTruncated = false;

  constructor(
    private readonly core: VisionCore,
    opts?: { defaultProviderId?: string; defaultInstruction?: string; defaultProfile?: "default" | "deep" },
  ) {
    this.sandbox = new SessionSandbox(core);
    // VISION_DEFAULT_INSTRUCTION 注入（可为空）；各工具按需回落各自的默认指令
    this.defaultInstruction = opts?.defaultInstruction;
    // VISION_DEFAULT_PROFILE 注入（缺省 default；deep 仅当用户明确要求时使用）
    this.defaultProfile = opts?.defaultProfile ?? "default";
    // 不预设默认模型：未指定 provider_id 时按注册顺序取第一个执行者（静态默认，非自动路由/故障转移）
    const providers = core.providers.all();
    this.defaultProviderId = opts?.defaultProviderId ?? providers[0]?.providerId ?? "";
  }

  /** 统一入口：领域错误一律转为 isError 结果，绝不向上抛（取消与能力不可执行也不是错误）。 */
  async execute(req: ExecuteRequest): Promise<ExecuteResponse> {
    try {
      return await this.dispatch(req);
    } catch (err) {
      if (err instanceof VisionError) {
        return { result: this.result({ error: err.toApplicationErrorData() }, true) };
      }
      const internal = new VisionError(ApplicationErrorCode.VISION_INTERNAL, "内部错误");
      return { result: this.result({ error: internal.toApplicationErrorData() }, true) };
    }
  }

  private async dispatch(req: ExecuteRequest): Promise<ExecuteResponse> {
    switch (req.toolName) {
      case "vision.session.create":
        return this.sessionCreate(req);
      case "vision.session.get":
        return this.sessionGet(req, this.parse(SessionGetArgs, req));
      case "vision.session.delete":
        return this.sessionDelete(req, this.parse(SessionDeleteArgs, req));
      case "vision.observe":
        return this.runVisual(req, this.parse(ObserveArgs, req), "observe");
      case "vision.summarize":
        return this.runVisual(req, this.parse(SummarizeArgs, req), "summarize");
      case "vision.detect":
        return this.runVisual(req, this.parse(DetectArgs, req), "detect");
      case "vision.ocr":
        return this.runVisual(req, this.parse(OcrArgs, req), "ocr");
      case "vision.operation.get":
        return this.operationGet(req, this.parse(OperationGetArgs, req));
      case "vision.operation.cancel":
        return this.operationCancel(req, this.parse(OperationCancelArgs, req));
      default:
        throw new VisionError(ApplicationErrorCode.VISION_TOOL_NOT_FOUND, "未知工具", {
          tool_name: req.toolName,
        });
    }
  }

  /* ------------------------------------------------------------ */
  /* Session 工具                                                    */
  /* ------------------------------------------------------------ */

  private async sessionCreate(req: ExecuteRequest): Promise<ExecuteResponse> {
    this.parse(SessionCreateArgs, req);
    const session = this.core.sessions.create(req.identity.principalId, req.identity.tenantId);
    return {
      result: this.result({
        vision_session_id: session.vision_session_id,
        principal_id: session.principal_id,
        tenant_id: session.tenant_id,
        status: session.status,
        created_at: session.created_at,
      }),
    };
  }

  private async sessionGet(req: ExecuteRequest, args: z.infer<typeof SessionGetArgs>): Promise<ExecuteResponse> {
    // 读取保留证据允许 closed（审查 #5：关闭仅禁止新的执行类操作）
    const session = this.sandbox.authorize(args.vision_session_id, req.identity, { allowClosed: true });
    return {
      result: this.result({
        vision_session_id: session.vision_session_id,
        principal_id: session.principal_id,
        tenant_id: session.tenant_id,
        status: session.status,
        created_at: session.created_at,
      }),
    };
  }

  private async sessionDelete(req: ExecuteRequest, args: z.infer<typeof SessionDeleteArgs>): Promise<ExecuteResponse> {
    // 已关闭会话的重复 delete = 幂等 no-op（审查 #5）
    this.sandbox.authorize(args.vision_session_id, req.identity, { allowClosed: true });
    const session = this.core.sessions.close(args.vision_session_id);
    return {
      result: this.result({
        vision_session_id: session.vision_session_id,
        status: session.status,
      }),
    };
  }

  /* ------------------------------------------------------------ */
  /* Operation 工具                                                  */
  /* ------------------------------------------------------------ */

  private async operationGet(req: ExecuteRequest, args: z.infer<typeof OperationGetArgs>): Promise<ExecuteResponse> {
    // 读取保留证据允许 closed（审查 #5：关闭仅禁止新的执行类操作）
    this.sandbox.authorize(args.vision_session_id, req.identity, { allowClosed: true });
    const op = this.core.operations.get(args.vision_session_id, args.operation_id);
    if (!op) {
      throw new VisionError(ApplicationErrorCode.OPERATION_NOT_FOUND, "operation 不存在", {
        vision_session_id: args.vision_session_id,
        operation_id: args.operation_id,
      });
    }
    return { result: this.result({ operation: summarizeOperation(op) }), operation: op };
  }

  private async operationCancel(req: ExecuteRequest, args: z.infer<typeof OperationCancelArgs>): Promise<ExecuteResponse> {
    this.sandbox.authorize(args.vision_session_id, req.identity);
    const existing = this.core.operations.get(args.vision_session_id, args.operation_id);
    if (!existing) {
      throw new VisionError(ApplicationErrorCode.OPERATION_NOT_FOUND, "operation 不存在", {
        vision_session_id: args.vision_session_id,
        operation_id: args.operation_id,
      });
    }
    if (existing.status === "running") {
      // 审查 #1：先中止底层执行（in-flight 映射 → CancellationTokenSource），再落状态
      const token = this.inflight.get(this.inflightKey(args.vision_session_id, args.operation_id));
      if (token) {
        token.cancel();
      }
      const op = this.core.operations.cancel(args.vision_session_id, args.operation_id);
      return { result: this.result({ operation: summarizeOperation(op) }), operation: op };
    }
    // 已终止的 operation 取消 = 幂等 no-op（取消本身不是错误）
    return { result: this.result({ operation: summarizeOperation(existing) }), operation: existing };
  }

  /* ------------------------------------------------------------ */
  /* 视觉工具（observe / detect / ocr）                                */
  /* ------------------------------------------------------------ */

  private async runVisual(
    req: ExecuteRequest,
    args: VisualArgs,
    kind: VisualKind,
  ): Promise<ExecuteResponse> {
    const sessionId = args.vision_session_id;
    this.sandbox.authorize(sessionId, req.identity);

    // 幂等入口：operation_id 去重作用域 = Vision Session（规格五.2）
    const operationId = args.operation_id ?? genId("op");
    const begun = this.core.operations.begin(sessionId, operationId, req.toolName, req.args);
    if (begun.deduplicated) {
      // In-flight / 已终止：不创建第二次执行，暴露既有状态（规格五.2）
      return {
        result: this.result({
          operation: summarizeOperation(begun.record),
          deduplicated: true,
          in_flight: begun.inFlight,
        }),
        operation: begun.record,
        deduplicated: true,
        inFlight: begun.inFlight,
      };
    }

    try {
      // in-flight 注册（审查 #1）：(session, operation_id) → CancellationTokenSource，供 operation.cancel 中止
      this.inflight.set(this.inflightKey(sessionId, operationId), req.cancel);

      // 图像解析：uri/inline 走统一 Fetch Boundary；resource_ref 先授权后 dereference。
      // summarize 批量解析：任一图片失败 → 整体失败（诚实，不静默丢弃）
      const images =
        kind === "summarize"
          ? await Promise.all(
              (args.image_inputs ?? []).map((input) =>
                this.resolveImage(input, sessionId, req.identity, req.cancel.signal),
              ),
            )
          : [await this.resolveImage(args.image_input!, sessionId, req.identity, req.cancel.signal)];

      const provider = this.core.providers.get(args.provider_id ?? this.defaultProviderId);

      const jsonMode =
        kind === "detect" ||
        (kind === "observe" && (args.json_mode === true || args.observation_schema !== undefined));
      const required: CapabilityId[] =
        kind === "observe" ? (jsonMode ? ["image_understanding", "structured_detection"] : ["image_understanding"])
        : kind === "summarize" ? ["image_understanding"]
        : kind === "ocr" ? ["ocr"]
        : ["structured_detection"];

      // 能力门禁：Final Executable = Effective ∩ IQA（仅描述可行性；IQA 结果不进图谱）
      const assessment = this.executability(provider, required, images);
      if (!assessment.executable) {
        const finished = this.core.operations.finish(sessionId, operationId, {
          status: "completed",
          result: { executable: false, reasons: assessment.reasons, provider: provider.providerId },
        });
        return {
          result: this.result({ operation: summarizeOperation(finished), executability: assessment }),
          operation: finished,
        };
      }

      const instruction = this.buildInstruction(kind, args);
      const providerResult = await provider.execute(
        { images, instruction, jsonMode },
        req.cancel.signal,
      );

      // summarize 至少 1 张图（zod 保证），此处取首图仅供结构化分支读取尺寸
      const observations = this.buildObservations(kind, providerResult, provider, operationId, args, images[0]!);
      const committed = observations.map((o) => this.core.graph.commitObservation(sessionId, o));

      const summary = {
        observations: committed.map(summarizeObservation),
        provider: provider.providerId,
        ...(this.lastStructuredTruncated ? { limitations: ["too_many_objects"] } : {}),
      };
      this.lastStructuredTruncated = false;
      const finished = this.core.operations.finish(sessionId, operationId, {
        status: "completed",
        result: summary,
      });
      return { result: this.result(summary), operation: finished };
    } catch (err) {
      // 取消：Operation → cancelled，已 committed 证据保留（规格二.2）；取消不是 Tool Error
      if (isOperationCancelled(err) || req.cancel.isCancelled) {
        const op = this.core.operations.cancel(sessionId, operationId);
        return {
          result: this.result({ operation: summarizeOperation(op), cancelled: true }),
          operation: op,
        };
      }
      // 应用级错误：事实 + 恢复属性，无建议（finish 已幂等：被 cancel 工具抢先置终态时返回现有记录）
      if (err instanceof VisionError) {
        const op = this.core.operations.finish(sessionId, operationId, {
          status: "failed",
          error: err.toApplicationErrorData(),
        });
        return {
          result: this.result(
            { operation: summarizeOperation(op), error: err.toApplicationErrorData() },
            true,
          ),
          operation: op,
        };
      }
      // 未知异常：内部错误事实化
      const internal = new VisionError(ApplicationErrorCode.VISION_INTERNAL, "内部错误");
      const op = this.core.operations.finish(sessionId, operationId, {
        status: "failed",
        error: internal.toApplicationErrorData(),
      });
      return {
        result: this.result(
          { operation: summarizeOperation(op), error: internal.toApplicationErrorData() },
          true,
        ),
        operation: op,
      };
    } finally {
      this.inflight.delete(this.inflightKey(sessionId, operationId));
    }
  }

  /** in-flight 取消映射的作用域与 Operation 去重一致：Vision Session。 */
  private inflightKey(sessionId: string, operationId: string): string {
    return `${sessionId}/${operationId}`;
  }

  /* ------------------------------------------------------------ */
  /* 内部辅助                                                        */
  /* ------------------------------------------------------------ */

  private parse<S extends z.ZodType>(schema: S, req: ExecuteRequest): z.infer<S> {
    const parsed = schema.safeParse(req.args);
    if (!parsed.success) {
      throw new VisionError(ApplicationErrorCode.VISION_INVALID_ARGS, "工具参数不合法", {
        tool_name: req.toolName,
        issues: parsed.error.issues.map((i: z.ZodIssue) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    return parsed.data;
  }

  /** 图像解析：resource_ref 必须先做 Session 归属/授权校验（规格四.1）。 */
  private async resolveImage(
    imageInput: ImageInput,
    sessionId: string,
    identity: IdentityContext,
    signal: AbortSignal,
  ): Promise<FetchedImage> {
    if (imageInput.type === "resource_ref") {
      const parsed = parseVisionResourceUri(imageInput.resource_ref);
      if (!parsed) {
        throw new VisionError(ApplicationErrorCode.VISION_INVALID_IMAGE_INPUT, "resource_ref 非本 Server 资源", {
          resource_ref: imageInput.resource_ref,
        });
      }
      // 严禁 resource_ref 成为跨 Session 越权读取入口
      if (parsed.sessionId !== sessionId) {
        throw new VisionError(ApplicationErrorCode.RESOURCE_AUTHORIZATION_DENIED, "resource_ref 指向其他 Session", {
          resource_ref: imageInput.resource_ref,
        });
      }
      this.sandbox.authorize(parsed.sessionId, identity);
      const artifact = this.core.artifacts.get(parsed.sessionId, parsed.artifactId);
      if (!artifact) {
        throw new VisionError(ApplicationErrorCode.RESOURCE_NOT_FOUND, "Artifact 不存在", {
          artifact_id: parsed.artifactId,
        });
      }
      return {
        bytes: artifact.bytes,
        mimeType: artifact.metadata.mime_type,
        declaredMimeType: artifact.metadata.mime_type,
        contentLength: artifact.metadata.content_length,
        source: imageInput.resource_ref,
      };
    }
    // URI 授权边界：Fetch Boundary 依 Principal/Tenant + 资源来源策略判断可否获取
    return this.core.fetchBoundary.resolve(
      imageInput,
      signal,
      { principalId: identity.principalId, tenantId: identity.tenantId },
    );
  }

  /** Final Executable Capability 评估：Effective ∩ IQA，只陈述可行性事实（无任何建议字段）。 */
  private executability(
    provider: VLMProvider,
    required: CapabilityId[],
    images?: FetchedImage[],
  ): {
    executable: boolean;
    reasons: string[];
    provider: string;
    constraints: unknown;
    iqa?: unknown;
  } {
    const effective = this.core.capabilities.effective(provider.providerId);
    const constraints = effective?.constraints ?? provider.declare().constraints;
    if (!effective) {
      return {
        executable: false,
        reasons: ["provider 能力未经验证（Effective Capability 缺失）"],
        provider: provider.providerId,
        constraints,
      };
    }
    const missing = required.filter((c) => !effective.capabilities.includes(c));
    if (missing.length > 0) {
      return {
        executable: false,
        reasons: missing.map((c) => `能力 ${c} 未通过验证，当前输入不可执行`),
        provider: provider.providerId,
        constraints,
      };
    }
    // IQA Capability Assessment：默认属于 Execution Metadata（IQA Result Semantics 封口），
    // 代码路径上只进评估结果，绝不进入 Observation Graph。
    // 批量输入（summarize）：任一图片不满足模型约束 → 整体不可执行（诚实，不静默丢弃）。
    if (images && images.length > 0) {
      for (let i = 0; i < images.length; i += 1) {
        const img = images[i]!;
        const iqa = assessImage(img.bytes, img.mimeType, constraints);
        if (!iqa.executable) {
          return {
            executable: false,
            // 批量输入带索引（定位失败图片）；单图保持原前缀（兼容既有行为）
            reasons: iqa.reasons.map((r) =>
              images.length > 1 ? `IQA(img[${i}]): ${r}` : `IQA: ${r}`,
            ),
            provider: provider.providerId,
            constraints,
            iqa,
          };
        }
      }
    }
    return { executable: true, reasons: [], provider: provider.providerId, constraints, iqa: undefined };
  }

  private buildInstruction(kind: VisualKind, args: VisualArgs): string {
    // 优先级：Agent 显式 instruction > profile 档位（deep=预置深入指令包）> env 默认指令 > 内置默认
    const profile = args.profile ?? this.defaultProfile;
    switch (kind) {
      case "observe":
        if (args.observation_schema) {
          // 声明式结构化观察（v0.3）：结构契约由 Server 强制，Agent instruction 仅作语义前缀
          const structured =
            `仅输出一个 JSON 对象，不要任何其他文字：{"<维度名>": <值>}。` +
            `每个维度的值必须是该维度的可观察客观事实；` +
            `若无法可靠观察，值为 "unknown" 且必须附带 reason 字段，` +
            `reason 只能是以下枚举之一：insufficient_visual_evidence / occluded / ambiguous / ` +
            `not_applicable / unsupported / execution_unavailable。绝不猜测。` +
            `观察维度：${args.observation_schema.dimensions.join("、")}。`;
          return args.instruction ? `${args.instruction}\n${structured}` : structured;
        }
        if (args.instruction) return args.instruction;
        if (profile === "deep") return DEFAULT_DEEP_OBSERVE_INSTRUCTION;
        return this.defaultInstruction ?? DEFAULT_OBSERVE_INSTRUCTION;
      case "summarize": {
        const n = String(args.image_inputs?.length ?? 0);
        if (args.instruction) return args.instruction;
        if (profile === "deep") return DEFAULT_DEEP_SUMMARIZE_INSTRUCTION.replace("{n}", n);
        return this.defaultInstruction ?? DEFAULT_SUMMARIZE_INSTRUCTION.replace("{n}", n);
      }
      case "detect": {
        const labels = (args.labels ?? []).join("、");
        return (
          `找出图中所有属于以下类别之一的对象，仅输出 JSON，不要任何其他文字：` +
          `{"objects":[{"label":"<类别名>","bbox":[x1,y1,x2,y2]}]}。` +
          `类别：${labels}。若未发现任何对象则输出 {"objects":[]}。`
        );
      }
      case "ocr": {
        const lang = args.lang;
        return `提取图中所有文字内容，尽量保持原始排版与换行。${lang ? `（语言提示：${lang}）` : ""}`;
      }
    }
  }

  /** 构建 Observation（感知增强，非决策替代）。 */
  private buildObservations(
    kind: VisualKind,
    providerResult: { text: string; providerMeta: Omit<ProviderSource, "adapter_version"> },
    provider: VLMProvider,
    operationId: string,
    args: VisualArgs,
    image: FetchedImage,
  ): Observation[] {
    const source: ProviderSource = {
      provider: providerResult.providerMeta.provider,
      model: providerResult.providerMeta.model,
      model_version: providerResult.providerMeta.model_version,
      adapter_version: provider.adapterVersion,
      execution_timestamp: providerResult.providerMeta.execution_timestamp,
    };
    const base: Omit<Observation, "observation_id" | "label" | "text"> = {
      schema_version: 1,
      location: { type: "full_image", coordinate_system: "image_px" },
      confidence: { value: null, semantics: "provider_defined" },
      source,
      lineage: { operation_id: operationId, derivation: "direct", parents: [] },
      limitations: [],
      status: "pending",
      created_at: "",
    };

    // 声明式结构化观察（v0.3）：逐维度 value / unknown+reason；结构损坏 → structured_parse_failed
    if (kind === "observe" && args.observation_schema) {
      const parsed = parseDimensionObservation(providerResult.text, args.observation_schema.dimensions);
      return [
        this.toObservation(
          base,
          "structured_observation",
          { type: "full_image", coordinate_system: "image_px" },
          null,
          operationId,
          provider,
          parsed.ok ? JSON.stringify(parsed.map) : providerResult.text,
          parsed.ok ? [] : ["structured_parse_failed"],
        ),
      ];
    }

    if (kind === "detect" || (kind === "observe" && args.json_mode === true)) {
      // 契约校验（审查 #6）：detect 要求 bbox 存在且合法（坐标序 + 图像边界）；
      // confidence 必须在 0..1；不合格项丢弃，全部不合格 → structured_parse_failed
      const { width, height } = readImageDimensions(image.bytes, image.mimeType);
      const structured = parseStructuredObservations(providerResult.text, {
        requireBbox: kind === "detect",
        width,
        height,
        allowedLabels: kind === "detect" ? args.labels : undefined,
      });
      if (structured) {
        // 膨胀防御（外部审查建议）：超限截断如实标记，不静默吞
        this.lastStructuredTruncated = structured.truncated;
        return structured.objects.map((o) => {
          const limitations = [
            ...(o.confidenceInvalid
              ? ["confidence_invalid"]
              : o.confidence === undefined
                ? ["confidence_not_provided_by_provider"]
                : []),
          ];
          return this.toObservation(
            base,
            o.label,
            o.bbox
              ? { type: "bbox", bbox: o.bbox, coordinate_system: "image_px" }
              : { type: "full_image", coordinate_system: "image_px" },
            o.confidence ?? null,
            operationId,
            provider,
            o.text,
            limitations,
          );
        });
      }
      // 结构化解析失败或全部项不合格：如实陈述事实，不伪造结构化证据
      return [
        this.toObservation(
          base,
          "visual_evidence",
          { type: "full_image", coordinate_system: "image_px" },
          null,
          operationId,
          provider,
          providerResult.text,
          ["structured_parse_failed"],
        ),
      ];
    }

    if (kind === "ocr") {
      return [
        this.toObservation(
          base,
          "text_block",
          { type: "full_image", coordinate_system: "image_px" },
          null,
          operationId,
          provider,
          providerResult.text,
        ),
      ];
    }

    // summarize：批量综合概述 → 单个散文式 Observation（label=summary）
    if (kind === "summarize") {
      return [
        this.toObservation(
          base,
          "summary",
          { type: "full_image", coordinate_system: "image_px" },
          null,
          operationId,
          provider,
          providerResult.text,
        ),
      ];
    }

    // observe 默认：证据文本 Observation（Contract Clarification）
    return [
      this.toObservation(
        base,
        "visual_evidence",
        { type: "full_image", coordinate_system: "image_px" },
        null,
        operationId,
        provider,
        providerResult.text,
        provider.declare().constraints?.confidence_supported === false
          ? ["confidence_not_provided_by_provider"]
          : [],
      ),
    ];
  }

  private toObservation(
    base: Omit<Observation, "observation_id" | "label" | "text">,
    label: string,
    location: Location,
    confidenceValue: number | null,
    operationId: string,
    provider: VLMProvider,
    text: string | undefined,
    extraLimitations: string[] = [],
  ): Observation {
    return {
      ...base,
      observation_id: genId("obs"),
      label,
      location,
      confidence: { value: confidenceValue, semantics: "provider_defined" } satisfies Confidence,
      lineage: { operation_id: operationId, derivation: "direct", parents: [] },
      limitations: [...base.limitations, ...extraLimitations],
      status: "pending",
      created_at: "",
      ...(text !== undefined ? { text } : {}),
    };
  }

  private result(structured: Record<string, unknown>, isError = false): ToolResult {
    return { isError, textBlocks: [], structured, resourceRefs: [] };
  }
}

/* ------------------------------------------------------------ */
/* 结构化解析（perception enhancement，非决策）                        */
/* ------------------------------------------------------------ */

interface StructuredObject {
  label: string;
  bbox?: [number, number, number, number];
  confidence?: number;
  confidenceInvalid?: boolean;
  text?: string;
}

interface StructuredParseOptions {
  /** detect：要求每个对象带合法 bbox；observe json_mode：允许无 bbox（降级 full_image） */
  requireBbox: boolean;
  /** 图像尺寸（bbox 边界校验） */
  width: number;
  height: number;
  /** detect：仅接受 Agent 声明的 label（机械白名单，不做语义解释） */
  allowedLabels?: string[];
  /** 结构化对象数量上限（膨胀防御；超限截断并标记 truncated） */
  maxObjects?: number;
}

interface StructuredParseResult {
  objects: StructuredObject[];
  /** 因超过 maxObjects 被截断（如实标记，不静默吞） */
  truncated: boolean;
}

const DEFAULT_MAX_STRUCTURED_OBJECTS = 500;

/** unknown 证据状态枚举（v0.3 契约）：reason 是证据状态，unknown 是证据值 */
const UNKNOWN_REASONS = new Set([
  "insufficient_visual_evidence",
  "occluded",
  "ambiguous",
  "not_applicable",
  "unsupported",
  "execution_unavailable",
]);

/**
 * 声明式维度观察解析（v0.3 契约）：
 * - 输出必须是 JSON 对象，键必须 ⊆ 声明维度（未知键 → 整体 parse_failed）；
 * - 每个维度：标量值 = 观察事实；{value:"unknown", reason:枚举} = 诚实未知（合法证据）；
 * - reason 非枚举或结构损坏 → 整体 parse_failed（两级失败语义，与字段级 unknown 严格区分）；
 * - 缺失维度 → 如实标记 insufficient_visual_evidence。
 */
function parseDimensionObservation(
  text: string,
  dimensions: string[],
): { ok: boolean; map?: Record<string, { value: unknown; reason?: string }> } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false };
  const obj = raw as Record<string, unknown>;
  const dimSet = new Set(dimensions);
  for (const key of Object.keys(obj)) {
    if (!dimSet.has(key)) return { ok: false };
  }
  const map: Record<string, { value: unknown; reason?: string }> = {};
  for (const dim of dimensions) {
    const v = obj[dim];
    if (v === undefined) {
      map[dim] = { value: "unknown", reason: "insufficient_visual_evidence" };
      continue;
    }
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const rec = v as Record<string, unknown>;
      if (rec["value"] === "unknown") {
        if (typeof rec["reason"] !== "string" || !UNKNOWN_REASONS.has(rec["reason"])) {
          return { ok: false };
        }
        map[dim] = { value: "unknown", reason: rec["reason"] as string };
        continue;
      }
      map[dim] = { value: rec["value"] };
      continue;
    }
    map[dim] = { value: v };
  }
  return { ok: true, map };
}

function parseStructuredObservations(
  text: string,
  opts: StructuredParseOptions,
): StructuredParseResult | undefined {
  try {
    const parsed = JSON.parse(text) as { objects?: unknown };
    if (!Array.isArray(parsed.objects)) return undefined;
    const objects: StructuredObject[] = [];
    const maxObjects = opts.maxObjects ?? DEFAULT_MAX_STRUCTURED_OBJECTS;
    let truncated = false;
    for (const o of parsed.objects) {
      if (typeof o !== "object" || o === null) continue;
      const rec = o as Record<string, unknown>;
      if (typeof rec.label !== "string" || rec.label.length === 0) continue;
      if (opts.allowedLabels && !opts.allowedLabels.includes(rec.label)) continue;
      const item: StructuredObject = { label: rec.label };
      // bbox 校验：4 个数、坐标序合法（x1<=x2, y1<=y2）、不越图像边界
      if (Array.isArray(rec.bbox) && rec.bbox.length === 4 && rec.bbox.every((n) => typeof n === "number")) {
        const [x1, y1, x2, y2] = rec.bbox as [number, number, number, number];
        const valid =
          Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2) &&
          x1 <= x2 && y1 <= y2 &&
          x1 >= 0 && y1 >= 0 &&
          (opts.width <= 0 || x2 <= opts.width) && (opts.height <= 0 || y2 <= opts.height);
        if (valid) {
          item.bbox = [x1, y1, x2, y2];
        } else if (opts.requireBbox) {
          // detect 契约：bbox 缺失/非法 → 该项不合格
          continue;
        }
        // 非 requireBbox（observe json_mode）：非法 bbox 视为无 bbox（降级 full_image）
      } else if (opts.requireBbox) {
        continue;
      }
      // confidence 契约：0..1 之外视为无效（置 null + limitation 由上层处理）
      if (typeof rec.confidence === "number") {
        if (rec.confidence >= 0 && rec.confidence <= 1) {
          item.confidence = rec.confidence;
        } else {
          item.confidenceInvalid = true;
        }
      }
      if (typeof rec.text === "string") item.text = rec.text;
      if (objects.length >= maxObjects) {
        truncated = true;
        continue;
      }
      objects.push(item);
    }
    // 空数组是合法"未发现对象"结果；非空但全部不合格才是解析失败。
    if (objects.length === 0 && parsed.objects.length > 0) return undefined;
    return { objects, truncated };
  } catch {
    return undefined;
  }
}

function summarizeObservation(o: Observation) {
  return {
    observation_id: o.observation_id,
    label: o.label,
    location: o.location,
    confidence: o.confidence,
    limitations: o.limitations,
    ...(o.text !== undefined ? { text: o.text } : {}),
  };
}

function summarizeOperation(op: OperationRecord) {
  return {
    operation_id: op.operation_id,
    vision_session_id: op.vision_session_id,
    tool_name: op.tool_name,
    status: op.status,
    created_at: op.created_at,
    started_at: op.started_at,
    finished_at: op.finished_at,
    committed_observation_ids: op.committed_observation_ids,
    committed_artifact_ids: op.committed_artifact_ids,
    ...(op.result !== undefined ? { result: op.result } : {}),
    ...(op.error !== undefined ? { error: op.error } : {}),
  };
}
