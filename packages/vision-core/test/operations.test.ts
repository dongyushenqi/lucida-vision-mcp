import { describe, expect, it } from "vitest";
import { ApplicationErrorCode } from "@mcp-vision/contracts";
import { InMemoryVisionStore, SqliteVisionStore } from "../src/store.js";
import { OperationService } from "../src/operations.js";
import { ObservationGraph } from "../src/graph.js";
import { genId } from "../src/ids.js";

function makeServices() {
  const store = new InMemoryVisionStore();
  const clock = () => "2026-01-15T08:30:00.000Z";
  const operations = new OperationService(store, clock);
  const graph = new ObservationGraph(store, clock);
  return { store, operations, graph };
}

const SESSION = "vs_test";
const OP_ID = "op_test";
const ARGS = { image_input: { type: "uri", uri: "https://example.com/a.png" }, instruction: "描述" };

function makeObs(operationId: string, id: string) {
  return {
    schema_version: 1 as const,
    observation_id: id,
    label: "visual_evidence",
    location: { type: "full_image" as const, coordinate_system: "image_px" as const },
    confidence: { value: null, semantics: "provider_defined" as const },
    source: {
      provider: "agnes",
      model: "agnes-2.5-flash",
      model_version: "agnes-2.5-flash",
      adapter_version: "0.1.0",
      execution_timestamp: "2026-01-15T08:30:00.000Z",
    },
    lineage: { operation_id: operationId, derivation: "direct" as const, parents: [] },
    limitations: [],
    status: "pending" as const,
    created_at: "",
  };
}

describe("OperationService 幂等控制（规格五.2）", () => {
  it("首次 begin 创建 running 记录", () => {
    const { operations } = makeServices();
    const r = operations.begin(SESSION, OP_ID, "vision.observe", ARGS);
    expect(r.deduplicated).toBe(false);
    expect(r.record.status).toBe("running");
    expect(r.record.canonical_parameter_identity).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("同 (session, operation_id) + 同参数、已终止 → 去重返回既有记录", () => {
    const { operations } = makeServices();
    operations.begin(SESSION, OP_ID, "vision.observe", ARGS);
    operations.finish(SESSION, OP_ID, { status: "completed", result: { ok: true } });
    const r = operations.begin(SESSION, OP_ID, "vision.observe", ARGS);
    expect(r.deduplicated).toBe(true);
    expect(r.inFlight).toBe(false);
    expect(r.record.status).toBe("completed");
    expect(r.record.result).toEqual({ ok: true });
  });

  it("同 (session, operation_id) + 同参数、in-flight → 不创建第二次执行", () => {
    const { operations } = makeServices();
    operations.begin(SESSION, OP_ID, "vision.observe", ARGS);
    const r = operations.begin(SESSION, OP_ID, "vision.observe", ARGS);
    expect(r.deduplicated).toBe(true);
    expect(r.inFlight).toBe(true);
    expect(r.record.status).toBe("running");
  });

  it("同 (session, operation_id) + 参数变化 → OPERATION_ID_CONFLICT，严禁重执行", () => {
    const { operations } = makeServices();
    operations.begin(SESSION, OP_ID, "vision.observe", ARGS);
    const changed = { ...ARGS, instruction: "不同的指令" };
    expect(() => operations.begin(SESSION, OP_ID, "vision.observe", changed)).toThrowError(
      expect.objectContaining({ applicationErrorCode: ApplicationErrorCode.OPERATION_ID_CONFLICT }),
    );
  });

  it("身份字段不可变：finish 不改变 canonical_parameter_identity / created_at", () => {
    const { operations } = makeServices();
    const begun = operations.begin(SESSION, OP_ID, "vision.observe", ARGS);
    const finished = operations.finish(SESSION, OP_ID, { status: "completed" });
    expect(finished.canonical_parameter_identity).toBe(begun.record.canonical_parameter_identity);
    expect(finished.created_at).toBe(begun.record.created_at);
  });

  it("重复终止 → 幂等返回现有记录（审查 #1：取消后 Provider 完成不撞终态报错）", () => {
    const { operations } = makeServices();
    operations.begin(SESSION, OP_ID, "vision.observe", ARGS);
    const cancelled = operations.cancel(SESSION, OP_ID);
    expect(cancelled.status).toBe("cancelled");
    // 原执行随后完成 → finish 直接返回现有记录，绝不抛错
    const finished = operations.finish(SESSION, OP_ID, { status: "completed", result: { late: true } });
    expect(finished.status).toBe("cancelled");
    expect(finished).not.toHaveProperty("result");
  });
});

describe("取消契约与提交边界（规格二.2）", () => {
  it("cancelled 后已 committed 的 Observation 保留", () => {
    const { store, operations, graph } = makeServices();
    operations.begin(SESSION, OP_ID, "vision.observe", ARGS);
    graph.commitObservation(SESSION, makeObs(OP_ID, "obs_1"));
    operations.cancel(SESSION, OP_ID);
    const op = operations.get(SESSION, OP_ID)!;
    expect(op.status).toBe("cancelled");
    expect(op.committed_observation_ids).toContain("obs_1");
    expect(graph.list(SESSION).length).toBe(1);
  });

  it("failed 后已 committed 的证据同样保留（不随失败回滚）", () => {
    const { operations, graph } = makeServices();
    operations.begin(SESSION, OP_ID, "vision.observe", ARGS);
    graph.commitObservation(SESSION, makeObs(OP_ID, "obs_2"));
    operations.finish(SESSION, OP_ID, {
      status: "failed",
      error: { application_error_code: "PROVIDER_TIMEOUT", message: "超时" },
    });
    const op = operations.get(SESSION, OP_ID)!;
    expect(op.status).toBe("failed");
    expect(op.committed_observation_ids).toContain("obs_2");
  });

  it("状态机无 partially_completed", () => {
    const { operations } = makeServices();
    operations.begin(SESSION, genId("op"), "vision.observe", ARGS);
    const ops = operations.list(SESSION);
    expect(ops[0]!.status).not.toBe("partially_completed");
  });
});

describe("SQLite 真实事务（审查建议：内存事务不回滚，用真实 SQLite 覆盖提交边界）", () => {
  it("取消后已 committed 证据保留（SqliteVisionStore :memory: 事务路径）", () => {
    const store = new SqliteVisionStore(":memory:");
    const clock = () => "2026-01-15T08:30:00.000Z";
    const operations = new OperationService(store, clock);
    const graph = new ObservationGraph(store, clock);
    operations.begin(SESSION, OP_ID, "vision.observe", ARGS);
    graph.commitObservation(SESSION, makeObs(OP_ID, "obs_sqlite_1"));
    operations.cancel(SESSION, OP_ID);
    const op = operations.get(SESSION, OP_ID)!;
    expect(op.status).toBe("cancelled");
    expect(op.committed_observation_ids).toContain("obs_sqlite_1");
    expect(graph.list(SESSION).length).toBe(1);
    store.close();
  });

  it("Observation 入库前契约校验：超界 confidence → 拒绝提交（审查 #6）", () => {
    const { graph } = makeServices();
    const bad = makeObs(OP_ID, "obs_bad");
    bad.confidence = { value: 1.5, semantics: "provider_defined" };
    expect(() => graph.commitObservation(SESSION, bad)).toThrowError(
      expect.objectContaining({ applicationErrorCode: ApplicationErrorCode.VISION_INTERNAL }),
    );
    expect(graph.list(SESSION)).toEqual([]);
  });
});
