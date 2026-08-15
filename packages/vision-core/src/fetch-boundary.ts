/**
 * 统一 Server-side Fetch Boundary（规格四.1）。
 *
 * - 当 type=uri 时，图像**必须**由本边界获取；Provider Adapter 严禁绕过（接口层保证
 *   Adapter 只收到已获取的本地字节）。
 * - SSRF 防护矩阵：DNS 解析策略（每次连接经 blockingLookup 门禁）、私有地址阻断、
 *   重定向校验（仅 http/https、≤5 跳）、大小限制、MIME 校验与 payload sniffing。
 * - URI 授权边界：本边界只解决"网络访问安全"，不构成资源授权；
 *   401/403 与授权策略判断由上层 Identity/Authorization Context 处理。
 * - inline：大小限制必须在 Base64 解码**前**校验（规格 MUST）；解码后 sniff 校验声明 MIME。
 */
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { ApplicationErrorCode, VisionError, type ImageInput } from "@mcp-vision/contracts";
import { isTimeoutAbort, OperationCancelledError } from "./cancellation.js";
import { normalizeMimeType, sniffMimeType, SUPPORTED_IMAGE_MIME_TYPES } from "./mime.js";
import { blockingLookup } from "./net-address.js";

export interface FetchBoundaryConfig {
  /** 可注入 fetch（单测用）；缺省为全局 fetch */
  fetchImpl?: typeof fetch;
  /** inline 最大字节数（解码前按 Base64 长度校验） */
  maxInlineBytes: number;
  /** uri 拉取最大字节数 */
  maxUriBytes: number;
  /** 单次拉取总超时（ms） */
  timeoutMs: number;
  /** 最大重定向跳数 */
  maxRedirects: number;
  /** 允许的 URI scheme */
  allowedSchemes: string[];
  /**
   * URI 授权边界策略（规格四.1）：
   * SSRF 防护仅解决网络访问安全，不得被视为资源授权机制——
   * 资源可否获取须依 Principal/Tenant 与允许的资源来源策略判定。
   */
  uriPolicy?: UriAuthorizationPolicy;
}

/**
 * 资源来源策略：域名白名单 + 可选授权钩子。
 * - allowedOrigins 空数组 = 无来源限制（仅 SSRF 防护）；
 * - 匹配规则：精确 host 或子域（"example.com" 匹配 example.com / a.example.com）。
 */
export interface UriAuthorizationPolicy {
  allowedOrigins?: string[];
  /** 自定义授权钩子：返回 false → SECURITY_URI_DENIED（只陈述事实） */
  authorize?: (uri: URL, ctx: { principalId: string; tenantId: string }) => boolean;
}

export interface UriAuthContext {
  principalId: string;
  tenantId: string;
}

/** host 是否命中允许来源（精确或子域后缀）。 */
export function isOriginAllowed(hostname: string, allowedOrigins: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowedOrigins.some((origin) => {
    const o = origin.toLowerCase().replace(/\.$/, "");
    if (o === "") return false;
    return host === o || host.endsWith(`.${o}`);
  });
}

export const DEFAULT_FETCH_BOUNDARY_CONFIG: FetchBoundaryConfig = {
  maxInlineBytes: 10 * 1024 * 1024,
  maxUriBytes: 10 * 1024 * 1024,
  timeoutMs: 30_000,
  maxRedirects: 5,
  allowedSchemes: ["http", "https"],
};

export interface FetchedImage {
  bytes: Uint8Array;
  /** sniff 出的真实 MIME（已通过声明校验） */
  mimeType: string;
  /** 声明 MIME（inline 为 Agent 声明；uri 为 Content-Type，缺失时为 sniff 结果） */
  declaredMimeType: string;
  contentLength: number;
  /** uri 模式为最终 URL；inline 为 "inline" */
  source: string;
}

