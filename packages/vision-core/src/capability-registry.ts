/**
 * Capability Registry —— 三层能力模型（规格三.2）。
 *
 * - Declared：Provider 配置声明。
 * - Verified：Capability Probe 验证结果。探针仅更新 Registry，严禁自动生成 Observation。
 * - Effective = Declared ∩ Verified，保留 Scope and Constraints（约束保留原则）。
 * - Final Executable Capability 由接口层在具体输入上计算（Effective ∩ IQA），
 *   仅描述执行可行性，严禁任何替代工具推荐/恢复策略/工作流建议。
 */
import type {
  CapabilityRegistryEntry,
  DeclaredCapability,
  EffectiveCapability,
  VerifiedCapability,
} from "@mcp-vision/contracts";
import { ApplicationErrorCode, VisionError } from "@mcp-vision/contracts";
import type { Clock } from "./clock.js";
import type { VisionStore } from "./store.js";

export class CapabilityRegistry {
  constructor(
    private readonly store: VisionStore,
    private readonly clock: Clock,
  ) {}

  register(declared: DeclaredCapability): CapabilityRegistryEntry {
    const entry: CapabilityRegistryEntry = {
      schema_version: 1,
      provider: declared.provider,
      declared,
      verified: null,
      effective: null,
      updated_at: this.clock(),
    };
    this.store.upsertCapability(entry);
    return entry;
  }

  /** 记录探针验证结果并重算 Effective。 */
  verify(verified: VerifiedCapability): CapabilityRegistryEntry {
    const entry = this.mustGet(verified.provider);
    const effectiveCaps = entry.declared.capabilities.filter((c) =>
      verified.capabilities.includes(c),
    );
    const effective: EffectiveCapability | null =
      effectiveCaps.length > 0
        ? {
            provider: verified.provider,
            capabilities: effectiveCaps,
            constraints: entry.declared.constraints,
            updated_at: this.clock(),
          }
        : null;
    const updated: CapabilityRegistryEntry = {
      ...entry,
      verified,
      effective,
      updated_at: this.clock(),
    };
    this.store.upsertCapability(updated);
    return updated;
  }

  get(provider: string): CapabilityRegistryEntry | undefined {
    return this.store.getCapability(provider);
  }

  effective(provider: string): EffectiveCapability | undefined {
    return this.store.getCapability(provider)?.effective ?? undefined;
  }

  private mustGet(provider: string): CapabilityRegistryEntry {
    const entry = this.store.getCapability(provider);
    if (!entry) {
      throw new VisionError(ApplicationErrorCode.PROVIDER_UNAVAILABLE, `provider 未注册`, {
        provider,
      });
    }
    return entry;
  }
}
