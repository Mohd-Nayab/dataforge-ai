import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";

import { config } from "./config.js";
import { authenticate, requireRole } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { dataProxy } from "./routes/dataProxy.js";
import { type Role, toPublic, userStore } from "./store/users.js";

const app = express();

app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(","),
    credentials: true,
  })
);
app.use(morgan("dev"));

app.use(
  rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "dataforge-backend" });
});

// Auth routes (JSON body parsing only applied here so multipart proxy is untouched).
app.use("/api/auth", express.json({ limit: "1mb" }), authRouter);

// Admin: list users and update roles.
app.get("/api/admin/users", authenticate, requireRole("admin"), (_req, res) => {
  res.json({ users: userStore.list() });
});

app.patch("/api/admin/users/:id/role", authenticate, requireRole("admin"), express.json({ limit: "1mb" }), (req, res) => {
  const role = req.body.role as Role;
  if (!role || !["admin", "manager", "user"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  const updated = userStore.updateRole(req.params.id, role);
  if (!updated) return res.status(404).json({ error: "User not found" });
  return res.json({ user: toPublic(updated) });
});

// Data engine proxy — streams everything (incl. multipart uploads) to FastAPI.
app.use("/api/data", dataProxy);

// Global error handler.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    const e = err as { status?: number; statusCode?: number; message?: string };
    const status = e?.status ?? e?.statusCode ?? 500;

    // Client errors (4xx) carry safe, useful messages; 5xx stay generic.
    if (status >= 400 && status < 500) {
      return res.status(status).json({ error: e.message ?? "Bad request" });
    }

    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`DataForge backend listening on http://localhost:${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`Proxying /api/data -> ${config.pythonServiceUrl}`);
});
