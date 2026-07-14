# DataForge AI

An AI-powered data cleaning, transformation, analytics, visualization, prediction and reporting platform.

This repository is a **microservices monorepo**:

```
DataForge_AI/
├── frontend/         # React 19 + TypeScript + Vite + Tailwind + Zustand + React Query
├── backend/          # Node.js + Express + TypeScript (auth + API gateway)
├── python-service/   # FastAPI data engine (pandas-powered cleaning / stats / analytics / AI)
├── docker/           # Dockerfiles
├── docker-compose.yml
└── docs/
```

## Phase 1 — Core Vertical Slice (this build)

Everything runs **end-to-end**:

- JWT authentication (register / login) — Node backend. **The first registered user becomes `admin`**, with an Admin Dashboard to list users and change roles, plus a Profile page for every user to update their name and change password
- File upload (CSV / TSV / PSV / Excel / ODS / JSON / XML / HTML / Parquet / Feather / Arrow / ORC / Pickle / Stata / SAS / SPSS / HDF5) — FastAPI engine
- Excel-like data preview (sorting, search, pagination, column stats)
- **Cleaning Studio** with real Pandas operations (remove duplicates, drop/fill nulls, trim, case, outlier removal, type casting, encoding, etc.) plus a **column-scope selector** so any operation can target specific columns, and column ops (drop / rename / split / merge / dtype-cast).
- **Data Profiling** page — per-column dtype, missing %, unique counts, and numeric summaries (min/mean/median/max/std), backed by the `/stats` engine
- **SQL Workspace** — run read-only DuckDB SQL queries against any dataset via `/api/data/datasets/{id}/sql`, with a query editor, results table, and an in-memory LRU result cache that speeds up repeated queries (invalidated when the dataset is cleaned)
- **ML Studio** — train scikit-learn regression/classification models (auto task detection, RandomForest / Linear / Logistic), view metrics (R²/MAE/RMSE or accuracy), and run predictions back over the dataset
- **Report Builder** — aggregate dataset metadata, profiling stats, and validation issues into a single quality-scored report with an HTML download
- **Forecasting** — time-series forecasting on date columns (linear trend, moving average, seasonal naive) with horizon control and a chart/table
- **Big-Data engines** — optional Polars and Dask loaders at upload time; CSV/JSON/Parquet/Feather/XLSX files are loaded via Polars (fast) or Dask (out-of-core) and stored as pandas for downstream compatibility
- Validation report (duplicates, missing values, invalid emails/URLs, outliers, negative values)
- Analytics charts (histogram, bar, correlation matrix) via Recharts
- AI Chat assistant (rule-based NL → operation router, optional Ollama backend)
- **Export** the (cleaned) dataset to **CSV / Excel (.xlsx) / JSON** from Preview, Profiling, or the Cleaning Studio
- **Universal Database Platform — Phase 1 core**: database-agnostic `DatabaseAdapter` interface, AES-256-GCM encrypted connection profiles, adapter registry (SQLite, PostgreSQL, MongoDB available; MySQL/MariaDB/SQL Server/Oracle/Redis/Elasticsearch/VectorDBs declared), `DatabaseManager` with connection pooling, testing, switching, and reconnection. Backend routes for profile CRUD, connection testing, one-click database switching, schema discovery, and unified query execution. Frontend **Connections** page to manage profiles, switch active databases, and run queries without code changes or restarts.

Later phases layer on the full page set.

---

## Quick Start (local, no Docker)

> Requires Node 18+ and Python 3.10–3.12 recommended.

### 1. Python data engine

```bash
cd python-service
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2. Node backend (gateway + auth)

```bash
cd backend
npm install
npm run dev          # http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Open http://localhost:5173 and register an account. If port 5173 is busy, Vite will pick the next free port (e.g. 5174) — the `/api` proxy still targets the backend on 4000.

---

## Verify end-to-end (smoke test)

With all three services running, exercise the full stack (auth → admin → profile → upload → preview → validate → clean → analytics → chat → profiling → export → transforms → SQL → SQL cache → ML → report → forecast → polars upload → dask upload) in one shot:

```bash
powershell -ExecutionPolicy Bypass -File scripts/smoke_test.ps1
```

It uploads `docs/sample_data.csv` and asserts every stage returns successfully, finishing with `ALL SMOKE TESTS PASSED`.

---

## Quick Start (Docker)

```bash
docker-compose up --build
```

