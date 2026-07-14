/**
 * ChromaDB adapter for vector storage and similarity search.
 * Accepts either a full URL (profile.options.connectionString) or host/port.
 */
import { randomUUID } from "node:crypto";

import { ChromaClient, IncludeEnum, type Collection, type Metadata } from "chromadb";

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

// Lightweight mirrors of Chroma response shapes so we don't rely on package internals.
type ChromaIds = string[];
interface GetResponse {
  ids: ChromaIds;
  embeddings?: (number[] | null)[] | null;
  documents?: (string | null)[] | null;
  metadatas?: (Metadata | null)[] | null;
}
interface MultiQueryResponse {
  ids: string[][];
  embeddings?: (number[][] | null)[] | null;
  documents?: (string[] | null)[] | null;
  metadatas?: (Metadata[] | null)[] | null;
  distances?: (number[] | null)[] | null;
}

const CAPS: DatabaseCapabilities = {
  family: "vector",
  sql: false,
  documents: true,
  transactions: false,
  indexes: false,
  vectorSearch: true,
};

export class ChromaAdapter implements DatabaseAdapter {
  readonly type = "chromadb" as const;
  readonly capabilities = CAPS;
  private client: ChromaClient | null = null;

  constructor(private profile: ConnectionProfile) {}

  private baseUrl(): string {
    const connectionString = this.profile.options?.connectionString as string | undefined;
    if (connectionString) return connectionString;
    const host = this.profile.host || "localhost";
    const port = this.profile.port ?? 8000;
    return `http://${host}:${port}`;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  private createChromaClient(path: string): ChromaClient {
    return new ChromaClient({ path });
  }

  async connect(): Promise<void> {
    if (this.client) return;
    this.client = this.createChromaClient(this.baseUrl());
    await this.client.heartbeat();
  }

  async disconnect(): Promise<void> {
    this.client = null;
  }

  private require(): ChromaClient {
    if (!this.client) throw new AdapterNotConnectedError(this.type);
    return this.client;
  }

  async test(): Promise<ConnectionTestResult> {
    const start = Date.now();
    const hb = await this.require().heartbeat();
    return {
      ok: true,
      latencyMs: Date.now() - start,
      message: "Connected to ChromaDB.",
      serverInfo: { heartbeat: hb },
    };
  }

  async discoverSchema(): Promise<SchemaSnapshot> {
    const collections = (await this.require().listCollections()) as unknown[];
    const objects: SchemaObject[] = collections.map((c) => ({
      name: typeof c === "string" ? c : (c as { name?: string }).name ?? "unknown",
      type: "collection",
    }));
    return { objects, discoveredAt: new Date().toISOString() };
  }

  async executeQuery<T = Record<string, unknown>>(_sql: string, _params?: unknown[]): Promise<QueryResult<T>> {
    throw new NotSupportedError(this.type, "executeQuery (use query/insert/update/delete)");
  }

  private async getCollection(name: string): Promise<Collection> {
    return this.require().getOrCreateCollection({ name });
  }

  async find<T = Record<string, unknown>>(target: string, options: FindOptions = {}): Promise<T[]> {
    const coll = await this.getCollection(target);
    const result = (await coll.get({
      where: options.filter as Record<string, unknown>,
      limit: options.limit ?? 100,
      offset: options.offset,
      include: [IncludeEnum.Metadatas, IncludeEnum.Documents],
    })) as unknown as GetResponse;
    return this.chromaRows<T>(result);
  }

  async insert<T = Record<string, unknown>>(target: string, doc: T | T[]): Promise<number> {
    const docs = Array.isArray(doc) ? doc : [doc];
    if (docs.length === 0) return 0;
    const coll = await this.getCollection(target);
    const ids = docs.map((d) => (d as { id?: string }).id ?? randomUUID());
    const embeddings = docs.map((d) => (d as { embedding?: number[] }).embedding).filter((e): e is number[] => Array.isArray(e));
    const metadatas = docs.map((d) => this.toMetadata(this.withoutReservedKeys(d as Record<string, unknown>)));
    const documents = docs.map((d) => (d as { document?: string }).document ?? JSON.stringify(d));
    await coll.add({
      ids,
      embeddings: embeddings.length ? embeddings : undefined,
      metadatas,
      documents,
    });
    return docs.length;
  }

  async update(target: string, filter: Record<string, unknown>, changes: Record<string, unknown>): Promise<number> {
    const coll = await this.getCollection(target);
    const result = (await coll.get({
      where: filter,
      include: [IncludeEnum.Metadatas, IncludeEnum.Embeddings, IncludeEnum.Documents],
    })) as unknown as GetResponse;
    const ids = result.ids;
    if (!ids.length) return 0;
    const metadatas = (result.metadatas ?? []).map((m: Metadata | null) => this.toMetadata({ ...(m ?? {}), ...changes }));
    const embeddings = (result.embeddings ?? []).filter((e: number[] | null): e is number[] => e !== null);
    const documents = (result.documents ?? []).map((d: string | null) => d ?? "").filter((d: string): d is string => Boolean(d));
    await coll.update({
      ids,
      embeddings: embeddings.length ? embeddings : undefined,
      metadatas,
      documents: documents.length ? documents : undefined,
    });
    return ids.length;
  }

  async delete(target: string, filter: Record<string, unknown>): Promise<number> {
    const coll = await this.getCollection(target);
    const result = (await coll.get({ where: filter, include: [] })) as unknown as GetResponse;
    const ids = result.ids;
    if (!ids.length) return 0;
    await coll.delete({ ids });
    return ids.length;
  }

  async createCollection(name: string): Promise<void> {
    await this.require().getOrCreateCollection({ name });
  }

  async createIndex?(_target: string, _fields: string[]): Promise<void> {
    // Chroma manages indexes automatically.
    return;
  }

  async query<T = Record<string, unknown>>(plan: QueryPlan): Promise<QueryResult<T>> {
    if (plan.mode === "vector") {
      if (!plan.target) throw new Error("Vector query plan is missing 'target' field.");
      if (!plan.vector?.length) throw new Error("Vector query plan is missing 'vector' field.");
      const coll = await this.getCollection(plan.target);
      const result = (await coll.query({
        queryEmbeddings: [plan.vector],
        nResults: plan.topK ?? 5,
        where: plan.filter as Record<string, unknown> | undefined,
        include: [IncludeEnum.Metadatas, IncludeEnum.Documents, IncludeEnum.Distances],
      })) as unknown as MultiQueryResponse;
      const rows = this.chromaRows<T>(result).map((row, i) => ({
        ...row,
        distance: result.distances?.[0]?.[i],
      }));
      return { rows, rowCount: rows.length, fields: rows[0] ? Object.keys(rows[0]) : [] };
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
    throw new NotSupportedError(this.type, "sql query");
  }

  private chromaRows<T>(result: GetResponse | MultiQueryResponse): T[] {
    // MultiQueryResponse wraps each field in an extra array per query.
    const isMulti = Array.isArray(result.ids?.[0]);
    const ids = isMulti ? (result as MultiQueryResponse).ids[0] : (result as GetResponse).ids;
    const metadatas = isMulti ? (result as MultiQueryResponse).metadatas?.[0] : (result as GetResponse).metadatas;
    const documents = isMulti ? (result as MultiQueryResponse).documents?.[0] : (result as GetResponse).documents;
    return ids.map((id: string, i: number) => {
      const meta = metadatas?.[i] ?? {};
      const doc = documents?.[i];
      return {
        id,
        ...meta,
        ...(doc ? { document: doc } : {}),
      } as T;
    });
  }

  private toMetadata(record: Record<string, unknown>): Metadata {
    const out: Metadata = {};
    for (const [k, v] of Object.entries(record)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        out[k] = v;
      } else {
        out[k] = JSON.stringify(v);
      }
    }
    return out;
  }

  private withoutReservedKeys(record: Record<string, unknown>): Record<string, unknown> {
    const { id, embedding, document, ...rest } = record;
    void id;
    void embedding;
    void document;
    return rest;
  }
}

registerFactory("chromadb", (profile) => new ChromaAdapter(profile));
