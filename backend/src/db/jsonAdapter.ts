import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { CreateUserInput, PublicUser, Role, User, UserRepository } from "./types.js";

export interface JsonAdapterOptions {
  dataDir: string;
}

export class JsonUserRepository implements UserRepository {
  private users = new Map<string, User>();
  private filePath: string;

  constructor(options: JsonAdapterOptions) {
    this.filePath = path.join(options.dataDir, "users.json");
  }

  async init(): Promise<void> {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.load();
  }

  private load() {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const text = fs.readFileSync(this.filePath, "utf-8").replace(/^\uFEFF/, "");
      const raw = JSON.parse(text) as User[];
      this.users.clear();
      raw.forEach((u) => this.users.set(u.id, u));
    } catch {
      /* ignore malformed file */
    }
  }

  private persist() {
    fs.writeFileSync(this.filePath, JSON.stringify([...this.users.values()], null, 2));
  }

  async findByEmail(email: string): Promise<User | undefined> {
    return [...this.users.values()].find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );
  }

  async findById(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async create(data: CreateUserInput): Promise<User> {
    const isFirstUser = this.users.size === 0;
    const user: User = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      role: data.role ?? (isFirstUser ? "admin" : "user"),
      ...data,
    };
    this.users.set(user.id, user);
    this.persist();
    return user;
  }

  async list(): Promise<PublicUser[]> {
    return [...this.users.values()].map(toPublic);
  }

  async listAll(): Promise<User[]> {
    return [...this.users.values()].map((u) => ({ ...u }));
  }

  async upsert(user: User): Promise<User> {
    const email = user.email.toLowerCase();
    // Drop any other record with the same email but different id.
    for (const [id, existing] of this.users) {
      if (existing.email.toLowerCase() === email && id !== user.id) {
        this.users.delete(id);
      }
    }
    const next: User = { ...user, email };
    this.users.set(user.id, next);
    this.persist();
    return next;
  }

  async updateRole(id: string, role: Role): Promise<PublicUser | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    user.role = role;
    this.persist();
    return toPublic(user);
  }

  async updateProfile(id: string, name: string): Promise<PublicUser | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    user.name = name;
    this.persist();
    return toPublic(user);
  }

  async updatePassword(id: string, passwordHash: string): Promise<PublicUser | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    user.passwordHash = passwordHash;
    this.persist();
    return toPublic(user);
  }
}

export function toPublic(user: User): PublicUser {
  const { passwordHash: _ignored, ...rest } = user;
  return rest;
}
