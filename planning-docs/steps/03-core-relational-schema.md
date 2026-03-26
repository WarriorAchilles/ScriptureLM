# Step 03: Core relational schema

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §7 (data model), §5.1–§5.2 (notebook vs global sources), §15 #1 and #9 (source lifecycle).

## Manual actions (you must do)

- Translate §7 into **concrete table definitions** (names may vary slightly).
- Decide **UUID vs. bigserial** primary keys; pick one style and apply consistently.
- Add **constraints**: at most **one notebook per user** (v1 product rule), at most **one thread per notebook** for MVP (§5.1, §15 #4).

## Goal

Persist **Users**, **Notebooks**, **ChatThreads**, **Messages**, **Sources**, **Chunks** (or chunk table + separate vector table—your choice as long as joins are clear), and **Jobs** with statuses aligned to ingest/reindex (§7).

## What you will build

- Migrations creating tables and indexes for:
  - **User**, **Notebook** (`user_id` unique where appropriate).
  - **ChatThread** (`notebook_id` unique for v1).
  - **Message** (`thread_id`, role, content, optional `retrieval_debug` JSON).
  - **Source** with **`corpus`** enum/tag (`scripture` | `sermon` | `other`), **type** (`pdf` | `text` | `markdown`), **status**, error fields, **`storage_key`**, checksum, **`deleted_at` / hide**, **`purge_after`**, audit timestamps (§5.2, §15 #9).
  - **Chunk** linked to `source_id`, content, metadata JSON, embedding column or FK to vector store mirror.
  - **Job** (`ingest` | `reindex`), payload JSON, status, attempts.
- Foreign keys and indexes on **`source_id`**, **`thread_id`**, **`notebook_id`**.

## Implementation notes

- **Sources are global**—no `notebook_id` on `Source` (§5.2).
- Reserve space for **`embedding_model`** and dimension metadata on chunks or a side table (§6.3 “Critical” note).
- Soft-delete fields should make **hidden sources invisible** to default catalog queries (implement query filters when you build APIs in later steps).

## Definition of done (testable)

- Migrations apply cleanly on a fresh database from Step 02.
- A **seed script or SQL fixture** can insert: 1 user → 1 notebook → 1 thread → 1 source (minimal required columns) without errors.
- Automated test or script asserts **uniqueness** rules you chose (e.g. second notebook for same user fails, or app-level guard—document which).
