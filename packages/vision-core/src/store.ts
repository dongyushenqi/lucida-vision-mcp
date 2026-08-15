/**
 * 存储抽象：V1 实现 = SQLite（Node 内置 node:sqlite，Implementation Decision），
 * 另提供内存实现供单测使用。存储选型属 Implementation Decision，可替换。
 */
import { DatabaseSync } from "node:sqlite";
import type {
  ArtifactMetadata,
  CapabilityRegistryEntry,
  Observation,
  OperationRecord,
  VisionSession,
} from "@mcp-vision/contracts";

export interface StoredArtifact {
  metadata: ArtifactMetadata;
  bytes: Uint8Array;
}

export interface VisionStore {
  // ---- sessions ----
  createSession(s: VisionSession): void;
  getSession(sessionId: string): VisionSession | undefined;
  updateSession(s: VisionSession): void;
  // ---- operations ----
  getOperation(sessionId: string, operationId: string): OperationRecord | undefined;
  listOperations(sessionId: string): OperationRecord[];
  insertOperation(op: OperationRecord): void;
  updateOperation(op: OperationRecord): void;
  // ---- observations ----
  insertObservation(sessionId: string, obs: Observation): void;
  getObservation(observationId: string): { sessionId: string; observation: Observation } | undefined;
  listObservations(sessionId: string): Observation[];
  // ---- artifacts ----
  insertArtifact(sessionId: string, metadata: ArtifactMetadata, bytes: Uint8Array): void;
  getArtifact(artifactId: string): { sessionId: string; artifact: StoredArtifact } | undefined;
  // ---- capability registry ----
  upsertCapability(entry: CapabilityRegistryEntry): void;
  getCapability(provider: string): CapabilityRegistryEntry | undefined;
  // ---- tx ----
  transaction<T>(fn: () => T): T;
  close(): void;
}

function parseRow<T>(data: string): T {
  return JSON.parse(data) as T;
}

/* ------------------------------------------------------------------ */
/* SQLite 实现（node:sqlite，WAL）                                      */
/* ------------------------------------------------------------------ */

