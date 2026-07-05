import { randomUUID } from "node:crypto";
import pg from "pg";

import type { CreateUserInput, PublicUser, Role, User, UserRepository } from "./types.js";

const { Pool } = pg;

export interface PostgresAdapterOptions {
  connectionString: string;
}

export class PostgresUserRepository implements UserRepository {
  private pool: pg.Pool;

  constructor(options: PostgresAdapterOptions) {
    this.pool = new Pool({ connectionString: options.connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(
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

  private toUser(row: pg.QueryResultRow): User {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      passwordHash: row.passwordhash,
      role: row.role as Role,
      createdAt: row.createdat,
    };
  }

  private toPublic(user: User): PublicUser {
    const { passwordHash, ...rest } = user;
    return rest;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const { rows } = await this.pool.query(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1)",
      [email]
    );
    return rows[0] ? this.toUser(rows[0]) : undefined;
  }

  async findById(id: string): Promise<User | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ? this.toUser(rows[0]) : undefined;
  }

  async create(data: CreateUserInput): Promise<User> {
    const existing = await this.findByEmail(data.email);
    if (existing) throw new Error("Email already registered");

    const countRes = await this.pool.query("SELECT COUNT(*) as count FROM users");
    const count = Number(countRes.rows[0].count);

    const user: User = {
      id: randomUUID(),
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash: data.passwordHash,
      role: data.role ?? (count === 0 ? "admin" : "user"),
      createdAt: new Date().toISOString(),
    };

    await this.pool.query(
      "INSERT INTO users (id, name, email, passwordHash, role, createdAt) VALUES ($1, $2, $3, $4, $5, $6)",
      [user.id, user.name, user.email, user.passwordHash, user.role, user.createdAt]
    );

    return user;
  }

  async list(): Promise<PublicUser[]> {
    const { rows } = await this.pool.query(
      "SELECT id, name, email, role, createdAt FROM users ORDER BY createdAt DESC"
    );
    return rows.map((r) => this.toPublic(this.toUser(r)));
  }

  async updateRole(id: string, role: Role): Promise<PublicUser | undefined> {
    await this.pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, id]);
    const user = await this.findById(id);
    return user ? this.toPublic(user) : undefined;
  }

  async updateProfile(id: string, name: string): Promise<PublicUser | undefined> {
    await this.pool.query("UPDATE users SET name = $1 WHERE id = $2", [name, id]);
    const user = await this.findById(id);
    return user ? this.toPublic(user) : undefined;
  }

  async updatePassword(id: string, passwordHash: string): Promise<PublicUser | undefined> {
    await this.pool.query("UPDATE users SET passwordHash = $1 WHERE id = $2", [
      passwordHash,
      id,
    ]);
    const user = await this.findById(id);
    return user ? this.toPublic(user) : undefined;
  }
}
