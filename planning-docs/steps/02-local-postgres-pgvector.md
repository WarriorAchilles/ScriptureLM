# Step 02: Local PostgreSQL + pgvector

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §6.2 (RDS + pgvector), §6.4 (vectors colocated with metadata), §15 #2.

## Manual actions (you must do)

- Install **Docker Desktop** (or compatible) if you have not (see Step 00).
- Add a **`docker-compose.yml`** (or agreed alternative) that runs **PostgreSQL with the pgvector extension** available. Many teams use an image that ships pgvector preinstalled.
- Choose a migration tool (**Prisma**, **Drizzle**, **Knex**, raw SQL, etc.) and add it to the repo—this step only needs the **extension enabled** and a connection URL.

## Goal

Developers can run **`docker compose up`** (or one command) and connect to a database that supports **`vector`** embeddings alongside relational tables.

## What you will build

- Compose service (or documented cloud dev DB) with persisted volume.
- A migration or bootstrap SQL that runs **`CREATE EXTENSION IF NOT EXISTS vector`**.
- Document **connection string** format in `.env.example` (no real secrets committed).

## Implementation notes

- Match the **embedding dimensions** you will use in Step 08 when you declare vector columns (you can use a placeholder dimension if the exact Titan size is not finalized yet—then adjust in Step 08 with a follow-up migration).
- Keep **tenant_id** columns in mind for later SaaS posture (§4.2); you can add nullable columns early or wait until Step 3—either way, avoid designs that block multi-tenant evolution.

## Definition of done (testable)

- From a clean clone, one documented command starts Postgres and pgvector is enabled (verify with `SELECT extname FROM pg_extension WHERE extname = 'vector';`).
- The app (or a small `scripts/db-check.ts`) can **open a pooled connection** using `DATABASE_URL` and run a trivial query.
