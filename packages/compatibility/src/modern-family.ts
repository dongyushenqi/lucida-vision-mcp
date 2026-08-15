/**
 * Modern Protocol Family 占位（规格五.1）。
 *
 * Modern Family（2026-07-28+）：无 initialize 握手、无 Mcp-Session-Id、
 * 请求自描述、Stateless Core、server/discover 可选发现、Tasks/Apps 扩展。
 * 规格明确：Vision Core 不因协议演进而重写——本层是唯一需要变更的地方。
 * V1 不实现 Modern Family（Future Extension 边界），仅声明抽象以固化架构。
 */
export interface ModernFamilyAdapter {
  readonly family: "modern";
  /** server/discover：可选的预先能力发现（非强制握手步骤） */
  discover(): ModernDiscovery;
}

export interface ModernDiscovery {
  server_name: string;
  server_version: string;
  protocol_family: "modern";
  capabilities: {
    tools: boolean;
    resources: boolean;
  };
  /** 由本 Server 定义并持久化的数据结构版本（规格三：全局 Schema 版本控制） */
  schema_versions: Record<string, number>;
}

export class ModernFamilyPlaceholder implements ModernFamilyAdapter {
  readonly family = "modern" as const;

  discover(): ModernDiscovery {
    return {
      server_name: "lucida",
      server_version: "0.1.0",
      protocol_family: "modern",
      capabilities: { tools: true, resources: true },
      schema_versions: { observation: 1, artifact: 1, operation: 1, session: 1, capability: 1 },
    };
  }
}
