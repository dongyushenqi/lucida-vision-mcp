import { describe, expect, it } from "vitest";
import { CancellationTokenSource } from "@mcp-vision/vision-core";
import { bridgeToCancellationToken } from "../src/cancel-bridge.js";

describe("取消桥（规格二.2：协议取消 → 内部 Cancellation Context）", () => {
  it("协议信号 abort → 内部 token 取消", () => {
    const ac = new AbortController();
    const cts = bridgeToCancellationToken({ signal: ac.signal });
    expect(cts.isCancelled).toBe(false);
    ac.abort();
    expect(cts.isCancelled).toBe(true);
    expect(() => cts.throwIfCancelled()).toThrow();
  });

  it("协议信号已 abort → 立即取消", () => {
    const ac = new AbortController();
    ac.abort();
    const cts = bridgeToCancellationToken({ signal: ac.signal });
    expect(cts.isCancelled).toBe(true);
  });

  it("无协议信号 → token 保持非取消（Vision Core 不依赖 originating 取消机制）", () => {
    const cts = bridgeToCancellationToken({});
    expect(cts.isCancelled).toBe(false);
  });
});
