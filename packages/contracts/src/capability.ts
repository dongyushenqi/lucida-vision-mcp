/**
 * 三层能力模型 —— 规格三.2。
 *
 * Declared（配置声明）∩ Verified（探针验证）→ Effective（保留 Scope and Constraints），
 * Effective ∩ IQA Assessment → Final Executable Capability（仅描述执行可行性，
 * 严禁替代工具推荐/恢复策略/工作流建议）。
 *
 * Probe 副作用边界：探针结果仅用于更新 Capability Registry，
 * 严禁自动生成 Observation 注入视觉事实图谱。
 */
import { z } from "zod";

export const CapabilityId = z.enum([
  "image_understanding",
  "structured_detection",
  "ocr",
  "multi_image",
]);

export type CapabilityId = z.infer<typeof CapabilityId>;

export const ScopeAndConstraints = z.record(z.unknown());

export type ScopeAndConstraints = z.infer<typeof ScopeAndConstraints>;

export const DeclaredCapability = z
  .object({
    provider: z.string().min(1),
    capabilities: z.array(CapabilityId),
    constraints: ScopeAndConstraints,
  })
  .strict();

export type DeclaredCapability = z.infer<typeof DeclaredCapability>;

export const VerifiedCapability = z
  .object({
    provider: z.string().min(1),
    capabilities: z.array(CapabilityId),
    probe_id: z.string().min(1),
    verified_at: z.string().min(1), // ISO 8601
  })
  .strict();

export type VerifiedCapability = z.infer<typeof VerifiedCapability>;

/** Effective = Declared ∩ Verified；约束保留原则：保留 Scope and Constraints。 */
export const EffectiveCapability = z
  .object({
    provider: z.string().min(1),
    capabilities: z.array(CapabilityId),
    constraints: ScopeAndConstraints,
    updated_at: z.string().min(1), // ISO 8601
  })
  .strict();

export type EffectiveCapability = z.infer<typeof EffectiveCapability>;

export const CapabilityRegistryEntry = z
  .object({
    schema_version: z.literal(1),
    provider: z.string().min(1),
    declared: DeclaredCapability,
    verified: VerifiedCapability.nullable(),
    effective: EffectiveCapability.nullable(),
    updated_at: z.string().min(1), // ISO 8601
  })
  .strict();

export type CapabilityRegistryEntry = z.infer<typeof CapabilityRegistryEntry>;

/** Final Executable Capability：仅描述"当前输入在当前 Provider 下的执行可行性"。 */
export interface ExecutabilityAssessment {
  provider: string;
  tool_name: string;
  executable: boolean;
  /** 非决策属性：只陈述不可执行的事实与原因，无任何建议。 */
  reasons: string[];
  /** IQA 结果属于 Execution Metadata（IQA Result Semantics 封口，默认不进 Observation Graph）。 */
  iqa?: unknown;
}
