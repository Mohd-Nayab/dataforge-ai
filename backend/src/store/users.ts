import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

export type Role = "admin" | "manager" | "user";

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
}

export type PublicUser = Omit<User, "passwordHash">;

class UserStore {
  private users = new Map<string, User>();

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.load();
  }

  private load() {
    if (!fs.existsSync(USERS_FILE)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8")) as User[];
      raw.forEach((u) => this.users.set(u.id, u));
    } catch {
      /* ignore malformed file */
    }
  }

  persist() {
    fs.writeFileSync(USERS_FILE, JSON.stringify([...this.users.values()], null, 2));
  }

  findByEmail(email: string): User | undefined {
    return [...this.users.values()].find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );
  }

  findById(id: string): User | undefined {
    return this.users.get(id);
  }

  create(data: Omit<User, "id" | "createdAt" | "role"> & { role?: Role }): User {
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

  list(): PublicUser[] {
    return [...this.users.values()].map(toPublic);
  }

  updateRole(id: string, role: Role): User | undefined {
    const user = this.users.get(id);
    if (!user) return undefined;
    user.role = role;
    this.persist();
    return user;
  }
}

export function toPublic(user: User): PublicUser {
  const { passwordHash: _ignored, ...rest } = user;
  return rest;
}

export const userStore = new UserStore();
