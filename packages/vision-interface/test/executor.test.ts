import { describe, expect, it, vi } from "vitest";
import {
  ApplicationErrorCode,
  type CapabilityId,
  type DeclaredCapability,
  type VerifiedCapability,
} from "@mcp-vision/contracts";
import {
  CancellationTokenSource,
  FetchBoundary,
  VisionCore,
  type ProviderExecuteRequest,
  type ProviderExecuteResult,
  type VLMProvider,
} from "@mcp-vision/vision-core";
import { InMemoryVisionStore } from "@mcp-vision/vision-core";
import { VisionExecutor } from "../src/executor.js";
import type { IdentityContext } from "../src/identity.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const IDENTITY: IdentityContext = { principalId: "p1", tenantId: "t1" };
const OTHER_IDENTITY: IdentityContext = { principalId: "p2", tenantId: "t1" };

class MockProvider implements VLMProvider {
  readonly providerId = "mock";
  readonly adapterVersion = "0.1.0";
  readonly capabilityIds: CapabilityId[];
  calls = 0;

  constructor(
    private readonly opts: {
      declared: DeclaredCapability;
      verified?: CapabilityId[];
      text?: string;
      failWith?: Error;
      delayMs?: number;
    },
  ) {
    this.capabilityIds = opts.declared.capabilities;
  }

  declare(): DeclaredCapability {
    return this.opts.declared;
  }

  async probe(): Promise<VerifiedCapability> {
    return {
      provider: this.providerId,
      capabilities: this.opts.verified ?? [],
      probe_id: "probe_1",
      verified_at: "2026-01-15T08:30:00.000Z",
    };
  }

  async execute(req: ProviderExecuteRequest, signal: AbortSignal): Promise<ProviderExecuteResult> {
    this.calls += 1;
    if (this.opts.failWith) throw this.opts.failWith;
    if (this.opts.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.opts.delayMs));
    }
    signal.throwIfAborted();
    return {
      text: this.opts.text ?? "证据文本",
      providerMeta: {
        provider: "mock",
        model: "mock-vlm",
        model_version: "1.0.0",
        execution_timestamp: "2026-01-15T08:30:00.000Z",
      },
    };
  }
}

const DECLARED: DeclaredCapability = {
  provider: "mock",
  capabilities: ["image_understanding", "structured_detection", "ocr"],
  constraints: { confidence_supported: false },
};

async function makeEnv(opts: { verified?: CapabilityId[]; text?: string; failWith?: Error; delayMs?: number } = {}) {
  const provider = new MockProvider({ declared: DECLARED, ...opts });
  const core = new VisionCore({
    store: new InMemoryVisionStore(),
    fetchBoundary: new FetchBoundary(),
    providers: [provider],
  });
  core.capabilities.register(provider.declare());
  if (opts.verified) {
    core.capabilities.verify(await provider.probe());
  }
  const executor = new VisionExecutor(core);
  const createRes = await executor.execute({
    toolName: "vision.session.create",
    args: {},
    identity: IDENTITY,
    cancel: new CancellationTokenSource(),
  });
  const sessionId = (createRes.result.structured as { vision_session_id: string }).vision_session_id;
  return { provider, core, executor, sessionId };
}

function call(executor: VisionExecutor, toolName: string, args: Record<string, unknown>, identity = IDENTITY, cancel?: CancellationTokenSource) {
  return executor.execute({ toolName, args, identity, cancel: cancel ?? new CancellationTokenSource() });
}

const OBSERVE_ARGS = (sessionId: string, extra: Record<string, unknown> = {}) => ({
  vision_session_id: sessionId,
  image_input: { type: "inline", inline: { mime_type: "image/png", blob: PNG_1PX } },
  ...extra,
});

describe("Session 授权沙箱（规格二.4）", () => {
  it("Session ID 不能跨 Principal 访问", async () => {
    const { executor, sessionId } = await makeEnv();
    const r = await call(executor, "vision.session.get", { vision_session_id: sessionId }, OTHER_IDENTITY);
    expect(r.result.isError).toBe(true);
    expect((r.result.structured as { error: { application_error_code: string } }).error.application_error_code)
      .toBe(ApplicationErrorCode.SESSION_AUTHORIZATION_DENIED);
  });

  it("session.create 绑定 Principal/Tenant", async () => {
    const { sessionId, core } = await makeEnv();
    const session = core.sessions.get(sessionId)!;
    expect(session.principal_id).toBe("p1");
    expect(session.tenant_id).toBe("t1");
  });
});

