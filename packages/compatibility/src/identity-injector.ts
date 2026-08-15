/**
 * Identity Context 注入（规格二.4）。
 *
 * - Legacy Family：无协议级身份 → 使用 Server 配置的默认 Principal/Tenant
 *   （Implementation Decision：单机部署默认 local/default，服务化时改为真实认证）。
 * - Modern Family：从请求自描述上下文解析（V1 占位，见 modern-family.ts）。
 */
import type { IdentityContext } from "@mcp-vision/vision-interface";

export interface IdentityConfig {
  principalId: string;
  tenantId: string;
}

export function legacyIdentity(config: IdentityConfig): IdentityContext {
  return {
    principalId: config.principalId,
    tenantId: config.tenantId,
    via: "legacy-config",
  };
}

export const DEFAULT_IDENTITY_CONFIG: IdentityConfig = {
  principalId: "local",
  tenantId: "default",
};
