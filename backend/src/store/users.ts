import { config } from "../config.js";
import { createUserRepository } from "../db/index.js";
import type { PublicUser, Role, User, UserRepository } from "../db/index.js";

export type { PublicUser, Role, User } from "../db/index.js";

class UserStore {
  constructor(private repo: UserRepository) {}

  async init() {
    try {
      await this.repo.init();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `Failed to initialize "${config.databaseType}" database, falling back to JSON storage:`,
        err instanceof Error ? err.message : err
      );
      this.repo = createUserRepository("json");
      await this.repo.init();
    }
  }

  findByEmail(email: string): Promise<User | undefined> {
    return this.repo.findByEmail(email);
  }

  findById(id: string): Promise<User | undefined> {
    return this.repo.findById(id);
  }

  create(data: Omit<User, "id" | "createdAt" | "role"> & { role?: Role }): Promise<User> {
    return this.repo.create(data);
  }

  list(): Promise<PublicUser[]> {
    return this.repo.list();
  }

  updateRole(id: string, role: Role): Promise<PublicUser | undefined> {
    return this.repo.updateRole(id, role);
  }

  updateProfile(id: string, name: string): Promise<PublicUser | undefined> {
    return this.repo.updateProfile(id, name);
  }

  updatePassword(id: string, passwordHash: string): Promise<PublicUser | undefined> {
    return this.repo.updatePassword(id, passwordHash);
  }

  persist(): Promise<void> {
    return Promise.resolve();
  }

  setRepo(repo: UserRepository) {
    this.repo = repo;
  }
}

export const userStore = new UserStore(createUserRepository());

export function toPublic(user: User): PublicUser {
  const { passwordHash: _ignored, ...rest } = user;
  return rest;
}