describe("vision.observe（规格三.1 / 四.1）", () => {
  it("默认证据文本 Observation：committed + provenance 完整", async () => {
    const { executor, sessionId, core } = await makeEnv({ verified: ["image_understanding"], text: "一个褐色斑点" });
    const r = await call(executor, "vision.observe", OBSERVE_ARGS(sessionId));
    expect(r.result.isError).toBe(false);
    const summary = r.result.structured as { observations: Array<{ label: string; text?: string; limitations: string[] }> };
    expect(summary.observations).toHaveLength(1);
    expect(summary.observations[0]!.label).toBe("visual_evidence");
    expect(summary.observations[0]!.text).toBe("一个褐色斑点");
    expect(summary.observations[0]!.limitations).toContain("confidence_not_provided_by_provider");
    // 已 committed：Operation 证据清单 + 图谱
    expect(r.operation!.status).toBe("completed");
    expect(r.operation!.committed_observation_ids).toHaveLength(1);
    expect(core.graph.list(sessionId)).toHaveLength(1);
  });

  it("json_mode + 已验证 structured_detection → 结构化 Observation", async () => {
    const text = JSON.stringify({ objects: [{ label: "brown_spot", bbox: [1, 2, 3, 4] }] });
    const { executor, sessionId } = await makeEnv({
      verified: ["image_understanding", "structured_detection"],
      text,
    });
    const r = await call(executor, "vision.observe", OBSERVE_ARGS(sessionId, { json_mode: true }));
    const summary = r.result.structured as { observations: Array<{ label: string; location: { type: string } }> };
    expect(summary.observations[0]!.label).toBe("brown_spot");
    expect(summary.observations[0]!.location.type).toBe("bbox");
  });

  it("json_mode 但未验证 structured_detection → 可行性评估事实（非错误、无建议）", async () => {
    const { executor, sessionId, provider } = await makeEnv({ verified: ["image_understanding"] });
    const r = await call(executor, "vision.observe", OBSERVE_ARGS(sessionId, { json_mode: true }));
    expect(r.result.isError).toBe(false);
    const s = r.result.structured as { executability: { executable: boolean; reasons: string[] } };
    expect(s.executability.executable).toBe(false);
    expect(s.executability.reasons.join()).toContain("structured_detection");
    expect(provider.calls).toBe(0); // 未执行 Provider
    expect(r.operation!.status).toBe("completed");
  });
});

describe("vision.detect / vision.ocr", () => {
  it("detect 未验证 structured_detection → 不可执行评估", async () => {
    const { executor, sessionId } = await makeEnv({ verified: ["image_understanding"] });
    const r = await call(executor, "vision.detect", OBSERVE_ARGS(sessionId, { labels: ["spot"] }));
    const s = r.result.structured as { executability: { executable: boolean } };
    expect(s.executability.executable).toBe(false);
  });

  it("detect 已验证 → 结构化 Observation", async () => {
    const text = JSON.stringify({ objects: [{ label: "crack", bbox: [0, 0, 10, 10] }] });
    const { executor, sessionId } = await makeEnv({ verified: ["structured_detection"], text });
    const r = await call(executor, "vision.detect", OBSERVE_ARGS(sessionId, { labels: ["crack"] }));
    const s = r.result.structured as { observations: Array<{ label: string }> };
    expect(s.observations[0]!.label).toBe("crack");
  });

  it("ocr → text_block Observation", async () => {
    const { executor, sessionId } = await makeEnv({ verified: ["ocr"], text: "HELLO 世界" });
    const r = await call(executor, "vision.ocr", OBSERVE_ARGS(sessionId));
    const s = r.result.structured as { observations: Array<{ label: string; text?: string }> };
    expect(s.observations[0]!.label).toBe("text_block");
    expect(s.observations[0]!.text).toBe("HELLO 世界");
  });
});

