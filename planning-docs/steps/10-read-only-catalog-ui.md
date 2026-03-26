# Step 10: Read-only source catalog (API + UI)

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.2 (source list UX), §5.1 (indexing status visibility), §6.5 (no end-user upload), §2 goals (multi-source KB).

## Manual actions (you must do)

- Seed or ingest **at least two** `Source` rows with different **`corpus` values** so the UI is non-trivial (e.g. one `scripture` book fixture, one `sermon` fixture).
- Decide **empty-state** copy that explains the **shared catalog** model (§1, §5.1)—no user uploads.

## Goal

Authenticated users see a **read-only** list of sources: **name/title**, **corpus tag**, **indexing status**, and enough identity to pick sources later (§5.2).

## What you will build

- **API**: list sources (exclude soft-deleted/hidden by default per Step 03 rules).
- **UI page** in the workspace: table or cards with status badges (`pending`, `ready`, `failed`), error hint for failures.
- Loading and error states; keyboard-accessible layout (§6.5 accessibility note).

## Implementation notes

- **No mutation controls** for ordinary users (§5.2).
- Fetch should be **efficient enough** for ~1,200 sermon rows—consider pagination or virtualized list when you approach that scale (§11 “corpus scale”).

## Definition of done (testable)

- Manual or E2E: logged-in user opens catalog page and sees **correct row count** matching API.
- A `failed` source shows **actionable error text** from `error_message` (truncated ok).
- Unauthenticated user **cannot** access the catalog API (401/403/redirect).
