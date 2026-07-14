/**
 * Adapter registry — the single plugin point of the platform.
 *
 * To add support for a new database you ONLY:
 *   1. Implement the DatabaseAdapter interface in ../adapters/<name>.ts
 *   2. Call registerAdapter(...) below (or from that module).
 * No other code needs to change. The UI, DatabaseManager, and routes all
 * read from this registry dynamically.
 */
import type {
  AdapterFactory,
  DatabaseCapabilities,
  SupportedDatabase,
} from "./types.js";

export interface AdapterDescriptor {
  type: SupportedDatabase;
  label: string;
  capabilities: DatabaseCapabilities;
  /** Whether a working factory is registered. */
  status: "available" | "planned";
  /** Fields the connection form should request for this engine. */
  requiredFields: ("host" | "port" | "username" | "password" | "database" | "options")[];
  defaultPort?: number;
  factory?: AdapterFactory;
}

const registry = new Map<SupportedDatabase, AdapterDescriptor>();

/** Register (or replace) an adapter descriptor. */
export function registerAdapter(descriptor: AdapterDescriptor): void {
  registry.set(descriptor.type, descriptor);
}

/** Register only the factory + mark available, keeping existing metadata. */
export function registerFactory(type: SupportedDatabase, factory: AdapterFactory): void {
  const existing = registry.get(type);
  if (!existing) {
    throw new Error(`Cannot register factory for unknown database type "${type}".`);
  }
  registry.set(type, { ...existing, factory, status: "available" });
}

export function getDescriptor(type: SupportedDatabase): AdapterDescriptor | undefined {
  return registry.get(type);
}

export function listDescriptors(): AdapterDescriptor[] {
  return [...registry.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function isAvailable(type: SupportedDatabase): boolean {
  return registry.get(type)?.status === "available";
}

// ---------------------------------------------------------------------------
// Baseline catalog of every database the platform is designed to support.
// Engines without a factory yet are listed as "planned" so the UI can show the
// full roadmap and gate connection attempts cleanly.
// ---------------------------------------------------------------------------
const CATALOG: Omit<AdapterDescriptor, "factory">[] = [
  { type: "sqlite", label: "SQLite", status: "planned", defaultPort: undefined,
    requiredFields: ["database"],
    capabilities: { family: "relational", sql: true, documents: true, transactions: true, indexes: true, vectorSearch: false } },
  { type: "postgres", label: "PostgreSQL", status: "planned", defaultPort: 5432,
    requiredFields: ["host", "port", "username", "password", "database"],
    capabilities: { family: "relational", sql: true, documents: true, transactions: true, indexes: true, vectorSearch: false } },
  { type: "mysql", label: "MySQL", status: "planned", defaultPort: 3306,
    requiredFields: ["host", "port", "username", "password", "database"],
    capabilities: { family: "relational", sql: true, documents: true, transactions: true, indexes: true, vectorSearch: false } },
  { type: "mariadb", label: "MariaDB", status: "planned", defaultPort: 3306,
    requiredFields: ["host", "port", "username", "password", "database"],
    capabilities: { family: "relational", sql: true, documents: true, transactions: true, indexes: true, vectorSearch: false } },
  { type: "sqlserver", label: "Microsoft SQL Server", status: "planned", defaultPort: 1433,
    requiredFields: ["host", "port", "username", "password", "database"],
    capabilities: { family: "relational", sql: true, documents: true, transactions: true, indexes: true, vectorSearch: false } },
  { type: "oracle", label: "Oracle Database", status: "planned", defaultPort: 1521,
    requiredFields: ["host", "port", "username", "password", "database"],
    capabilities: { family: "relational", sql: true, documents: true, transactions: true, indexes: true, vectorSearch: false } },
  { type: "mongodb", label: "MongoDB", status: "planned", defaultPort: 27017,
    requiredFields: ["host", "port", "username", "password", "database", "options"],
    capabilities: { family: "document", sql: false, documents: true, transactions: true, indexes: true, vectorSearch: false } },
  { type: "redis", label: "Redis", status: "planned", defaultPort: 6379,
    requiredFields: ["host", "port", "password"],
    capabilities: { family: "key_value", sql: false, documents: true, transactions: false, indexes: false, vectorSearch: false } },
  { type: "elasticsearch", label: "Elasticsearch", status: "planned", defaultPort: 9200,
    requiredFields: ["host", "port", "username", "password"],
    capabilities: { family: "search", sql: false, documents: true, transactions: false, indexes: true, vectorSearch: true } },
  { type: "pinecone", label: "Pinecone", status: "planned",
    requiredFields: ["options"],
    capabilities: { family: "vector", sql: false, documents: true, transactions: false, indexes: true, vectorSearch: true } },
  { type: "chromadb", label: "ChromaDB", status: "planned", defaultPort: 8000,
    requiredFields: ["host", "port"],
    capabilities: { family: "vector", sql: false, documents: true, transactions: false, indexes: true, vectorSearch: true } },
  { type: "weaviate", label: "Weaviate", status: "planned", defaultPort: 8080,
    requiredFields: ["host", "port", "options"],
    capabilities: { family: "vector", sql: false, documents: true, transactions: false, indexes: true, vectorSearch: true } },
  { type: "qdrant", label: "Qdrant", status: "planned", defaultPort: 6333,
    requiredFields: ["host", "port", "options"],
    capabilities: { family: "vector", sql: false, documents: true, transactions: false, indexes: true, vectorSearch: true } },
  { type: "milvus", label: "Milvus", status: "planned", defaultPort: 19530,
    requiredFields: ["host", "port"],
    capabilities: { family: "vector", sql: false, documents: true, transactions: false, indexes: true, vectorSearch: true } },
  { type: "faiss", label: "FAISS (local)", status: "planned",
    requiredFields: ["database"],
    capabilities: { family: "vector", sql: false, documents: true, transactions: false, indexes: true, vectorSearch: true } },
];

for (const entry of CATALOG) {
  registry.set(entry.type, entry);
}