- Frontend: http://localhost:5173
- Backend:  http://localhost:4000
- Python:   http://localhost:8000/docs

---

## Environment

Copy `.env.example` files in `backend/` and `python-service/` if you need to override defaults. Sensible defaults are baked in for local development.

---

## Deploy to production (Vercel + Render)

The easiest free-tier stack is **Vercel** for the frontend and **Render** for the two backend services. All three connect to the same GitHub repository.

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial DataForge AI commit"
git branch -M main
git remote add origin https://github.com/Mohd-Nayab/dataforge-ai.git
git push -u origin main
```

Replace `dataforge-ai` with a different repository name if you prefer.

### 2. Create the GitHub repo (if not created)

You can either create an empty repo on GitHub first and use the URL above, or use the GitHub CLI:

```bash
gh repo create dataforge-ai --public --source=. --remote=origin --push
```

### 3. Deploy the Python service on Render

1. In Render, click **New +** → **Blueprint** and connect your GitHub repo.
2. Render reads `render.yaml` and creates two web services automatically.
3. For the Python service (`dataforge-python`), set:
   - **Runtime**: Python 3.11
   - **Build command**: `pip install -r requirements.txt`
   - **Start command**: `uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level warning`
4. Update `CORS_ORIGINS` in the service environment to include your deployed frontend URL.

### 4. Deploy the Node backend on Render

Render creates this from `render.yaml` as well (`dataforge-backend`). If you create it manually:

1. **New +** → **Web Service**, select the same repo, set **Root Directory** to `backend`.
2. **Build command**: `npm install && npm run build`
3. **Start command**: `npm start`
4. Set environment variables:
   - `JWT_SECRET` — generate a strong random string.
   - `PYTHON_SERVICE_URL` — the URL of the Render Python service.
   - `CORS_ORIGIN` — the URL of the Vercel frontend.

### 5. Deploy the frontend on Vercel

1. Import your GitHub repo in Vercel.
2. Set **Framework Preset** to **Vite** and **Root Directory** to `frontend`.
3. Add environment variable `VITE_API_URL` pointing to your Render backend (e.g. `https://dataforge-backend.onrender.com/api`).
4. Deploy.

### 6. Update Render URLs (if you changed service names)

Edit `render.yaml` and `frontend/.env.example` to match the actual Render service names, then push the changes.

## Database options

DataForge supports multiple storage backends for user/auth data through a swappable adapter (`backend/src/db`). Configure the default via environment variables, or switch live from the Admin dashboard.

| Type | `DATABASE_TYPE` | `DATABASE_URL` | Notes |
| --- | --- | --- | --- |
| JSON file (default) | `json` | _empty_ | Stored in `DATA_DIR/users.json`. Zero setup. |
| SQLite | `sqlite` | optional dir path | Local file DB via `better-sqlite3`. |
| PostgreSQL | `postgres` | `postgresql://user:pass@host:5432/dbname` | Uses `pg`. |
| MongoDB | `mongodb` | `mongodb+srv://user:pass@cluster.mongodb.net/dbname` | Uses `mongodb`. |

### Switch database from the UI

1. Log in as an **admin** user.
2. Open the **Admin** page → **Database Connection** card.
3. Pick a database, enter the connection URL (for Postgres/MongoDB), and click **Switch Database**.

The backend validates the connection and swaps the active adapter at runtime. To make a change permanent across restarts, also set `DATABASE_TYPE` and `DATABASE_URL` in your environment (or `render.yaml`).

> Note: switching databases does not migrate existing users. Each backend keeps its own data.

### Managed Postgres on Render (automatic)

`render.yaml` provisions a **free Render Postgres** instance (`dataforge-db`) and injects its connection string into the backend as `DATABASE_URL`, with `DATABASE_TYPE=postgres`. When you deploy the Blueprint, the backend uses Postgres out of the box — no manual URL needed.

- Hosted Postgres connections (Render, Neon, etc.) use SSL automatically; `localhost` connections do not.
- If the database is ever unreachable at startup, the backend logs a warning and falls back to JSON storage so it never crash-loops.
- Render's free Postgres expires after ~30 days; recreate it or point `DATABASE_URL` at another provider (e.g. Neon) when it lapses.

### MongoDB Atlas (free M0) setup

To demo the MongoDB adapter, create a free cluster and paste its URL into the Admin switcher:

