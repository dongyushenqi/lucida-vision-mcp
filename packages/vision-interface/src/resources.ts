/**
 * Resource URI 解析与受控引用（规格四.2 / 五.1）。
 *
 * - Tier 1：vision://{vision_session_id}/{artifact_id} → resources/read 返回 Base64 blob。
 * - Tool 返回的 Resource Link 不保证出现在 resources/list（解耦关系）。
 */
import { ApplicationErrorCode, VisionError } from "@mcp-vision/contracts";

export const VISION_RESOURCE_SCHEME = "vision";

export function isVisionResourceUri(uri: string): boolean {
  return uri.startsWith("vision://");
}

/** 解析 vision://{session}/{artifact}；非本 Server 资源返回 undefined。 */
export function parseVisionResourceUri(uri: string): { sessionId: string; artifactId: string } | undefined {
  if (!isVisionResourceUri(uri)) return undefined;
  const rest = uri.slice("vision://".length);
  const parts = rest.split("/");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") return undefined;
  return { sessionId: parts[0]!, artifactId: parts[1]! };
}

export interface ResourceReadResult {
  sessionId: string;
  artifactId: string;
  mimeType: string;
  bytes: Uint8Array;
  contentLength: number;
}

/**
 * Tier 1 读取：必须先经 Session 授权沙箱（由调用方传入已授权的 sessionId）。
 * 仅返回归属该 Session 的 Artifact；digest 不承担授权功能（Integrity/Authorization 分离）。
 */
export function readTier1Resource(
  core: { artifacts: { get(sessionId: string, artifactId: string): { metadata: { mime_type: string; content_length: number }; bytes: Uint8Array } | undefined } },
  sessionId: string,
  artifactId: string,
): ResourceReadResult {
  const artifact = core.artifacts.get(sessionId, artifactId);
  if (!artifact) {
    throw new VisionError(ApplicationErrorCode.RESOURCE_NOT_FOUND, "Artifact 不存在或不属于该 Session", {
      vision_session_id: sessionId,
      artifact_id: artifactId,
    });
  }
  return {
    sessionId,
    artifactId,
    mimeType: artifact.metadata.mime_type,
    bytes: artifact.bytes,
    contentLength: artifact.metadata.content_length,
  };
}
