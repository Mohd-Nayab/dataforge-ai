/**
 * Core types for the universal, database-agnostic data platform.
 *
 * Every database engine is accessed through the {@link DatabaseAdapter}
 * interface. Higher-level modules (cleaning, analytics, AI) talk ONLY to the
 * DatabaseManager, never to a concrete driver. Adding a new database therefore
 * means implementing this interface once and registering a factory — no other
 * code needs to change.
 */

/** All database engines the platform is designed to support. */
export type SupportedDatabase =
  | "sqlite"
  | "postgres"
  | "mysql"
  | "mariadb"
  | "sqlserver"
  | "oracle"
  | "mongodb"
  | "redis"
  | "elasticsearch"
  | "pinecone"
  | "chromadb"
  | "weaviate"
  | "qdrant"
  | "milvus"
  | "faiss";

/** Broad family a database belongs to — drives which operations are relevant. */
export type DatabaseFamily = "relational" | "document" | "key_value" | "search" | "vector";

/** Whether an adapter is fully implemented or a registered-but-pending stub. */
export type AdapterStatus = "available" | "planned";

export interface DatabaseCapabilities {
  family: DatabaseFamily;
  /** SQL-style `executeQuery` supported. */
  sql: boolean;
  /** Document CRUD (`find`/`insert`/`update`/`delete`) supported. */
  documents: boolean;
  /** ACID-style transactions supported. */
  transactions: boolean;
  /** Secondary index creation supported. */
  indexes: boolean;
  /** Vector upsert / similarity search supported. */
  vectorSearch: boolean;
}

/**
 * A saved connection profile. Credentials are encrypted at rest — the
 * `password` field here is the DECRYPTED value used only in memory. The
 * on-disk representation stores `passwordEnc` instead (see profiles.ts).
 */
export interface ConnectionProfile {
  id: string;
  name: string;
  type: SupportedDatabase;
  host?: string;
  port?: number;
  username?: string;
  /** Decrypted password (in memory only). */
  password?: string;
  database?: string;
  ssl?: boolean;
  authMethod?: string;
  /** Free-form driver options (e.g. connection string, api key). */
  options?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Public view of a profile — never leaks the password. */
export type PublicConnectionProfile = Omit<ConnectionProfile, "password"> & {
  hasPassword: boolean;
};

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  /** Column names when the driver exposes them. */
  fields?: string[];
  /** Raw driver payload for debugging / advanced callers. */
  raw?: unknown;
}

export interface FindOptions {
  filter?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  sort?: Record<string, 1 | -1>;
  projection?: Record<string, 0 | 1>;
}

export type QueryMode = "sql" | "document" | "vector";

export interface QueryPlan {
  mode: QueryMode;
  /** Table/collection/index name for document or vector modes. */
  target?: string;
  /** Raw SQL string for relational engines (mode === "sql"). */
  sql?: string;
  /** Positional parameters for raw SQL. */
  params?: unknown[];
  /** Document filter (mode === "document"). */
  filter?: Record<string, unknown>;
  /** Document field projection (mode === "document"). */
  projection?: Record<string, 0 | 1>;
  limit?: number;
  offset?: number;
  sort?: Record<string, 1 | -1>;
  /** Query vector for similarity search (mode === "vector"). */
  vector?: number[];
  /** Field containing embeddings for vector search (mode === "vector"). */
  vectorField?: string;
  /** Number of nearest neighbors for vector search (mode === "vector"). */
  topK?: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  serverInfo?: Record<string, unknown>;
}

/** A discovered table (SQL) or collection (document/vector). */
export interface SchemaObject {
  name: string;
  type: "table" | "view" | "collection" | "index";
  columns?: { name: string; dataType: string; nullable?: boolean }[];
  rowCount?: number;
}

export interface SchemaSnapshot {
  database?: string;
  objects: SchemaObject[];
  discoveredAt: string;
}

/**
 * The single interface every database adapter implements. Methods that a given
 * engine cannot support should throw {@link NotSupportedError} so callers can
 * degrade gracefully rather than crash.
 */
export interface DatabaseAdapter {
  readonly type: SupportedDatabase;
  readonly capabilities: DatabaseCapabilities;

  /** Whether a live connection is currently held. */
  isConnected(): boolean;

  /** Open a connection / pool. Idempotent. */
  connect(): Promise<void>;

  /** Close the connection / pool safely. Idempotent. */
  disconnect(): Promise<void>;

  /** Lightweight round-trip used by the "Test connection" button. */
  test(): Promise<ConnectionTestResult>;

  /** Discover schemas / collections / indexes for the Schema Explorer. */
  discoverSchema(): Promise<SchemaSnapshot>;

  // --- Unified query ------------------------------------------------------
  /**
   * Dispatch a {@link QueryPlan} to the engine-native implementation.
   * This is the single entry point higher-level features should use.
   */
  query<T = Record<string, unknown>>(plan: QueryPlan): Promise<QueryResult<T>>;

  // --- SQL-style ---------------------------------------------------------
  executeQuery<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;

  // --- Document / generic CRUD ------------------------------------------
  find<T = Record<string, unknown>>(target: string, options?: FindOptions): Promise<T[]>;
  insert<T = Record<string, unknown>>(target: string, doc: T | T[]): Promise<number>;
  update(target: string, filter: Record<string, unknown>, changes: Record<string, unknown>): Promise<number>;
  delete(target: string, filter: Record<string, unknown>): Promise<number>;

  // --- DDL ---------------------------------------------------------------
  createTable?(name: string, columns: { name: string; dataType: string }[]): Promise<void>;
  createCollection?(name: string): Promise<void>;
  createIndex?(target: string, fields: string[], options?: Record<string, unknown>): Promise<void>;

  // --- Transactions ------------------------------------------------------
  beginTransaction?(): Promise<void>;
  commit?(): Promise<void>;
  rollback?(): Promise<void>;
}

/** Factory signature registered in the adapter registry. */
export type AdapterFactory = (profile: ConnectionProfile) => DatabaseAdapter;

export class NotSupportedError extends Error {
  constructor(type: SupportedDatabase, op: string) {
    super(`Operation "${op}" is not supported by the ${type} adapter.`);
    this.name = "NotSupportedError";
  }
}

export class AdapterNotConnectedError extends Error {
  constructor(type: SupportedDatabase) {
    super(`The ${type} adapter is not connected. Call connect() first.`);
    this.name = "AdapterNotConnectedError";
  }
}
