# ScriptureLM

NotebookLM-style theological research workspace (shared catalog, RAG chat, grounded summaries). Product scope and architecture live in [`planning-docs/NOTEBOOKLM-CLONE-MASTER-SPEC.md`](planning-docs/NOTEBOOKLM-CLONE-MASTER-SPEC.md).

## Web app

The UI and API are a **Next.js** (App Router) app in this repo (see Step 01 in [`planning-docs/steps/01-nextjs-monolith-scaffold.md`](planning-docs/steps/01-nextjs-monolith-scaffold.md)).

**Prerequisites:** Node.js LTS and npm.

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Development server ([http://localhost:3000](http://localhost:3000)) |
| `npm run build` | Production build |
| `npm run start` | Run the production server (after `build`) |
| `npm run lint` | ESLint |
| `docker compose up -d` | Start local Postgres + pgvector (Step 02; requires Docker) |
| `npm run db:migrate:dev` | Apply Prisma migrations to `DATABASE_URL` (first-time / schema changes) |
| `npm run db:migrate` | Apply migrations (e.g. CI/production-style) |
| `npm run db:check` | Verify `DATABASE_URL` accepts connections (`SELECT 1`) |
| `npm run db:check:rds` | Same using `DATABASE_URL_RDS_DEV` if set; exits 0 with “skipping” if unset (CI-friendly) |

**Health check:** with the app running, `GET /api/health` should return `200` and JSON `{ "ok": true }` (no database required).

**pgvector:** after migrations, `SELECT extname FROM pg_extension WHERE extname = 'vector'` should return a row on the compose database.

## Local development — database

This project assumes **two layers** for Postgres during development:

1. **Primary — Docker Postgres + pgvector**  
   Run via `docker compose` (see Step 02 in [`planning-docs/steps/02-local-postgres-pgvector.md`](planning-docs/steps/02-local-postgres-pgvector.md)). Point **`DATABASE_URL`** in `.env.local` at this instance for everyday coding, tests, and offline work.  
   Compose maps **host port `5433` → container `5432`** so a PostgreSQL install already bound to `5432` on your machine does not block the stack; change `ports` in `docker-compose.yml` to `5432:5432` if you prefer the default host port and nothing else uses it.

2. **Optional — cloud dev RDS**  
   When you need behavior closer to production (network, RDS parameters, shared dev data), provision a **dev RDS** Postgres instance with pgvector and use a second URL (e.g. **`DATABASE_URL_RDS_DEV`** in `.env.local`). The running app still reads **`DATABASE_URL`** only: copy the RDS URL into **`DATABASE_URL`** when you want the app and migrations to hit RDS, or use your own comment/uncomment convention — do **not** run destructive migrations against the wrong target.

Implementation steps for agents and operators: [`planning-docs/steps/README.md`](planning-docs/steps/README.md).
