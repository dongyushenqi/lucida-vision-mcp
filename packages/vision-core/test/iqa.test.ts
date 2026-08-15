import { describe, expect, it } from "vitest";
import { assessImage, readImageDimensions } from "../src/iqa.js";

const PNG_1PX_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** 2x2 红色 BMP（14 字节文件头 + 40 字节 DIB + 像素） */
function makeBmp(width: number, height: number): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const buf = Buffer.alloc(14 + 40 + pixelBytes);
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(14 + 40 + pixelBytes, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  for (let i = 0; i < pixelBytes; i++) buf[54 + i] = 0x00; // 黑
  return new Uint8Array(buf);
}

describe("readImageDimensions", () => {
  it("PNG：从 IHDR 解析宽高", () => {
    const png = new Uint8Array(Buffer.from(PNG_1PX_B64, "base64"));
    expect(readImageDimensions(png, "image/png")).toEqual({ width: 1, height: 1 });
  });

  it("BMP：从 DIB 头解析宽高", () => {
    const bmp = makeBmp(4, 3);
    expect(readImageDimensions(bmp, "image/bmp")).toEqual({ width: 4, height: 3 });
  });

  it("未知格式返回 0x0", () => {
    expect(readImageDimensions(new Uint8Array([1, 2, 3]), "image/png")).toEqual({ width: 0, height: 0 });
  });
});

describe("assessImage（IQA：Final Executable = Effective ∩ IQA）", () => {
  it("合法图像 + 无约束 → 可执行，metrics 含技术属性", () => {
    const png = new Uint8Array(Buffer.from(PNG_1PX_B64, "base64"));
    const r = assessImage(png, "image/png", undefined);
    expect(r.executable).toBe(true);
    expect(r.decodable).toBe(true);
    expect(r.metrics).toMatchObject({ format: "image/png", width: 1, height: 1 });
  });

  it("不可解码 payload → 不可执行（事实原因）", () => {
    const r = assessImage(new Uint8Array(Buffer.from("not an image")), "image/png", undefined);
    expect(r.executable).toBe(false);
    expect(r.reasons).toContain("undecodable_image_format");
  });

  it("字节数超过 max_image_size 约束 → 不可执行", () => {
    const bmp = makeBmp(8, 8);
    const r = assessImage(bmp, "image/bmp", { max_image_size: 100 });
    expect(r.executable).toBe(false);
    expect(r.reasons[0]).toMatch(/payload_exceeds_max_image_size/);
  });

  it("长边超过 max_dimension 约束 → 不可执行（Fetch Boundary 不检查尺寸，IQA 增量价值）", () => {
    const bmp = makeBmp(16, 16);
    const r = assessImage(bmp, "image/bmp", { max_dimension: 8 });
    expect(r.executable).toBe(false);
    expect(r.reasons[0]).toMatch(/dimension_exceeds_max_dimension/);
  });

  it("IQA 结果只含技术事实，无任何建议字段", () => {
    const r = assessImage(new Uint8Array([1]), "image/png", undefined);
    expect(JSON.stringify(r)).not.toContain("suggested_action");
    expect(JSON.stringify(r)).not.toContain("recommend");
  });
});
