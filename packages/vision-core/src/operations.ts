/**
 * Operation 生命周期与幂等控制（规格二.2 / 二.3 / 五.2）。
 *
 * - Operation Identity Immutability：身份字段创建后不可变（本服务只更新状态/时间戳/结果/证据清单）。
 * - 状态机保持简单：running / completed / cancelled / failed，无 partially_completed。
 * - In-flight 去重：同 (session, operation_id) + 相同 Canonical Parameter Identity 且 running →
 *   不创建第二次执行，返回既有 Operation 当前状态（轮询/结果获取属 Implementation Decision）。
 * - 冲突校验：同 (session, operation_id) 但参数身份不同 → OPERATION_ID_CONFLICT，严禁重执行或返回旧结果。
 * - 取消保留原则：finish(cancelled/failed) 不改动已 committed 证据清单。
 */
import {
  ApplicationErrorCode,
  operationParameterIdentity,
  VisionError,
} from "@mcp-vision/contracts";
import type { OperationErrorInfo, OperationRecord } from "@mcp-vision/contracts";
import type { Clock } from "./clock.js";
import type { VisionStore } from "./store.js";

export interface BeginResult {
  record: OperationRecord;
  /** 本次请求被去重（返回既有 Operation，而非新建执行） */
  deduplicated: boolean;
  /** 既有 Operation 仍在执行中（In-flight Deduplication，规格五.2） */
  inFlight: boolean;
}

export interface FinishOutcome {
  status: "completed" | "cancelled" | "failed";
  result?: unknown;
  error?: OperationErrorInfo;
}

export class OperationService {
  constructor(
    private readonly store: VisionStore,
    private readonly clock: Clock,
  ) {}

  /** 幂等入口：创建或去重返回既有 Operation。 */
  begin(
    sessionId: string,
    operationId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): BeginResult {
    const identity = operationParameterIdentity(toolName, args);
    const existing = this.store.getOperation(sessionId, operationId);

    if (!existing) {
      const record: OperationRecord = {
        schema_version: 1,
        operation_id: operationId,
        vision_session_id: sessionId,
        tool_name: toolName,
        canonical_parameter_identity: identity,
        status: "running",
        created_at: this.clock(),
        started_at: this.clock(),
        finished_at: null,
        committed_observation_ids: [],
        committed_artifact_ids: [],
      };
      this.store.insertOperation(record);
      return { record, deduplicated: false, inFlight: false };
    }

    if (existing.canonical_parameter_identity !== identity) {
      // 规格五.2：重复请求参数变化 → 必须报错，严禁重新执行或返回旧结果
      throw new VisionError(
        ApplicationErrorCode.OPERATION_ID_CONFLICT,
        `operation_id 已存在且请求参数发生变化`,
        { operation_id: operationId, vision_session_id: sessionId },
      );
    }

    if (existing.status === "running") {
      return { record: existing, deduplicated: true, inFlight: true };
    }
    return { record: existing, deduplicated: true, inFlight: false };
  }

  /**
   * 终止 Operation（仅 running → 终态；身份字段不变，已 committed 证据保留）。
   * 幂等（审查 #1）：若已被其他路径（如 operation.cancel 工具）置为终态，直接返回现有记录，
   * 绝不抛错——避免"用户取消后 Provider 完成撞终态 → VISION_INTERNAL"。
   */
  finish(sessionId: string, operationId: string, outcome: FinishOutcome): OperationRecord {
    const op = this.mustGet(sessionId, operationId);
    if (op.status !== "running") {
      return op;
    }
    const updated: OperationRecord = {
      ...op,
      status: outcome.status,
      finished_at: this.clock(),
      ...(outcome.result !== undefined ? { result: outcome.result } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    };
    this.store.updateOperation(updated);
    return updated;
  }

  /** 取消：只改状态，绝不删除/失效已 committed 证据（规格二.2）。 */
  cancel(sessionId: string, operationId: string): OperationRecord {
    return this.finish(sessionId, operationId, { status: "cancelled" });
  }

  get(sessionId: string, operationId: string): OperationRecord | undefined {
    return this.store.getOperation(sessionId, operationId);
  }

  list(sessionId: string): OperationRecord[] {
    return this.store.listOperations(sessionId);
  }

  private mustGet(sessionId: string, operationId: string): OperationRecord {
    const op = this.store.getOperation(sessionId, operationId);
    if (!op) {
      throw new VisionError(ApplicationErrorCode.OPERATION_NOT_FOUND, "operation 不存在", {
        operation_id: operationId,
        vision_session_id: sessionId,
      });
    }
    return op;
  }
}
