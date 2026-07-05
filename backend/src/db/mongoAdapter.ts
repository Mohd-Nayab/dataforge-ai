import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";

import type { CreateUserInput, PublicUser, Role, User, UserRepository } from "./types.js";

export interface MongoAdapterOptions {
  connectionString: string;
}

export class MongoUserRepository implements UserRepository {
  private client: MongoClient;
  private dbName = "dataforge";

  constructor(options: MongoAdapterOptions) {
    this.client = new MongoClient(options.connectionString, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
  }

  async init(): Promise<void> {
    await this.client.connect();
    const users = this.client.db(this.dbName).collection("users");
    await users.createIndex({ email: 1 }, { unique: true });
  }

  private collection() {
    return this.client.db(this.dbName).collection<User>("users");
  }

  private toPublic(user: User): PublicUser {
    const { passwordHash, ...rest } = user;
    return rest;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const user = await this.collection().findOne({
      email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    });
    return user ?? undefined;
  }

  async findById(id: string): Promise<User | undefined> {
    const user = await this.collection().findOne({ id });
    return user ?? undefined;
  }

  async create(data: CreateUserInput): Promise<User> {
    const existing = await this.findByEmail(data.email);
    if (existing) throw new Error("Email already registered");

    const count = await this.collection().countDocuments();
    const user: User = {
      id: randomUUID(),
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash: data.passwordHash,
      role: data.role ?? (count === 0 ? "admin" : "user"),
      createdAt: new Date().toISOString(),
    };

    await this.collection().insertOne(user);
    return user;
  }

  async list(): Promise<PublicUser[]> {
    const users = await this.collection()
      .find({}, { projection: { passwordHash: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    return users as PublicUser[];
  }

  async updateRole(id: string, role: Role): Promise<PublicUser | undefined> {
    await this.collection().updateOne({ id }, { $set: { role } });
    const user = await this.findById(id);
    return user ? this.toPublic(user) : undefined;
  }

  async updateProfile(id: string, name: string): Promise<PublicUser | undefined> {
    await this.collection().updateOne({ id }, { $set: { name } });
    const user = await this.findById(id);
    return user ? this.toPublic(user) : undefined;
  }

  async updatePassword(id: string, passwordHash: string): Promise<PublicUser | undefined> {
    await this.collection().updateOne({ id }, { $set: { passwordHash } });
    const user = await this.findById(id);
    return user ? this.toPublic(user) : undefined;
  }
}