describe("幂等与冲突（规格五.2）", () => {
  it("同 operation_id + 同参数：不创建第二次执行（返回既有状态）", async () => {
    const { executor, sessionId, provider } = await makeEnv({ verified: ["image_understanding"] });
    const args = OBSERVE_ARGS(sessionId, { operation_id: "op_dedup" });
    const first = await call(executor, "vision.observe", args);
    const second = await call(executor, "vision.observe", args);
    expect(second.deduplicated).toBe(true);
    expect(second.inFlight).toBe(false);
    expect(second.operation!.status).toBe("completed");
    expect(provider.calls).toBe(1);
  });

  it("同 operation_id + 参数变化 → OPERATION_ID_CONFLICT（严禁重执行/返回旧结果）", async () => {
    const { executor, sessionId, provider } = await makeEnv({ verified: ["image_understanding"] });
    await call(executor, "vision.observe", OBSERVE_ARGS(sessionId, { operation_id: "op_conflict" }));
    const second = await call(executor, "vision.observe", OBSERVE_ARGS(sessionId, {
      operation_id: "op_conflict",
      instruction: "完全不同的指令",
    }));
    expect(second.result.isError).toBe(true);
    const s = second.result.structured as { error: { application_error_code: string } };
    expect(s.error.application_error_code).toBe(ApplicationErrorCode.OPERATION_ID_CONFLICT);
    expect(provider.calls).toBe(1);
  });

  it("In-flight 去重：返回 running 状态供轮询", async () => {
    const { executor, sessionId, provider } = await makeEnv({
      verified: ["image_understanding"],
      delayMs: 200,
    });
    const args = OBSERVE_ARGS(sessionId, { operation_id: "op_inflight" });
    const firstP = call(executor, "vision.observe", args);
    const second = await call(executor, "vision.observe", args);
    expect(second.deduplicated).toBe(true);
    expect(second.inFlight).toBe(true);
    expect(second.operation!.status).toBe("running");
    await firstP;
    expect(provider.calls).toBe(1);
  });
});

describe("取消契约（规格二.2）", () => {
  it("取消 → operation cancelled；已 committed 证据保留；取消不是错误", async () => {
    const { executor, sessionId, core } = await makeEnv({ verified: ["image_understanding"], delayMs: 500 });
    const cancel = new CancellationTokenSource();
    const args = OBSERVE_ARGS(sessionId, { operation_id: "op_cancel" });
    // 先直接提交一条证据（模拟取消前已 committed）
    const existing = core.graph.commitObservation(sessionId, {
      schema_version: 1,
      observation_id: "obs_before_cancel",
      label: "visual_evidence",
      location: { type: "full_image", coordinate_system: "image_px" },
      confidence: { value: null, semantics: "provider_defined" },
      source: {
        provider: "mock",
        model: "mock-vlm",
        model_version: "1.0.0",
        adapter_version: "0.1.0",
        execution_timestamp: "2026-01-15T08:30:00.000Z",
      },
      lineage: { operation_id: "op_cancel", derivation: "direct", parents: [] },
      limitations: [],
      status: "pending",
      created_at: "",
    });
    void existing;

    const p = call(executor, "vision.observe", args, IDENTITY, cancel);
    await new Promise((r) => setTimeout(r, 50));
    cancel.cancel();
    const r = await p;

    expect(r.result.isError).toBe(false);
    const s = r.result.structured as { cancelled: boolean };
    expect(s.cancelled).toBe(true);
    expect(r.operation!.status).toBe("cancelled");
    // 取消绝不移除已 committed 证据
    expect(core.graph.get(sessionId, "obs_before_cancel")).toBeDefined();
    expect(core.graph.list(sessionId).length).toBe(1);
  });

  it("Provider 失败 → operation failed + 错误事实（无建议字段）", async () => {
    const { executor, sessionId, provider } = await makeEnv({
      verified: ["image_understanding"],
      failWith: Object.assign(new Error("boom"), { name: "MockFail" }),
    });
    void provider;
    const r = await call(executor, "vision.observe", OBSERVE_ARGS(sessionId));
    expect(r.result.isError).toBe(true);
    expect(r.operation!.status).toBe("failed");
    const s = r.result.structured as { error: { application_error_code: string } };
    expect(s.error.application_error_code).toBe(ApplicationErrorCode.VISION_INTERNAL);
    expect(s.error).not.toHaveProperty("suggested_action");
  });
});

