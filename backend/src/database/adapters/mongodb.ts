/**
 * MongoDB adapter. Document CRUD + schema discovery via collection sampling.
 * `executeQuery` is not applicable (throws NotSupportedError) — callers should
 * check `capabilities.sql` first, or use find/insert/update/delete.
 */
import { MongoClient, type Db } from "mongodb";

import { registerFactory } from "../core/registry.js";
import {
  AdapterNotConnectedError,
  NotSupportedError,
  type ConnectionProfile,
  type ConnectionTestResult,
  type DatabaseAdapter,
  type DatabaseCapabilities,
  type FindOptions,
  type QueryResult,
  type SchemaObject,
  type SchemaSnapshot,
} from "../core/types.js";

const CAPS: DatabaseCapabilities = {
  family: "document",
  sql: false,
  documents: true,
  transactions: true,
  indexes: true,
  vectorSearch: false,
};

export class MongoAdapter implements DatabaseAdapter {
  readonly type = "mongodb" as const;
  readonly capabilities = CAPS;
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(private profile: ConnectionProfile) {}

  private uri(): string {
    const fromOptions = this.profile.options?.connectionString as string | undefined;
    if (fromOptions) return fromOptions;
    const auth =
      this.profile.username && this.profile.password
        ? `${encodeURIComponent(this.profile.username)}:${encodeURIComponent(this.profile.password)}@`
        : "";
    const host = this.profile.host ?? "localhost";
    const port = this.profile.port ?? 27017;
    return `mongodb://${auth}${host}:${port}`;
  }

  isConnected(): boolean {
    return this.db !== null;
  }

  async connect(): Promise<void> {
    if (this.db) return;
    this.client = new MongoClient(this.uri(), {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
    await this.client.connect();
    this.db = this.client.db(this.profile.database || "dataforge");
  }

  async disconnect(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.db = null;
  }

  private require(): Db {
    if (!this.db) throw new AdapterNotConnectedError(this.type);
    return this.db;
  }

  async test(): Promise<ConnectionTestResult> {
    const start = Date.now();
    const info = await this.require().command({ ping: 1 });
    return {
      ok: info.ok === 1,
      latencyMs: Date.now() - start,
      message: "Connected to MongoDB.",
      serverInfo: { db: this.profile.database || "dataforge" },
    };
  }

  async executeQuery<T = Record<string, unknown>>(): Promise<QueryResult<T>> {
    throw new NotSupportedError(this.type, "executeQuery (use find/insert/update/delete)");
  }

  async find<T = Record<string, unknown>>(target: string, options: FindOptions = {}): Promise<T[]> {
    const cursor = this.require()
      .collection(target)
      .find(options.filter ?? {}, { projection: options.projection });
    if (options.sort) cursor.sort(options.sort);
    if (options.offset) cursor.skip(options.offset);
    if (options.limit) cursor.limit(options.limit);
    return (await cursor.toArray()) as T[];
  }

  async insert<T = Record<string, unknown>>(target: string, doc: T | T[]): Promise<number> {
    const coll = this.require().collection(target);
    if (Array.isArray(doc)) {
      if (doc.length === 0) return 0;
      const res = await coll.insertMany(doc as Record<string, unknown>[]);
      return res.insertedCount;
    }
    await coll.insertOne(doc as Record<string, unknown>);
    return 1;
  }

  async update(
    target: string,
    filter: Record<string, unknown>,
    changes: Record<string, unknown>
  ): Promise<number> {
    const res = await this.require().collection(target).updateMany(filter, { $set: changes });
    return res.modifiedCount;
  }

  async delete(target: string, filter: Record<string, unknown>): Promise<number> {
    const res = await this.require().collection(target).deleteMany(filter);
    return res.deletedCount;
  }

  async createCollection(name: string): Promise<void> {
    await this.require().createCollection(name);
  }

  async createIndex(target: string, fields: string[], options: Record<string, unknown> = {}): Promise<void> {
    const spec: Record<string, 1> = {};
    for (const f of fields) spec[f] = 1;
    await this.require().collection(target).createIndex(spec, options);
  }

  async discoverSchema(): Promise<SchemaSnapshot> {
    const db = this.require();
    const collections = await db.listCollections().toArray();
    const objects: SchemaObject[] = [];
    for (const c of collections) {
      const coll = db.collection(c.name);
      const sample = await coll.findOne({});
      const count = await coll.estimatedDocumentCount();
      objects.push({
        name: c.name,
        type: "collection",
        rowCount: count,
        columns: sample
          ? Object.keys(sample).map((k) => ({ name: k, dataType: typeof (sample as Record<string, unknown>)[k] }))
          : [],
      });
    }
    return { database: this.profile.database, objects, discoveredAt: new Date().toISOString() };
  }
}

registerFactory("mongodb", (profile) => new MongoAdapter(profile));
