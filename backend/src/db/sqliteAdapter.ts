import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import type { CreateUserInput, PublicUser, Role, User, UserRepository } from "./types.js";

export interface SqliteAdapterOptions {
  dataDir: string;
}

export class SqliteUserRepository implements UserRepository {
  private db: Database.Database;

  constructor(options: SqliteAdapterOptions) {
    fs.mkdirSync(options.dataDir, { recursive: true });
    this.db = new Database(path.join(options.dataDir, "users.sqlite"));
  }

  async init(): Promise<void> {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL,
        createdAt TEXT NOT NULL
      )`
    );
  }

  private toUser(row: Record<string, unknown>): User {
    return {
      id: row.id as string,
      name: row.name as string,
      email: row.email as string,
      passwordHash: row.passwordHash as string,
      role: row.role as Role,
      createdAt: row.createdAt as string,
    };
  }

  private toPublic(user: User): PublicUser {
    const { passwordHash, ...rest } = user;
    return rest;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const row = this.db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email.toLowerCase()) as Record<string, unknown> | undefined;
    return row ? this.toUser(row) : undefined;
  }

  async findById(id: string): Promise<User | undefined> {
    const row = this.db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.toUser(row) : undefined;
  }

  async create(data: CreateUserInput): Promise<User> {
    const existing = await this.findByEmail(data.email);
    if (existing) throw new Error("Email already registered");

    const count = this.db.prepare("SELECT COUNT(*) as count FROM users").get() as {
      count: number;
    };

    const user: User = {
      id: randomUUID(),
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash: data.passwordHash,
      role: data.role ?? (count.count === 0 ? "admin" : "user"),
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        "INSERT INTO users (id, name, email, passwordHash, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(user.id, user.name, user.email, user.passwordHash, user.role, user.createdAt);

    return user;
  }

  async list(): Promise<PublicUser[]> {
    const rows = this.db
      .prepare("SELECT id, name, email, role, createdAt FROM users ORDER BY createdAt DESC")
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.toPublic(this.toUser(r)));
  }

  async updateRole(id: string, role: Role): Promise<PublicUser | undefined> {
    this.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
    const user = await this.findById(id);
    return user ? this.toPublic(user) : undefined;
  }

  async updateProfile(id: string, name: string): Promise<PublicUser | undefined> {
    this.db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, id);
    const user = await this.findById(id);
    return user ? this.toPublic(user) : undefined;
  }

  async updatePassword(id: string, passwordHash: string): Promise<PublicUser | undefined> {
    this.db.prepare("UPDATE users SET passwordHash = ? WHERE id = ?").run(passwordHash, id);
    const user = await this.findById(id);
    return user ? this.toPublic(user) : undefined;
  }
}