describe("IQA 能力评估（规格三.2：Final Executable = Effective ∩ IQA）", () => {
  /** 16x16 黑色 BMP（inline 合法，但长边超 max_dimension=8 约束） */
  function makeBmp(width: number, height: number): string {
    const rowSize = Math.ceil((width * 3) / 4) * 4;
    const buf = Buffer.alloc(14 + 40 + rowSize * height);
    buf.write("BM", 0, "ascii");
    buf.writeUInt32LE(54 + rowSize * height, 2);
    buf.writeUInt32LE(54, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(width, 18);
    buf.writeInt32LE(height, 22);
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(24, 28);
    return buf.toString("base64");
  }

  it("图像长边超 Provider 约束 → 不可执行评估（事实，无建议）；IQA 不进图谱", async () => {
    const provider = new MockProvider({
      declared: {
        provider: "mock",
        capabilities: ["image_understanding"],
        constraints: { max_dimension: 8 },
      },
      verified: ["image_understanding"],
    });
    const core = new VisionCore({
      store: new InMemoryVisionStore(),
      fetchBoundary: new FetchBoundary(),
      providers: [provider],
    });
    core.capabilities.register(provider.declare());
    core.capabilities.verify(await provider.probe());
    const executor = new VisionExecutor(core);
    const createRes = await executor.execute({
      toolName: "vision.session.create",
      args: {},
      identity: IDENTITY,
      cancel: new CancellationTokenSource(),
    });
    const sessionId = (createRes.result.structured as { vision_session_id: string }).vision_session_id;

    const r = await call(executor, "vision.observe", {
      vision_session_id: sessionId,
      image_input: {
        type: "inline",
        inline: { mime_type: "image/bmp", blob: makeBmp(16, 16) },
      },
    });
    expect(r.result.isError).toBe(false);
    const s = r.result.structured as {
      executability: { executable: boolean; reasons: string[]; iqa?: { width: number } };
    };
    expect(s.executability.executable).toBe(false);
    expect(s.executability.reasons[0]).toMatch(/IQA: dimension_exceeds/);
    expect(s.executability.iqa).toMatchObject({ width: 16, height: 16 });
    // IQA 只进 Execution Metadata：图谱与 Operation 结果都无 Observation
    expect(r.operation!.committed_observation_ids).toEqual([]);
    expect(core.graph.list(sessionId)).toEqual([]);
  });
});

describe("resource_ref 授权（规格四.1）", () => {
  it("跨 Session resource_ref → RESOURCE_AUTHORIZATION_DENIED", async () => {
    const { executor, sessionId, core } = await makeEnv({ verified: ["image_understanding"] });
    const artMeta = core.artifacts.storeArtifact(sessionId, Buffer.from(PNG_1PX, "base64"), "image/png");
    // 同 Principal 的另一个 Session
    const b = await call(executor, "vision.session.create", {});
    const sessionB = (b.result.structured as { vision_session_id: string }).vision_session_id;
    const r = await call(executor, "vision.observe", OBSERVE_ARGS(sessionB, {
      image_input: { type: "resource_ref", resource_ref: artMeta.storage.ref },
    }));
    expect(r.result.isError).toBe(true);
    const s = r.result.structured as { error: { application_error_code: string } };
    expect(s.error.application_error_code).toBe(ApplicationErrorCode.RESOURCE_AUTHORIZATION_DENIED);
  });

  it("同 Session resource_ref 可正常 dereference", async () => {
    const { executor, sessionId, core } = await makeEnv({ verified: ["image_understanding"] });
    const artMeta = core.artifacts.storeArtifact(sessionId, Buffer.from(PNG_1PX, "base64"), "image/png");
    const r = await call(executor, "vision.observe", OBSERVE_ARGS(sessionId, {
      image_input: { type: "resource_ref", resource_ref: artMeta.storage.ref },
    }));
    expect(r.result.isError).toBe(false);
    expect((r.result.structured as { observations: unknown[] }).observations).toHaveLength(1);
  });
});

describe("参数校验", () => {
  it("非法参数 → VISION_INVALID_ARGS（isError 结果，不抛异常）", async () => {
    const { executor, sessionId } = await makeEnv();
    const r = await call(executor, "vision.observe", { image_input: { type: "uri", uri: "https://x/y.png" } } as never);
    expect(r.result.isError).toBe(true);
    const s = r.result.structured as { error: { application_error_code: string } };
    expect(s.error.application_error_code).toBe(ApplicationErrorCode.VISION_INVALID_ARGS);
  });

  it("未知工具 → VISION_TOOL_NOT_FOUND", async () => {
    const { executor } = await makeEnv();
    const r = await call(executor, "vision.nonexistent", {});
    const s = r.result.structured as { error: { application_error_code: string } };
    expect(s.error.application_error_code).toBe(ApplicationErrorCode.VISION_TOOL_NOT_FOUND);
  });
});

describe("operation.get / operation.cancel", () => {
  it("operation.cancel 终止 running；重复 cancel 为幂等 no-op", async () => {
    const { executor, sessionId } = await makeEnv({ verified: ["image_understanding"], delayMs: 300 });
    const cancel = new CancellationTokenSource();
    const p = call(executor, "vision.observe", OBSERVE_ARGS(sessionId, { operation_id: "op_x" }), IDENTITY, cancel);
    await new Promise((r) => setTimeout(r, 30));
    const c = await call(executor, "vision.operation.cancel", {
      vision_session_id: sessionId,
      operation_id: "op_x",
    });
    expect(c.result.isError).toBe(false);
    expect((c.result.structured as { operation: { status: string } }).operation.status).toBe("cancelled");
    const c2 = await call(executor, "vision.operation.cancel", {
      vision_session_id: sessionId,
      operation_id: "op_x",
    });
    expect(c2.result.isError).toBe(false);
    await p;
  });
});