1. Sign up at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas) and create a free **M0** cluster.
2. **Database Access** → add a database user (username + password).
3. **Network Access** → add IP `0.0.0.0/0` (allow from anywhere) so Render can connect.
4. **Connect** → **Drivers** → copy the connection string, e.g.
   `mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
5. Replace `<user>`/`<pass>` with your credentials.
6. In the app: **Admin** → **Database Connection** → choose **MongoDB**, paste the URL, click **Switch Database**.

The adapter uses the `dataforge` database and a `users` collection (created automatically). To make MongoDB the default across restarts, set `DATABASE_TYPE=mongodb` and `DATABASE_URL=<your Atlas URL>` in the backend environment.

### ChromaDB setup (local vector DB)

To use the ChromaDB vector adapter locally, start a Chroma server and switch the active database to **ChromaDB**.

1. Run Chroma with Docker:
   ```bash
   docker run -d -p 8000:8000 chromadb/chroma:latest
   ```
   Or use Python: `pip install chromadb && chroma run --host localhost --port 8000`
2. In the app: **Admin** → **Database Connection** → choose **ChromaDB**, enter host `localhost` and port `8000`, then click **Switch Database**.
3. To make ChromaDB the default across restarts, set `DATABASE_TYPE=chromadb` and `DATABASE_URL=http://localhost:8000` in your environment.

Collections are created on demand. Use the **Vector** mode in the query runner to run similarity searches over embeddings.

## Universal Database Platform Architecture

`backend/src/database` is designed as an adapter-based, multi-engine platform:

```
backend/src/database/
├── core/
│   ├── types.ts          # DatabaseAdapter interface, profile types, capabilities, QueryPlan
│   ├── crypto.ts         # AES-256-GCM credential encryption
│   ├── profiles.ts       # Encrypted on-disk profile store (CRUD)
│   ├── registry.ts       # Adapter registry / plugin catalog
│   └── DatabaseManager.ts# Pooling, switching, reconnect, unified query API
├── adapters/
│   ├── sqlite.ts         # Relational (sql + document query plans)
│   ├── postgres.ts       # Relational (sql + document query plans)
│   ├── mysql.ts          # Relational (sql + document query plans)
│   ├── mongodb.ts        # Document (document query plans)
│   └── chromadb.ts       # Vector (document + vector query plans)
└── index.ts              # Barrel + adapter registration
```

### How to add a new adapter

1. **Implement the interface** in `backend/src/database/adapters/<engine>.ts`:

```typescript
import { registerFactory } from "../core/registry.js";
import {
  NotSupportedError,
  type DatabaseAdapter,
  type ConnectionProfile,
  type QueryPlan,
  type QueryResult,
} from "../core/types.js";

class MyAdapter implements DatabaseAdapter {
  readonly type = "mydb" as const;
  readonly capabilities = { family: "relational", sql: true, documents: false, transactions: true, indexes: true, vectorSearch: false };
  async connect() { /* ... */ }
  async disconnect() { /* ... */ }
  async test() { return { ok: true, latencyMs: 0, message: "OK" }; }
  async executeQuery<T>(_sql: string, _params?: unknown[]): Promise<QueryResult<T>> { throw new NotSupportedError(this.type, "executeQuery"); }
  async find<T>(_target: string, _options?: unknown): Promise<T[]> { return []; }
  async insert<T>(_target: string, _doc: T | T[]): Promise<number> { return 0; }
  async update(_target: string, _filter: unknown, _changes: unknown): Promise<number> { return 0; }
  async delete(_target: string, _filter: unknown): Promise<number> { return 0; }
  async discoverSchema() { return { objects: [], discoveredAt: new Date().toISOString() }; }
  async query<T>(plan: QueryPlan): Promise<QueryResult<T>> {
    if (plan.mode === "sql" && plan.sql) return this.executeQuery<T>(plan.sql, plan.params ?? []);
    throw new NotSupportedError(this.type, "query");
  }
}

registerFactory("mydb", (profile) => new MyAdapter(profile));
```

2. **Register it** in `backend/src/database/index.ts`:

```typescript
import "./adapters/<engine>.js"; // module calls registerFactory internally
```

3. **(Optional)** If the new engine is the default backend store, add a migration strategy in the legacy `/admin/database` switch route.

### Security

- Credentials inside `ConnectionProfile` are encrypted with **AES-256-GCM** before being written to disk (`backend/data/profiles.json`).
- The key is derived from `JWT_SECRET` or `APP_SECRET`; generate a strong secret in production.
- The raw password is only sent from the client during create/update; the API never returns it.

## License

MIT
