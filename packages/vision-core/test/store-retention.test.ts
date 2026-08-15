import { describe, expect, it } from "vitest";
import { InMemoryVisionStore, SqliteVisionStore } from "../src/store.js";

function makeStore() {
  return new SqliteVisionStore(":memory:");
}

const OP = (id: string, createdAt: string) => ({
  schema_version: 1 as const,
  operation_id: id,
  vision_session_id: "vs_1",
  tool_name: "vision.observe",
  canonical_parameter_identity: "sha256:" + "a".repeat(64),
  status: "completed" as const,
  created_at: createdAt,
  started_at: createdAt,
  finished_at: createdAt,
  committed_observation_ids: [],
  committed_artifact_ids: [],
});

const ART = (id: string, createdAt: string) => ({
  schema_version: 1 as const,
  artifact_id: id,
  mime_type: "image/png",
  content_length: 4,
  digest: { algorithm: "SHA-256" as const, value: "a".repeat(64) },
  created_at: createdAt,
  storage: { tier: 1 as const, ref: `vision://vs_1/${id}` },
});

describe("retention 自动清理（规格二.3 Implementation Decision）", () => {
  it("过期 Operation/Artifact 被整条删除，新数据保留，身份字段不受影响", () => {
    const store = makeStore();
    store.insertOperation(OP("op_old", "2026-01-01T00:00:00.000Z"));
    store.insertOperation(OP("op_new", "2026-08-15T00:00:00.000Z"));
    store.insertArtifact("vs_1", ART("art_old", "2026-01-01T00:00:00.000Z"), new Uint8Array([1, 2, 3, 4]));
    store.insertArtifact("vs_1", ART("art_new", "2026-08-15T00:00:00.000Z"), new Uint8Array([5, 6, 7, 8]));

    const removedOps = store.deleteOperationsOlderThan(7 * 24);
    const removedArts = store.deleteArtifactsOlderThan(24);

    expect(removedOps).toBe(1);
    expect(removedArts).toBe(1);
    expect(store.getOperation("vs_1", "op_old")).toBeUndefined();
    expect(store.getOperation("vs_1", "op_new")).toBeDefined();
    expect(store.getArtifact("art_old")).toBeUndefined();
    expect(store.getArtifact("art_new")).toBeDefined();
    // 被保留记录的字段未被触碰（身份不可变）
    expect(store.getOperation("vs_1", "op_new")!.created_at).toBe("2026-08-15T00:00:00.000Z");
    store.close();
  });

  it("retentionHours <= 0 视为关闭（不删除）", () => {
    const store = makeStore();
    store.insertOperation(OP("op_old", "2026-01-01T00:00:00.000Z"));
    expect(store.deleteOperationsOlderThan(0)).toBe(0);
    expect(store.getOperation("vs_1", "op_old")).toBeDefined();
    store.close();
  });

  it("running 中的超期 Operation 不被删除（SQLite；审查：避免删后 finish/cancel 变 NOT_FOUND）", () => {
    const store = makeStore();
    store.insertOperation({ ...OP("op_running_old", "2026-01-01T00:00:00.000Z"), status: "running" });
    store.insertOperation(OP("op_done_old", "2026-01-01T00:00:00.000Z"));
    const removed = store.deleteOperationsOlderThan(7 * 24);
    expect(removed).toBe(1);
    expect(store.getOperation("vs_1", "op_running_old")).toBeDefined();
    expect(store.getOperation("vs_1", "op_done_old")).toBeUndefined();
    store.close();
  });

  it("running 中的超期 Operation 不被删除（InMemory 同分支，审查 4 补测）", () => {
    const store = new InMemoryVisionStore();
    store.insertOperation({ ...OP("op_running_old", "2026-01-01T00:00:00.000Z"), status: "running" });
    store.insertOperation(OP("op_done_old", "2026-01-01T00:00:00.000Z"));
    const removed = store.deleteOperationsOlderThan(7 * 24);
    expect(removed).toBe(1);
    expect(store.getOperation("vs_1", "op_running_old")).toBeDefined();
    expect(store.getOperation("vs_1", "op_done_old")).toBeUndefined();
  });

  it("Observation 不随 retention 删除（已 committed 证据独立保留，规格二.2）", () => {
    const store = makeStore();
    store.insertOperation(OP("op_old", "2026-01-01T00:00:00.000Z"));
    store.insertObservation("vs_1", {
      schema_version: 1,
      observation_id: "obs_keep",
      label: "visual_evidence",
      location: { type: "full_image", coordinate_system: "image_px" },
      confidence: { value: null, semantics: "provider_defined" },
      source: {
        provider: "mock",
        model: "m",
        model_version: "1",
        adapter_version: "0.1.0",
        execution_timestamp: "2026-01-01T00:00:00.000Z",
      },
      lineage: { operation_id: "op_old", derivation: "direct", parents: [] },
      limitations: [],
      status: "committed",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    store.deleteOperationsOlderThan(7 * 24);
    // Observation 表不参与 retention 删除（证据保留原则；Operation 删除仅影响追溯入口）
    expect(store.getObservation("obs_keep")).toBeDefined();
    store.close();
  });
});
