import { describe, expect, it } from "vitest";
import { ApplicationErrorCode } from "@mcp-vision/contracts";
import {
  DEFAULT_FETCH_BOUNDARY_CONFIG as DEFAULT,
  FetchBoundary,
  isOriginAllowed,
} from "../src/fetch-boundary.js";
import { isBlockedAddress } from "../src/net-address.js";
import { normalizeMimeType, sniffMimeType } from "../src/mime.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("net-address：SSRF 私有地址阻断矩阵（规格四.1）", () => {
  it("阻断私有/保留/回环/链路本地/多播", () => {
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
      "169.254.1.1", "0.0.0.0", "100.64.0.1", "224.0.0.1", "240.0.0.1",
      "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
      "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("放行公网地址", () => {
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("1.1.1.1")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("mime sniff（规格四.1 payload 校验）", () => {
  it("识别 PNG / JPEG / GIF / WebP / BMP / TIFF", () => {
    const png = Buffer.from(PNG_1PX, "base64");
    expect(sniffMimeType(new Uint8Array(png))).toBe("image/png");
    expect(sniffMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMimeType(new Uint8Array(Buffer.from("GIF89a....")))).toBe("image/gif");
    expect(sniffMimeType(new Uint8Array(Buffer.from("RIFFxxxxWEBP")))).toBe("image/webp");
    expect(sniffMimeType(new Uint8Array(Buffer.from("BM....")))).toBe("image/bmp");
    expect(sniffMimeType(new Uint8Array(Buffer.from("II*\u0000....")))).toBe("image/tiff");
  });

  it("非图像 payload → undefined", () => {
    expect(sniffMimeType(new Uint8Array(Buffer.from("hello world")))).toBeUndefined();
  });

  it("normalizeMimeType 归一别名与参数", () => {
    expect(normalizeMimeType("image/jpg")).toBe("image/jpeg");
    expect(normalizeMimeType("image/PNG; charset=utf-8")).toBe("image/png");
  });
});

describe("FetchBoundary inline 校验（规格四.1）", () => {
  const boundary = new FetchBoundary();

  it("合法 inline 通过（解码前大小限制、sniff 一致）", async () => {
    const img = await boundary.validateInline("image/png", PNG_1PX);
    expect(img.mimeType).toBe("image/png");
    expect(img.contentLength).toBeGreaterThan(0);
  });

  it("声明 MIME 与 payload 不符 → SECURITY_MIME_MISMATCH", async () => {
    await expect(boundary.validateInline("image/jpeg", PNG_1PX)).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.SECURITY_MIME_MISMATCH,
    });
  });

  it("非图像 payload → VISION_INVALID_IMAGE_INPUT", async () => {
    const b64 = Buffer.from("not an image at all").toString("base64");
    await expect(boundary.validateInline("image/png", b64)).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.VISION_INVALID_IMAGE_INPUT,
    });
  });

  it("非法 Base64 → VISION_INVALID_IMAGE_INPUT", async () => {
    await expect(boundary.validateInline("image/png", "!!!not-base64!!!")).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.VISION_INVALID_IMAGE_INPUT,
    });
  });

  it("超大 payload 在解码前拒绝 → SECURITY_PAYLOAD_TOO_LARGE", async () => {
    const small = new FetchBoundary({ ...DEFAULT, maxInlineBytes: 1024 });
    const bigB64 = Buffer.alloc(4096, 1).toString("base64");
    await expect(small.validateInline("image/png", bigB64)).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.SECURITY_PAYLOAD_TOO_LARGE,
    });
  });

  it("uri 模式：私有地址经连接门禁阻断 → SECURITY_URI_DENIED", async () => {
    await expect(boundary.resolve({ type: "uri", uri: "http://127.0.0.1/x.png" })).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.SECURITY_URI_DENIED,
    });
  });

  it("uri 模式：不支持的 scheme → SECURITY_UNSUPPORTED_SCHEME", async () => {
    await expect(boundary.resolve({ type: "uri", uri: "file:///etc/passwd" })).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.SECURITY_UNSUPPORTED_SCHEME,
    });
  });

  it("resource_ref 不属本边界 → RESOURCE_NOT_FOUND（由接口层授权后 dereference）", async () => {
    await expect(
      boundary.resolve({ type: "resource_ref", resource_ref: "vision://vs_1/art_1" }),
    ).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.RESOURCE_NOT_FOUND,
    });
  });
});

describe("URI 授权边界（规格四.1：SSRF ≠ 资源授权）", () => {
  it("isOriginAllowed：精确 host 与子域匹配", () => {
    expect(isOriginAllowed("example.com", ["example.com"])).toBe(true);
    expect(isOriginAllowed("a.example.com", ["example.com"])).toBe(true);
    expect(isOriginAllowed("notexample.com", ["example.com"])).toBe(false);
    expect(isOriginAllowed("example.com.evil.net", ["example.com"])).toBe(false);
    expect(isOriginAllowed("example.com", [])).toBe(false);
  });

  it("来源不在白名单 → SECURITY_URI_DENIED（策略检查在发请求前，零网络）", async () => {
    const boundary = new FetchBoundary({
      ...DEFAULT,
      uriPolicy: { allowedOrigins: ["allowed.example.com"] },
    });
    await expect(
      boundary.resolve(
        { type: "uri", uri: "https://evil.example.net/x.png" },
        undefined,
        { principalId: "p1", tenantId: "t1" },
      ),
    ).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.SECURITY_URI_DENIED,
    });
  });

  it("自定义授权钩子拒绝 → SECURITY_URI_DENIED", async () => {
    const boundary = new FetchBoundary({
      ...DEFAULT,
      uriPolicy: {
        authorize: (uri, ctx) => uri.hostname === "ok.example.com" && ctx.principalId === "p1",
      },
    });
    await expect(
      boundary.resolve(
        { type: "uri", uri: "https://ok.example.com/x.png" },
        undefined,
        { principalId: "p2", tenantId: "t1" },
      ),
    ).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.SECURITY_URI_DENIED,
    });
  });

  it("无策略 → 不拦截（仅 SSRF 防护生效）", () => {
    const boundary = new FetchBoundary();
    // 策略缺失时私有地址仍被门禁阻断（SSRF 防护独立于授权策略）
    expect(() => boundary["authorizeUri"](new URL("https://example.com/x.png"), undefined)).not.toThrow();
  });
});
