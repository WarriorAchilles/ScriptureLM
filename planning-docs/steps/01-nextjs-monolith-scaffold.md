# Step 01: Next.js monolith scaffold

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §6 (monolith posture), §6.5 (App Router), §6.1 component (1) web app.

## Manual actions (you must do)

- Initialize the repo layout if not already present (`create-next-app` or equivalent) and choose **TypeScript** + **App Router** (§6.5).
- Pick package manager (`npm`, `pnpm`, or `yarn`) and stick to it for the project.

## Goal

A **single deployable Next.js application** that will later host UI, API routes, and can share code with a worker process from the same repo (§6.1, §15 #5).

## What you will build

- Next.js project with **App Router**, baseline **lint/format** scripts, and a minimal **layout** (placeholder home).
- A trivial **`GET /api/health`** (or Route Handler equivalent) returning JSON `{ "ok": true }` without external dependencies.

## Implementation notes

- Do **not** add vector DB or auth in this step; keep the shell boring and fast to iterate.
- Structure folders so a future **worker entry** (e.g. `worker.ts` or separate npm script) can import shared ingest/retrieval modules without circular hacks.

## Definition of done (testable)

- `npm run dev` (or your package manager equivalent) starts without errors.
- `GET /api/health` returns **200** and JSON indicating readiness.
- `npm run build` (or CI build) succeeds.
