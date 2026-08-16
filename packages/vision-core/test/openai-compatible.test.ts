import { describe, expect, it, vi } from "vitest";
import { ApplicationErrorCode } from "@mcp-vision/contracts";
import { OpenAICompatibleAdapter } from "../src/providers/openai-compatible.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function okResponse(text: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeAdapter(
  config: Partial<ConstructorParameters<typeof OpenAICompatibleAdapter>[0]> = {},
  fetchImpl: typeof fetch = async () => okResponse("x"),
) {
  return new OpenAICompatibleAdapter({
    providerId: "qwen",
    apiKey: "test-key",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-vl-max",
    fetchImpl,
    ...config,
  });
}

describe("OpenAICompatibleAdapter：多厂商通用性", () => {
  it("providerId 影响请求目标与鉴权（千问/豆包/GPT 各自配置实例）", async () => {
    const calls: Array<{ url: string; auth: string; model: string }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({
        url,
        auth: (init.headers as Record<string, string>)["Authorization"],
        model: JSON.parse(init.body as string).model,
      });
      return okResponse("看到一只猫");
    };

    const qwen = new OpenAICompatibleAdapter({
      providerId: "qwen",
      apiKey: "k-qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-vl-max",
      fetchImpl,
    });
    const doubao = new OpenAICompatibleAdapter({
      providerId: "doubao",
      apiKey: "k-doubao",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-1.5-vision-pro",
      fetchImpl,
    });

    const image = { bytes: Buffer.from(PNG_1PX, "base64"), mimeType: "image/png" };
    await qwen.execute({ images: [image], instruction: "描述", jsonMode: false }, new AbortController().signal);
    await doubao.execute({ images: [image], instruction: "描述", jsonMode: false }, new AbortController().signal);

    expect(calls[0]).toMatchObject({
      url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      auth: "Bearer k-qwen",
      model: "qwen-vl-max",
    });
    expect(calls[1]).toMatchObject({
      url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      auth: "Bearer k-doubao",
      model: "doubao-1.5-vision-pro",
    });
  });

  it("多图批量（summarize）：content 按序展开为多个 image_url 部件", async () => {
    const captured: unknown[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      captured.push(JSON.parse(init.body as string));
      return okResponse("综合概述");
    };
    const adapter = new OpenAICompatibleAdapter({
      providerId: "batch",
      apiKey: "k",
      baseUrl: "https://example.com/v1",
      model: "batch-vlm",
      fetchImpl,
    });
    const imgA = { bytes: Buffer.from(PNG_1PX, "base64"), mimeType: "image/png" };
    const imgB = { bytes: Buffer.from(PNG_1PX, "base64"), mimeType: "image/png" };
    await adapter.execute(
      { images: [imgA, imgB], instruction: "综合概述", jsonMode: false },
      new AbortController().signal,
    );
    const content = (captured[0] as { messages: { content: unknown[] }[] }).messages[0]!.content;
    expect(content).toHaveLength(3); // text + 2 张图
    const urlParts = content.filter((p) => (p as { type: string }).type === "image_url");
    expect(urlParts).toHaveLength(2);
    expect((urlParts[0] as { image_url: { url: string } }).image_url.url).toMatch(/^data:image\/png;base64,/);
    expect((urlParts[1] as { image_url: { url: string } }).image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it("未配 baseUrl 时默认 OpenAI 官方端点", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      return okResponse("ok");
    });
    const adapter = new OpenAICompatibleAdapter({
      providerId: "gpt",
      apiKey: "k",
      model: "gpt-4o",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await adapter.execute(
      { images: [], instruction: "x", jsonMode: false },
      new AbortController().signal,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("非法 providerId 拒绝构造（Agent 显式选择标识必须合法）", () => {
    expect(() => new OpenAICompatibleAdapter({ providerId: "bad id!", apiKey: "k" })).toThrow();
  });

  it("declare：约束合并 extraConstraints（供应商特有属性）", () => {
    const adapter = makeAdapter({ extraConstraints: { confidence_supported: false, vendor_note: "x" } });
    expect(adapter.declare().constraints).toMatchObject({
      max_image_size: 10485760,
      confidence_supported: false,
      vendor_note: "x",
    });
  });

  it("declare：max_image_size 从配置计算（审查：与 Server Fetch 上限同步，不写死）", () => {
    const adapter = makeAdapter({ maxImageSize: 2048 });
    expect(adapter.declare().constraints.max_image_size).toBe(2048);
    expect(adapter.declare().constraints.max_images_per_request).toBe(1); // 单图输入诚实声明
  });

  it("成功路径：providerMeta 携带 providerId 与模型标识", async () => {
    const adapter = makeAdapter({});
    const r = await adapter.execute(
      { images: [], instruction: "x", jsonMode: false },
      new AbortController().signal,
    );
    expect(r.providerMeta).toMatchObject({ provider: "qwen", model: "qwen-vl-max" });
  });

  it("401 → PROVIDER_AUTH_FAILED（不重试）", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }));
    const adapter = makeAdapter({}, fetchImpl as unknown as typeof fetch);
    await expect(
      adapter.execute({ images: [], instruction: "x", jsonMode: false }, new AbortController().signal),
    ).rejects.toMatchObject({ applicationErrorCode: ApplicationErrorCode.PROVIDER_AUTH_FAILED });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("5xx 有界重试一次后成功", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(okResponse("ok"));
    const adapter = makeAdapter({}, fetchImpl as unknown as typeof fetch);
    const r = await adapter.execute(
      { images: [], instruction: "x", jsonMode: false },
      new AbortController().signal,
    );
    expect(r.text).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("探针：三探针全部通过 → verified 含三项（不产生 Observation）", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okResponse("一张图片"))
      .mockResolvedValueOnce(okResponse("无文字"))
      .mockResolvedValueOnce(okResponse(JSON.stringify({ objects: [{ label: "red_square", bbox: [1, 2, 3, 4] }] })));
    const adapter = makeAdapter({}, fetchImpl as unknown as typeof fetch);
    const verified = await adapter.probe(new AbortController().signal);
    expect(verified.provider).toBe("qwen");
    expect(verified.capabilities).toEqual(
      expect.arrayContaining(["image_understanding", "ocr", "structured_detection"]),
    );
  });

  it("取消信号中止请求", async () => {
    const ac = new AbortController();
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<never>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        ac.abort();
      });
    });
    const adapter = makeAdapter({}, fetchImpl as unknown as typeof fetch);
    await expect(
      adapter.execute({ images: [], instruction: "x", jsonMode: false }, ac.signal),
    ).rejects.toThrow();
  });

  it("content 为 content block 数组时拼接 text（审查 #7）", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: [{ type: "text", text: "第一段" }, { type: "text", text: "第二段" }] } }],
        }),
        { status: 200 },
      ),
    );
    const adapter = makeAdapter({}, fetchImpl as unknown as typeof fetch);
    const r = await adapter.execute(
      { images: [], instruction: "x", jsonMode: false },
      new AbortController().signal,
    );
    expect(r.text).toBe("第一段\n第二段");
  });

  it("jsonMode 携带 response_format；400 时降级重试一次（审查 #7）", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async (url: string, init: RequestInit) => {
        calls.push(JSON.parse(init.body as string));
        return new Response("bad request", { status: 400 });
      })
      .mockImplementationOnce(async (url: string, init: RequestInit) => {
        calls.push(JSON.parse(init.body as string));
        return okResponse('{"objects":[]}');
      });
    const adapter = makeAdapter({}, fetchImpl as unknown as typeof fetch);
    const r = await adapter.execute(
      { images: [], instruction: "x", jsonMode: true },
      new AbortController().signal,
    );
    expect(r.text).toBe('{"objects":[]}');
    expect(calls[0]!["response_format"]).toEqual({ type: "json_object" });
    expect(calls[1]!["response_format"]).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("超时 → PROVIDER_TIMEOUT（审查 #2：与用户取消区分）", async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<never>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const adapter = makeAdapter({ timeoutMs: 80 }, fetchImpl as unknown as typeof fetch);
    await expect(
      adapter.execute({ images: [], instruction: "x", jsonMode: false }, new AbortController().signal),
    ).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.PROVIDER_TIMEOUT,
    });
  });

  it("真实 Node 超时形态（DOMException TimeoutError）同样映射 PROVIDER_TIMEOUT", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const adapter = makeAdapter({}, fetchImpl as unknown as typeof fetch);
    await expect(
      adapter.execute({ images: [], instruction: "x", jsonMode: false }, new AbortController().signal),
    ).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.PROVIDER_TIMEOUT,
    });
  });

  it("用户取消原样上抛（AbortError，非 PROVIDER_TIMEOUT）", async () => {
    const ac = new AbortController();
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<never>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        ac.abort();
      });
    });
    const adapter = makeAdapter({ timeoutMs: 5000 }, fetchImpl as unknown as typeof fetch);
    await expect(
      adapter.execute({ images: [], instruction: "x", jsonMode: false }, ac.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("响应文本超限 → PROVIDER_INVALID_RESPONSE（膨胀防御，不截断）", async () => {
    const fetchImpl = vi.fn(async () => okResponse("x".repeat(2000)));
    const adapter = makeAdapter(
      { maxResponseTextBytes: 1000 },
      fetchImpl as unknown as typeof fetch,
    );
    await expect(
      adapter.execute({ images: [], instruction: "x", jsonMode: false }, new AbortController().signal),
    ).rejects.toMatchObject({
      applicationErrorCode: ApplicationErrorCode.PROVIDER_INVALID_RESPONSE,
    });
  });
});
