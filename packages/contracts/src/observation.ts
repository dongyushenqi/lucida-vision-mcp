/**
 * Observation（视觉证据节点）—— 规格三.1。
 *
 * - label 必须代表可观察的视觉属性/对象类别/区域/模式/文本/几何特征；
 *   严禁领域诊断、因果归因、治疗建议或工作流推荐。
 * - confidence 数值语义由 Provider 定义（provider_defined），
 *   Vision Core 不得跨 Provider 直接数值比较或加权平均。
 * - source（Provenance）在 Observation committed 后绝对不可变。
 * - lineage.operation_id 保证操作追溯性。
 */
import { z } from "zod";

export const CoordinateSystem = z.enum(["image_px"]);

export const LocationBBox = z
  .object({
    type: z.literal("bbox"),
    /** [x1, y1, x2, y2] */
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    coordinate_system: CoordinateSystem,
  })
  .strict();

export const LocationPoint = z
  .object({
    type: z.literal("point"),
    point: z.tuple([z.number(), z.number()]),
    coordinate_system: CoordinateSystem,
  })
  .strict();

export const LocationPolygon = z
  .object({
    type: z.literal("polygon"),
    points: z.array(z.tuple([z.number(), z.number()])).min(3),
    coordinate_system: CoordinateSystem,
  })
  .strict();

export const LocationFullImage = z
  .object({
    type: z.literal("full_image"),
    coordinate_system: CoordinateSystem,
  })
  .strict();

export const Location = z.discriminatedUnion("type", [
  LocationBBox,
  LocationPoint,
  LocationPolygon,
  LocationFullImage,
]);

export type Location = z.infer<typeof Location>;

/**
 * confidence 数值语义由 Provider/Model 定义（semantics: provider_defined）。
 * Provider 不提供置信度时 value 为 null（Contract Clarification：
 * limitations 必须注明 confidence_not_provided_by_provider）。
 */
export const Confidence = z
  .object({
    value: z.number().min(0).max(1).nullable(),
    semantics: z.literal("provider_defined"),
  })
  .strict();

export type Confidence = z.infer<typeof Confidence>;

/** Provenance：精确记录实际执行来源；committed 后绝对不可变。 */
export const ProviderSource = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    model_version: z.string().min(1),
    adapter_version: z.string().min(1),
    execution_timestamp: z.string().min(1), // ISO 8601
  })
  .strict();

export type ProviderSource = z.infer<typeof ProviderSource>;

export const Lineage = z
  .object({
    /** 追溯到产生它的具体 Operation */
    operation_id: z.string().min(1),
    derivation: z.enum(["direct", "derived"]),
    parents: z.array(z.string()).default([]),
  })
  .strict();

export type Lineage = z.infer<typeof Lineage>;

export const ObservationStatus = z.enum(["committed", "pending"]);

export const Observation = z
  .object({
    schema_version: z.literal(1),
    observation_id: z.string().min(1),
    label: z.string().min(1),
    location: Location,
    confidence: Confidence,
    source: ProviderSource,
    lineage: Lineage,
    limitations: z.array(z.string()).default([]),
    status: ObservationStatus,
    created_at: z.string().min(1), // ISO 8601
    /**
     * Contract Clarification（见 docs/DECISIONS.md）：
     * observe 的 Provider 原文证据，仅 `visual_evidence` 标签使用；
     * 不改变规格规定的必须字段语义。
     */
    text: z.string().optional(),
  })
  .strict();

export type Observation = z.infer<typeof Observation>;
