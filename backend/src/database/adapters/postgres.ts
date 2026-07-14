/**
 * PostgreSQL adapter (node-postgres). Uses a pooled client.
 * Accepts either a full connection string (profile.options.connectionString)
 * or discrete host/port/user/password/database fields.
 */
import pg from "pg";

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

const { Pool } = pg;

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

export class PostgresAdapter implements DatabaseAdapter {
  readonly type = "postgres" as const;
  readonly capabilities = CAPS;
  private pool: pg.Pool | null = null;

  constructor(private profile: ConnectionProfile) {}

  private poolConfig(): pg.PoolConfig {
    const connectionString = this.profile.options?.connectionString as string | undefined;
    if (connectionString) {
      const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
      return { connectionString, ssl: isLocal || !this.profile.ssl ? undefined : { rejectUnauthorized: false } };
    }
    return {
      host: this.profile.host,
      port: this.profile.port ?? 5432,
      user: this.profile.username,
      password: this.profile.password,
      database: this.profile.database,
      ssl: this.profile.ssl ? { rejectUnauthorized: false } : undefined,
      max: 10,
    };
  }

  isConnected(): boolean {
    return this.pool !== null;
  }

  async connect(): Promise<void> {
    if (this.pool) return;
    this.pool = new Pool(this.poolConfig());
    // Validate eagerly so bad credentials fail fast.
    const client = await this.pool.connect();
    client.release();
  }

  async disconnect(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }

  private require(): pg.Pool {
    if (!this.pool) throw new AdapterNotConnectedError(this.type);
    return this.pool;
  }

  async test(): Promise<ConnectionTestResult> {
    const start = Date.now();
    const { rows } = await this.require().query("SELECT version() AS version");
    return {
      ok: true,
      latencyMs: Date.now() - start,
      message: "Connected to PostgreSQL.",
      serverInfo: { version: rows[0]?.version },
    };
  }

  async executeQuery<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    const res = await this.require().query(sql, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount ?? res.rows.length,
      fields: res.fields?.map((f) => f.name),
      raw: res,
    };
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
    const keys = Object.keys(filter);
    const where = keys.length
      ? ` WHERE ${keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(" AND ")}`
      : "";
    const order = sort
      ? ` ORDER BY ${Object.entries(sort).map(([k, d]) => `${ident(k)} ${d === -1 ? "DESC" : "ASC"}`).join(", ")}`
      : "";
    const lim = limit != null ? ` LIMIT ${Number(limit)}` : "";
    const off = offset != null ? ` OFFSET ${Number(offset)}` : "";
    const sql = `SELECT * FROM ${ident(target)}${where}${order}${lim}${off}`;
    return (await this.executeQuery<T>(sql, Object.values(filter))).rows;
  }

  async insert<T = Record<string, unknown>>(target: string, doc: T | T[]): Promise<number> {
    const docs = (Array.isArray(doc) ? doc : [doc]) as Record<string, unknown>[];
    if (docs.length === 0) return 0;
    const cols = Object.keys(docs[0]);
    let count = 0;
    for (const row of docs) {
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `INSERT INTO ${ident(target)} (${cols.map(ident).join(", ")}) VALUES (${placeholders})`;
      const res = await this.require().query(sql, cols.map((c) => row[c]));
      count += res.rowCount ?? 0;
    }
    return count;
  }

  async update(
    target: string,
    filter: Record<string, unknown>,
    changes: Record<string, unknown>
  ): Promise<number> {
    const setKeys = Object.keys(changes);
    const whereKeys = Object.keys(filter);
    const setClause = setKeys.map((k, i) => `${ident(k)} = $${i + 1}`).join(", ");
    const whereClause = whereKeys.length
      ? ` WHERE ${whereKeys.map((k, i) => `${ident(k)} = $${setKeys.length + i + 1}`).join(" AND ")}`
      : "";
    const sql = `UPDATE ${ident(target)} SET ${setClause}${whereClause}`;
    const res = await this.require().query(sql, [...Object.values(changes), ...Object.values(filter)]);
    return res.rowCount ?? 0;
  }

  async delete(target: string, filter: Record<string, unknown>): Promise<number> {
    const keys = Object.keys(filter);
    const whereClause = keys.length
      ? ` WHERE ${keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(" AND ")}`
      : "";
    const res = await this.require().query(`DELETE FROM ${ident(target)}${whereClause}`, Object.values(filter));
    return res.rowCount ?? 0;
  }

  async createTable(name: string, columns: { name: string; dataType: string }[]): Promise<void> {
    const cols = columns.map((c) => `${ident(c.name)} ${c.dataType}`).join(", ");
    await this.require().query(`CREATE TABLE IF NOT EXISTS ${ident(name)} (${cols})`);
  }

  async createIndex(target: string, fields: string[], options: Record<string, unknown> = {}): Promise<void> {
    const unique = options.unique ? "UNIQUE " : "";
    const idxName = `idx_${target}_${fields.join("_")}`;
    await this.require().query(
      `CREATE ${unique}INDEX IF NOT EXISTS ${ident(idxName)} ON ${ident(target)} (${fields.map(ident).join(", ")})`
    );
  }

  async discoverSchema(): Promise<SchemaSnapshot> {
    const tables = await this.require().query<{ table_name: string; table_type: string }>(
      `SELECT table_name, table_type FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`
    );
    const objects: SchemaObject[] = [];
    for (const t of tables.rows) {
      const cols = await this.require().query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
        [t.table_name]
      );
      objects.push({
        name: t.table_name,
        type: t.table_type === "VIEW" ? "view" : "table",
        columns: cols.rows.map((c) => ({
          name: c.column_name,
          dataType: c.data_type,
          nullable: c.is_nullable === "YES",
        })),
      });
    }
    return { database: this.profile.database, objects, discoveredAt: new Date().toISOString() };
  }
}

registerFactory("postgres", (profile) => new PostgresAdapter(profile));
