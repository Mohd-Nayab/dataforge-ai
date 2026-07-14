/**
 * Universal database platform API.
 *
 * All routes are admin-guarded. They expose the DatabaseManager and connection
 * profile store to the frontend Connection Manager + Database Switcher.
 */
import { Router } from "express";
import { z } from "zod";

import { authenticate, requireRole } from "../middleware/auth.js";
import {
  databaseManager,
  listDescriptors,
  profiles,
  type ConnectionProfile,
  type SupportedDatabase,
} from "../database/index.js";

export const databaseRouter = Router();

databaseRouter.use(authenticate, requireRole("admin"));

const DB_TYPES = [
  "sqlite", "postgres", "mysql", "mariadb", "sqlserver", "oracle",
  "mongodb", "redis", "elasticsearch",
  "pinecone", "chromadb", "weaviate", "qdrant", "milvus", "faiss",
] as const;

const profileSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(DB_TYPES),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  database: z.string().optional(),
  ssl: z.boolean().optional(),
  authMethod: z.string().optional(),
  options: z.record(z.unknown()).optional(),
});

/** List every supported database + capabilities + availability. */
databaseRouter.get("/supported", (_req, res) => {
  res.json({ databases: listDescriptors() });
});

/** Current active connection status. */
databaseRouter.get("/status", (_req, res) => {
  res.json(databaseManager.getStatus());
});

/** List saved connection profiles (no secrets). */
databaseRouter.get("/profiles", (_req, res) => {
  res.json({ profiles: profiles.listProfiles(), activeId: profiles.getActiveProfileId() });
});

/** Create a profile. */
databaseRouter.post("/profiles", (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid profile" });
  }
  return res.status(201).json({ profile: profiles.createProfile(parsed.data) });
});

/** Update a profile (partial). */
databaseRouter.patch("/profiles/:id", (req, res) => {
  const parsed = profileSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid profile" });
  }
  const updated = profiles.updateProfile(req.params.id, parsed.data);
  if (!updated) return res.status(404).json({ error: "Profile not found" });
  return res.json({ profile: updated });
});

/** Delete a profile. */
databaseRouter.delete("/profiles/:id", async (req, res) => {
  await databaseManager.disconnect(req.params.id).catch(() => undefined);
  const ok = profiles.deleteProfile(req.params.id);
  if (!ok) return res.status(404).json({ error: "Profile not found" });
  return res.json({ deleted: true });
});

/**
 * Test a connection. Either provide a saved profile id (`?id=`) or a full
 * inline profile body. Never persists anything.
 */
databaseRouter.post("/test", async (req, res) => {
  let profile: ConnectionProfile | undefined;
  const id = (req.query.id as string) || (req.body?.id as string);
  if (id) {
    profile = profiles.getProfile(id);
    if (!profile) return res.status(404).json({ error: "Profile not found" });
  } else {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid profile" });
    }
    const now = new Date().toISOString();
    profile = { id: "test", createdAt: now, updatedAt: now, ...parsed.data } as ConnectionProfile;
  }
  const result = await databaseManager.testProfile(profile);
  return res.status(result.ok ? 200 : 400).json(result);
});

/** One-click switch to a saved profile. */
databaseRouter.post("/switch/:id", async (req, res) => {
  const profile = profiles.getProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  try {
    await databaseManager.switchTo(req.params.id);
    return res.json({
      message: `Switched to "${profile.name}" (${profile.type}).`,
      status: databaseManager.getStatus(),
    });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Switch failed" });
  }
});

/** Disconnect the active connection. */
databaseRouter.post("/disconnect", async (_req, res) => {
  const { activeProfileId } = databaseManager.getStatus();
  if (activeProfileId) await databaseManager.disconnect(activeProfileId);
  return res.json({ status: databaseManager.getStatus() });
});

/** Discover schema / collections of the active connection. */
databaseRouter.get("/schema", async (_req, res) => {
  try {
    const snapshot = await databaseManager.discoverSchema();
    return res.json(snapshot);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Schema discovery failed" });
  }
});

/** Run a query against the active connection using the unified QueryPlan. */
const queryPlanSchema = z.object({
  mode: z.enum(["sql", "document", "vector"]),
  target: z.string().optional(),
  sql: z.string().optional(),
  params: z.array(z.unknown()).optional(),
  filter: z.record(z.unknown()).optional(),
  projection: z.record(z.union([z.literal(0), z.literal(1)])).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  sort: z.record(z.union([z.literal(1), z.literal(-1)])).optional(),
  vector: z.array(z.number()).optional(),
  vectorField: z.string().optional(),
  topK: z.number().int().positive().optional(),
});

databaseRouter.post("/query", async (req, res) => {
  const parsed = queryPlanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query plan" });
  }
  try {
    const result = await databaseManager.query(parsed.data);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Query failed" });
  }
});

export type { SupportedDatabase };
