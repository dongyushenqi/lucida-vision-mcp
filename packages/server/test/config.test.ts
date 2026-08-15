import { describe, expect, it } from "vitest";
import { loadConfig, parseProviders } from "../src/config.js";

describe("Server 配置", () => {
  it("默认值：内存库 + local/default 身份", () => {
    const cfg = loadConfig({});
    expect(cfg.dbPath).toBe(":memory:");
    expect(cfg.identity).toEqual({ principalId: "local", tenantId: "default" });
    expect(cfg.agnes.apiKey).toBe("");
    expect(cfg.probeOnBoot).toBe(true);
    expect(cfg.probeIntervalHours).toBe(24);
  });

  it("环境变量覆盖", () => {
    const cfg = loadConfig({
      VISION_DB_PATH: "C:/data/vision.sqlite",
      VISION_PRINCIPAL: "alice",
      AGNES_API_KEY: "sk-test",
      AGNES_BASE_URL: "https://example.com/v1",
      VISION_PROBE_ON_BOOT: "false",
      VISION_PROBE_INTERVAL_HOURS: "0",
      VISION_ALLOWED_URI_ORIGINS: "example.com, images.example.org",
    });
    expect(cfg.dbPath).toBe("C:/data/vision.sqlite");
    expect(cfg.identity.principalId).toBe("alice");
    expect(cfg.agnes.apiKey).toBe("sk-test");
    expect(cfg.agnes.baseUrl).toBe("https://example.com/v1");
    expect(cfg.probeOnBoot).toBe(false);
    expect(cfg.probeIntervalHours).toBe(0);
    expect(cfg.allowedUriOrigins).toEqual(["example.com", "images.example.org"]);
  });

  it("VISION_PROBE_INTERVAL_HOURS 非法值回退默认 24", () => {
    expect(loadConfig({ VISION_PROBE_INTERVAL_HOURS: "abc" }).probeIntervalHours).toBe(24);
    expect(loadConfig({ VISION_PROBE_INTERVAL_HOURS: "-1" }).probeIntervalHours).toBe(24);
  });

  it("URI 来源白名单缺省为空（仅 SSRF 防护）", () => {
    expect(loadConfig({}).allowedUriOrigins).toEqual([]);
  });

  it("retention 与 Fetch 大小配置解析（默认值与覆盖）", () => {
    const def = loadConfig({});
    expect(def.retentionHours).toEqual({ operations: 168, artifacts: 24 });
    expect(def.maxInlineBytes).toBe(10 * 1024 * 1024);
    expect(def.maxUriBytes).toBe(10 * 1024 * 1024);

    const cfg = loadConfig({
      VISION_RETENTION_OPERATIONS_HOURS: "48",
      VISION_RETENTION_ARTIFACTS_HOURS: "0",
      VISION_MAX_INLINE_BYTES: "2048",
      VISION_MAX_URI_BYTES: "4096",
    });
    expect(cfg.retentionHours).toEqual({ operations: 48, artifacts: 0 });
    expect(cfg.maxInlineBytes).toBe(2048);
    expect(cfg.maxUriBytes).toBe(4096);

    expect(loadConfig({ VISION_MAX_INLINE_BYTES: "abc" }).maxInlineBytes).toBe(10 * 1024 * 1024);
  });

  it("URI scheme 白名单：默认 http,https,file；可显式覆盖（含收窄）；非法项剔除", () => {
    expect(loadConfig({}).allowedUriSchemes).toEqual(["http", "https", "file"]);
    expect(loadConfig({ VISION_ALLOW_URI_SCHEMES: "http,https,file" }).allowedUriSchemes).toEqual([
      "http",
      "https",
      "file",
    ]);
    expect(loadConfig({ VISION_ALLOW_URI_SCHEMES: "http,https" }).allowedUriSchemes).toEqual(["http", "https"]);
    expect(loadConfig({ VISION_ALLOW_URI_SCHEMES: "http, hTtPs, bad scheme!, file" }).allowedUriSchemes).toEqual([
      "http",
      "https",
      "file",
    ]);
    expect(loadConfig({ VISION_ALLOW_URI_SCHEMES: "bad scheme!" }).allowedUriSchemes).toEqual(["http", "https", "file"]);
    expect(loadConfig({ VISION_ALLOW_URI_SCHEMES: "http,http" }).allowedUriSchemes).toEqual(["http"]);
  });

  it("私有地址放行开关：缺省关闭；仅显式 'true' 开启", () => {
    expect(loadConfig({}).allowPrivateAddresses).toBe(false);
    expect(loadConfig({ VISION_ALLOW_PRIVATE_ADDRESSES: "true" }).allowPrivateAddresses).toBe(true);
    expect(loadConfig({ VISION_ALLOW_PRIVATE_ADDRESSES: "1" }).allowPrivateAddresses).toBe(false);
    expect(loadConfig({ VISION_ALLOW_PRIVATE_ADDRESSES: "yes" }).allowPrivateAddresses).toBe(false);
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
