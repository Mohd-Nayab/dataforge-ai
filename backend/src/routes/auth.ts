import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { authenticate, signToken } from "../middleware/auth.js";
import { toPublic, userStore } from "../store/users.js";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(80),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { name, email, password } = parsed.data;
  if (await userStore.findByEmail(email)) {
    return res.status(409).json({ error: "Email already registered" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await userStore.create({ name, email, passwordHash });
  const token = signToken({ id: user.id, email: user.email, role: user.role });
  return res.status(201).json({ token, user: toPublic(user) });
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input" });
  }
  const { email, password } = parsed.data;
  const user = await userStore.findByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = signToken({ id: user.id, email: user.email, role: user.role });
  return res.json({ token, user: toPublic(user) });
});

authRouter.get("/me", authenticate, async (req, res) => {
  const user = await userStore.findById(req.user!.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user: toPublic(user) });
});

authRouter.patch("/me", authenticate, async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const user = await userStore.updateProfile(req.user!.id, parsed.data.name);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user });
});

authRouter.post("/password", authenticate, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const user = await userStore.findById(req.user!.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await userStore.updatePassword(req.user!.id, passwordHash);
  return res.json({ message: "Password changed successfully" });
});
