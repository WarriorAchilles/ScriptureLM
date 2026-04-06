# Step 05: Authentication (single-user MVP)

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §4.1 (minimal auth), §6.2 (Cognito or Auth.js), §6.6 (session security), §5.1 / §15 #4 (one notebook / one thread).

## Manual actions (you must do)

- If you use **OAuth or Cognito**: create the app/client in the provider console, set **callback URLs** for local and production, and paste **client ID/secret** into `.env`.
- If you use **credentials (email/password)** only: choose an initial password and create the first account via the sign-up flow the agent implements, **or** run the documented seed once in dev.
- Never commit **session secrets** (`AUTH_SECRET` / `NEXTAUTH_SECRET`); generate a long random string locally.

## Instructions for the AI coding agent

1. Implement authentication appropriate for **solo MVP** (§4.1). **Default recommendation:** **Auth.js (v5)** with a **Credentials** provider and **bcrypt**-hashed passwords stored on **User**, unless the human specified Cognito/OAuth in `.env`.
2. Add **middleware** or **layout guards** so routes under **`/workspace`** (or agreed path) require a session; unauthenticated users go to **`/sign-in`**.
3. Add **sign-in** and **sign-out** UI (minimal styling consistent with the app).
4. On **first successful authentication**, ensure **exactly one `Notebook`** and **one `ChatThread`** exist for that user (create if missing). Use a **transaction** and handle races (unique indexes from Step 03).
5. Add **`tenant_id`** column to **User** or Notebook if not present—**nullable** UUID/string ok for v1 (§4.2). Document future use in a comment.
6. Optional: add **`role`** enum (`user` | `admin`) on **User**; default new dev seed user to **`admin`** for operator scripts later.
7. Add **tests**: unauthenticated `GET` to a protected API returns **401**; authenticated session can `GET` workspace shell data.
8. **Do not** implement catalog or RAG in this step.

## Definition of done (testable)

- Unauthenticated access to `/workspace` **redirects** to sign-in (or API returns 401).
- After sign-in, user lands on an **empty workspace** shell.
- Sign-out clears the session; protected routes are inaccessible again.
- Automated test covers at least one **401** and one **authenticated** path.
