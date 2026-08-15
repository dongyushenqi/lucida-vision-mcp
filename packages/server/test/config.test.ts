import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

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
