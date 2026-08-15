import { describe, expect, it } from "vitest";
import { ImageInput } from "../src/image-input.js";

describe("ImageInput 互斥联合（规格四.1：非活动模式字段必须被拒绝）", () => {
  it("接受 uri 模式", () => {
    const r = ImageInput.safeParse({ type: "uri", uri: "https://example.com/a.png" });
    expect(r.success).toBe(true);
  });

  it("接受 resource_ref 模式", () => {
    const r = ImageInput.safeParse({ type: "resource_ref", resource_ref: "vision://vs_1/art_2" });
    expect(r.success).toBe(true);
  });

  it("接受 inline 模式", () => {
    const r = ImageInput.safeParse({
      type: "inline",
      inline: { mime_type: "image/png", blob: "aGVsbG8=" },
    });
    expect(r.success).toBe(true);
  });

  it("拒绝 uri 模式携带 inline（非活动字段）", () => {
    const r = ImageInput.safeParse({
      type: "uri",
      uri: "https://example.com/a.png",
      inline: { mime_type: "image/png", blob: "aGVsbG8=" },
    });
    expect(r.success).toBe(false);
  });

  it("拒绝 inline 模式携带 uri（非活动字段）", () => {
    const r = ImageInput.safeParse({
      type: "inline",
      inline: { mime_type: "image/png", blob: "aGVsbG8=" },
      uri: "https://example.com/a.png",
    });
    expect(r.success).toBe(false);
  });

  it("拒绝未知 type", () => {
    const r = ImageInput.safeParse({ type: "file", path: "/tmp/a.png" });
    expect(r.success).toBe(false);
  });

  it("拒绝缺失字段", () => {
    expect(ImageInput.safeParse({ type: "uri" }).success).toBe(false);
    expect(
      ImageInput.safeParse({ type: "inline", inline: { mime_type: "image/png" } }).success,
    ).toBe(false);
  });
});
