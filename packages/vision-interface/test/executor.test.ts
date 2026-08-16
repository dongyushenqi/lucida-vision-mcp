import { describe, expect, it, vi } from "vitest";
import {
  ApplicationErrorCode,
  VisionError,
  type CapabilityId,
  type DeclaredCapability,
  type VerifiedCapability,
} from "@mcp-vision/contracts";
import {
  CancellationTokenSource,
  FetchBoundary,
  OperationCancelledError,
  VisionCore,
  type ProviderExecuteRequest,
  type ProviderExecuteResult,
  type ProviderImage,
  type VLMProvider,
} from "@mcp-vision/vision-core";
import { InMemoryVisionStore } from "@mcp-vision/vision-core";
import { VisionExecutor } from "../src/executor.js";
import { MAX_SUMMARIZE_IMAGES } from "../src/args.js";
import type { IdentityContext } from "../src/identity.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const IDENTITY: IdentityContext = { principalId: "p1", tenantId: "t1" };
const OTHER_IDENTITY: IdentityContext = { principalId: "p2", tenantId: "t1" };

class MockProvider implements VLMProvider {
  readonly providerId = "mock";
  readonly protocolFamily = "openai-compatible" as const;
  readonly adapterVersion = "0.1.0";
  readonly capabilityIds: CapabilityId[];
  calls = 0;
  /** 最近一次 execute 收到的指令（断言默认指令/覆盖/Agent 指令用） */
  lastInstruction?: string;
  /** 最近一次 execute 收到的图片数组（断言多图批量用） */
  lastImages?: ProviderImage[];
  /** 最近一次 execute 的 jsonMode */
  lastJsonMode?: boolean;

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
    this.lastInstruction = req.instruction;
    this.lastImages = req.images;
    this.lastJsonMode = req.jsonMode;
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
    // 1x1 测试图：bbox 必须是界内合法值 [0,0,0,0]（审查 #6 契约校验）
    const text = JSON.stringify({ objects: [{ label: "brown_spot", bbox: [0, 0, 0, 0] }] });
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
    const text = JSON.stringify({ objects: [{ label: "crack", bbox: [0, 0, 0, 0] }] });
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
  it("operation.cancel 真实中止 Provider（审查 #1：in-flight 映射 → token.cancel）", async () => {
    // Provider 执行中监听 abort → 抛 OperationCancelledError（模拟真实中止）
    const provider = new MockProvider({
      declared: DECLARED,
      verified: ["image_understanding"],
    });
    // 覆写 execute：等待 abort
    const origExecute = provider.execute.bind(provider);
    provider.execute = async (req, signal) => {
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new OperationCancelledError("aborted")));
      });
      return origExecute(req, signal);
    };
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

    const running = call(executor, "vision.observe", OBSERVE_ARGS(sessionId, { operation_id: "op_abort" }));
    await new Promise((r) => setTimeout(r, 30));
    const cancelRes = await call(executor, "vision.operation.cancel", {
      vision_session_id: sessionId,
      operation_id: "op_abort",
    });
    expect(cancelRes.result.isError).toBe(false);
    expect((cancelRes.result.structured as { operation: { status: string } }).operation.status).toBe("cancelled");

    // 原请求：Provider 被真实中止 → cancelled 结果，绝不是 VISION_INTERNAL
    const r = await running;
    expect(r.result.isError).toBe(false);
    const s = r.result.structured as { cancelled: boolean };
    expect(s.cancelled).toBe(true);
    expect(r.operation!.status).toBe("cancelled");
  });

  it("in-flight 取消映射按 Vision Session 隔离（同一 operation_id 不跨 Session 误中止）", async () => {
    const aborted: string[] = [];
    const provider = new MockProvider({
      declared: DECLARED,
      verified: ["image_understanding"],
    });
    const origExecute = provider.execute.bind(provider);
    provider.execute = async (req, signal) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!signal.aborted) resolve();
        }, 200);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            aborted.push("aborted");
            reject(new OperationCancelledError("aborted"));
          },
          { once: true },
        );
      });
      return origExecute(req, signal);
    };

    const core = new VisionCore({
      store: new InMemoryVisionStore(),
      fetchBoundary: new FetchBoundary(),
      providers: [provider],
    });
    core.capabilities.register(provider.declare());
    core.capabilities.verify(await provider.probe());
    const executor = new VisionExecutor(core);
    const createSession = async () => {
      const created = await executor.execute({
        toolName: "vision.session.create",
        args: {},
        identity: IDENTITY,
        cancel: new CancellationTokenSource(),
      });
      return (created.result.structured as { vision_session_id: string }).vision_session_id;
    };
    const sessionA = await createSession();
    const sessionB = await createSession();
    const sameArgs = (sessionId: string) =>
      OBSERVE_ARGS(sessionId, { operation_id: "op_shared" });

    const runningA = call(executor, "vision.observe", sameArgs(sessionA));
    await new Promise((r) => setTimeout(r, 30));
    const runningB = call(executor, "vision.observe", sameArgs(sessionB));
    await new Promise((r) => setTimeout(r, 30));

    const cancelA = await call(executor, "vision.operation.cancel", {
      vision_session_id: sessionA,
      operation_id: "op_shared",
    });
    expect((cancelA.result.structured as { operation: { status: string } }).operation.status).toBe("cancelled");

    const rA = await runningA;
    const rB = await runningB;
    // 会话作用域映射：取消 A 只中止 A；B 正常完成
    expect(aborted).toHaveLength(1);
    expect(rA.result.structured).toMatchObject({ cancelled: true });
    expect(rA.operation!.status).toBe("cancelled");
    expect(rB.result.isError).toBe(false);
    expect(rB.operation!.status).toBe("completed");
  });

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

