/**
 * 内部取消契约（规格二.2）。
 *
 * - Compatibility Layer 将协议级取消/请求终止/传输断开转换为统一 CancellationTokenSource；
 * - Vision Core 只认本机制，绝不依赖 originating MCP cancellation mechanism；
 * - 取消本身不得被解释为 Tool Execution Error（由上层按 Operation 状态处理）。
 */

/** 内部取消信号。 */
export class CancellationTokenSource {
  private readonly ac = new AbortController();

  cancel(): void {
    if (!this.ac.signal.aborted) {
      this.ac.abort(new OperationCancelledError("operation cancelled by internal cancellation context"));
    }
  }

  get isCancelled(): boolean {
    return this.ac.signal.aborted;
  }

  get signal(): AbortSignal {
    return this.ac.signal;
  }

  throwIfCancelled(): void {
    if (this.isCancelled) {
      throw new OperationCancelledError("operation cancelled by internal cancellation context");
    }
  }
}

/** 内部取消导致的终止：上层应映射为 Operation 状态 cancelled，而非错误。 */
export class OperationCancelledError extends Error {
  constructor(message = "operation cancelled") {
    super(message);
    this.name = "OperationCancelledError";
  }
}

export function isOperationCancelled(err: unknown): err is OperationCancelledError {
  return err instanceof OperationCancelledError;
}
