import { config } from "../config.js";

import { JsonUserRepository } from "./jsonAdapter.js";
import { MongoUserRepository } from "./mongoAdapter.js";
import { PostgresUserRepository } from "./postgresAdapter.js";
import { SqliteUserRepository } from "./sqliteAdapter.js";
import type { UserRepository } from "./types.js";

export type DatabaseType = "json" | "sqlite" | "postgres" | "mongodb";

export function createUserRepository(
  type: DatabaseType = config.databaseType,
  url: string = config.databaseUrl
): UserRepository {
  switch (type) {
    case "sqlite":
      return new SqliteUserRepository({ dataDir: url || config.dataDir });
    case "postgres":
      return new PostgresUserRepository({ connectionString: url });
    case "mongodb":
      return new MongoUserRepository({ connectionString: url });
    case "json":
    default:
      return new JsonUserRepository({ dataDir: config.dataDir });
  }
}

export * from "./types.js";
