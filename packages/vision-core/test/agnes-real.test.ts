/**
 * Agnes 真实 API 测试（可选）：仅在 AGNES_API_KEY 环境变量存在时运行。
 *
 * 安全约定：Key 只从环境变量读取，绝不落盘/入库；
 * CI（无 secret）自动跳过，本地/手动 workflow（有 secret）自动执行。
 * 免费层注意：probe 消耗 3 次调用，请控制运行频率。
 */
import { describe, expect, it } from "vitest";
import { AgnesAdapter } from "../src/providers/agnes.js";

const hasKey = Boolean(process.env.AGNES_API_KEY);

describe.runIf(hasKey)("Agnes 真实 API（需 AGNES_API_KEY）", () => {
  const adapter = new AgnesAdapter({
    apiKey: process.env.AGNES_API_KEY ?? "",
    timeoutMs: 60_000,
  });

  it("真实探针：基础理解 + OCR 验证（结果只进 Registry 语义）", async () => {
    const verified = await adapter.probe(new AbortController().signal);
    expect(verified.capabilities).toContain("image_understanding");
    expect(verified.capabilities).toContain("ocr");
  }, 120_000);

  it("真实执行：返回证据文本 + 完整 provenance 素材", async () => {
    // 1x1 PNG（真实字节，走 OpenAI 兼容内联 data URI）
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );
    const r = await adapter.execute(
      { images: [{ bytes, mimeType: "image/png" }], instruction: "描述这张图片", jsonMode: false },
      new AbortController().signal,
    );
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.providerMeta).toMatchObject({
      provider: "agnes",
      model: "agnes-2.5-flash",
      model_version: "agnes-2.5-flash",
    });
    expect(r.providerMeta.execution_timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  }, 120_000);
});