export class FetchBoundary {
  private readonly httpAgent: HttpAgent;
  private readonly httpsAgent: HttpsAgent;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: FetchBoundaryConfig = DEFAULT_FETCH_BOUNDARY_CONFIG) {
    // 每一次连接都经私有地址门禁（DNS 重绑定防护）
    this.httpAgent = new HttpAgent({ lookup: blockingLookup });
    this.httpsAgent = new HttpsAgent({ lookup: blockingLookup });
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** 按输入模式解析为本地字节；resource_ref 不属于本边界（由接口层授权后从存储 dereference）。 */
  async resolve(
    input: ImageInput,
    signal?: AbortSignal,
    authCtx?: UriAuthContext,
  ): Promise<FetchedImage> {
    switch (input.type) {
      case "uri":
        return this.resolveUri(input.uri, signal, authCtx);
      case "inline":
        return this.validateInline(input.inline.mime_type, input.inline.blob);
      case "resource_ref":
        throw new VisionError(
          ApplicationErrorCode.RESOURCE_NOT_FOUND,
          "resource_ref 须经 Session 授权后由接口层 dereference",
          { resource_ref: input.resource_ref },
        );
    }
  }

  /** URI 模式：scheme 白名单 → 授权策略 → 门禁连接 → 重定向校验 → 大小限制 → MIME sniff。 */
  async resolveUri(uri: string, signal?: AbortSignal, authCtx?: UriAuthContext): Promise<FetchedImage> {
    let u: URL;
    try {
      u = new URL(uri);
    } catch {
      // 非法 URI 字符串：事实化错误，绝不泄漏内部异常（审查 #9）
      throw new VisionError(ApplicationErrorCode.VISION_INVALID_IMAGE_INPUT, "uri 不是合法 URL", {
        uri,
      });
    }
    const scheme = u.protocol.replace(":", "");
    if (!this.config.allowedSchemes.includes(scheme)) {
      throw new VisionError(ApplicationErrorCode.SECURITY_UNSUPPORTED_SCHEME, `不支持的 URI scheme`, {
        scheme,
        uri,
      });
    }
    // URI 授权边界：依 Principal/Tenant + 资源来源策略判定（SSRF ≠ 授权）
    this.authorizeUri(u, authCtx);

    let current = u;
    let redirects = 0;
    for (;;) {
      const combined = AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(this.config.timeoutMs),
      ]);
      let res: Response;
      try {
        // Node fetch 的 agent 扩展（undici）：类型未收录于 lib.dom，此处显式声明（Implementation Decision）
        const init = {
          agent: (parsed: URL) =>
            parsed.protocol === "https:" ? this.httpsAgent : this.httpAgent,
          redirect: "manual" as const,
          signal: combined,
          headers: { accept: "image/*" },
        } as RequestInit & { agent: (parsed: URL) => unknown };
        res = await this.fetchImpl(current, init);
      } catch (err) {
        // 取消/超时区分（审查 #2）：用户取消 → OperationCancelledError；超时 → 事实化错误
        if (signal?.aborted) {
          throw new OperationCancelledError("fetch cancelled");
        }
        if (isTimeoutAbort(err) || (err instanceof Error && err.name === "AbortError" && isTimeoutAbort(combined.reason))) {
          throw new VisionError(ApplicationErrorCode.SECURITY_URI_DENIED, "URI 获取超时", {
            uri: current.href,
            reason: "timeout",
          });
        }
        if (err instanceof Error && err.name === "AbortError") {
          throw new OperationCancelledError("fetch cancelled");
        }
        throw new VisionError(ApplicationErrorCode.SECURITY_URI_DENIED, `URI 获取失败`, {
          uri: current.href,
          cause: err instanceof Error ? err.message : String(err),
        });
      }

      // 重定向校验：仅 http/https，受限跳数
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          throw new VisionError(ApplicationErrorCode.SECURITY_URI_DENIED, "重定向缺少 Location", {
            uri: current.href,
          });
        }
        await discardResponseBody(res);
        redirects += 1;
        if (redirects > this.config.maxRedirects) {
          throw new VisionError(ApplicationErrorCode.SECURITY_URI_DENIED, "重定向次数超限", {
            uri,
            redirects,
          });
        }
        current = new URL(location, current);
        if (!this.config.allowedSchemes.includes(current.protocol.replace(":", ""))) {
          throw new VisionError(
            ApplicationErrorCode.SECURITY_UNSUPPORTED_SCHEME,
            `重定向目标 scheme 不允许`,
            { scheme: current.protocol, uri: current.href },
          );
        }
        // 重定向目标同样过授权策略（防白名单绕过）
        this.authorizeUri(current, authCtx);
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        // URI 授权边界：能够访问 ≠ 获得授权；事实陈述，无建议
        await discardResponseBody(res);
        throw new VisionError(ApplicationErrorCode.SECURITY_URI_DENIED, "URI 访问被拒绝", {
          uri: current.href,
          http_status: res.status,
        });
      }
      if (!res.ok) {
        await discardResponseBody(res);
        throw new VisionError(ApplicationErrorCode.RESOURCE_NOT_FOUND, "URI 资源不可获取", {
          uri: current.href,
          http_status: res.status,
        });
      }

      let bytes: Uint8Array;
      try {
        bytes = await readBodyCapped(res.body, this.config.maxUriBytes, combined);
      } catch (err) {
        if (signal?.aborted) {
          throw new OperationCancelledError("fetch cancelled");
        }
        if (isTimeoutAbort(err) || (err instanceof Error && err.name === "AbortError" && isTimeoutAbort(combined.reason))) {
          throw new VisionError(ApplicationErrorCode.SECURITY_URI_DENIED, "URI 读取超时", {
            uri: current.href,
            reason: "timeout",
          });
        }
        if (err instanceof Error && err.name === "AbortError") {
          throw new OperationCancelledError("fetch cancelled");
        }
        throw new VisionError(ApplicationErrorCode.SECURITY_URI_DENIED, `URI 读取失败`, {
          uri: current.href,
          cause: err instanceof Error ? err.message : String(err),
        });
      }
      const declared = normalizeMimeType(res.headers.get("content-type") ?? "");
      return validatePayload(bytes, declared, current.href);
    }
  }

  /** URI 授权边界：来源策略 + 授权钩子；SSRF 防护 ≠ 资源授权（规格四.1）。 */
  private authorizeUri(u: URL, authCtx?: UriAuthContext): void {
    const policy = this.config.uriPolicy;
    if (!policy) return;
    const denied = (reason: string) => {
      throw new VisionError(ApplicationErrorCode.SECURITY_URI_DENIED, "URI 不在允许的资源来源范围内", {
        uri: u.href,
        reason,
      });
    };
    if (policy.allowedOrigins && policy.allowedOrigins.length > 0) {
      if (!isOriginAllowed(u.hostname, policy.allowedOrigins)) {
        denied(`origin_not_allowed`);
      }
    }
    if (policy.authorize) {
      const ok = policy.authorize(u, authCtx ?? { principalId: "", tenantId: "" });
      if (!ok) denied(`authorization_denied`);
    }
  }

  /** inline 模式：解码前大小限制 → 解码 → sniff 校验声明 MIME。 */
  async validateInline(declaredMime: string, blobB64: string, source = "inline"): Promise<FetchedImage> {
    // 规格 MUST：解码前按 Base64 长度估算校验（4/3 膨胀 + 少量 padding 余量）
    const maxB64Length = Math.ceil((this.config.maxInlineBytes * 4) / 3) + 4;
    if (blobB64.length > maxB64Length) {
      throw new VisionError(ApplicationErrorCode.SECURITY_PAYLOAD_TOO_LARGE, "inline payload 超限", {
        max_bytes: this.config.maxInlineBytes,
      });
    }
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(blobB64);
    } catch {
      throw new VisionError(ApplicationErrorCode.VISION_INVALID_IMAGE_INPUT, "inline payload 非合法 Base64");
    }
    // 解码后字节数复查（审查 #9：Base64 长度估算允许约 3 字节余量，双重校验封死）
    if (bytes.byteLength > this.config.maxInlineBytes) {
      throw new VisionError(ApplicationErrorCode.SECURITY_PAYLOAD_TOO_LARGE, "inline payload 解码后超限", {
        max_bytes: this.config.maxInlineBytes,
        actual_bytes: bytes.byteLength,
      });
    }
    return validatePayload(bytes, normalizeMimeType(declaredMime), source);
  }
}

