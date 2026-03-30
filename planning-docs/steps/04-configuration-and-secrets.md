# Step 04: Configuration and secrets boundary

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §6.6 (secrets, TLS), §6.5 (no client API keys), §9.

## Manual actions (you must do)

- After the agent adds **`.env.example`**, copy it to **`.env.local`** and fill **real secret values** (never commit `.env.local`).
- If you use **AWS SSO or named profiles** locally, configure the AWS CLI/SDK credentials the agent documents for Bedrock/S3 in later steps.

## Instructions for the AI coding agent

1. Create or expand **`.env.example`** with **every** variable needed through Step 16 placeholders: **`DATABASE_URL`** (Docker Postgres for default local dev), **`DATABASE_URL_RDS_DEV`** (optional — cloud dev RDS; app still reads **`DATABASE_URL` at runtime** unless you add explicit multi-DB support, which is out of scope), `AWS_REGION`, `S3_BUCKET` (or equivalent), `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` or **profile** note, `BEDROCK_EMBEDDING_MODEL_ID`, `ANTHROPIC_API_KEY`, auth secrets (`NEXTAUTH_SECRET` / `AUTH_SECRET`, OAuth IDs if used), **`OPERATOR_INGEST_SECRET`** (or similar) for protected operator routes, optional `SQS_QUEUE_URL`. Keep the **Docker + optional RDS** local dev story aligned with Step 02 and the root `README.md`.
2. Implement **`src/lib/config.ts`** (or equivalent) that:
   - Parses and **validates** required env vars for **server runtime**.
   - Exports typed **`serverEnv`** (or getters) used by Route Handlers, server actions, and worker—**never** import this module from client components.
3. Add **`npm run check-env`** that loads `.env.example` keys list (or a static list in code) and verifies **presence** of required keys when `NODE_ENV=production` **or** when `REQUIRE_FULL_ENV=1`—**do not print values**.
4. Wire **Next.js** so missing critical env in production fails at **startup** or first server init with a **clear error message** (which variable is missing).
5. Add **ESLint rule** or **commented grep checklist** in `CONTRIBUTING` fragment: forbid `process.env.ANTHROPIC` / `AWS_SECRET` in files marked `"use client"` or under `app/**/client`—adapt to project structure.
6. Document in a short **code comment** in `config.ts` that Step 16 may load from **Secrets Manager/SSM** without changing call sites (same env var names in **App Runner**).

## Definition of done (testable)

- Starting the app with **`REQUIRE_FULL_ENV=1`** (or prod mode) and missing a required key throws or logs a **named** missing variable before handling user traffic.
- `npm run check-env` exits **0** when all required keys are set and **non-zero** when one is removed.
- No Anthropic or raw AWS secret keys appear in **`NEXT_PUBLIC_*`** variables.
