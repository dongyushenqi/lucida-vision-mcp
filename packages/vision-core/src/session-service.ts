/**
 * Vision Session 服务 —— 规格二.4。
 *
 * 本服务负责 Session 记录的创建/查询/关闭；
 * 授权校验（Session 归属 Principal/Tenant）由 vision-interface 的 Session 沙箱执行——
 * Session identifier 不得单独作为授权凭证。
 */
import type { VisionSession } from "@mcp-vision/contracts";
import type { Clock } from "./clock.js";
import { genId } from "./ids.js";
import type { VisionStore } from "./store.js";

export class SessionService {
  constructor(
    private readonly store: VisionStore,
    private readonly clock: Clock,
  ) {}

  create(principalId: string, tenantId: string): VisionSession {
    const session: VisionSession = {
      schema_version: 1,
      vision_session_id: genId("vs"),
      principal_id: principalId,
      tenant_id: tenantId,
      status: "active",
      created_at: this.clock(),
    };
    this.store.createSession(session);
    return session;
  }

  get(sessionId: string): VisionSession | undefined {
    return this.store.getSession(sessionId);
  }

  close(sessionId: string): VisionSession {
    const s = this.store.getSession(sessionId);
    if (!s) {
      throw new Error(`session not found: ${sessionId}`);
    }
    const closed: VisionSession = { ...s, status: "closed" };
    this.store.updateSession(closed);
    return closed;
  }
}