function validatePayload(
  bytes: Uint8Array,
  declaredMime: string,
  source: string,
): FetchedImage {
  const sniffed = sniffMimeType(bytes);
  if (!sniffed) {
    throw new VisionError(ApplicationErrorCode.VISION_INVALID_IMAGE_INPUT, "payload 不是受支持的图像格式", {
      source,
    });
  }
  const mimeType = declaredMime || sniffed;
  if (!SUPPORTED_IMAGE_MIME_TYPES.includes(mimeType as (typeof SUPPORTED_IMAGE_MIME_TYPES)[number]) ||
      mimeType !== sniffed) {
    // 规格 MUST：声明 MIME 必须与实际 payload 格式一致
    throw new VisionError(ApplicationErrorCode.SECURITY_MIME_MISMATCH, "声明 MIME 与 payload 实际格式不一致", {
      declared: declaredMime,
      sniffed,
      source,
    });
  }
  return {
    bytes,
    mimeType: sniffed,
    declaredMimeType: declaredMime,
    contentLength: bytes.byteLength,
    source,
  };
}

/** 丢弃未消费的响应体，释放连接；错误路径不得留下未关闭 body。 */
async function discardResponseBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // 释放失败不影响业务错误分类
  }
}

async function readBodyCapped(
  body: ReadableStream<Uint8Array> | null,
  cap: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!body) {
    throw new VisionError(ApplicationErrorCode.RESOURCE_NOT_FOUND, "响应无 body");
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    if (signal?.aborted) {
      if (isTimeoutAbort(signal.reason)) {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }
      throw new OperationCancelledError("fetch cancelled");
    }
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new VisionError(ApplicationErrorCode.SECURITY_PAYLOAD_TOO_LARGE, "URI 响应超限", {
        max_bytes: cap,
      });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = Buffer.from(b64, "base64");
  if (bin.toString("base64").replace(/=+$/, "") !== b64.replace(/=+$/, "")) {
    throw new Error("invalid base64");
  }
  return new Uint8Array(bin);
}
