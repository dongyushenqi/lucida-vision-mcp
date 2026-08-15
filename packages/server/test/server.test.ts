import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/index.js";

// 测试环境关闭定时器（probe/retention），避免 unref 定时器干扰
function testConfig(extra: Record<string, string> = {}) {
  return loadConfig({
    VISION_PROBE_ON_BOOT: "false",
    VISION_RETENTION_OPERATIONS_HOURS: "0",
    VISION_RETENTION_ARTIFACTS_HOURS: "0",
    ...extra,
  });
}

describe("重复 providerId 校验（启动即报错）", () => {
  it("VISION_PROVIDERS_JSON 重复 providerId → 拒绝启动", async () => {
    const cfg = testConfig({
      VISION_PROVIDERS_JSON: JSON.stringify([
        { providerId: "qwen", apiKey: "k1" },
        { providerId: "qwen", apiKey: "k2" },
      ]),
    });
    await expect(createServer(cfg)).rejects.toThrow(/重复的 providerId/);
  });

  it("唯一 providerId 正常装配", async () => {
    const cfg = testConfig({
      VISION_PROVIDERS_JSON: JSON.stringify([{ providerId: "qwen", apiKey: "k1" }]),
    });
    const { core, store } = await createServer(cfg);
    expect(core.providers.all().map((p) => p.providerId)).toEqual(["qwen"]);
    store.close();
  });
});
