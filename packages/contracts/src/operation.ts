/**
 * Operation record —— 规格二.3 / 五.2。
 *
 * - 身份字段（operation_id / vision_session_id / canonical_parameter_identity /
 *   created_at）创建后绝对不可变，保留期内用于审计与结果追溯。
 * - 状态保持简单：running / completed / cancelled / failed，无 partially_completed。
 * - cancelled 或 failed 时，committed_observation_ids / committed_artifact_ids 依然保留
 *   （取消契约与提交边界，规格二.2）。
 */
import { z } from "zod";

export const OperationStatus = z.enum([
  "running",
  "completed",
  "cancelled",
  "failed",
]);

export type OperationStatus = z.infer<typeof OperationStatus>;

export const OperationErrorInfo = z
  .object({
    application_error_code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  })
  .strict();

export type OperationErrorInfo = z.infer<typeof OperationErrorInfo>;

export const OperationRecord = z
  .object({
    schema_version: z.literal(1),
    operation_id: z.string().min(1),
    vision_session_id: z.string().min(1),
    tool_name: z.string().min(1),
    /** sha256: + JCS 规范化参数身份的哈希（规格五.2，不可变） */
    canonical_parameter_identity: z.string().min(1),
    status: OperationStatus,
    created_at: z.string().min(1), // ISO 8601
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
    committed_observation_ids: z.array(z.string()).default([]),
    committed_artifact_ids: z.array(z.string()).default([]),
    /**
     * Contract Clarification（见 docs/DECISIONS.md）：
     * 执行结果/失败错误信息，仅作 in-flight 状态暴露与结果获取实现，
     * 不影响身份字段不可变性。
     */
    result: z.unknown().optional(),
    error: OperationErrorInfo.optional(),
  })
  .strict();

export type OperationRecord = z.infer<typeof OperationRecord>;
