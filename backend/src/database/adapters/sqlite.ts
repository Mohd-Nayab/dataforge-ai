/**
 * SQLite adapter (better-sqlite3). File-based or in-memory.
 * `profile.database` is the file path; empty / ":memory:" uses an in-memory DB.
 */
import path from "node:path";
import fs from "node:fs";

import BetterSqlite3 from "better-sqlite3";

import { config } from "../../config.js";
import { registerFactory } from "../core/registry.js";
import {
  AdapterNotConnectedError,
  NotSupportedError,
  type ConnectionProfile,
  type ConnectionTestResult,
  type DatabaseAdapter,
  type DatabaseCapabilities,
  type FindOptions,
  type QueryPlan,
  type QueryResult,
  type SchemaObject,
  type SchemaSnapshot,
} from "../core/types.js";

const CAPS: DatabaseCapabilities = {
  family: "relational",
  sql: true,
  documents: true,
  transactions: true,
  indexes: true,
  vectorSearch: false,
};

function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return `"${name}"`;
}

export class SqliteAdapter implements DatabaseAdapter {
  readonly type = "sqlite" as const;
  readonly capabilities = CAPS;
  private db: BetterSqlite3.Database | null = null;

  constructor(private profile: ConnectionProfile) {}

  private resolvePath(): string {
    const target = this.profile.database?.trim();
    if (!target || target === ":memory:") return ":memory:";
    return path.isAbsolute(target) ? target : path.join(config.dataDir, target);
  }

  isConnected(): boolean {
    return Boolean(this.db && this.db.open);
  }

  async connect(): Promise<void> {
    if (this.isConnected()) return;
    const file = this.resolvePath();
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new BetterSqlite3(file);
    this.db.pragma("journal_mode = WAL");
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private require(): BetterSqlite3.Database {
    if (!this.db) throw new AdapterNotConnectedError(this.type);
    return this.db;
  }

  async test(): Promise<ConnectionTestResult> {
    const start = Date.now();
    const row = this.require().prepare("SELECT sqlite_version() AS version").get() as {
      version: string;
    };
    return {
      ok: true,
      latencyMs: Date.now() - start,
      message: "Connected to SQLite.",
      serverInfo: { version: row.version, file: this.resolvePath() },
    };
  }

  async executeQuery<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    const db = this.require();
    const stmt = db.prepare(sql);
    const isSelect = /^\s*(select|pragma|with)\b/i.test(sql);
    if (isSelect) {
      const rows = stmt.all(...params) as T[];
      return { rows, rowCount: rows.length, fields: rows[0] ? Object.keys(rows[0]) : [] };
    }
    const info = stmt.run(...params);
    return { rows: [], rowCount: info.changes, raw: info };
  }

  async query<T = Record<string, unknown>>(plan: QueryPlan): Promise<QueryResult<T>> {
    if (plan.mode === "sql") {
      if (!plan.sql) throw new Error("SQL query plan is missing 'sql' field.");
      return this.executeQuery<T>(plan.sql, plan.params ?? []);
    }
    if (plan.mode === "document") {
      if (!plan.target) throw new Error("Document query plan is missing 'target' field.");
      const rows = await this.find<T>(plan.target, {
        filter: plan.filter,
        limit: plan.limit,
        offset: plan.offset,
        sort: plan.sort,
        projection: plan.projection,
      });
      return { rows, rowCount: rows.length, fields: rows[0] ? Object.keys(rows[0]) : [] };
    }
    throw new NotSupportedError(this.type, "query");
  }

  async find<T = Record<string, unknown>>(target: string, options: FindOptions = {}): Promise<T[]> {
    const { filter = {}, limit, offset, sort } = options;
    const where = Object.keys(filter);
    const clause = where.length ? ` WHERE ${where.map((k) => `${ident(k)} = ?`).join(" AND ")}` : "";
    const order = sort
      ? ` ORDER BY ${Object.entries(sort).map(([k, d]) => `${ident(k)} ${d === -1 ? "DESC" : "ASC"}`).join(", ")}`
      : "";
    const lim = limit != null ? ` LIMIT ${Number(limit)}` : "";
    const off = offset != null ? ` OFFSET ${Number(offset)}` : "";
    const sql = `SELECT * FROM ${ident(target)}${clause}${order}${lim}${off}`;
    return (await this.executeQuery<T>(sql, Object.values(filter))).rows;
  }

