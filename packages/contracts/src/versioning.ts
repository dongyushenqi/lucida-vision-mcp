/**
 * 全局 Schema 版本控制（规格三：所有 Vision Server 定义并持久化的核心领域数据结构
 * 必须包含显式的 schema_version 字段。此约束不适用于 MCP 原生协议消息或瞬态 RPC envelope）。
 */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/** 版本化数据的公共形态。 */
export interface SchemaVersioned {
  schema_version: number;
}
