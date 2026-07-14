/**
 * DatabaseManager — the unified entry point every module must use instead of
 * talking to a database driver directly.
 *
 * Responsibilities:
 *   - maintain a pool of live adapters keyed by profile id
 *   - one active connection at a time, switchable in one call
 *   - safe close / connect / reconnect with retry + backoff
 *   - test arbitrary connection profiles
 *   - expose a single, engine-agnostic surface (executeQuery/find/insert/...)
 */
import { getDescriptor, isAvailable } from "./registry.js";
import {
  getProfile,
  getActiveProfileId,
  setActiveProfileId,
} from "./profiles.js";
import type {
  ConnectionProfile,
  ConnectionTestResult,
  DatabaseAdapter,
  FindOptions,
  QueryResult,
  SchemaSnapshot,
  SupportedDatabase,
} from "./types.js";

export interface ManagerStatus {
  activeProfileId: string | null;
  activeType: SupportedDatabase | null;
  connected: boolean;
  pooledProfiles: string[];
}

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 200;
const MAX_POOL_SIZE = 8;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DatabaseManager {
  /** profileId -> live adapter (the connection pool). */
  private pool = new Map<string, DatabaseAdapter>();
  private activeId: string | null = null;

  /** Build (but do not connect) an adapter for a profile. */
  private buildAdapter(profile: ConnectionProfile): DatabaseAdapter {
    const descriptor = getDescriptor(profile.type);
    if (!descriptor) {
      throw new Error(`Unknown database type "${profile.type}".`);
    }
    if (!descriptor.factory || descriptor.status !== "available") {
      throw new Error(
        `The "${descriptor.label}" adapter is registered but not yet implemented in this build.`
      );
    }
    return descriptor.factory(profile);
  }

  /** Retry an async op with exponential backoff. */
  private async withRetry<T>(op: () => Promise<T>, label: string): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await op();
      } catch (err) {
        lastErr = err;
        if (attempt < RETRY_ATTEMPTS) {
          await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`${label} failed after ${RETRY_ATTEMPTS} attempts: ${msg}`);
  }

  /** Evict the oldest idle (non-active) adapter if the pool is full. */
  private async evictIfNeeded(): Promise<void> {
    if (this.pool.size < MAX_POOL_SIZE) return;
    for (const [id, adapter] of this.pool) {
      if (id !== this.activeId) {
        await adapter.disconnect().catch(() => undefined);
        this.pool.delete(id);
        return;
      }
    }
  }

  /** Connect a profile and add it to the pool (idempotent). */
  async connect(profileId: string): Promise<DatabaseAdapter> {
    const existing = this.pool.get(profileId);
    if (existing?.isConnected()) return existing;

    const profile = getProfile(profileId);
    if (!profile) throw new Error(`Connection profile "${profileId}" not found.`);

    await this.evictIfNeeded();
    const adapter = existing ?? this.buildAdapter(profile);
    await this.withRetry(() => adapter.connect(), `Connecting to ${profile.type}`);
    this.pool.set(profileId, adapter);
    return adapter;
  }

  /** Disconnect and remove a single pooled connection. */
  async disconnect(profileId: string): Promise<void> {
    const adapter = this.pool.get(profileId);
    if (!adapter) return;
    await adapter.disconnect().catch(() => undefined);
    this.pool.delete(profileId);
    if (this.activeId === profileId) this.activeId = null;
  }

  /** Disconnect everything (graceful shutdown). */
  async disconnectAll(): Promise<void> {
    await Promise.all([...this.pool.values()].map((a) => a.disconnect().catch(() => undefined)));
    this.pool.clear();
    this.activeId = null;
  }

  /**
   * One-click switch: safely close the previous active connection, connect the
   * target, and mark it active. The previous connection is closed (per spec)
   * rather than left pooled to free driver resources.
   */
  async switchTo(profileId: string): Promise<DatabaseAdapter> {
    const previous = this.activeId;
    const adapter = await this.connect(profileId);
    this.activeId = profileId;
    setActiveProfileId(profileId);
    if (previous && previous !== profileId) {
      await this.disconnect(previous);
    }
    return adapter;
  }

  /** Restore the last active profile on startup, if any and available. */
  async restoreActive(): Promise<void> {
    const saved = getActiveProfileId();
    if (!saved) return;
    const profile = getProfile(saved);
    if (!profile || !isAvailable(profile.type)) return;
    try {
      await this.switchTo(saved);
    } catch {
      /* leave inactive; user can reconnect from the UI */
    }
  }

  /** The active adapter, auto-reconnecting if the connection dropped. */
  async active(): Promise<DatabaseAdapter> {
    if (!this.activeId) throw new Error("No active database. Select a connection first.");
    const adapter = this.pool.get(this.activeId);
    if (!adapter) return this.connect(this.activeId);
    if (!adapter.isConnected()) {
      await this.withRetry(() => adapter.connect(), "Reconnecting");
    }
    return adapter;
  }

  getStatus(): ManagerStatus {
    const adapter = this.activeId ? this.pool.get(this.activeId) : undefined;
    return {
      activeProfileId: this.activeId,
      activeType: adapter?.type ?? (this.activeId ? getProfile(this.activeId)?.type ?? null : null),
      connected: Boolean(adapter?.isConnected()),
      pooledProfiles: [...this.pool.keys()],
    };
  }

  /** Test an arbitrary profile without keeping it pooled. */
  async testProfile(profile: ConnectionProfile): Promise<ConnectionTestResult> {
    if (!isAvailable(profile.type)) {
      return {
        ok: false,
        latencyMs: 0,
        message: `The ${profile.type} adapter is not yet implemented in this build.`,
      };
    }
    const adapter = this.buildAdapter(profile);
    try {
      await adapter.connect();
      return await adapter.test();
    } catch (err) {
      return {
        ok: false,
        latencyMs: 0,
        message: err instanceof Error ? err.message : "Connection failed.",
      };
    } finally {
      await adapter.disconnect().catch(() => undefined);
    }
  }

  // --- Engine-agnostic passthrough (used by cleaning/analytics/AI) --------
  async executeQuery<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    return (await this.active()).executeQuery<T>(sql, params);
  }
  async find<T = Record<string, unknown>>(target: string, options?: FindOptions): Promise<T[]> {
    return (await this.active()).find<T>(target, options);
  }
  async insert<T = Record<string, unknown>>(target: string, doc: T | T[]): Promise<number> {
    return (await this.active()).insert<T>(target, doc);
  }
  async update(target: string, filter: Record<string, unknown>, changes: Record<string, unknown>): Promise<number> {
    return (await this.active()).update(target, filter, changes);
  }
  async delete(target: string, filter: Record<string, unknown>): Promise<number> {
    return (await this.active()).delete(target, filter);
  }
  async discoverSchema(): Promise<SchemaSnapshot> {
    return (await this.active()).discoverSchema();
  }
}

/** Process-wide singleton. */
export const databaseManager = new DatabaseManager();