  async insert<T = Record<string, unknown>>(target: string, doc: T | T[]): Promise<number> {
    const docs = Array.isArray(doc) ? doc : [doc];
    if (docs.length === 0) return 0;
    const cols = Object.keys(docs[0] as Record<string, unknown>);
    const placeholders = `(${cols.map(() => "?").join(", ")})`;
    const sql = `INSERT INTO ${ident(target)} (${cols.map(ident).join(", ")}) VALUES ${placeholders}`;
    const stmt = this.require().prepare(sql);
    const tx = this.require().transaction((rows: Record<string, unknown>[]) => {
      for (const row of rows) stmt.run(...cols.map((c) => row[c]));
    });
    tx(docs as Record<string, unknown>[]);
    return docs.length;
  }

  async update(
    target: string,
    filter: Record<string, unknown>,
    changes: Record<string, unknown>
  ): Promise<number> {
    const setCols = Object.keys(changes);
    const whereCols = Object.keys(filter);
    const setClause = setCols.map((c) => `${ident(c)} = ?`).join(", ");
    const whereClause = whereCols.length
      ? ` WHERE ${whereCols.map((c) => `${ident(c)} = ?`).join(" AND ")}`
      : "";
    const sql = `UPDATE ${ident(target)} SET ${setClause}${whereClause}`;
    const info = this.require().prepare(sql).run(...Object.values(changes), ...Object.values(filter));
    return info.changes;
  }

  async delete(target: string, filter: Record<string, unknown>): Promise<number> {
    const whereCols = Object.keys(filter);
    const whereClause = whereCols.length
      ? ` WHERE ${whereCols.map((c) => `${ident(c)} = ?`).join(" AND ")}`
      : "";
    const info = this.require().prepare(`DELETE FROM ${ident(target)}${whereClause}`).run(
      ...Object.values(filter)
    );
    return info.changes;
  }

  async createTable(name: string, columns: { name: string; dataType: string }[]): Promise<void> {
    const cols = columns.map((c) => `${ident(c.name)} ${c.dataType}`).join(", ");
    this.require().exec(`CREATE TABLE IF NOT EXISTS ${ident(name)} (${cols})`);
  }

  async createIndex(target: string, fields: string[], options: Record<string, unknown> = {}): Promise<void> {
    const unique = options.unique ? "UNIQUE " : "";
    const idxName = `idx_${target}_${fields.join("_")}`;
    this.require().exec(
      `CREATE ${unique}INDEX IF NOT EXISTS ${ident(idxName)} ON ${ident(target)} (${fields.map(ident).join(", ")})`
    );
  }

  async beginTransaction(): Promise<void> {
    this.require().exec("BEGIN");
  }
  async commit(): Promise<void> {
    this.require().exec("COMMIT");
  }
  async rollback(): Promise<void> {
    this.require().exec("ROLLBACK");
  }

  async discoverSchema(): Promise<SchemaSnapshot> {
    const db = this.require();
    const items = db
      .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string; type: "table" | "view" }[];
    const objects: SchemaObject[] = items.map((it) => {
      const cols = db.prepare(`PRAGMA table_info(${ident(it.name)})`).all() as {
        name: string;
        type: string;
        notnull: number;
      }[];
      const count = (db.prepare(`SELECT COUNT(*) AS c FROM ${ident(it.name)}`).get() as { c: number }).c;
      return {
        name: it.name,
        type: it.type,
        rowCount: count,
        columns: cols.map((c) => ({ name: c.name, dataType: c.type || "TEXT", nullable: c.notnull === 0 })),
      };
    });
    return { database: this.resolvePath(), objects, discoveredAt: new Date().toISOString() };
  }
}

registerFactory("sqlite", (profile) => new SqliteAdapter(profile));
