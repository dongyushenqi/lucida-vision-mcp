/**
 * Identity Context —— 由 Compatibility Layer 注入（规格二.4）。
 *
 * Legacy Family 无协议级身份 → 使用 Server 配置的默认 Principal/Tenant；
 * Modern Family 从请求自描述上下文解析。本层只消费，不推断。
 */
export interface IdentityContext {
  principalId: string;
  tenantId: string;
  /** 身份来源描述（审计用，不参与授权判定） */
  via?: string;
}
