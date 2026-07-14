import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Isolate the profile store to a temp dir BEFORE importing modules that read
// config.dataDir. Dynamic imports below run after this env is set.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dataforge-db-test-"));
process.env.DATA_DIR = tmpDir;
process.env.APP_SECRET = "test-secret-key-for-encryption-1234567890";

type PlatformModule = typeof import("../index.js");
type ProfilesModule = typeof import("../core/profiles.js");
type RegistryModule = typeof import("../core/registry.js");

let platform: PlatformModule;
let profiles: ProfilesModule;
let registry: RegistryModule;

beforeAll(async () => {
  platform = await import("../index.js");
  profiles = await import("../core/profiles.js");
  registry = await import("../core/registry.js");
});

afterAll(async () => {
  await platform.databaseManager.disconnectAll();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("adapter registry", () => {
  it("lists all 15 supported databases", () => {
    expect(registry.listDescriptors().length).toBe(15);
  });

  it("marks sqlite / postgres / mongodb as available", () => {
    expect(registry.isAvailable("sqlite")).toBe(true);
    expect(registry.isAvailable("postgres")).toBe(true);
    expect(registry.isAvailable("mongodb")).toBe(true);
  });

  it("keeps not-yet-implemented engines as planned", () => {
    expect(registry.isAvailable("oracle")).toBe(false);
    expect(registry.getDescriptor("qdrant")?.status).toBe("planned");
  });
});

describe("connection profiles (encrypted at rest)", () => {
  it("creates a profile and never leaks the password", () => {
    const created = profiles.createProfile({
      name: "Local SQLite",
      type: "sqlite",
      database: "test.sqlite",
      password: "should-be-hidden",
    });
    expect(created.hasPassword).toBe(true);
    expect((created as Record<string, unknown>).password).toBeUndefined();

    // On-disk file must not contain the plaintext password.
    const onDisk = fs.readFileSync(path.join(tmpDir, "connection-profiles.json"), "utf-8");
    expect(onDisk).not.toContain("should-be-hidden");

    // Internal getter decrypts it for the manager.
    expect(profiles.getProfile(created.id)?.password).toBe("should-be-hidden");
  });

  it("updates and deletes profiles", () => {
    const p = profiles.createProfile({ name: "Temp", type: "sqlite", database: "t.sqlite" });
    const updated = profiles.updateProfile(p.id, { name: "Renamed" });
    expect(updated?.name).toBe("Renamed");
    expect(profiles.deleteProfile(p.id)).toBe(true);
    expect(profiles.getPublicProfile(p.id)).toBeUndefined();
  });
});

describe("DatabaseManager with SQLite (in-memory)", () => {
  it("switches, runs DDL/CRUD, and discovers schema", async () => {
    const { databaseManager } = platform;
    const profile = profiles.createProfile({
      name: "Memory DB",
      type: "sqlite",
      database: ":memory:",
    });

    const adapter = await databaseManager.switchTo(profile.id);
    expect(databaseManager.getStatus().connected).toBe(true);
    expect(databaseManager.getStatus().activeType).toBe("sqlite");

    await adapter.createTable!("users", [
      { name: "id", dataType: "INTEGER PRIMARY KEY" },
      { name: "email", dataType: "TEXT" },
    ]);

    const inserted = await databaseManager.insert("users", [
      { id: 1, email: "a@x.com" },
      { id: 2, email: "b@x.com" },
    ]);
    expect(inserted).toBe(2);

    const found = await databaseManager.find("users", { filter: { email: "a@x.com" } });
    expect(found).toHaveLength(1);

    const updated = await databaseManager.update("users", { id: 2 }, { email: "b2@x.com" });
    expect(updated).toBe(1);

    const q = await databaseManager.executeQuery<{ c: number }>("SELECT COUNT(*) AS c FROM users");
    expect(q.rows[0].c).toBe(2);

    const schema = await databaseManager.discoverSchema();
    const usersObj = schema.objects.find((o) => o.name === "users");
    expect(usersObj?.type).toBe("table");
    expect(usersObj?.columns?.map((c) => c.name)).toContain("email");

    const removed = await databaseManager.delete("users", { id: 1 });
    expect(removed).toBe(1);
  });

  it("tests a profile without keeping it pooled", async () => {
    const { databaseManager } = platform;
    const result = await databaseManager.testProfile({
      id: "inline",
      name: "inline",
      type: "sqlite",
      database: ":memory:",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("refuses to switch to a planned (unimplemented) engine", async () => {
    const { databaseManager } = platform;
    const oracle = profiles.createProfile({
      name: "Oracle X",
      type: "oracle",
      host: "localhost",
      port: 1521,
    });
    await expect(databaseManager.switchTo(oracle.id)).rejects.toThrow(/not yet implemented/i);
  });
});
