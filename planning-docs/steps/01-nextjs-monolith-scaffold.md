# Step 01: Next.js monolith scaffold

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §6 (monolith), §6.5 (App Router), §6.1 (web app component), §15 #5.

## Manual actions (you must do)

- Ensure **Node.js LTS** is installed and you can run the package manager the repo will use (`npm`, `pnpm`, or `yarn`).
- If your organization requires a specific registry or proxy, configure it before installing dependencies.

## Instructions for the AI coding agent

1. **Scaffold or align** a **Next.js** app with **TypeScript** and the **App Router** (§6.5). If the repo already has a Next app, normalize it to this shape instead of nesting a second app.
2. Add baseline **scripts**: `dev`, `build`, `start`, `lint` (and `format` if the repo uses Prettier).
3. Add a minimal **root layout** and a simple **home page** (placeholder copy is fine).
4. Implement **`GET /api/health`** as a Route Handler returning JSON such as `{ "ok": true }` with **no** database or external service calls.
5. Create a **`src/lib/`** (or `lib/`) folder convention and a **stub** `package.json` script or comment block documenting where a future **`worker`** entry will live (same repo, shared imports per §6.1).
6. Ensure **`npm run build`** passes in CI-friendly conditions (strict TypeScript if the template enables it).
7. **Do not** add auth, ORM, AWS SDK, or vector dependencies in this step.

## Definition of done (testable)

- `npm run dev` (or equivalent) starts without errors.
- `GET /api/health` returns **200** and JSON indicating readiness.
- `npm run build` succeeds.
