/**
 * Image Input Contract（规格四.1）。
 *
 * ImageInput 必须为互斥联合（Discriminated Union）：
 * 精确选择一种输入模式（uri | resource_ref | inline），
 * 属于非活动模式的字段必须被拒绝（V1 强制 Reject）。
 *
 * Server 不得假设 Agent 的本地文件系统对 Server 可见。
 */
import { z } from "zod";

export const InlineImage = z
  .object({
    mime_type: z.string().min(1),
    /** base64 编码的原始字节 */
    blob: z.string().min(1),
  })
  .strict();

export const ImageInputUri = z
  .object({
    type: z.literal("uri"),
    uri: z.string().min(1),
  })
  .strict();

export const ImageInputResourceRef = z
  .object({
    type: z.literal("resource_ref"),
    resource_ref: z.string().min(1),
  })
  .strict();

export const ImageInputInline = z
  .object({
    type: z.literal("inline"),
    inline: InlineImage,
  })
  .strict();

export const ImageInput = z.discriminatedUnion("type", [
  ImageInputUri,
  ImageInputResourceRef,
  ImageInputInline,
]);

export type ImageInput = z.infer<typeof ImageInput>;
export type InlineImage = z.infer<typeof InlineImage>;
