/**
 * Observation Graph —— 视觉事实图谱（规格二.3 / 三.1）。
 *
 * Commit Boundary（规格二.2）：Observation 一旦完成 Server 端持久化（图谱写入）即视为 committed。
 * committed 之后绝不移除/失效——取消契约的保留原则由"只增不改删"保证。
 */
import { ApplicationErrorCode, Observation, VisionError, type Observation as ObservationType } from "@mcp-vision/contracts";
import type { Clock } from "./clock.js";
import type { VisionStore } from "./store.js";

export class ObservationGraph {
  constructor(
    private readonly store: VisionStore,
    private readonly clock: Clock,
  ) {}

  /** 提交 Observation：写入图谱 + 同步到所属 Operation 的已提交证据清单（同一事务）。
   *  Commit Boundary 前置校验（审查 #6）：任何 Observation 入库前必须通过契约 schema 校验。 */
  commitObservation(sessionId: string, obs: ObservationType): ObservationType {
    const committed: ObservationType = {
      ...obs,
      status: "committed",
      created_at: obs.created_at.length > 0 ? obs.created_at : this.clock(),
    };
    const parsed = Observation.safeParse(committed);
    if (!parsed.success) {
      throw new VisionError(ApplicationErrorCode.VISION_INTERNAL, "Observation 契约校验失败", {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    this.store.transaction(() => {
      this.store.insertObservation(sessionId, committed);
      const op = this.store.getOperation(sessionId, obs.lineage.operation_id);
      if (op && !op.committed_observation_ids.includes(obs.observation_id)) {
        this.store.updateOperation({
          ...op,
          committed_observation_ids: [...op.committed_observation_ids, obs.observation_id],
        });
      }
    });
    return committed;
  }

  get(sessionId: string, observationId: string): ObservationType | undefined {
    const e = this.store.getObservation(observationId);
    return e && e.sessionId === sessionId ? e.observation : undefined;
  }

  list(sessionId: string): ObservationType[] {
    return this.store.listObservations(sessionId);
  }
}