describe("closed Session 语义（审查 #5）", () => {
  it("delete 后：新执行被拒（SESSION_CLOSED）；读取状态与保留证据仍可", async () => {
    const { executor, sessionId, core } = await makeEnv({ verified: ["image_understanding"] });
    await call(executor, "vision.observe", OBSERVE_ARGS(sessionId, { operation_id: "op_keep" }));
    await call(executor, "vision.session.delete", { vision_session_id: sessionId });

    // 新执行 → SESSION_CLOSED（isError，非异常）
    const r = await call(executor, "vision.observe", OBSERVE_ARGS(sessionId));
    expect(r.result.isError).toBe(true);
    expect(
      (r.result.structured as { error: { application_error_code: string } }).error.application_error_code,
    ).toBe(ApplicationErrorCode.SESSION_CLOSED);

    // operation.get 读取保留记录允许（closed 只禁新执行）
    const og = await call(executor, "vision.operation.get", {
      vision_session_id: sessionId,
      operation_id: "op_keep",
    });
    expect(og.result.isError).toBe(false);
    expect((og.result.structured as { operation: { status: string } }).operation.status).toBe("completed");

    // session.get 读取允许（allowClosed）
    const sg = await call(executor, "vision.session.get", { vision_session_id: sessionId });
    expect(sg.result.isError).toBe(false);
    expect((sg.result.structured as { status: string }).status).toBe("closed");

    // 保留证据（Artifact）读取允许
    const art = core.artifacts.storeArtifact(sessionId, Buffer.from(PNG_1PX, "base64"), "image/png");
    const ref = await call(executor, "vision.observe", {
      vision_session_id: sessionId,
      image_input: { type: "resource_ref", resource_ref: art.storage.ref },
    });
    expect(ref.result.isError).toBe(true); // 新执行仍被拒（即使 resource_ref 本身可读）
  });

  it("重复 delete 幂等", async () => {
    const { executor, sessionId } = await makeEnv();
    await call(executor, "vision.session.delete", { vision_session_id: sessionId });
    const again = await call(executor, "vision.session.delete", { vision_session_id: sessionId });
    expect(again.result.isError).toBe(false);
  });
});

