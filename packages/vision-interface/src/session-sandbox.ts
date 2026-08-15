/**
 * Session 授权沙箱（规格二.4）。
 *
 * - 任何访问/修改/继续执行/读取 Vision Session 的操作都必须经本沙箱授权校验；
 * - Session identifier 不得单独作为授权凭证（不可预测性 ≠ 授权）；
 * - Vision Session 不得跨 Principal/Tenant 访问（V1）。
 */
import { ApplicationErrorCode, VisionError, type VisionSession } from "@mcp-vision/contracts";
import type { VisionCore } from "@mcp-vision/vision-core";
import type { IdentityContext } from "./identity.js";

export class SessionSandbox {
  constructor(private readonly core: VisionCore) {}

  /** 校验 Session 存在且归属当前 Principal/Tenant，返回 Session。 */
  authorize(sessionId: string, identity: IdentityContext): VisionSession {
    const session = this.core.sessions.get(sessionId);
    if (!session) {
      throw new VisionError(ApplicationErrorCode.SESSION_NOT_FOUND, "Vision Session 不存在", {
        vision_session_id: sessionId,
      });
    }
    if (
      session.principal_id !== identity.principalId ||
      session.tenant_id !== identity.tenantId
    ) {
      throw new VisionError(
        ApplicationErrorCode.SESSION_AUTHORIZATION_DENIED,
        "无权访问该 Vision Session（归属校验失败）",
        { vision_session_id: sessionId },
      );
    }
    return session;
  }
}
