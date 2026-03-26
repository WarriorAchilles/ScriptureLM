# Step 14: Source scope and corpus presets (UI + API)

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.1 (default full catalog, narrowing), §5.3 (active scope per message), §6.5 (corpus-aware controls), §13 success criteria (Scripture-only / sermons-only).

## Manual actions (you must do)

- Design the **scope control UX**: presets **All / Scripture / Sermons** plus **multi-select sources** (§6.5). Keep it accessible (keyboard + screen reader labels).
- With real corpus size, consider **search/filter** within the source list for picking individual sermons.

## Goal

Each chat request carries an **explicit active `source_id` set** derived from UI state; retrieval respects it end-to-end (§5.1, §5.3).

## What you will build

- Client state: selected preset + optional **overrides**.
- Server validation: only **existing, non-hidden** `source_id`s; presets map to SQL filters (`corpus`) or expanded ID lists.
- **Regression tests**: same question with **Scripture-only** vs **Sermons-only** returns different top chunks on a seeded split corpus.

## Implementation notes

- **Balancing corpora** when “All” is selected (§5.3 “source-aware retrieval”)—implement at least **corpus filter** or simple **per-corpus quotas** in SQL (e.g., take `k/2` from each) if you observe dominance in practice.
- Default remains **full catalog** when user clears selection (§5.1).

## Definition of done (testable)

- Manual: toggle Scripture-only; ask a question known to hit sermon-only fixture; answer should **not** cite sermon when scope is Scripture-only (given your seed data).
- Automated: API rejects **invalid** `source_id` with 400.
- Snapshot or unit test for **preset → SQL filter** mapping to prevent accidental regressions.
