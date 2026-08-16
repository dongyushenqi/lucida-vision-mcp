/**
 * E2E 冒烟：SDK Client ↔ LegacyFamilyServer（InMemoryTransport，真实 MCP 握手）。
 *
 * 覆盖：initialize 握手 / tools/list / callTool（observe、幂等去重、错误映射）/
 * resources/read（Tier 1 blob）/ resources/list（动态 Artifact 非权威清单）。
 */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CapabilityId, DeclaredCapability, VerifiedCapability } from "@mcp-vision/contracts";
import {
  FetchBoundary,
  InMemoryVisionStore,
  VisionCore,
  type ProviderExecuteRequest,
  type ProviderExecuteResult,
  type VLMProvider,
} from "@mcp-vision/vision-core";
import { createVisionTools, VisionExecutor } from "@mcp-vision/vision-interface";
import { LegacyFamilyServer } from "../src/legacy-server.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

class MockProvider implements VLMProvider {
  readonly providerId = "mock";
  readonly protocolFamily = "openai-compatible" as const;
  readonly adapterVersion = "0.1.0";
  readonly capabilityIds: CapabilityId[] = ["image_understanding", "structured_detection"];
  calls = 0;

  declare(): DeclaredCapability {
    return {
      provider: "mock",
      capabilities: [...this.capabilityIds],
      constraints: { confidence_supported: false },
    };
  }

  async probe(): Promise<VerifiedCapability> {
    return {
      provider: "mock",
      capabilities: [...this.capabilityIds],
      probe_id: "probe_1",
      verified_at: "2026-01-15T08:30:00.000Z",
    };
  }

  async execute(_req: ProviderExecuteRequest, _signal: AbortSignal): Promise<ProviderExecuteResult> {
    this.calls += 1;
    return {
      text: "图中有两个褐色斑点，位于左上区域",
      providerMeta: {
        provider: "mock",
        model: "mock-vlm",
        model_version: "1.0.0",
        execution_timestamp: "2026-01-15T08:30:00.000Z",
      },
    };
  }
}

async function makePair() {
  const provider = new MockProvider();
  const core = new VisionCore({
    store: new InMemoryVisionStore(),
    fetchBoundary: new FetchBoundary(),
    providers: [provider],
  });
  core.capabilities.register(provider.declare());
  core.capabilities.verify(await provider.probe());

  const executor = new VisionExecutor(core);
  const server = new LegacyFamilyServer({
    executor,
    core,
    tools: createVisionTools(),
    identity: { principalId: "local", tenantId: "default" },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "e2e-test", version: "0.0.1" });
  await client.connect(clientTransport);
  return { client, server, core, provider };
}

function inlineArgs(sessionId: string, extra: Record<string, unknown> = {}) {
  return {
    vision_session_id: sessionId,
    image_input: { type: "inline", inline: { mime_type: "image/png", blob: PNG_1PX } },
    ...extra,
  };
}

describe("E2E：Legacy Family 协议冒烟", () => {
  it("initialize 握手 + tools/list 注册全部 V1 工具", async () => {
    const { client } = await makePair();
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "vision.detect",
        "vision.observe",
        "vision.ocr",
        "vision.operation.cancel",
        "vision.operation.get",
        "vision.session.create",
        "vision.session.delete",
        "vision.session.get",
        "vision.summarize",
        "vision.session.audit",
      ].sort(),
    );
  });

  it("session.create → observe（inline 图片）→ 证据 Observation；ToolResult 无 isError", async () => {
    const { client } = await makePair();
    const created = await client.callTool({ name: "vision.session.create", arguments: {} });
    const sessionId = (
      created.structuredContent as { vision_session_id: string }
    ).vision_session_id;

    const observed = await client.callTool({
      name: "vision.observe",
      arguments: inlineArgs(sessionId),
    });
    expect(observed.isError).toBeFalsy();
    const sc = observed.structuredContent as {
      observations: Array<{ label: string; text?: string; limitations: string[] }>;
    };
    expect(sc.observations).toHaveLength(1);
    expect(sc.observations[0]!.label).toBe("visual_evidence");
    expect(sc.observations[0]!.text).toContain("褐色斑点");
    expect(sc.observations[0]!.limitations).toContain("confidence_not_provided_by_provider");
  });

  it("幂等去重：同 operation_id 二次调用不重复执行（Provider 只调一次）", async () => {
    const { client, provider } = await makePair();
    const created = await client.callTool({ name: "vision.session.create", arguments: {} });
    const sessionId = (created.structuredContent as { vision_session_id: string }).vision_session_id;
    const args = inlineArgs(sessionId, { operation_id: "op_e2e_dedup" });

    await client.callTool({ name: "vision.observe", arguments: args });
    const second = await client.callTool({ name: "vision.observe", arguments: args });
    const sc = second.structuredContent as { deduplicated: boolean; operation: { status: string } };
    expect(sc.deduplicated).toBe(true);
    expect(sc.operation.status).toBe("completed");
    expect(provider.calls).toBe(1);
  });

  it("工具参数非法 → isError=true（SDK schema 校验，事实陈述无建议）", async () => {
    const { client } = await makePair();
    const r = await client.callTool({
      name: "vision.observe",
      arguments: { image_input: { type: "uri", uri: "https://x/y.png" } },
    });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain("Input validation error");
    // 错误响应无任何建议字段
    expect(JSON.stringify(r)).not.toContain("suggested_action");
  });

  it("应用级错误经 MCP 路径携带 application_error_code（OPERATION_ID_CONFLICT）", async () => {
    const { client } = await makePair();
    const created = await client.callTool({ name: "vision.session.create", arguments: {} });
    const sessionId = (created.structuredContent as { vision_session_id: string }).vision_session_id;
    await client.callTool({
      name: "vision.observe",
      arguments: inlineArgs(sessionId, { operation_id: "op_e2e_conflict" }),
    });
    const conflict = await client.callTool({
      name: "vision.observe",
      arguments: inlineArgs(sessionId, { operation_id: "op_e2e_conflict", instruction: "完全不同的指令" }),
    });
    expect(conflict.isError).toBe(true);
    const sc = conflict.structuredContent as { error: { application_error_code: string } };
    expect(sc.error.application_error_code).toBe("OPERATION_ID_CONFLICT");
  });

  it("Tier 1：resources/read 返回 Artifact blob；resources/list 为空（非权威清单）", async () => {
    const { client, core } = await makePair();
    const created = await client.callTool({ name: "vision.session.create", arguments: {} });
    const sessionId = (created.structuredContent as { vision_session_id: string }).vision_session_id;
    const bytes = Buffer.from(PNG_1PX, "base64");
    const meta = core.artifacts.storeArtifact(sessionId, bytes, "image/png");

    const listed = await client.listResources();
    expect(listed.resources).toEqual([]);

    const read = await client.readResource({ uri: meta.storage.ref });
    const content = read.contents[0] as { mimeType?: string; blob?: string };
    expect(content.blob).toBe(PNG_1PX);
    expect(content.mimeType).toBe("image/png");
  });

  it("跨 Principal 的资源不可读（Tier 1 授权边界）", async () => {
    const { client, core } = await makePair();
    const bytes = Buffer.from(PNG_1PX, "base64");
    // 直接写入归属其他 principal 的 session
    const otherSession = core.sessions.create("alice", "default");
    const meta = core.artifacts.storeArtifact(otherSession.vision_session_id, bytes, "image/png");
    await expect(client.readResource({ uri: meta.storage.ref })).rejects.toThrow();
  });
});
