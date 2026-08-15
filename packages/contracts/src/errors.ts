/**
 * 错误处理模型与命名空间隔离（规格五.3）。
 *
 * - 协议级错误（JSON-RPC error.code）归 Compatibility Layer 管，遵守 MCP/JSON-RPC 规范。
 * - 应用级错误身份标识（Application Error Identity）使用 Vision 定义的命名空间，
 *   承载于协议允许的 `error.data.application_error_code`，绝不覆盖协议层 code 语义。
 * - 错误响应只陈述事实与恢复属性，严禁任何 `suggested_action` 类字段。
 *
 * 本模块是纯领域层：不 import 任何 MCP 协议包（协议家族独立）。
 */

export const APPLICATION_ERROR_NAMESPACES = [
  "SESSION",
  "OPERATION",
  "RESOURCE",
  "SECURITY",
  "PROVIDER",
  "VISION",
] as const;

export const ApplicationErrorCode = {
  // SESSION_*
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_AUTHORIZATION_DENIED: "SESSION_AUTHORIZATION_DENIED",
  SESSION_CLOSED: "SESSION_CLOSED",
  // OPERATION_*
  OPERATION_ID_CONFLICT: "OPERATION_ID_CONFLICT",
  OPERATION_NOT_FOUND: "OPERATION_NOT_FOUND",
  OPERATION_IN_FLIGHT: "OPERATION_IN_FLIGHT",
  // RESOURCE_*
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  RESOURCE_AUTHORIZATION_DENIED: "RESOURCE_AUTHORIZATION_DENIED",
  // SECURITY_*
  SECURITY_SSRF_BLOCKED: "SECURITY_SSRF_BLOCKED",
  SECURITY_URI_DENIED: "SECURITY_URI_DENIED",
  SECURITY_MIME_MISMATCH: "SECURITY_MIME_MISMATCH",
  SECURITY_PAYLOAD_TOO_LARGE: "SECURITY_PAYLOAD_TOO_LARGE",
  SECURITY_UNSUPPORTED_SCHEME: "SECURITY_UNSUPPORTED_SCHEME",
  // PROVIDER_*
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  PROVIDER_INVALID_RESPONSE: "PROVIDER_INVALID_RESPONSE",
  PROVIDER_AUTH_FAILED: "PROVIDER_AUTH_FAILED",
  // VISION_*
  VISION_INVALID_IMAGE_INPUT: "VISION_INVALID_IMAGE_INPUT",
  VISION_INVALID_ARGS: "VISION_INVALID_ARGS",
  VISION_TOOL_NOT_FOUND: "VISION_TOOL_NOT_FOUND",
  VISION_INTERNAL: "VISION_INTERNAL",
} as const;

export type ApplicationErrorCode =
  (typeof ApplicationErrorCode)[keyof typeof ApplicationErrorCode];

/** 承载于协议 error.data 的应用级错误结构（规格五.3）。 */
export interface ApplicationErrorData {
  application_error_code: ApplicationErrorCode;
  message: string;
  details?: unknown;
}

/** 领域层错误：只陈述事实与恢复属性。 */
export class VisionError extends Error {
  readonly applicationErrorCode: ApplicationErrorCode;
  readonly details?: unknown;

  constructor(code: ApplicationErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "VisionError";
    this.applicationErrorCode = code;
    this.details = details;
  }

  toApplicationErrorData(): ApplicationErrorData {
    const data: ApplicationErrorData = {
      application_error_code: this.applicationErrorCode,
      message: this.message,
    };
    if (this.details !== undefined) {
      data.details = this.details;
    }
    return data;
  }
}

export function isVisionError(err: unknown): err is VisionError {
  return err instanceof VisionError;
}
