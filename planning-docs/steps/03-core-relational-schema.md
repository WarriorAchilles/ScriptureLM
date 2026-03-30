# Step 03: Core relational schema

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §7 (data model), §5.1–§5.2 (notebook vs global sources), §15 #1 and #9.

## Manual actions (you must do)

- Run **`docker compose up`** (or ensure your active DB is up) and apply migrations using the commands the agent documents (e.g. `npm run db:migrate`). Use **Docker `DATABASE_URL`** for normal runs; run the same migration command against **dev RDS** only when you have temporarily pointed **`DATABASE_URL`** there (or use your ORM’s direct URL flag if documented). This is **operations**, not authoring schema—you only execute.

## Instructions for the AI coding agent

1. Translate **§7** into **migrations** for: **User**, **Notebook**, **ChatThread**, **Message**, **Source**, **Chunk**, **Job** (names may match your ORM conventions).
2. **Enforce v1 product rules** in schema or documented DB constraints:
   - At most **one `Notebook` per `user_id`** (unique index on `notebook.user_id`).
   - At most **one `ChatThread` per `notebook_id`** (unique index on `chat_thread.notebook_id`).
3. **`Source`** (global catalog, no `notebook_id`):
   - `type`: `pdf` | `text` | `markdown`.
   - `corpus`: `scripture` | `sermon` | `other`.
   - `status` for ingest lifecycle; `error_message`; `storage_key`; checksum; byte size; `text_extraction_version` or pipeline version field if not already named in §7.
   - **Soft delete / hide**: `deleted_at` or equivalent; **`purge_after`** for scheduled hard delete (§15 #9).
   - Audit: `created_at`, `updated_at`, optional `created_by`.
4. **`Chunk`**: `source_id` FK, `content`, `metadata` JSON (page, offsets, `chunk_index`, `bible_book`, sermon identifiers as strings), **`embedding_model`** string (nullable until Step 08), **vector** column with dimension matching Step 08 (use **placeholder dimension** 1024 or document “replace when Titan dimension confirmed” + follow-up migration in Step 08).
5. **`Message`**: `thread_id`, `role`, `content`, optional **`retrieval_debug` JSON** (nullable).
6. **`Job`**: `type` `ingest` | `reindex`, `payload` JSON, `status`, `attempts`, timestamps.
7. Add **indexes** on `source_id`, `thread_id`, `notebook_id`, and any columns used for listing sources by status/corpus.
8. Add a **`seed` or `db:seed` script** (dev-only) that inserts: one user → one notebook → one thread → one minimal `Source` (or use a test factory) to validate FKs.
9. Add an **automated test** or script that asserts **second notebook** for same user fails at DB level **or** that application-level guards exist—**document which** in a short comment near the migration.

## Definition of done (testable)

- Migrations apply on a **fresh** DB from Step 02 without errors.
- Seed or test factory creates the chain user → notebook → thread → source without manual SQL.
- Uniqueness behavior for notebook/thread is covered by test or migration comment as specified above.
