import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChromaAdapter } from "../chromadb.js";
import type { ConnectionProfile } from "../../core/types.js";

const baseProfile: ConnectionProfile = {
  id: "c1",
  name: "test-chroma",
  type: "chromadb",
  host: "localhost",
  port: 8000,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("ChromaDB adapter", () => {
  let client: any;
  let collection: any;
  let adapter: ChromaAdapter;

  beforeEach(() => {
    collection = {
      add: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(),
    };
    client = {
      heartbeat: vi.fn().mockResolvedValue({ nanosecond_heartbeat: 1 }),
      listCollections: vi.fn().mockResolvedValue([{ name: "docs" }]),
      getOrCreateCollection: vi.fn().mockResolvedValue(collection),
    };
    adapter = new ChromaAdapter(baseProfile);
  });

  it("connects and disconnects", async () => {
    const createSpy = vi.spyOn(adapter as any, "createChromaClient").mockReturnValue(client);
    await adapter.connect();
    expect(createSpy).toHaveBeenCalled();
    expect(adapter.isConnected()).toBe(true);
    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
    createSpy.mockRestore();
  });

  it("tests connection and reports latency", async () => {
    const createSpy = vi.spyOn(adapter as any, "createChromaClient").mockReturnValue(client);
    await adapter.connect();
    const res = await adapter.test();
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Connected to ChromaDB/);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    createSpy.mockRestore();
  });

  it("discovers collections", async () => {
    const createSpy = vi.spyOn(adapter as any, "createChromaClient").mockReturnValue(client);
    await adapter.connect();
    const schema = await adapter.discoverSchema();
    expect(schema.objects).toContainEqual({ name: "docs", type: "collection" });
    createSpy.mockRestore();
  });

  it("inserts documents with auto-generated ids", async () => {
    const createSpy = vi.spyOn(adapter as any, "createChromaClient").mockReturnValue(client);
    await adapter.connect();
    const count = await adapter.insert("docs", [
      { text: "hello", embedding: [1, 2, 3] },
      { text: "world", embedding: [4, 5, 6] },
    ]);
    expect(count).toBe(2);
    expect(collection.add).toHaveBeenCalled();
    const args = collection.add.mock.calls[0][0];
    expect(args.ids).toHaveLength(2);
    expect(args.documents).toEqual([
      JSON.stringify({ text: "hello", embedding: [1, 2, 3] }),
      JSON.stringify({ text: "world", embedding: [4, 5, 6] }),
    ]);
    createSpy.mockRestore();
  });

  it("finds documents by filter", async () => {
    const createSpy = vi.spyOn(adapter as any, "createChromaClient").mockReturnValue(client);
    await adapter.connect();
    collection.get.mockResolvedValue({
      ids: ["a", "b"],
      metadatas: [{ category: "x" }, { category: "y" }],
      documents: ["doc a", "doc b"],
    });
    const rows = await adapter.find("docs", { filter: { category: "x" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "a", category: "x", document: "doc a" });
    createSpy.mockRestore();
  });

  it("runs a vector QueryPlan", async () => {
    const createSpy = vi.spyOn(adapter as any, "createChromaClient").mockReturnValue(client);
    await adapter.connect();
    collection.query.mockResolvedValue({
      ids: [["a", "b"]],
      distances: [[0.1, 0.5]],
      metadatas: [[{ category: "x" }, { category: "y" }]],
      documents: [["doc a", "doc b"]],
    });
    const result = await adapter.query({
      mode: "vector",
      target: "docs",
      vector: [1, 2, 3],
      vectorField: "embedding",
      topK: 2,
    });
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]).toMatchObject({ id: "a", category: "x", document: "doc a", distance: 0.1 });
    createSpy.mockRestore();
  });

  it("throws for SQL QueryPlan", async () => {
    const createSpy = vi.spyOn(adapter as any, "createChromaClient").mockReturnValue(client);
    await adapter.connect();
    await expect(adapter.query({ mode: "sql", sql: "SELECT 1" })).rejects.toThrow(/sql query.*not supported/i);
    createSpy.mockRestore();
  });

  it("throws AdapterNotConnectedError when querying without connection", async () => {
    await expect(adapter.query({ mode: "document", target: "docs" })).rejects.toThrow(/not connected/);
  });
});
