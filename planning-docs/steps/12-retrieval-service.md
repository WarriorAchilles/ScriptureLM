# Step 12: Retrieval service (scoped vector search)

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.3, §5.1, §6.4 query path, §15 #7 (vector-only), §12 #2.

## Manual actions (you must do)

- None beyond keeping **Docker/DB** running and having **seeded chunks with embeddings** from Steps 07–09 for manual smoke tests.

## Instructions for the AI coding agent

1. Implement **`lib/retrieval/search.ts`** exporting **`retrieveContext(params)`** where `params` includes:
   - `query: string`
   - `limit: number` (k)
   - `sourceIds?: string[]` — if **undefined** or empty array meaning “all”, define behavior explicitly: **all non-hidden `ready` sources**.
   - `corpus?: 'scripture' | 'sermon' | 'other'` optional filter joining **`Source`**.
2. **Embed query** using **same** Bedrock helper as Step 08 (shared module).
3. **SQL**: `pgvector` distance operator (`<=>` or `<->` per your setup), **`WHERE source_id = ANY($1)`** when scoped, **`JOIN sources`** to filter **`deleted_at IS NULL`** and **`status = 'ready'`**.
4. Return **ranked** rows: chunk `id`, `content`, `metadata`, `source_id`, **display fields** for citations (book, title, filename).
5. Optional **quota split** when no `corpus` filter: e.g. `k/2` from `scripture` and `k/2` from `sermon` using **UNION** or two queries—implement **simple** version to mitigate corpus dominance (§5.3); document limitations.
6. **Logging**: debug log **top source_ids** (no PII).
7. **Tests**:
   - **Unit**: inject **fixed** tiny vectors in DB (or mock DB) so nearest neighbor is deterministic.
   - **Exclusion**: scoped `sourceIds` omit other sources.
   - **Empty**: no matches returns `[]` without throw.

## Definition of done (testable)

- `npm test` covers deterministic top-1 hit, exclusion, and empty retrieval.
- Manual: one SQL or script invocation logs plausible chunk IDs for a sample query against dev data.
