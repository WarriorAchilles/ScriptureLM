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

**Health check:** with the app running, `GET /api/health` should return `200` and JSON `{ "ok": true }` (no database required).

## Local development — database

This project assumes **two layers** for Postgres during development:

1. **Primary — Docker Postgres + pgvector**  
   Run via `docker compose` (see Step 02 in [`planning-docs/steps/02-local-postgres-pgvector.md`](planning-docs/steps/02-local-postgres-pgvector.md)). Point **`DATABASE_URL`** in `.env.local` at this instance for everyday coding, tests, and offline work.

2. **Optional — cloud dev RDS**  
   When you need behavior closer to production (network, RDS parameters, shared dev data), provision a **dev RDS** Postgres instance with pgvector and use a second URL (e.g. **`DATABASE_URL_RDS_DEV`** in `.env.local`). The running app still reads **`DATABASE_URL`** only: copy the RDS URL into **`DATABASE_URL`** when you want the app and migrations to hit RDS, or use your own comment/uncomment convention — do **not** run destructive migrations against the wrong target.

Implementation steps for agents and operators: [`planning-docs/steps/README.md`](planning-docs/steps/README.md).
