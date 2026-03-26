# Step 05: Authentication (single-user MVP)

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §4.1 (single user / minimal auth), §6.2 (Cognito or Auth.js), §6.6 (session security).

## Manual actions (you must do)

- Choose **Auth.js (NextAuth)** with credentials stored in DB, **Amazon Cognito**, or another approach that satisfies “not public” (§4.1). For solo MVP, a **single allowed user** is acceptable.
- Register your app’s **callback URLs** / **JWT secrets** in the provider console if applicable.
- Create the **first User row** (migration seed or signup flow—your choice).

## Goal

The main **workspace routes** require authentication; anonymous visitors cannot read catalog or chat data (§4.1, §6.6).

## What you will build

- Session creation and persistence appropriate to your auth choice.
- Middleware or layout guards so `/workspace` (or your route) **redirects unauthenticated** users to sign-in.
- On first login, **ensure** `Notebook` and single `ChatThread` exist for that user (§5.1, §15 #4)—can be lazy-created here or in Step 11, but must be consistent.

## Implementation notes

- Even for one user, model **`tenant_id`** or `user_id` on user-owned rows for future SaaS (§4.2).
- **Admin/operator** vs **end user** roles: not strictly required until protected operator routes exist; if you add `role` early, default the solo user to `admin` for local ingest scripts.

## Definition of done (testable)

- Unauthenticated request to a protected page receives **redirect** or **401** from API as designed.
- Authenticated user can load an **empty workspace shell** (no RAG yet is fine).
- Logging out (if implemented) clears the session; protected routes are inaccessible again.
