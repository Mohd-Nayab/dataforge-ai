import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

dotenv.config();

export type DatabaseType = "json" | "sqlite" | "postgres" | "mongodb";

const VALID_DB_TYPES: DatabaseType[] = ["json", "sqlite", "postgres", "mongodb"];

function resolveDataDir(): string {
  return process.env.DATA_DIR ?? "./data";
}

function runtimeDbConfigPath(): string {
  return path.join(resolveDataDir(), "runtime-db.json");
}

function loadRuntimeDbConfig(): { type?: DatabaseType; url?: string } {
  try {
    const filePath = runtimeDbConfigPath();
    if (!fs.existsSync(filePath)) return {};
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      type?: string;
      url?: string;
    };
    if (!raw?.type || !VALID_DB_TYPES.includes(raw.type as DatabaseType)) return {};
    return {
      type: raw.type as DatabaseType,
      url: typeof raw.url === "string" ? raw.url : "",
    };
  } catch {
    return {};
  }
}

const runtimeDb = loadRuntimeDbConfig();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "change-me-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  pythonServiceUrl: process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 500),
  dataDir: resolveDataDir(),
  // Prefer last Admin UI selection (runtime-db.json), then env vars.
  databaseType: (runtimeDb.type ??
    process.env.DATABASE_TYPE ??
    "json") as DatabaseType,
  databaseUrl: runtimeDb.url ?? process.env.DATABASE_URL ?? "",
};

export function persistDatabaseConfig(type: DatabaseType, url: string): void {
  const dir = resolveDataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    runtimeDbConfigPath(),
    JSON.stringify({ type, url: url ?? "", updatedAt: new Date().toISOString() }, null, 2),
    "utf-8"
  );
  config.databaseType = type;
  config.databaseUrl = url ?? "";
}