describe("结构化结果契约校验（审查 #6）", () => {
  it("detect：bbox 越出图像边界 → 该项不合格，整体 structured_parse_failed", async () => {
    const text = JSON.stringify({
      objects: [{ label: "crack", bbox: [0, 0, 9999, 9999] }],
    });
    const { executor, sessionId } = await makeEnv({
      verified: ["structured_detection"],
      text,
    });
    const r = await call(executor, "vision.detect", OBSERVE_ARGS(sessionId, { labels: ["crack"] }));
    const s = r.result.structured as {
      observations: Array<{ label: string; limitations: string[] }>;
    };
    expect(s.observations).toHaveLength(1);
    expect(s.observations[0]!.label).toBe("visual_evidence");
    expect(s.observations[0]!.limitations).toContain("structured_parse_failed");
  });

  it("detect：缺 bbox 的对象不合格（不得降级 full_image）", async () => {
    const text = JSON.stringify({ objects: [{ label: "crack" }] });
    const { executor, sessionId } = await makeEnv({ verified: ["structured_detection"], text });
    const r = await call(executor, "vision.detect", OBSERVE_ARGS(sessionId, { labels: ["crack"] }));
    const s = r.result.structured as { observations: Array<{ limitations: string[] }> };
    expect(s.observations[0]!.limitations).toContain("structured_parse_failed");
  });

  it('detect：合法空结果 {"objects":[]} 不是解析失败', async () => {
    const { executor, sessionId } = await makeEnv({
      verified: ["structured_detection"],
      text: JSON.stringify({ objects: [] }),
    });
    const r = await call(executor, "vision.detect", OBSERVE_ARGS(sessionId, { labels: ["crack"] }));
    expect(r.result.isError).toBe(false);
    const s = r.result.structured as { observations: unknown[] };
    expect(s.observations).toEqual([]);
    expect(r.operation!.status).toBe("completed");
  });

  it("detect：Provider 返回白名单外 label → 不进入 Observation 图谱", async () => {
    const { executor, sessionId } = await makeEnv({
      verified: ["structured_detection"],
      text: JSON.stringify({ objects: [{ label: "cat", bbox: [0, 0, 0, 0] }] }),
    });
    const r = await call(executor, "vision.detect", OBSERVE_ARGS(sessionId, { labels: ["dog"] }));
    const s = r.result.structured as { observations: Array<{ label: string; limitations: string[] }> };
    expect(s.observations).toHaveLength(1);
    expect(s.observations[0]!.label).toBe("visual_evidence");
    expect(s.observations[0]!.limitations).toContain("structured_parse_failed");
  });

  it("observe json_mode：无 bbox 允许（降级 full_image）；非法 bbox 降级；confidence 超界置 null", async () => {
    const text = JSON.stringify({
      objects: [
        { label: "spot", confidence: 9.9 },
        { label: "ok", bbox: [0, 0, 0, 0], confidence: 0.5 },
        { label: "badbbox", bbox: [5, 5, 1, 1] }, // 坐标序非法 → 降级 full_image
      ],
    });
    const { executor, sessionId } = await makeEnv({
      verified: ["image_understanding", "structured_detection"],
      text,
    });
    const r = await call(executor, "vision.observe", OBSERVE_ARGS(sessionId, { json_mode: true }));
    const s = r.result.structured as {
      observations: Array<{
        location: { type: string };
        confidence: { value: number | null };
        limitations: string[];
      }>;
    };
    expect(s.observations).toHaveLength(3);
    expect(s.observations[0]!.location.type).toBe("full_image"); // 无 bbox → full_image
    expect(s.observations[0]!.confidence.value).toBeNull(); // 超界 → null
    expect(s.observations[0]!.limitations).toContain("confidence_invalid");
    expect(s.observations[1]!.location.type).toBe("bbox");
    expect(s.observations[1]!.confidence.value).toBe(0.5);
    expect(s.observations[2]!.location.type).toBe("full_image"); // 非法 bbox → 降级
    expect(s.observations[2]!.limitations).toContain("confidence_not_provided_by_provider");
  });

  it("结构化对象超限 → 截断并如实标记 too_many_objects（膨胀防御）", async () => {
    const objects = Array.from({ length: 1200 }, (_, i) => ({
      label: `obj_${i}`,
      bbox: [0, 0, 0, 0],
    }));
    const { executor, sessionId } = await makeEnv({
      verified: ["image_understanding", "structured_detection"],
      text: JSON.stringify({ objects }),
    });
    const r = await call(executor, "vision.observe", OBSERVE_ARGS(sessionId, { json_mode: true }));
    const s = r.result.structured as {
      observations: unknown[];
      limitations?: string[];
    };
    expect(s.observations.length).toBe(500); // 默认上限
    expect(s.limitations).toContain("too_many_objects");
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

describe("vision.observe 默认指令（v0.1.3 校准）", () => {
  it("未提供 instruction 时使用内置默认：聚焦主体、忽略水印、三档判断", async () => {
    const { executor, sessionId, provider } = await makeEnv({ verified: ["image_understanding"] });
    const res = await call(executor, "vision.observe", OBSERVE_ARGS(sessionId));
    expect(res.result.isError).toBe(false);
    const ins = provider.lastInstruction ?? "";
    // 聚焦主体、水印默认不转录、客观特征必须描述、主观评价三档、不推断
    expect(ins).toContain("水印与细小标识的文字转录");
    expect(ins).toContain("主体是什么就描述什么");
    expect(ins).toContain("穿着打扮");
    expect(ins).toContain("默认不主动输出");
    expect(ins).toContain("不得以“主观”为由拒绝回答");
    expect(ins).toContain("不推断、不编造");
    // 旧指令的"文本与几何模式"全要素要求已移除
    expect(ins).not.toContain("文本与几何模式");
  });

  it("构造注入 defaultInstruction 覆盖内置默认（VISION_DEFAULT_INSTRUCTION 通路）", async () => {
    const provider = new MockProvider({ declared: DECLARED, verified: ["image_understanding"] });
    const core = new VisionCore({
      store: new InMemoryVisionStore(),
      fetchBoundary: new FetchBoundary(),
      providers: [provider],
    });
    core.capabilities.register(provider.declare());
    core.capabilities.verify(await provider.probe());
    const executor = new VisionExecutor(core, { defaultInstruction: "只看主体，忽略一切细节" });
    const created = await call(executor, "vision.session.create", {});
    const sessionId = (created.result.structured as { vision_session_id: string }).vision_session_id;
    const res = await call(executor, "vision.observe", OBSERVE_ARGS(sessionId));
    expect(res.result.isError).toBe(false);
    expect(provider.lastInstruction).toBe("只看主体，忽略一切细节");
  });

  it("Agent 显式提供的 instruction 始终优先于默认与注入", async () => {
    const { executor, sessionId, provider } = await makeEnv({ verified: ["image_understanding"] });
    await call(executor, "vision.observe", OBSERVE_ARGS(sessionId, { instruction: "Agent 自定义指令" }));
    expect(provider.lastInstruction).toBe("Agent 自定义指令");
  });

  it("不预设默认模型：多 Provider 时未指定 provider_id 按注册顺序取第一个；显式 provider_id 精确选择", async () => {
    class SecondProvider extends MockProvider {
      readonly providerId = "mock2";
    }
    const first = new MockProvider({ declared: DECLARED, verified: ["image_understanding"] });
    const second = new SecondProvider({
      declared: { ...DECLARED, provider: "mock2" },
      verified: ["image_understanding"],
    });
    const core = new VisionCore({
      store: new InMemoryVisionStore(),
      fetchBoundary: new FetchBoundary(),
      providers: [first, second],
    });
    core.capabilities.register(first.declare());
    core.capabilities.register(second.declare());
    core.capabilities.verify(await first.probe());
    core.capabilities.verify(await second.probe());
    const executor = new VisionExecutor(core);
    const created = await call(executor, "vision.session.create", {});
    const sessionId = (created.result.structured as { vision_session_id: string }).vision_session_id;

    // 未指定 provider_id → 注册顺序第一个（静态默认，非自动路由）
    await call(executor, "vision.observe", OBSERVE_ARGS(sessionId));
    expect(first.calls).toBe(1);
    expect(second.calls).toBe(0);

    // 显式 provider_id → 精确选择第二个
    await call(executor, "vision.observe", OBSERVE_ARGS(sessionId, { provider_id: "mock2" }));
    expect(second.calls).toBe(1);
  });
});

describe("vision.summarize（批量综合概述）", () => {
  const PNG_2PX =
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAQAAABFaS0fAAAAEElEQVR42mNk+M9QzwAEjGQKABThA6XgvF6GAAAAAElFTkSuQmCC";
  const IMG = (id: number) => ({
    type: "inline" as const,
    inline: { mime_type: "image/png", blob: id === 1 ? PNG_1PX : PNG_2PX },
  });
  const SUMMARY_ARGS = (sessionId: string, n: number, extra: Record<string, unknown> = {}) => ({
    vision_session_id: sessionId,
    image_inputs: Array.from({ length: n }, (_, i) => IMG(i + 1)),
    ...extra,
  });

  it("2 张图 → Provider 收到 2 张图，单个 label=summary 观察，默认指令含批量语义", async () => {
    const { executor, sessionId, provider } = await makeEnv({ verified: ["image_understanding"] });
    const res = await call(executor, "vision.summarize", SUMMARY_ARGS(sessionId, 2));
    expect(res.result.isError).toBe(false);
    expect(provider.lastImages?.length).toBe(2);
    const ins = provider.lastInstruction ?? "";
    expect(ins).toContain("共 2 张");
    expect(ins).toContain("不要逐张罗列");
    expect(ins).toContain("水印与细小标识");
    // v0.4.1 校准：平实事实化 + 环境推断禁令
    expect(ins).toContain("平实直白的连贯文字");
    expect(ins).toContain("不推断拍摄时间");
    const s = res.result.structured as { observations: { label: string }[]; provider: string };
    expect(s.observations).toHaveLength(1);
    expect(s.observations[0]!.label).toBe("summary");
    expect(s.provider).toBe("mock");
  });

  it("参数校验：空数组与超过上限（16）都拒绝 → VISION_INVALID_ARGS", async () => {
    const { executor, sessionId } = await makeEnv({ verified: ["image_understanding"] });
    const empty = await call(executor, "vision.summarize", SUMMARY_ARGS(sessionId, 0));
    expect(empty.result.isError).toBe(true);
    const tooMany = await call(executor, "vision.summarize", SUMMARY_ARGS(sessionId, MAX_SUMMARIZE_IMAGES + 1));
    expect(tooMany.result.isError).toBe(true);
    const e = tooMany.result.structured as { error: { application_error_code: string } };
    expect(e.error.application_error_code).toBe(ApplicationErrorCode.VISION_INVALID_ARGS);
  });

  it("任一图片不可读 → 整体失败并如实报错（不静默丢弃）", async () => {
    const { executor, sessionId, provider } = await makeEnv({ verified: ["image_understanding"] });
    const res = await call(executor, "vision.summarize", {
      vision_session_id: sessionId,
      image_inputs: [
        IMG(1),
        { type: "inline", inline: { mime_type: "image/png", blob: "bm90LWFuLWltYWdl" } }, // 非图像字节
      ],
    });
    expect(res.result.isError).toBe(true);
    expect(provider.calls).toBe(0); // 取图阶段即失败，未触达 Provider
  });

  it("能力门禁：无 image_understanding 的 Provider → 如实不可执行", async () => {
    const { executor, sessionId } = await makeEnv({ verified: ["ocr"] });
    const res = await call(executor, "vision.summarize", SUMMARY_ARGS(sessionId, 1));
    expect(res.result.isError).toBe(false);
    const s = res.result.structured as { executability: { executable: boolean; reasons: string[] } };
    expect(s.executability.executable).toBe(false);
    expect(s.executability.reasons.join()).toContain("image_understanding");
  });

  it("operation_id 幂等：同参数二次调用去重；指令优先级 Agent > 注入 > 内置", async () => {
    const { executor, sessionId, provider } = await makeEnv({ verified: ["image_understanding"] });
    const args = SUMMARY_ARGS(sessionId, 2, { operation_id: "op_sum" });
    const first = await call(executor, "vision.summarize", args);
    expect(first.deduplicated).toBeUndefined();
    const second = await call(executor, "vision.summarize", args);
    expect(second.deduplicated).toBe(true);
    expect(provider.calls).toBe(1);

    // Agent 指令优先于注入
    await call(executor, "vision.summarize", SUMMARY_ARGS(sessionId, 1, { instruction: "按顺序描述" }));
    expect(provider.lastInstruction).toBe("按顺序描述");
  });

  it("有界并发批量：5 张图全部解析（按输入顺序），单次调用成功", async () => {
    const { executor, sessionId, provider } = await makeEnv({ verified: ["image_understanding"] });
    const res = await call(executor, "vision.summarize", SUMMARY_ARGS(sessionId, 5));
    expect(res.result.isError).toBe(false);
    expect(provider.lastImages?.length).toBe(5);
    expect(provider.calls).toBe(1);
  });

  it("多图门禁（审查修复）：Provider 声明 max_images_per_request=1 → summarize 2 图被如实拦截", async () => {
    const provider = new MockProvider({
      declared: { ...DECLARED, constraints: { max_images_per_request: 1 } },
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
    const created = await call(executor, "vision.session.create", {});
    const sessionId = (created.result.structured as { vision_session_id: string }).vision_session_id;
    const res = await call(executor, "vision.summarize", SUMMARY_ARGS(sessionId, 2));
    expect(res.result.isError).toBe(false);
    const s = res.result.structured as { executability: { executable: boolean; reasons: string[] } };
    expect(s.executability.executable).toBe(false);
    expect(s.executability.reasons.join()).toContain("images_exceed_provider_limit(1)");
    expect(provider.calls).toBe(0); // 门禁在 Provider 调用前拦截
  });
});

describe("vision.observe / summarize profile 档位（v0.2.1）", () => {
  const SUMMARY_ARGS = (sessionId: string, n: number, extra: Record<string, unknown> = {}) => ({
    vision_session_id: sessionId,
    image_inputs: Array.from({ length: n }, () => ({
      type: "inline" as const,
      inline: { mime_type: "image/png", blob: PNG_1PX },
    })),
    ...extra,
  });

  it("profile=deep：observe 使用深入指令包（水印/细小文字纳入，主观三档保留）", async () => {
    const { executor, sessionId, provider } = await makeEnv({ verified: ["image_understanding"] });
    const res = await call(executor, "vision.observe", OBSERVE_ARGS(sessionId, { profile: "deep" }));
    expect(res.result.isError).toBe(false);
    const ins = provider.lastInstruction ?? "";
    expect(ins).toContain("深入观察");
    expect(ins).toContain("水印");
    expect(ins).toContain("细小文字与标识");
    expect(ins).toContain("不得以“主观”为由拒绝回答");
    expect(ins).toContain("不推断、不编造");
  });

  it("profile=deep：summarize 使用深入概述指令包（含水印比较语义）", async () => {
    const { executor, sessionId, provider } = await makeEnv({ verified: ["image_understanding"] });
    await call(executor, "vision.summarize", SUMMARY_ARGS(sessionId, 3, { profile: "deep" }));
    const ins = provider.lastInstruction ?? "";
    expect(ins).toContain("共 3 张");
    expect(ins).toContain("水印、招牌、细小文字与标识的异同");
  });

  it("显式 instruction 优先于 profile=deep", async () => {
    const { executor, sessionId, provider } = await makeEnv({ verified: ["image_understanding"] });
    await call(executor, "vision.observe", OBSERVE_ARGS(sessionId, { profile: "deep", instruction: "只看主体" }));
    expect(provider.lastInstruction).toBe("只看主体");
  });

  it("构造注入 defaultProfile=deep：不传 profile 也走深入档（部署基调）", async () => {
    const provider = new MockProvider({ declared: DECLARED, verified: ["image_understanding"] });
    const core = new VisionCore({
      store: new InMemoryVisionStore(),
      fetchBoundary: new FetchBoundary(),
      providers: [provider],
    });
    core.capabilities.register(provider.declare());
    core.capabilities.verify(await provider.probe());
    const executor = new VisionExecutor(core, { defaultProfile: "deep" });
    const created = await call(executor, "vision.session.create", {});
    const sessionId = (created.result.structured as { vision_session_id: string }).vision_session_id;
    await call(executor, "vision.observe", OBSERVE_ARGS(sessionId));
    expect(provider.lastInstruction).toContain("深入观察");
    // 显式 instruction 仍优先
    await call(executor, "vision.observe", OBSERVE_ARGS(sessionId, { instruction: "x" }));
    expect(provider.lastInstruction).toBe("x");
  });

  it("非法 profile 值 → VISION_INVALID_ARGS", async () => {
    const { executor, sessionId } = await makeEnv({ verified: ["image_understanding"] });
    const res = await call(executor, "vision.observe", OBSERVE_ARGS(sessionId, { profile: "expert" }));
    expect(res.result.isError).toBe(true);
    const e = res.result.structured as { error: { application_error_code: string } };
    expect(e.error.application_error_code).toBe(ApplicationErrorCode.VISION_INVALID_ARGS);
  });
});

describe("vision.observe 声明式结构化观察（v0.3）", () => {
  const SCHEMA_ARGS = (sessionId: string, dims: string[], extra: Record<string, unknown> = {}) => ({
    vision_session_id: sessionId,
    image_input: { type: "inline", inline: { mime_type: "image/png", blob: PNG_1PX } },
    observation_schema: { dimensions: dims },
    ...extra,
  });
  const STRUCTURED_PROVIDER = { text: '{"color":"green","shape":"circular"}' };

  it("声明维度 → jsonMode 开启，单个 structured_observation，字段值如实返回", async () => {
    const { executor, sessionId, provider } = await makeEnv({
      verified: ["image_understanding", "structured_detection"],
      ...STRUCTURED_PROVIDER,
    });
    const res = await call(executor, "vision.observe", SCHEMA_ARGS(sessionId, ["color", "shape"]));
    expect(res.result.isError).toBe(false);
    expect(provider.lastJsonMode).toBe(true);
    const s = res.result.structured as { observations: { label: string; text: string }[] };
    expect(s.observations[0]!.label).toBe("structured_observation");
    const map = JSON.parse(s.observations[0]!.text) as Record<string, { value: unknown }>;
    expect(map["color"]!.value).toBe("green");
    expect(map["shape"]!.value).toBe("circular");
  });

  it("字段 unknown + 合法 reason → 合法证据（不失败）", async () => {
    const { executor, sessionId } = await makeEnv({
      verified: ["image_understanding", "structured_detection"],
      text: '{"symmetry":{"value":"unknown","reason":"insufficient_visual_evidence"},"count":3}',
    });
    const res = await call(executor, "vision.observe", SCHEMA_ARGS(sessionId, ["symmetry", "count"]));
    expect(res.result.isError).toBe(false);
    const s = res.result.structured as { observations: { text: string }[] };
    const map = JSON.parse(s.observations[0]!.text) as Record<string, { value: unknown; reason?: string }>;
    expect(map["symmetry"]).toEqual({ value: "unknown", reason: "insufficient_visual_evidence" });
    expect(map["count"]!.value).toBe(3);
  });

  it("reason 非枚举 → 整体 structured_parse_failed（两级失败语义）", async () => {
    const { executor, sessionId } = await makeEnv({
      verified: ["image_understanding", "structured_detection"],
      text: '{"shape":{"value":"unknown","reason":"i-dont-know"}}',
    });
    const res = await call(executor, "vision.observe", SCHEMA_ARGS(sessionId, ["shape"]));
    expect(res.result.isError).toBe(false);
    const s = res.result.structured as { observations: { limitations?: string[] }[] };
    expect(s.observations[0]!.limitations).toContain("structured_parse_failed");
  });

  it("输出含未声明键 → 整体 parse_failed（DSL 边界：只允许声明的维度）", async () => {
    const { executor, sessionId } = await makeEnv({
      verified: ["image_understanding", "structured_detection"],
      text: '{"color":"green","hacked_extra":"x"}',
    });
    const res = await call(executor, "vision.observe", SCHEMA_ARGS(sessionId, ["color"]));
    const s = res.result.structured as { observations: { limitations?: string[] }[] };
    expect(s.observations[0]!.limitations).toContain("structured_parse_failed");
  });

  it("缺失维度 → 如实标记 insufficient_visual_evidence", async () => {
    const { executor, sessionId } = await makeEnv({
      verified: ["image_understanding", "structured_detection"],
      text: '{"color":"green"}',
    });
    const res = await call(executor, "vision.observe", SCHEMA_ARGS(sessionId, ["color", "count"]));
    const s = res.result.structured as { observations: { text: string }[] };
    const map = JSON.parse(s.observations[0]!.text) as Record<string, { value: unknown; reason?: string }>;
    expect(map["count"]).toEqual({ value: "unknown", reason: "insufficient_visual_evidence" });
  });

  it("能力门禁：未经 structured_detection 验证 → 如实不可执行", async () => {
    const { executor, sessionId } = await makeEnv({ verified: ["image_understanding"] });
    const res = await call(executor, "vision.observe", SCHEMA_ARGS(sessionId, ["color"]));
    const s = res.result.structured as { executability: { executable: boolean; reasons: string[] } };
    expect(s.executability.executable).toBe(false);
    expect(s.executability.reasons.join()).toContain("structured_detection");
  });

  it("Agent instruction 与结构契约叠加（语义前缀 + 结构强制）", async () => {
    const { executor, sessionId, provider } = await makeEnv({
      verified: ["image_understanding", "structured_detection"],
      ...STRUCTURED_PROVIDER,
    });
    await call(
      executor,
      "vision.observe",
      SCHEMA_ARGS(sessionId, ["color"], { instruction: "重点观察叶子颜色" }),
    );
    const ins = provider.lastInstruction ?? "";
    expect(ins).toContain("重点观察叶子颜色");
    expect(ins).toContain("仅输出一个 JSON 对象");
    expect(ins).toContain("insufficient_visual_evidence");
  });

  it("参数校验：空维度与超过上限（20）→ VISION_INVALID_ARGS", async () => {
    const { executor, sessionId } = await makeEnv({ verified: ["image_understanding", "structured_detection"] });
    const empty = await call(executor, "vision.observe", SCHEMA_ARGS(sessionId, []));
    expect(empty.result.isError).toBe(true);
    const tooMany = await call(
      executor,
      "vision.observe",
      SCHEMA_ARGS(sessionId, Array.from({ length: 21 }, (_, i) => `d${i}`)),
    );
    expect(tooMany.result.isError).toBe(true);
  });

  it("幂等：同 schema + operation_id 二次调用去重（schema 参与参数身份）", async () => {
    const { executor, sessionId, provider } = await makeEnv({
      verified: ["image_understanding", "structured_detection"],
      ...STRUCTURED_PROVIDER,
    });
    const args = SCHEMA_ARGS(sessionId, ["color", "shape"], { operation_id: "op_struct" });
    await call(executor, "vision.observe", args);
    const second = await call(executor, "vision.observe", args);
    expect(second.deduplicated).toBe(true);
    expect(provider.calls).toBe(1);
  });
});

describe("vision.session.audit 审计汇总（v0.4 专业模块，按需调用）", () => {
  it("空 Session → 操作列表为空，返回 Session 元数据", async () => {
    const { executor, sessionId } = await makeEnv();
    const res = await call(executor, "vision.session.audit", { vision_session_id: sessionId });
    expect(res.result.isError).toBe(false);
    const s = res.result.structured as {
      vision_session_id: string;
      operation_count: number;
      operations: unknown[];
    };
    expect(s.vision_session_id).toBe(sessionId);
    expect(s.operation_count).toBe(0);
    expect(s.operations).toEqual([]);
  });

  it("observe + ocr 后：操作记录按时间排序，含状态/执行者/观察 id", async () => {
    const { executor, sessionId } = await makeEnv({ verified: ["image_understanding", "ocr"] });
    await call(executor, "vision.observe", OBSERVE_ARGS(sessionId));
    await call(executor, "vision.ocr", OBSERVE_ARGS(sessionId));
    const res = await call(executor, "vision.session.audit", { vision_session_id: sessionId });
    const s = res.result.structured as { operation_count: number; operations: any[] };
    expect(s.operation_count).toBe(2);
    expect(s.operations[0]!.tool_name).toBe("vision.observe");
    expect(s.operations[1]!.tool_name).toBe("vision.ocr");
    expect(s.operations[0]!.status).toBe("completed");
    expect(s.operations[0]!.provider).toBe("mock");
    expect(s.operations[0]!.observations).toBeUndefined(); // 默认不给观察元数据
  });

  it("include_observations=true：附观察全量元数据（label/location/source，区域对应）", async () => {
    const { executor, sessionId } = await makeEnv({ verified: ["image_understanding"] });
    await call(executor, "vision.observe", OBSERVE_ARGS(sessionId));
    const res = await call(executor, "vision.session.audit", {
      vision_session_id: sessionId,
      include_observations: true,
    });
    const s = res.result.structured as { operations: any[] };
    const obs = s.operations[0]!.observations as Array<{
      observation_id: string;
      label: string;
      location: { type: string };
      source: { provider: string };
    }>;
    expect(obs).toHaveLength(1);
    expect(obs[0]!.label).toBe("visual_evidence");
    expect(obs[0]!.location.type).toBe("full_image");
    expect(obs[0]!.source.provider).toBe("mock");
  });

  it("失败操作：error 如实呈现；不可执行操作：executability 呈现", async () => {
    const { executor, sessionId } = await makeEnv({
      verified: ["image_understanding"],
      failWith: new VisionError(ApplicationErrorCode.PROVIDER_UNAVAILABLE, "provider down"),
    });
    await call(executor, "vision.observe", OBSERVE_ARGS(sessionId));
    const res = await call(executor, "vision.session.audit", { vision_session_id: sessionId });
    const s = res.result.structured as { operations: any[] };
    expect(s.operations[0]!.status).toBe("failed");
    expect(s.operations[0]!.error.application_error_code).toBe(ApplicationErrorCode.PROVIDER_UNAVAILABLE);
  });

  it("其他 Principal → 拒绝（沙箱隔离）", async () => {
    const { executor, sessionId } = await makeEnv();
    const res = await call(executor, "vision.session.audit", { vision_session_id: sessionId }, OTHER_IDENTITY);
    expect(res.result.isError).toBe(true);
  });
});
