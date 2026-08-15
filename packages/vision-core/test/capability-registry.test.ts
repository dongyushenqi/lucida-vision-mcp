import { describe, expect, it } from "vitest";
import { InMemoryVisionStore } from "../src/store.js";
import { CapabilityRegistry } from "../src/capability-registry.js";

function makeRegistry() {
  const store = new InMemoryVisionStore();
  const clock = () => "2026-01-15T08:30:00.000Z";
  return new CapabilityRegistry(store, clock);
}

const DECLARED = {
  provider: "agnes",
  capabilities: ["image_understanding", "structured_detection", "ocr", "multi_image"],
  constraints: {
    max_image_size: 10485760,
    supported_output_formats: ["text"],
    confidence_supported: false,
  },
};

describe("三层能力模型（规格三.2）", () => {
  it("注册后 effective 为空（未验证）", () => {
    const reg = makeRegistry();
    reg.register(DECLARED);
    expect(reg.effective("agnes")).toBeUndefined();
  });

  it("Effective = Declared ∩ Verified，且保留约束（约束保留原则）", () => {
    const reg = makeRegistry();
    reg.register(DECLARED);
    reg.verify({
      provider: "agnes",
      capabilities: ["image_understanding", "structured_detection"],
      probe_id: "probe_1",
      verified_at: "2026-01-15T08:30:00.000Z",
    });
    const effective = reg.effective("agnes")!;
    expect(effective.capabilities).toEqual(["image_understanding", "structured_detection"]);
    expect(effective.constraints).toEqual(DECLARED.constraints);
  });

  it("探针只更新 Registry，不触碰 Observation 存储（副作用边界）", () => {
    const store = new InMemoryVisionStore();
    const reg = new CapabilityRegistry(store, () => "2026-01-15T08:30:00.000Z");
    reg.register(DECLARED);
    reg.verify({
      provider: "agnes",
      capabilities: ["image_understanding"],
      probe_id: "probe_1",
      verified_at: "2026-01-15T08:30:00.000Z",
    });
    expect(store.listObservations("any")).toEqual([]);
    expect(store.listOperations("any")).toEqual([]);
  });

  it("未注册 provider 的 verify 报错", () => {
    const reg = makeRegistry();
    expect(() =>
      reg.verify({
        provider: "ghost",
        capabilities: ["image_understanding"],
        probe_id: "p",
        verified_at: "2026-01-15T08:30:00.000Z",
      }),
    ).toThrow();
  });
});
