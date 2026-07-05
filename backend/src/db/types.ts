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

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  role?: Role;
}

export interface UserRepository {
  init(): Promise<void>;
  findByEmail(email: string): Promise<User | undefined>;
  findById(id: string): Promise<User | undefined>;
  create(data: CreateUserInput): Promise<User>;
  list(): Promise<PublicUser[]>;
  updateRole(id: string, role: Role): Promise<PublicUser | undefined>;
  updateProfile(id: string, name: string): Promise<PublicUser | undefined>;
  updatePassword(id: string, passwordHash: string): Promise<PublicUser | undefined>;
}
