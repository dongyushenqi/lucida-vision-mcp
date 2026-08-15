/**
 * Vision Session —— 规格二.4。
 *
 * - Vision Session 是视觉领域层的有状态上下文，与 MCP 协议层 Session 完全独立，
 *   可跨越多个 MCP 请求及传输连接持续存在。
 * - 与创建它的 Principal/Tenant 建立明确授权绑定；
 *   Session identifier 不得单独作为授权凭证（不可预测性不能替代 authorization check）。
 * - Vision Session 不得跨 Principal/Tenant 访问（V1）。
 */
import { z } from "zod";

export const VisionSessionStatus = z.enum(["active", "closed"]);

export const VisionSession = z
  .object({
    schema_version: z.literal(1),
    vision_session_id: z.string().min(1),
    principal_id: z.string().min(1),
    tenant_id: z.string().min(1),
    status: VisionSessionStatus,
    created_at: z.string().min(1), // ISO 8601
  })
  .strict();

export type VisionSession = z.infer<typeof VisionSession>;