export class SqliteVisionStore implements VisionStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operations (
        session_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (session_id, operation_id)
      );
      CREATE TABLE IF NOT EXISTS observations (
        observation_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
      CREATE TABLE IF NOT EXISTS artifacts (
        artifact_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        data TEXT NOT NULL,
        blob BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS capability_registry (
        provider TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
    `);
  }

  createSession(s: VisionSession): void {
    this.db.prepare("INSERT INTO sessions (session_id, data) VALUES (?, ?)").run(
      s.vision_session_id,
      JSON.stringify(s),
    );
  }

  getSession(sessionId: string): VisionSession | undefined {
    const row = this.db.prepare("SELECT data FROM sessions WHERE session_id = ?").get(sessionId) as
      | { data: string }
      | undefined;
    return row ? parseRow<VisionSession>(row.data) : undefined;
  }

  updateSession(s: VisionSession): void {
    this.db.prepare("UPDATE sessions SET data = ? WHERE session_id = ?").run(
      JSON.stringify(s),
      s.vision_session_id,
    );
  }

  getOperation(sessionId: string, operationId: string): OperationRecord | undefined {
    const row = this.db
      .prepare("SELECT data FROM operations WHERE session_id = ? AND operation_id = ?")
      .get(sessionId, operationId) as { data: string } | undefined;
    return row ? parseRow<OperationRecord>(row.data) : undefined;
  }

  listOperations(sessionId: string): OperationRecord[] {
    const rows = this.db
      .prepare("SELECT data FROM operations WHERE session_id = ? ORDER BY rowid")
      .all(sessionId) as { data: string }[];
    return rows.map((r) => parseRow<OperationRecord>(r.data));
  }

  insertOperation(op: OperationRecord): void {
    this.db
      .prepare("INSERT INTO operations (session_id, operation_id, data) VALUES (?, ?, ?)")
      .run(op.vision_session_id, op.operation_id, JSON.stringify(op));
  }

  updateOperation(op: OperationRecord): void {
    this.db
      .prepare("UPDATE operations SET data = ? WHERE session_id = ? AND operation_id = ?")
      .run(JSON.stringify(op), op.vision_session_id, op.operation_id);
  }

  insertObservation(sessionId: string, obs: Observation): void {
    this.db
      .prepare("INSERT INTO observations (observation_id, session_id, data) VALUES (?, ?, ?)")
      .run(obs.observation_id, sessionId, JSON.stringify(obs));
  }

  getObservation(observationId: string): { sessionId: string; observation: Observation } | undefined {
    const row = this.db
      .prepare("SELECT session_id, data FROM observations WHERE observation_id = ?")
      .get(observationId) as { session_id: string; data: string } | undefined;
    return row
      ? { sessionId: row.session_id, observation: parseRow<Observation>(row.data) }
      : undefined;
  }

  listObservations(sessionId: string): Observation[] {
    const rows = this.db
      .prepare("SELECT data FROM observations WHERE session_id = ? ORDER BY rowid")
      .all(sessionId) as { data: string }[];
    return rows.map((r) => parseRow<Observation>(r.data));
  }

  insertArtifact(sessionId: string, metadata: ArtifactMetadata, bytes: Uint8Array): void {
    this.db
      .prepare("INSERT INTO artifacts (artifact_id, session_id, data, blob) VALUES (?, ?, ?, ?)")
      .run(metadata.artifact_id, sessionId, JSON.stringify(metadata), bytes);
  }

  getArtifact(artifactId: string): { sessionId: string; artifact: StoredArtifact } | undefined {
    const row = this.db
      .prepare("SELECT session_id, data, blob FROM artifacts WHERE artifact_id = ?")
      .get(artifactId) as { session_id: string; data: string; blob: Uint8Array } | undefined;
    return row
      ? {
          sessionId: row.session_id,
          artifact: { metadata: parseRow<ArtifactMetadata>(row.data), bytes: row.blob },
        }
      : undefined;
  }

  upsertCapability(entry: CapabilityRegistryEntry): void {
    this.db
      .prepare(
        "INSERT INTO capability_registry (provider, data) VALUES (?, ?) " +
          "ON CONFLICT(provider) DO UPDATE SET data = excluded.data",
      )
      .run(entry.provider, JSON.stringify(entry));
  }

  getCapability(provider: string): CapabilityRegistryEntry | undefined {
    const row = this.db
      .prepare("SELECT data FROM capability_registry WHERE provider = ?")
      .get(provider) as { data: string } | undefined;
    return row ? parseRow<CapabilityRegistryEntry>(row.data) : undefined;
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}

/* ------------------------------------------------------------------ */
/* 内存实现（单测用）                                                    */
/* ------------------------------------------------------------------ */

export class InMemoryVisionStore implements VisionStore {
  private sessions = new Map<string, VisionSession>();
  private operations = new Map<string, OperationRecord>();
  private observations = new Map<string, { sessionId: string; observation: Observation }>();
  private artifacts = new Map<string, { sessionId: string; artifact: StoredArtifact }>();
  private capabilities = new Map<string, CapabilityRegistryEntry>();
  private txDepth = 0;

  createSession(s: VisionSession): void {
    this.sessions.set(s.vision_session_id, structuredClone(s));
  }

  getSession(sessionId: string): VisionSession | undefined {
    const s = this.sessions.get(sessionId);
    return s ? structuredClone(s) : undefined;
  }

  updateSession(s: VisionSession): void {
    this.sessions.set(s.vision_session_id, structuredClone(s));
  }

  getOperation(sessionId: string, operationId: string): OperationRecord | undefined {
    const op = this.operations.get(`${sessionId}/${operationId}`);
    return op ? structuredClone(op) : undefined;
  }

  listOperations(sessionId: string): OperationRecord[] {
    return [...this.operations.values()]
      .filter((o) => o.vision_session_id === sessionId)
      .map((o) => structuredClone(o));
  }

  insertOperation(op: OperationRecord): void {
    this.operations.set(`${op.vision_session_id}/${op.operation_id}`, structuredClone(op));
  }

  updateOperation(op: OperationRecord): void {
    this.operations.set(`${op.vision_session_id}/${op.operation_id}`, structuredClone(op));
  }

  insertObservation(sessionId: string, obs: Observation): void {
    this.observations.set(obs.observation_id, {
      sessionId,
      observation: structuredClone(obs),
    });
  }

  getObservation(observationId: string): { sessionId: string; observation: Observation } | undefined {
    const e = this.observations.get(observationId);
    return e ? structuredClone(e) : undefined;
  }

  listObservations(sessionId: string): Observation[] {
    return [...this.observations.values()]
      .filter((e) => e.sessionId === sessionId)
      .map((e) => structuredClone(e.observation));
  }

  insertArtifact(sessionId: string, metadata: ArtifactMetadata, bytes: Uint8Array): void {
    this.artifacts.set(metadata.artifact_id, {
      sessionId,
      artifact: { metadata: structuredClone(metadata), bytes: new Uint8Array(bytes) },
    });
  }

  getArtifact(artifactId: string): { sessionId: string; artifact: StoredArtifact } | undefined {
    const e = this.artifacts.get(artifactId);
    return e ? structuredClone(e) : undefined;
  }

  upsertCapability(entry: CapabilityRegistryEntry): void {
    this.capabilities.set(entry.provider, structuredClone(entry));
  }

  getCapability(provider: string): CapabilityRegistryEntry | undefined {
    const e = this.capabilities.get(provider);
    return e ? structuredClone(e) : undefined;
  }

  transaction<T>(fn: () => T): T {
    this.txDepth += 1;
    try {
      const result = fn();
      if (this.txDepth === 1) {
        // 内存实现：单层事务即提交（回滚语义在单测场景下不模拟）
      }
      return result;
    } finally {
      this.txDepth -= 1;
    }
  }

  close(): void {
    this.sessions.clear();
    this.operations.clear();
    this.observations.clear();
    this.artifacts.clear();
    this.capabilities.clear();
  }
}
