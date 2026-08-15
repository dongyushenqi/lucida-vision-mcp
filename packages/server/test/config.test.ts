import { describe, expect, it } from "vitest";
import { loadConfig, parseProviders } from "../src/config.js";

describe("Server 配置", () => {
  it("默认值：内存库 + local/default 身份", () => {
    const cfg = loadConfig({});
    expect(cfg.dbPath).toBe(":memory:");
    expect(cfg.identity).toEqual({ principalId: "local", tenantId: "default" });
    expect(cfg.agnes.apiKey).toBe("");
    expect(cfg.probeOnBoot).toBe(true);
  });

  it("环境变量覆盖", () => {
    const cfg = loadConfig({
      VISION_DB_PATH: "C:/data/vision.sqlite",
      VISION_PRINCIPAL: "alice",
      AGNES_API_KEY: "sk-test",
      AGNES_BASE_URL: "https://example.com/v1",
      VISION_PROBE_ON_BOOT: "false",
      VISION_ALLOWED_URI_ORIGINS: "example.com, images.example.org",
    });
    expect(cfg.dbPath).toBe("C:/data/vision.sqlite");
    expect(cfg.identity.principalId).toBe("alice");
    expect(cfg.agnes.apiKey).toBe("sk-test");
    expect(cfg.agnes.baseUrl).toBe("https://example.com/v1");
    expect(cfg.probeOnBoot).toBe(false);
    expect(cfg.allowedUriOrigins).toEqual(["example.com", "images.example.org"]);
  });

  it("URI 来源白名单缺省为空（仅 SSRF 防护）", () => {
    expect(loadConfig({}).allowedUriOrigins).toEqual([]);
  });
});

describe("VISION_PROVIDERS_JSON（多 Provider 装配）", () => {
  it("解析多个 OpenAI 兼容 Provider", () => {
    const providers = parseProviders(
      JSON.stringify([
        {
          providerId: "qwen",
          apiKey: "k1",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          model: "qwen-vl-max",
          displayName: "通义千问",
        },
        { providerId: "doubao", apiKey: "k2" },
      ]),
    );
    expect(providers).toEqual([
      {
        providerId: "qwen",
        apiKey: "k1",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-vl-max",
        displayName: "通义千问",
      },
      { providerId: "doubao", apiKey: "k2", baseUrl: undefined, model: undefined, displayName: undefined },
    ]);
  });

  it("跳过非法项；非法 JSON 返回空数组", () => {
    expect(
      parseProviders(
        JSON.stringify([{ providerId: "bad id", apiKey: "k" }, { apiKey: "no-id" }, 42]),
      ),
    ).toEqual([]);
    expect(parseProviders("not json")).toEqual([]);
    expect(parseProviders(undefined)).toEqual([]);
  });

  it("loadConfig 接入 providers", () => {
    const cfg = loadConfig({
      VISION_PROVIDERS_JSON: JSON.stringify([{ providerId: "gpt", apiKey: "k", model: "gpt-4o" }]),
    });
    expect(cfg.providers).toHaveLength(1);
    expect(cfg.providers[0]).toMatchObject({ providerId: "gpt", model: "gpt-4o" });
  });
});
