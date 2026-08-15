import { describe, expect, it } from "vitest";
import { ArtifactMetadata } from "../src/artifact.js";
import { Observation } from "../src/observation.js";
import { OperationRecord } from "../src/operation.js";
import { VisionSession } from "../src/session.js";
import { CapabilityRegistryEntry } from "../src/capability.js";

const source = {
  provider: "agnes",
  model: "agnes-2.5-flash",
  model_version: "agnes-2.5-flash",
  adapter_version: "0.1.0",
  execution_timestamp: "2026-01-15T08:30:00.000Z",
};

describe("Observation（规格三.1）", () => {
  const validObservation = {
    schema_version: 1,
    observation_id: "obs_1",
    label: "brown_spot",
    location: { type: "bbox", bbox: [10, 20, 30, 40], coordinate_system: "image_px" },
    confidence: { value: 0.87, semantics: "provider_defined" },
    source,
    lineage: { operation_id: "op_1", derivation: "direct", parents: [] },
    limitations: [],
    status: "committed",
    created_at: "2026-01-15T08:30:01.000Z",
  };

  it("接受合法 Observation", () => {
    expect(Observation.safeParse(validObservation).success).toBe(true);
  });

  it("拒绝额外字段（strict）", () => {
    expect(Observation.safeParse({ ...validObservation, diagnosis: "early_blight" }).success).toBe(
      false,
    );
  });

  it("拒绝缺失必须字段", () => {
    const { label: _label, ...rest } = validObservation;
    expect(Observation.safeParse(rest).success).toBe(false);
  });

  it("confidence 允许 null（Provider 不提供置信度，Contract Clarification）", () => {
    expect(
      Observation.safeParse({
        ...validObservation,
        confidence: { value: null, semantics: "provider_defined" },
        limitations: ["confidence_not_provided_by_provider"],
      }).success,
    ).toBe(true);
  });

  it("visual_evidence 标签可携带证据文本", () => {
    expect(
      Observation.safeParse({
        ...validObservation,
        label: "visual_evidence",
        text: "图片中可见一个褐色斑点",
      }).success,
    ).toBe(true);
  });
});

describe("Artifact Metadata（规格四.2）", () => {
  it("接受合法元数据", () => {
    expect(
      ArtifactMetadata.safeParse({
        schema_version: 1,
        artifact_id: "art_1",
        mime_type: "image/png",
        content_length: 12345,
        digest: { algorithm: "SHA-256", value: "a".repeat(64) },
        created_at: "2026-01-15T08:30:01.000Z",
        storage: { tier: 1, ref: "vision://vs_1/art_1" },
      }).success,
    ).toBe(true);
  });

  it("拒绝非法 digest 值", () => {
    expect(
      ArtifactMetadata.safeParse({
        schema_version: 1,
        artifact_id: "art_1",
        mime_type: "image/png",
        content_length: 1,
        digest: { algorithm: "SHA-256", value: "xyz" },
        created_at: "2026-01-15T08:30:01.000Z",
        storage: { tier: 1, ref: "vision://vs_1/art_1" },
      }).success,
    ).toBe(false);
  });
});

describe("Operation record（规格二.3 / 五.2）", () => {
  it("状态无 partially_completed", () => {
    expect(
      OperationRecord.safeParse({
        schema_version: 1,
        operation_id: "op_1",
        vision_session_id: "vs_1",
        tool_name: "vision.observe",
        canonical_parameter_identity: "sha256:" + "a".repeat(64),
        status: "partially_completed",
        created_at: "2026-01-15T08:30:00.000Z",
        started_at: null,
        finished_at: null,
      }).success,
    ).toBe(false);
  });

  it("接受四种合法状态", () => {
    for (const status of ["running", "completed", "cancelled", "failed"]) {
      expect(
        OperationRecord.safeParse({
          schema_version: 1,
          operation_id: "op_1",
          vision_session_id: "vs_1",
          tool_name: "vision.observe",
          canonical_parameter_identity: "sha256:" + "a".repeat(64),
          status,
          created_at: "2026-01-15T08:30:00.000Z",
          started_at: null,
          finished_at: null,
        }).success,
      ).toBe(true);
    }
  });
});

describe("Vision Session（规格二.4）", () => {
  it("接受合法 Session 并绑定 Principal/Tenant", () => {
    expect(
      VisionSession.safeParse({
        schema_version: 1,
        vision_session_id: "vs_1",
        principal_id: "p_1",
        tenant_id: "t_1",
        status: "active",
        created_at: "2026-01-15T08:30:00.000Z",
      }).success,
    ).toBe(true);
  });
});

describe("Capability Registry（规格三.2）", () => {
  it("entry 包含 schema_version 且 effective 保留 constraints", () => {
    const entry = {
      schema_version: 1,
      provider: "agnes",
      declared: {
        provider: "agnes",
        capabilities: ["image_understanding", "structured_detection"],
        constraints: { max_image_size: 10485760, supported_output_formats: ["text"] },
      },
      verified: {
        provider: "agnes",
        capabilities: ["image_understanding"],
        probe_id: "probe_1",
        verified_at: "2026-01-15T08:30:00.000Z",
      },
      effective: {
        provider: "agnes",
        capabilities: ["image_understanding"],
        constraints: { max_image_size: 10485760, supported_output_formats: ["text"] },
        updated_at: "2026-01-15T08:30:00.000Z",
      },
      updated_at: "2026-01-15T08:30:00.000Z",
    };
    expect(CapabilityRegistryEntry.safeParse(entry).success).toBe(true);
  });
});
