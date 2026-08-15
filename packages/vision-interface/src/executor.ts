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
} from "./args.js";
import type { IdentityContext } from "./identity.js";
import { parseVisionResourceUri } from "./resources.js";
import { SessionSandbox } from "./session-sandbox.js";

/** 中性感知指令（仅当 Agent 未提供 instruction 时使用；只请求可观察事实）。 */
export const DEFAULT_OBSERVE_INSTRUCTION =
  "描述这张图片中可观察到的视觉特征、对象类别、区域、文本与几何模式。" +
  "只陈述可观察的视觉事实，不做诊断、因果归因或任何建议。";

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

type VisualKind = "observe" | "detect" | "ocr";

interface VisualArgs {
  vision_session_id: string;
  image_input: ImageInput;
  provider_id?: string;
  operation_id?: string;
  json_mode?: boolean;
  instruction?: string;
  labels?: string[];
  lang?: string;
}

export class VisionExecutor {
  private readonly sandbox: SessionSandbox;
  private readonly defaultProviderId: string;

  constructor(
    private readonly core: VisionCore,
    opts?: { defaultProviderId?: string },
  ) {
    this.sandbox = new SessionSandbox(core);
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
    const session = this.sandbox.authorize(args.vision_session_id, req.identity);
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
    this.sandbox.authorize(args.vision_session_id, req.identity);
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
    this.sandbox.authorize(args.vision_session_id, req.identity);
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
    // 已终止的 operation 取消 = 幂等 no-op（取消本身不是错误）
    const op =
      existing.status === "running"
        ? this.core.operations.cancel(args.vision_session_id, args.operation_id)
        : existing;
    return { result: this.result({ operation: summarizeOperation(op) }), operation: op };
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
      // 图像解析：uri/inline 走统一 Fetch Boundary；resource_ref 先授权后 dereference
      const image = await this.resolveImage(args.image_input, sessionId, req.identity, req.cancel.signal);

      const provider = this.core.providers.get(args.provider_id ?? this.defaultProviderId);

      const jsonMode = kind === "detect" || (kind === "observe" && args.json_mode === true);
      const required: CapabilityId[] =
        kind === "observe" ? (jsonMode ? ["image_understanding", "structured_detection"] : ["image_understanding"])
        : kind === "ocr" ? ["ocr"]
        : ["structured_detection"];

      // 能力门禁：Final Executable = Effective ∩ IQA（仅描述可行性；IQA 结果不进图谱）
      const assessment = this.executability(provider, required, image);
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
        { images: [image], instruction, jsonMode },
        req.cancel.signal,
      );

      const observations = this.buildObservations(kind, providerResult, provider, operationId, args);
      const committed = observations.map((o) => this.core.graph.commitObservation(sessionId, o));

      const summary = {
        observations: committed.map(summarizeObservation),
        provider: provider.providerId,
      };
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
      // 应用级错误：事实 + 恢复属性，无建议
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
    }
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
    image?: FetchedImage,
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
    const iqa = image ? assessImage(image.bytes, image.mimeType, constraints) : undefined;
    if (iqa && !iqa.executable) {
      return {
        executable: false,
        reasons: iqa.reasons.map((r) => `IQA: ${r}`),
        provider: provider.providerId,
        constraints,
        iqa,
      };
    }
    return { executable: true, reasons: [], provider: provider.providerId, constraints, iqa };
  }

  private buildInstruction(kind: VisualKind, args: VisualArgs): string {
    switch (kind) {
      case "observe":
        return args.instruction ?? DEFAULT_OBSERVE_INSTRUCTION;
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

    if (kind === "detect" || (kind === "observe" && args.json_mode === true)) {
      const structured = parseStructuredObservations(providerResult.text);
      if (structured) {
        return structured.map((o) =>
          this.toObservation(
            base,
            o.label,
            o.bbox
              ? { type: "bbox", bbox: o.bbox, coordinate_system: "image_px" }
              : { type: "full_image", coordinate_system: "image_px" },
            o.confidence ?? null,
            operationId,
            provider,
            o.text,
          ),
        );
      }
      // 结构化解析失败：如实陈述事实，不伪造结构化证据
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
  text?: string;
}

function parseStructuredObservations(text: string): StructuredObject[] | undefined {
  try {
    const parsed = JSON.parse(text) as { objects?: unknown };
    if (!Array.isArray(parsed.objects)) return undefined;
    const objects: StructuredObject[] = [];
    for (const o of parsed.objects) {
      if (typeof o !== "object" || o === null) return undefined;
      const rec = o as Record<string, unknown>;
      if (typeof rec.label !== "string" || rec.label.length === 0) return undefined;
      const item: StructuredObject = { label: rec.label };
      if (Array.isArray(rec.bbox) && rec.bbox.length === 4 && rec.bbox.every((n) => typeof n === "number")) {
        item.bbox = rec.bbox as [number, number, number, number];
      }
      if (typeof rec.confidence === "number") item.confidence = rec.confidence;
      if (typeof rec.text === "string") item.text = rec.text;
      objects.push(item);
    }
    return objects;
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
