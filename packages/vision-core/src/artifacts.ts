/**
 * Artifact 服务 —— 规格四.2。
 *
 * - Observation 与 Artifact 独立生命周期：Artifact 独立存储与检索，关联靠显式 lineage。
 * - 完整性元数据：SHA-256 digest 仅用于完整性验证/去重/审计（Integrity/Authorization 分离）。
 * - V1 仅 Tier 1：blob 直读（vision://{session}/{artifact}）。
 */
import { createHash } from "node:crypto";
import type { ArtifactMetadata } from "@mcp-vision/contracts";
import type { Clock } from "./clock.js";
import { genId } from "./ids.js";
import type { StoredArtifact, VisionStore } from "./store.js";

export class ArtifactService {
  constructor(
    private readonly store: VisionStore,
    private readonly clock: Clock,
  ) {}

  storeArtifact(sessionId: string, bytes: Uint8Array, mimeType: string): ArtifactMetadata {
    const artifactId = genId("art");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const metadata: ArtifactMetadata = {
      schema_version: 1,
      artifact_id: artifactId,
      mime_type: mimeType,
      content_length: bytes.byteLength,
      digest: { algorithm: "SHA-256", value: digest },
      created_at: this.clock(),
      storage: { tier: 1, ref: `vision://${sessionId}/${artifactId}` },
    };
    this.store.insertArtifact(sessionId, metadata, bytes);
    return metadata;
  }

  get(sessionId: string, artifactId: string): StoredArtifact | undefined {
    const e = this.store.getArtifact(artifactId);
    return e && e.sessionId === sessionId ? e.artifact : undefined;
  }

  list(sessionId: string): ArtifactMetadata[] {
    // V1：内存/SQLite 均按 id 存储；list 通过 observations 级联暂不提供全量枚举，
    // 与规格"resources/list 不得视为动态 Artifact 权威清单"一致——只提供按会话的元数据快照。
    void sessionId;
    return [];
  }
}
