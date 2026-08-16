/**
 * V1 工具参数契约（严格模式：未知/非活动字段一律拒绝）。
 */
import { z } from "zod";
import { ImageInput } from "@mcp-vision/contracts";

/** 观察档位：default=默认摘要级；deep=预置深入指令包（仅当用户明确要求更深入/更专业时使用；指令预设，非能力预设） */
export const ObserveProfile = z.enum(["default", "deep"]);

/** 声明式结构化观察维度上限（单次调用） */
export const MAX_OBSERVATION_DIMENSIONS = 20;

/**
 * 声明式结构化观察（v0.3）：Agent 声明"观察什么维度"（如 color/shape/count）。
 * Server 不解释维度语义——维度名仅作为输出键；只允许描述观察对象与结构表达，
 * 禁止推理/组合/筛选/比较/决策语义（DSL 边界，见 docs/DECISIONS.md）。
 */
export const ObservationSchema = z
  .object({
    dimensions: z.array(z.string().min(1).max(64)).min(1).max(MAX_OBSERVATION_DIMENSIONS),
  })
  .strict();

const visionSessionId = z.string().min(1);
const operationId = z.string().min(1);
const providerId = z.string().min(1);

export const SessionCreateArgs = z.object({}).strict();

export const SessionGetArgs = z
  .object({
    vision_session_id: visionSessionId,
  })
  .strict();

/**
 * Session 审计汇总（v0.4 专业模块）：按需调用——仅当用户明确要求审计/记录/汇总/导出时使用，
 * 绝不主动输出。被调用时默认返回操作级汇总；include_observations=true 附全量观察元数据。
 */
export const SessionAuditArgs = z
  .object({
    vision_session_id: visionSessionId,
    /** true 时附每条操作已提交观察的元数据（label/location/confidence/limitations/source；location 即区域对应） */
    include_observations: z.boolean().optional(),
  })
  .strict();

export const SessionDeleteArgs = z
  .object({
    vision_session_id: visionSessionId,
  })
  .strict();

export const ObserveArgs = z
  .object({
    vision_session_id: visionSessionId,
    image_input: ImageInput,
    /** 感知指令：必须只请求可观察的视觉事实；缺省为中性感知指令 */
    instruction: z.string().min(1).max(2000).optional(),
    /** 观察档位：deep=预置深入指令包（纳入水印/细小文字/细粒度特征）；缺省 default */
    profile: ObserveProfile.optional(),
    /** 可选 JSON 模式：结构化观察输出（须经 probe 验证 structured_detection） */
    json_mode: z.boolean().optional(),
    /**
     * 声明式结构化观察（v0.3）：声明观察维度，逐字段返回 value 或 unknown+reason。
     * 提供时进入结构化模式（视同 json_mode=true），须经 structured_detection 探针验证。
     * 优先级高于 json_mode。
     */
    observation_schema: ObservationSchema.optional(),
    provider_id: providerId.optional(),
    /** 应用级请求去重标识（作用域：Vision Session，规格五.2） */
    operation_id: operationId.optional(),
  })
  .strict();

export const DetectArgs = z
  .object({
    vision_session_id: visionSessionId,
    image_input: ImageInput,
    /** Agent 声明要检测的视觉类别（label 白名单；Server 不解释语义） */
    labels: z.array(z.string().min(1)).min(1).max(50),
    provider_id: providerId.optional(),
    operation_id: operationId.optional(),
  })
  .strict();

/** 单次 summarize 最多接收的图片数（批量上限；总张数不限，可分多次调用） */
export const MAX_SUMMARIZE_IMAGES = 16;

export const SummarizeArgs = z
  .object({
    vision_session_id: visionSessionId,
    /** 待综合概述的图片（1~16 张；任一失败则整体失败并指明第几张） */
    image_inputs: z.array(ImageInput).min(1).max(MAX_SUMMARIZE_IMAGES),
    /** 感知指令：缺省为综合概述默认指令（散文式、不逐张罗列、忽略水印等细碎元素） */
    instruction: z.string().min(1).max(2000).optional(),
    /** 观察档位：deep=预置深入概述指令包；缺省 default */
    profile: ObserveProfile.optional(),
    provider_id: providerId.optional(),
    operation_id: operationId.optional(),
  })
  .strict();

export const OcrArgs = z
  .object({
    vision_session_id: visionSessionId,
    image_input: ImageInput,
    lang: z.string().min(1).max(64).optional(),
    provider_id: providerId.optional(),
    operation_id: operationId.optional(),
  })
  .strict();

export const OperationGetArgs = z
  .object({
    vision_session_id: visionSessionId,
    operation_id: operationId,
  })
  .strict();

export const OperationCancelArgs = z
  .object({
    vision_session_id: visionSessionId,
    operation_id: operationId,
  })
  .strict();

export type SessionCreateArgs = z.infer<typeof SessionCreateArgs>;
export type SessionGetArgs = z.infer<typeof SessionGetArgs>;
export type SessionAuditArgs = z.infer<typeof SessionAuditArgs>;
export type SessionDeleteArgs = z.infer<typeof SessionDeleteArgs>;
export type ObserveArgs = z.infer<typeof ObserveArgs>;
export type DetectArgs = z.infer<typeof DetectArgs>;
export type SummarizeArgs = z.infer<typeof SummarizeArgs>;
export type ObservationSchema = z.infer<typeof ObservationSchema>;
export type OcrArgs = z.infer<typeof OcrArgs>;
export type OperationGetArgs = z.infer<typeof OperationGetArgs>;
export type OperationCancelArgs = z.infer<typeof OperationCancelArgs>;
