/**
 * MySQL / MariaDB adapter (mysql2/promise).
 * Uses a pooled client. Accepts either a full connection string
 * (profile.options.connectionString) or discrete host/port/user/password/database fields.
 */
import mysql from "mysql2/promise";

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
  documents: false,
  transactions: true,
  indexes: true,
  vectorSearch: false,
};

function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return mysql.escapeId(name);
}

export class MysqlAdapter implements DatabaseAdapter {
  readonly type = "mysql" as const;
  readonly capabilities = CAPS;
  private pool: mysql.Pool | null = null;

  constructor(private profile: ConnectionProfile) {}

  private createMySqlPool(config: mysql.PoolOptions): mysql.Pool {
    return mysql.createPool(config);
  }

  private poolConfig(): mysql.PoolOptions {
    const connectionString = this.profile.options?.connectionString as string | undefined;
    if (connectionString) {
      return {
        uri: connectionString,
        ssl: this.profile.ssl ? { rejectUnauthorized: false } : undefined,
        waitForConnections: true,
        connectionLimit: 10,
      };
    }
    return {
      host: this.profile.host,
      port: this.profile.port ?? 3306,
      user: this.profile.username,
      password: this.profile.password,
      database: this.profile.database,
      ssl: this.profile.ssl ? { rejectUnauthorized: false } : undefined,
      waitForConnections: true,
      connectionLimit: 10,
    };
  }

  isConnected(): boolean {
    return this.pool !== null;
  }

  async connect(): Promise<void> {
    if (this.pool) return;
    this.pool = this.createMySqlPool(this.poolConfig());
    const conn = await this.pool.getConnection();
    conn.release();
  }

  async disconnect(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }

  private require(): mysql.Pool {
    if (!this.pool) throw new AdapterNotConnectedError(this.type);
    return this.pool;
  }

  async test(): Promise<ConnectionTestResult> {
    const start = Date.now();
    const [rows] = await this.require().query<mysql.RowDataPacket[]>("SELECT VERSION() AS version");
    return {
      ok: true,
      latencyMs: Date.now() - start,
      message: "Connected to MySQL/MariaDB.",
      serverInfo: { version: (rows[0] as { version: string })?.version },
    };
  }

  async executeQuery<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    const [rows, fields] = await this.require().query<T[] & mysql.RowDataPacket[]>(sql, params);
    const fieldNames = Array.isArray(fields)
      ? fields.map((f) => (typeof f === "object" && f && "name" in f ? (f as mysql.FieldPacket).name : String(f)))
      : undefined;
    return {
      rows: (Array.isArray(rows) ? rows : []) as T[],
      rowCount: Array.isArray(rows) ? rows.length : 0,
      fields: fieldNames,
      raw: { rows, fields },
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
      ? ` WHERE ${keys.map((k) => `${ident(k)} = ?`).join(" AND ")}`
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
    const placeholders = cols.map(() => "?").join(", ");
    const sql = `INSERT INTO ${ident(target)} (${cols.map(ident).join(", ")}) VALUES (${placeholders})`;
    let count = 0;
    for (const row of docs) {
      const [res] = await this.require().query<mysql.ResultSetHeader>(sql, cols.map((c) => row[c]));
      count += res.affectedRows ?? 0;
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
    const setClause = setKeys.map((k) => `${ident(k)} = ?`).join(", ");
    const whereClause = whereKeys.length
      ? ` WHERE ${whereKeys.map((k) => `${ident(k)} = ?`).join(" AND ")}`
      : "";
    const sql = `UPDATE ${ident(target)} SET ${setClause}${whereClause}`;
    const [res] = await this.require().query<mysql.ResultSetHeader>(sql, [
      ...Object.values(changes),
      ...Object.values(filter),
    ]);
    return res.affectedRows ?? 0;
  }

  async delete(target: string, filter: Record<string, unknown>): Promise<number> {
    const keys = Object.keys(filter);
    const whereClause = keys.length
      ? ` WHERE ${keys.map((k) => `${ident(k)} = ?`).join(" AND ")}`
      : "";
    const [res] = await this.require().query<mysql.ResultSetHeader>(
      `DELETE FROM ${ident(target)}${whereClause}`,
      Object.values(filter)
    );
    return res.affectedRows ?? 0;
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
    const db = this.profile.database;
    if (!db) throw new Error("Profile database is required for schema discovery");
    const [rows] = await this.require().query<
      mysql.RowDataPacket[]
    >(
      `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name`,
      [db]
    );
    const objects: SchemaObject[] = [];
    for (const t of rows) {
      const [cols] = await this.require().query<
        mysql.RowDataPacket[]
      >(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
        [db, t.table_name]
      );
      objects.push({
        name: t.table_name as string,
        type: (t.table_type as string) === "VIEW" ? "view" : "table",
        columns: cols.map((c) => ({
          name: c.column_name as string,
          dataType: c.data_type as string,
          nullable: c.is_nullable === "YES",
        })),
      });
    }
    return { database: db, objects, discoveredAt: new Date().toISOString() };
  }
}

registerFactory("mysql", (profile) => new MysqlAdapter(profile));
// MariaDB is wire-compatible with the mysql2 client.
registerFactory("mariadb", (profile) => new MysqlAdapter(profile as ConnectionProfile));
