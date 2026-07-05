import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { MongoClient } from "mongodb";
import pg from "pg";

import { config } from "../config.js";
import type { DatabaseType } from "./index.js";

const { Pool } = pg;

export interface DatasetMeta {
  id: string;
  name: string;
  filename: string;
  rows: number;
  columns: number;
  created_at: string;
  updated_at: string;
  owner?: string | null;
  engine?: string | null;
}

export interface DatasetRepository {
  init(): Promise<void>;
  saveMeta(meta: DatasetMeta): Promise<DatasetMeta>;
  listMeta(): Promise<DatasetMeta[]>;
  deleteMeta(id: string): Promise<void>;
}

// ------------------------------------------------------------------ JSON
class JsonDatasetRepository implements DatasetRepository {
  private filePath: string;
  private items = new Map<string, DatasetMeta>();

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "datasets_meta.json");
  }

  async init(): Promise<void> {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as DatasetMeta[];
        raw.forEach((m) => this.items.set(m.id, m));
      } catch {
        /* ignore malformed file */
      }
    }
  }

  private persist() {
    fs.writeFileSync(this.filePath, JSON.stringify([...this.items.values()], null, 2));
  }

  async saveMeta(meta: DatasetMeta): Promise<DatasetMeta> {
    this.items.set(meta.id, meta);
    this.persist();
    return meta;
  }

  async listMeta(): Promise<DatasetMeta[]> {
    return [...this.items.values()].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at)
    );
  }

  async deleteMeta(id: string): Promise<void> {
    this.items.delete(id);
    this.persist();
  }
}

// ---------------------------------------------------------------- SQLite
class SqliteDatasetRepository implements DatasetRepository {
  private db: BetterSqlite3.Database;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new BetterSqlite3(path.join(dataDir, "users.sqlite"));
  }

  async init(): Promise<void> {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS datasets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        filename TEXT NOT NULL,
        rows INTEGER NOT NULL,
        columns INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        owner TEXT,
        engine TEXT
      )`
    );
  }

  async saveMeta(meta: DatasetMeta): Promise<DatasetMeta> {
    this.db
      .prepare(
        `INSERT INTO datasets (id, name, filename, rows, columns, created_at, updated_at, owner, engine)
         VALUES (@id, @name, @filename, @rows, @columns, @created_at, @updated_at, @owner, @engine)
         ON CONFLICT(id) DO UPDATE SET
           name=@name, filename=@filename, rows=@rows, columns=@columns,
           updated_at=@updated_at, owner=@owner, engine=@engine`
      )
      .run({
        ...meta,
        owner: meta.owner ?? null,
        engine: meta.engine ?? null,
      });
    return meta;
  }

  async listMeta(): Promise<DatasetMeta[]> {
    return this.db
      .prepare("SELECT * FROM datasets ORDER BY updated_at DESC")
      .all() as DatasetMeta[];
  }

  async deleteMeta(id: string): Promise<void> {
    this.db.prepare("DELETE FROM datasets WHERE id = ?").run(id);
  }
}

// -------------------------------------------------------------- Postgres
class PostgresDatasetRepository implements DatasetRepository {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const isLocal =
      connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
    this.pool = new Pool({
      connectionString,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    });
  }

  async init(): Promise<void> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS datasets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        filename TEXT NOT NULL,
        rows INTEGER NOT NULL,
        columns INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        owner TEXT,
        engine TEXT
      )`
    );
  }

  async saveMeta(meta: DatasetMeta): Promise<DatasetMeta> {
    await this.pool.query(
      `INSERT INTO datasets (id, name, filename, rows, columns, created_at, updated_at, owner, engine)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         name=$2, filename=$3, rows=$4, columns=$5, updated_at=$7, owner=$8, engine=$9`,
      [
        meta.id,
        meta.name,
        meta.filename,
        meta.rows,
        meta.columns,
        meta.created_at,
        meta.updated_at,
        meta.owner ?? null,
        meta.engine ?? null,
      ]
    );
    return meta;
  }

  async listMeta(): Promise<DatasetMeta[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM datasets ORDER BY updated_at DESC"
    );
    return rows as DatasetMeta[];
  }

  async deleteMeta(id: string): Promise<void> {
    await this.pool.query("DELETE FROM datasets WHERE id = $1", [id]);
  }
}

// --------------------------------------------------------------- MongoDB
class MongoDatasetRepository implements DatasetRepository {
  private client: MongoClient;
  private dbName = "dataforge";

  constructor(connectionString: string) {
    this.client = new MongoClient(connectionString, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
  }

  private collection() {
    return this.client.db(this.dbName).collection<DatasetMeta>("datasets");
  }

  async init(): Promise<void> {
    await this.client.connect();
    await this.collection().createIndex({ id: 1 }, { unique: true });
  }

  async saveMeta(meta: DatasetMeta): Promise<DatasetMeta> {
    await this.collection().updateOne(
      { id: meta.id },
      { $set: meta },
      { upsert: true }
    );
    return meta;
  }

  async listMeta(): Promise<DatasetMeta[]> {
    const items = await this.collection()
      .find({}, { projection: { _id: 0 } })
      .sort({ updated_at: -1 })
      .toArray();
    return items as DatasetMeta[];
  }

  async deleteMeta(id: string): Promise<void> {
    await this.collection().deleteOne({ id });
  }
}

// --------------------------------------------------------------- factory
export function createDatasetRepository(
  type: DatabaseType = config.databaseType,
  url: string = config.databaseUrl
): DatasetRepository {
  switch (type) {
    case "sqlite":
      return new SqliteDatasetRepository(url || config.dataDir);
    case "postgres":
      return new PostgresDatasetRepository(url);
    case "mongodb":
      return new MongoDatasetRepository(url);
    case "json":
    default:
      return new JsonDatasetRepository(config.dataDir);
  }
}
