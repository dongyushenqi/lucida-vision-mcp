import { randomUUID } from "node:crypto";

/** 生成带前缀的领域实体 ID（operation_id / observation_id / artifact_id / session_id 等）。 */
export function genId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}
