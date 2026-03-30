# ScriptureLM

NotebookLM-style theological research workspace (shared catalog, RAG chat, grounded summaries). Product scope and architecture live in [`planning-docs/NOTEBOOKLM-CLONE-MASTER-SPEC.md`](planning-docs/NOTEBOOKLM-CLONE-MASTER-SPEC.md).

## Local development — database

This project assumes **two layers** for Postgres during development:

1. **Primary — Docker Postgres + pgvector**  
   Run via `docker compose` (see Step 02 in [`planning-docs/steps/02-local-postgres-pgvector.md`](planning-docs/steps/02-local-postgres-pgvector.md)). Point **`DATABASE_URL`** in `.env.local` at this instance for everyday coding, tests, and offline work.

2. **Optional — cloud dev RDS**  
   When you need behavior closer to production (network, RDS parameters, shared dev data), provision a **dev RDS** Postgres instance with pgvector and use a second URL (e.g. **`DATABASE_URL_RDS_DEV`** in `.env.local`). The running app still reads **`DATABASE_URL`** only: copy the RDS URL into **`DATABASE_URL`** when you want the app and migrations to hit RDS, or use your own comment/uncomment convention — do **not** run destructive migrations against the wrong target.

Implementation steps for agents and operators: [`planning-docs/steps/README.md`](planning-docs/steps/README.md).
