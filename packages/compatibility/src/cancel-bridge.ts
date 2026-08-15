/**
 * 取消信号统一抽象（规格二.2）。
 *
 * Compatibility Layer 将协议级取消、请求终止或传输层断开转换为统一的内部
 * CancellationTokenSource；Vision Core 绝不依赖 originating MCP cancellation mechanism。
 */
import { CancellationTokenSource } from "@mcp-vision/vision-core";

export interface ProtocolCancelSignal {
  signal?: AbortSignal;
}

/** 桥接：协议 AbortSignal → 内部 CancellationTokenSource。 */
export function bridgeToCancellationToken(
  protocol: ProtocolCancelSignal,
): CancellationTokenSource {
  const cts = new CancellationTokenSource();
  const signal = protocol.signal;
  if (signal) {
    if (signal.aborted) {
      cts.cancel();
    } else {
      signal.addEventListener("abort", () => cts.cancel(), { once: true });
    }
  }
  return cts;
}
