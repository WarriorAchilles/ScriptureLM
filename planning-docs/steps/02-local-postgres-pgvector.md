# Step 02: Local PostgreSQL + pgvector

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §6.2 (RDS + pgvector), §6.4 (vectors with metadata), §15 #2.

**Local dev database (project default):** **Docker Postgres + pgvector** is the everyday database; **optional cloud dev RDS** uses the same schema/migrations but a second connection string you swap into **`DATABASE_URL`** only when you want AWS-parity checks (see root `README.md`).

## Manual actions (you must do)

- Install and run **Docker Desktop** (or compatible engine) so `docker compose` works.
- After the agent adds `.env.example`, copy variables into **`.env.local`** (gitignored). Set **`DATABASE_URL`** to your **Docker** Postgres connection string for normal work (password you chose for compose).
- **Optional:** If you use **dev RDS**, add its connection string to **`.env.local`** as **`DATABASE_URL_RDS_DEV`** (or copy it over **`DATABASE_URL`** when testing against AWS). Ensure **network access** to RDS from your machine.

## Instructions for the AI coding agent

1. Add **`docker-compose.yml`** at the repo root (or `infra/`) with a **PostgreSQL image that includes pgvector** (e.g. `pgvector/pgvector:pg16` or equivalent), a **named volume** for data persistence, port mapping **5432**, and documented env vars for user/password/database.
2. Choose and install a **migration tool** consistent with the project (Use Prisma).
3. Add an initial migration (or bootstrap SQL) that runs **`CREATE EXTENSION IF NOT EXISTS vector`**.
4. Add **`.env.example`** with:
   - **`DATABASE_URL`** — placeholder pointing at **Docker** Postgres (primary local dev).
   - **`DATABASE_URL_RDS_DEV`** — optional commented placeholder for **cloud dev RDS**; document that the app uses **one** active URL at runtime (`DATABASE_URL`) and developers **copy** `DATABASE_URL_RDS_DEV` → `DATABASE_URL` when switching targets, or use two `.env.local` snippets they comment/uncomment — pick one convention and state it in comments.
5. Add a **small connectivity check**: `scripts/db-check.ts` (or `.mjs`) runnable via `npm run db:check` that connects with **`DATABASE_URL`** and runs `SELECT 1`. Optionally support `npm run db:check:rds` that uses **`DATABASE_URL_RDS_DEV`** when set (skip in CI if unset).
6. Use a **placeholder embedding dimension** for any vector column only if Step 03 introduces it; if this step stays extension-only, do not add application tables yet beyond what the migration tool requires.
7. Mention in code comments that **nullable `tenant_id`** on user-owned tables will appear in Step 03 for SaaS evolution (§4.2).

## Definition of done (testable)

- From a clean clone: `docker compose up -d` (or documented command) starts Postgres; `SELECT extname FROM pg_extension WHERE extname = 'vector'` returns a row when run against that DB.
- `npm run db:check` succeeds when **`DATABASE_URL`** points at the compose database.
- **Optional:** `npm run db:check:rds` succeeds when **`DATABASE_URL_RDS_DEV`** is set and RDS is reachable; if the script is omitted, `.env.example` must still document the RDS swap workflow.
