/**
 * Provider Adapter 接口 —— 模型独立性（规格一.2）与统一 Fetch Boundary（规格四.1）。
 *
 * - Adapter 只接收**已通过 Fetch Boundary 的本地字节**，绝不自行发起图像获取。
 * - 取消只认内部 AbortSignal（Compatibility Layer 翻译的 CancellationTokenSource）。
 * - Probe 是受控验证（可能产生成本），仅更新 Capability Registry，严禁生成 Observation。
 * - 严禁任何"自动重试智能路由/跨 Provider 故障转移"逻辑。
 */
import type {
  CapabilityId,
  DeclaredCapability,
  VerifiedCapability,
} from "@mcp-vision/contracts";

export interface ProviderImage {
  bytes: Uint8Array;
  mimeType: string;
}

export interface ProviderExecuteRequest {
  images: ProviderImage[];
  instruction: string;
  jsonMode: boolean;
}

export interface ProviderExecuteResult {
  text: string;
  providerMeta: {
    provider: string;
    model: string;
    model_version: string;
    execution_timestamp: string; // ISO 8601
  };
}

export interface VLMProvider {
  readonly providerId: string;
  readonly adapterVersion: string;
  /** 声明能力（含 Scope and Constraints） */
  declare(): DeclaredCapability;
  /** 能力探针：验证 declared 中的子集；结果只进 Capability Registry */
  probe(signal: AbortSignal): Promise<VerifiedCapability>;
  /** 执行感知：图像字节进、文本证据出 */
  execute(req: ProviderExecuteRequest, signal: AbortSignal): Promise<ProviderExecuteResult>;
  /** 声明的能力 id（供 Registry 过滤使用） */
  readonly capabilityIds: CapabilityId[];
}
