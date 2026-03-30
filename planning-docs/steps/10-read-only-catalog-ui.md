# Step 10: Read-only source catalog (API + UI)

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.2 (source list UX), §5.1 (indexing status), §6.5 (no end-user upload).

## Manual actions (you must do)

- In **dev**, use operator tooling (Steps 06–09) or seed data so **at least two** `Source` rows exist with different **`corpus`** values—so you can **see** the UI populated. This is data entry / ops, not code.
- Optionally tell the agent preferred **product tone** for empty-state copy (theological workspace vs neutral); otherwise the agent picks concise default copy aligned with §1.

## Instructions for the AI coding agent

1. **`GET /api/sources`** (or Server Component loader with auth): returns **paginated** list of catalog sources **excluding** soft-deleted/hidden by default (Step 03 filters). Include: **display name/title** (from metadata or filename), **`corpus`**, **`status`**, **`error_message`** (truncated for UI), **`updatedAt`**.
2. Enforce **session**: same auth as Step 05; return **401** when unauthenticated.
3. Add **`/workspace/sources`** (or nested route): **read-only** table or card grid; **status badges** for `pending` / `ready` / `failed`; show **error snippet** for failures (§5.2).
4. **Accessibility**: semantic table or list, **focus** styles, `aria-live` for loading/errors where appropriate (§6.5).
5. **Performance**: implement **`limit` + `cursor`** or offset pagination; document how UI will scale toward **~1,200** rows (virtualization optional but comment the hook point §11).
6. **No** upload, delete, or edit controls for end users (§5.2).
7. **Tests**: API returns 401 without session; with mocked session returns expected JSON shape.

## Definition of done (testable)

- Logged-in user sees row count matching API for seeded data.
- `failed` source shows human-readable **error** from DB.
- Unauthenticated `GET /api/sources` → **401**.
