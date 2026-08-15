/**
 * Operation Parameter Identity —— 规格五.2。
 *
 * - 去重必须基于应用级操作参数的规范化表示（Canonical Representation）；
 *   协议传输元数据、追踪元数据、认证元数据不得参与操作参数身份标识。
 * - 语义等价的参数表示必须解析为相同的规范化操作参数身份。
 * - 算法：RFC 8785 (JCS) 子集 + SHA-256（Implementation Decision）。
 */
import { createHash } from "node:crypto";

/** 非语义元数据键：不参与操作参数身份标识（规格五.2）。
 *  - 协议/追踪/认证元数据：协议传输层概念，绝非操作参数；
 *  - operation_id：属请求身份而非操作参数（Implementation Decision，见 docs/DECISIONS.md）。 */
export const NON_PARAMETER_METADATA_KEYS = [
  "mcp_session_id",
  "trace_id",
  "traceparent",
  "authorization",
  "auth_token",
  "request_id",
  "operation_id",
] as const;

/**
 * RFC 8785 (JCS) 子集的确定性 JSON 序列化：
 * - 对象键按 UTF-16 码元升序排序；
 * - 字符串按 JSON.stringify 转义规则（JCS 允许 ES 序列化）；
 * - 仅接受有限数值（NaN/Infinity 抛错）。
 */
export function canonicalize(value: unknown): string {
  return jcs(value);
}

function jcs(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw new Error("JCS: non-finite number is not canonicalizable");
      }
      return JSON.stringify(value);
    }
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map(jcs).join(",") + "]";
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const parts: string[] = [];
      for (const key of keys) {
        parts.push(JSON.stringify(key) + ":" + jcs(record[key]));
      }
      return "{" + parts.join(",") + "}";
    }
    default:
      throw new Error(`JCS: unsupported value type ${typeof value}`);
  }
}

/** 剔除协议/追踪/认证等非语义元数据，仅保留应用级操作参数。 */
export function extractOperationParameters(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if ((NON_PARAMETER_METADATA_KEYS as readonly string[]).includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Operation 参数身份：sha256(JCS({tool, args}))，去重与冲突校验的基准。 */
export function operationParameterIdentity(
  toolName: string,
  args: Record<string, unknown>,
): string {
  const canonical = canonicalize({
    tool: toolName,
    args: extractOperationParameters(args),
  });
  return "sha256:" + createHash("sha256").update(canonical, "utf8").digest("hex");
}
