/**
 * V1 工具参数契约（严格模式：未知/非活动字段一律拒绝）。
 */
import { z } from "zod";
import { ImageInput } from "@mcp-vision/contracts";

const visionSessionId = z.string().min(1);
const operationId = z.string().min(1);
const providerId = z.string().min(1);

export const SessionCreateArgs = z.object({}).strict();

export const SessionGetArgs = z
  .object({
    vision_session_id: visionSessionId,
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
    /** 可选 JSON 模式：结构化观察输出（须经 probe 验证 structured_detection） */
    json_mode: z.boolean().optional(),
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
export type SessionDeleteArgs = z.infer<typeof SessionDeleteArgs>;
export type ObserveArgs = z.infer<typeof ObserveArgs>;
export type DetectArgs = z.infer<typeof DetectArgs>;
export type SummarizeArgs = z.infer<typeof SummarizeArgs>;
export type OcrArgs = z.infer<typeof OcrArgs>;
export type OperationGetArgs = z.infer<typeof OperationGetArgs>;
export type OperationCancelArgs = z.infer<typeof OperationCancelArgs>;
