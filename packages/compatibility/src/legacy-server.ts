/**
 * Legacy Protocol Family 适配（规格五.1）。
 *
 * - 使用官方 MCP SDK：initialize/initialized 握手、传统 Session 机制由 SDK 处理；
 * - 协议级取消（RequestHandlerExtra.signal）→ 内部 CancellationTokenSource（取消桥）；
 * - 应用级错误承载于 CallToolResult.structuredContent（含 application_error_code），
 *   协议级 JSON-RPC 错误仍由 SDK 按规范处理（错误码命名空间物理隔离）；
 * - idempotentHint 仅为声明性提示（规格五.2），实现级幂等由 operation_id 机制保证；
 * - Tier 1 Artifact：vision://{session}/{artifact} → resources/read 返回 Base64 blob；
 * - resources/list 返回空（动态 Artifact 不是权威清单，规格四.2）。
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ErrorCode,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { VisionCore } from "@mcp-vision/vision-core";
import type { ToolResult, ToolSpec, VisionExecutor } from "@mcp-vision/vision-interface";
import { parseVisionResourceUri } from "@mcp-vision/vision-interface";
import { bridgeToCancellationToken } from "./cancel-bridge.js";
import { legacyIdentity, type IdentityConfig } from "./identity-injector.js";

export interface LegacyFamilyServerOptions {
  executor: VisionExecutor;
  core: VisionCore;
  tools: ToolSpec[];
  identity: IdentityConfig;
  serverName?: string;
  serverVersion?: string;
}

export class LegacyFamilyServer {
  private readonly server: McpServer;
  private readonly executor: VisionExecutor;
  private readonly identity: IdentityConfig;

  constructor(opts: LegacyFamilyServerOptions) {
    this.executor = opts.executor;
    this.identity = opts.identity;
    this.server = new McpServer(
      { name: opts.serverName ?? "lucida-vision-mcp", version: opts.serverVersion ?? "0.1.0" },
      { capabilities: { tools: {}, resources: {} } },
    );

    for (const tool of opts.tools) {
      this.server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: toolAnnotations(tool.name),
        },
        async (args, extra) => {
          const cts = bridgeToCancellationToken(extra);
          const res = await this.executor.execute({
            toolName: tool.name,
            args: (args ?? {}) as Record<string, unknown>,
            identity: legacyIdentity(this.identity),
            cancel: cts,
          });
          return toCallToolResult(res.result);
        },
      );
    }

    // Tier 1 资源模板：vision://{sessionId}/{artifactId}
    const template = new ResourceTemplate("vision://{sessionId}/{artifactId}", {
      // list 回调缺省 undefined：动态 Artifact 不出现在 resources/list（规格四.2 解耦关系）
      list: undefined,
    });
    this.server.registerResource(
      "vision-artifact",
      template,
      {
        title: "Vision Artifact (Tier 1 blob)",
        description: "视觉产物二进制数据（须归属当前 Principal/Tenant 的 Session）",
        mimeType: "application/octet-stream",
      },
      async (uri: URL, _variables: unknown, extra) => {
        const uriStr = uri.href;
        const parsed = parseVisionResourceUri(uriStr);
        if (!parsed) {
          throw new McpError(ErrorCode.InvalidParams, `无效的 vision resource URI: ${uriStr}`);
        }
        // Tier 1 授权：Session 归属校验（Session ID 不单独作为授权凭证）
        const identity = legacyIdentity(this.identity);
        const session = opts.core.sessions.get(parsed.sessionId);
        if (
          !session ||
          session.principal_id !== identity.principalId ||
          session.tenant_id !== identity.tenantId
        ) {
          throw new McpError(ErrorCode.InvalidParams, "资源不可读（归属校验失败）");
        }
        const artifact = opts.core.artifacts.get(parsed.sessionId, parsed.artifactId);
        if (!artifact) {
          throw new McpError(ErrorCode.InvalidParams, "artifact 不存在");
        }
        return {
          contents: [
            {
              uri: uriStr,
              mimeType: artifact.metadata.mime_type,
              blob: Buffer.from(artifact.bytes).toString("base64"),
            },
          ],
        };
      },
    );
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
  }

  close(): void {
    this.server.close();
  }
}

function toolAnnotations(toolName: string) {
  switch (toolName) {
    case "vision.session.get":
    case "vision.operation.get":
      return { readOnlyHint: true, idempotentHint: true };
    case "vision.observe":
    case "vision.detect":
    case "vision.ocr":
      // 声明性提示：实现级幂等由 operation_id 机制保证（规格五.2）
      return { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
    case "vision.operation.cancel":
      return { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
    default:
      return { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
  }
}

function toCallToolResult(r: ToolResult): CallToolResult {
  const text =
    r.textBlocks.length > 0
      ? r.textBlocks.join("\n")
      : r.structured !== undefined
        ? JSON.stringify(r.structured)
        : "";
  return {
    content: [{ type: "text", text }],
    ...(r.structured !== undefined ? { structuredContent: r.structured } : {}),
    isError: r.isError,
  };
}
