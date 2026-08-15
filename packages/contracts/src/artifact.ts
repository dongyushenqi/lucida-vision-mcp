/**
 * Artifact 完整性元数据 —— 规格四.2。
 *
 * - Observation 与 Artifact 为独立领域实体，不建立默认一对一生命周期绑定；
 *   关联必须通过显式 lineage / provenance 表达。
 * - digest 仅用于内容完整性验证、缓存去重及审计，
 *   不承担 Principal/Tenant、Session 或 Artifact 授权功能（Integrity/Authorization 分离）。
 */
import { z } from "zod";

export const ArtifactDigest = z
  .object({
    algorithm: z.literal("SHA-256"),
    value: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const ArtifactStorage = z
  .object({
    /** V1 仅 Tier 1：MCP Resource blob 直读 */
    tier: z.literal(1),
    /** Resource URI，如 vision://{session_id}/{artifact_id} */
    ref: z.string().min(1),
  })
  .strict();

export const ArtifactMetadata = z
  .object({
    schema_version: z.literal(1),
    artifact_id: z.string().min(1),
    mime_type: z.string().min(1),
    content_length: z.number().int().nonnegative(),
    digest: ArtifactDigest,
    created_at: z.string().min(1), // ISO 8601
    storage: ArtifactStorage,
  })
  .strict();

export type ArtifactMetadata = z.infer<typeof ArtifactMetadata>;
