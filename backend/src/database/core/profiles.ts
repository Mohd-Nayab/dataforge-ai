/**
 * Connection profile store.
 *
 * Profiles are persisted to `<dataDir>/connection-profiles.json`. Passwords are
 * stored ONLY as `passwordEnc` (AES-256-GCM). The decrypted password is exposed
 * in memory via {@link getProfile} for the DatabaseManager, and never returned
 * by the public listing API.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { config } from "../../config.js";
import { decrypt, encrypt } from "./crypto.js";
import type {
  ConnectionProfile,
  PublicConnectionProfile,
  SupportedDatabase,
} from "./types.js";

interface StoredProfile {
  id: string;
  name: string;
  type: SupportedDatabase;
  host?: string;
  port?: number;
  username?: string;
  passwordEnc?: string;
  database?: string;
  ssl?: boolean;
  authMethod?: string;
  options?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface StoreFile {
  activeId: string | null;
  profiles: StoredProfile[];
}

export interface ProfileInput {
  name: string;
  type: SupportedDatabase;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  authMethod?: string;
  options?: Record<string, unknown>;
}

function filePath(): string {
  return path.join(config.dataDir, "connection-profiles.json");
}

function load(): StoreFile {
  try {
    const raw = fs.readFileSync(filePath(), "utf-8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (!Array.isArray(parsed.profiles)) return { activeId: null, profiles: [] };
    return { activeId: parsed.activeId ?? null, profiles: parsed.profiles };
  } catch {
    return { activeId: null, profiles: [] };
  }
}

function persist(store: StoreFile): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(store, null, 2), "utf-8");
}

function toPublic(p: StoredProfile): PublicConnectionProfile {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    host: p.host,
    port: p.port,
    username: p.username,
    database: p.database,
    ssl: p.ssl,
    authMethod: p.authMethod,
    options: p.options,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    hasPassword: Boolean(p.passwordEnc),
  };
}

function toRuntime(p: StoredProfile): ConnectionProfile {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    host: p.host,
    port: p.port,
    username: p.username,
    password: p.passwordEnc ? decrypt(p.passwordEnc) : undefined,
    database: p.database,
    ssl: p.ssl,
    authMethod: p.authMethod,
    options: p.options,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function listProfiles(): PublicConnectionProfile[] {
  return load().profiles.map(toPublic);
}

/** Runtime profile WITH decrypted password — for internal connection use only. */
export function getProfile(id: string): ConnectionProfile | undefined {
  const found = load().profiles.find((p) => p.id === id);
  return found ? toRuntime(found) : undefined;
}

export function getPublicProfile(id: string): PublicConnectionProfile | undefined {
  const found = load().profiles.find((p) => p.id === id);
  return found ? toPublic(found) : undefined;
}

export function createProfile(input: ProfileInput): PublicConnectionProfile {
  const store = load();
  const now = new Date().toISOString();
  const profile: StoredProfile = {
    id: crypto.randomUUID(),
    name: input.name,
    type: input.type,
    host: input.host,
    port: input.port,
    username: input.username,
    passwordEnc: input.password ? encrypt(input.password) : undefined,
    database: input.database,
    ssl: input.ssl,
    authMethod: input.authMethod,
    options: input.options,
    createdAt: now,
    updatedAt: now,
  };
  store.profiles.push(profile);
  persist(store);
  return toPublic(profile);
}

export function updateProfile(
  id: string,
  patch: Partial<ProfileInput>
): PublicConnectionProfile | undefined {
  const store = load();
  const idx = store.profiles.findIndex((p) => p.id === id);
  if (idx === -1) return undefined;
  const current = store.profiles[idx];
  const next: StoredProfile = {
    ...current,
    name: patch.name ?? current.name,
    type: patch.type ?? current.type,
    host: patch.host ?? current.host,
    port: patch.port ?? current.port,
    username: patch.username ?? current.username,
    database: patch.database ?? current.database,
    ssl: patch.ssl ?? current.ssl,
    authMethod: patch.authMethod ?? current.authMethod,
    options: patch.options ?? current.options,
    // Only re-encrypt when a new password is explicitly provided.
    passwordEnc:
      patch.password !== undefined
        ? patch.password
          ? encrypt(patch.password)
          : undefined
        : current.passwordEnc,
    updatedAt: new Date().toISOString(),
  };
  store.profiles[idx] = next;
  persist(store);
  return toPublic(next);
}

export function deleteProfile(id: string): boolean {
  const store = load();
  const before = store.profiles.length;
  store.profiles = store.profiles.filter((p) => p.id !== id);
  if (store.activeId === id) store.activeId = null;
  const changed = store.profiles.length !== before;
  if (changed) persist(store);
  return changed;
}

export function getActiveProfileId(): string | null {
  return load().activeId;
}

export function setActiveProfileId(id: string | null): void {
  const store = load();
  store.activeId = id;
  persist(store);
}
