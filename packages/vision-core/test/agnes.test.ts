import { describe, expect, it, vi } from "vitest";
import { ApplicationErrorCode, VisionError } from "@mcp-vision/contracts";
import { AgnesAdapter, AGNES_DEFAULT_MODEL } from "../src/providers/agnes.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function okResponse(text: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonProbeResponse(): Response {
  return okResponse(
    JSON.stringify({ objects: [{ label: "red_square", bbox: [1, 2, 3, 4] }] }),
  );
}

function makeAdapter(fetchImpl: typeof fetch, apiKey = "test-key") {
  return new AgnesAdapter({ apiKey, fetchImpl, timeoutMs: 5000 });
}

describe("AgnesAdapter 执行", () => {
  it("成功路径：文本证据 + providerMeta（provenance 素材）", async () => {
    const fetchMock = vi.fn(async () => okResponse("图片中有一个褐色斑点"));
    const adapter = makeAdapter(fetchMock as unknown as typeof fetch);
    const r = await adapter.execute(
      {
        images: [{ bytes: Buffer.from(PNG_1PX, "base64"), mimeType: "image/png" }],
        instruction: "描述",
        jsonMode: false,
      },
      new AbortController().signal,
    );
    expect(r.text).toBe("图片中有一个褐色斑点");
    expect(r.providerMeta).toMatchObject({
      provider: "agnes",
      model: AGNES_DEFAULT_MODEL,
      model_version: AGNES_DEFAULT_MODEL,
    });
    // 图片必须内联 data URI 传给 Provider（统一 Fetch Boundary）
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it("401 → PROVIDER_AUTH_FAILED（不重试）", async () => {
    const fetchMock = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const adapter = makeAdapter(fetchMock as unknown as typeof fetch);
    await expect(
      adapter.execute(
        { images: [], instruction: "x", jsonMode: false },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.PROVIDER_AUTH_FAILED,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("5xx 有界重试一次后成功（免费层瞬时故障）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(okResponse("重试成功"));
    const adapter = makeAdapter(fetchMock as unknown as typeof fetch);
    const r = await adapter.execute(
      { images: [], instruction: "x", jsonMode: false },
      new AbortController().signal,
    );
    expect(r.text).toBe("重试成功");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("返回结构异常 → PROVIDER_INVALID_RESPONSE", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ foo: 1 }), { status: 200 }));
    const adapter = makeAdapter(fetchMock as unknown as typeof fetch);
    await expect(
      adapter.execute(
        { images: [], instruction: "x", jsonMode: false },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.PROVIDER_INVALID_RESPONSE,
    });
  });

  it("取消信号中止请求（取消契约：内部 AbortSignal）", async () => {
    const ac = new AbortController();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<never>((_resolve, reject) => {
        // 先挂监听再 abort，避免错过事件
        init.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
        );
        ac.abort();
      });
    });
    const adapter = makeAdapter(fetchMock as unknown as typeof fetch);
    await expect(
      adapter.execute({ images: [], instruction: "x", jsonMode: false }, ac.signal),
    ).rejects.toThrow();
    expect(ac.signal.aborted).toBe(true);
  });
});

describe("AgnesAdapter 探针（规格三.2 副作用边界）", () => {
  it("基础理解 + OCR + JSON bbox 均通过 → verified 含三项；不产生 Observation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse("一张测试图片"))
      .mockResolvedValueOnce(okResponse("图片中没有文字"))
      .mockResolvedValueOnce(jsonProbeResponse());
    const adapter = makeAdapter(fetchMock as unknown as typeof fetch);
    const verified = await adapter.probe(new AbortController().signal);
    expect(verified.capabilities).toEqual(
      expect.arrayContaining(["image_understanding", "ocr", "structured_detection"]),
    );
  });

  it("JSON 解析失败 → structured_detection 不进入 verified（不抛错）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse("图片"))
      .mockResolvedValueOnce(okResponse("无文字"))
      .mockResolvedValueOnce(okResponse("这不是 JSON"));
    const adapter = makeAdapter(fetchMock as unknown as typeof fetch);
    const verified = await adapter.probe(new AbortController().signal);
    expect(verified.capabilities).toContain("image_understanding");
    expect(verified.capabilities).toContain("ocr");
    expect(verified.capabilities).not.toContain("structured_detection");
  });
});

describe("AgnesAdapter 声明", () => {
  it("declare 返回约束（Scope and Constraints 保留原则）", () => {
    const adapter = makeAdapter(async () => okResponse(""));
    expect(adapter.declare().constraints).toMatchObject({
      max_image_size: 10485760,
      confidence_supported: false,
      supported_output_formats: ["text"],
    });
  });

  it("缺少 apiKey：构造允许，执行时如实报 PROVIDER_AUTH_FAILED（优雅降级）", async () => {
    const adapter = makeAdapter(async () => okResponse(""), "");
    await expect(
      adapter.execute(
        { images: [], instruction: "x", jsonMode: false },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.PROVIDER_AUTH_FAILED,
    });
  });
});
