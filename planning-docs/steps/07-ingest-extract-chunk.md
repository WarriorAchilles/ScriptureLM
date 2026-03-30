# Step 07: Ingest — extract, normalize, chunk (no embeddings yet)

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §6.4 (extract–chunk), §2 (file types), §15 #8 (text-native PDF only), §15 #1 (66 book sources).

## Manual actions (you must do)

- If **PDF tests** need files you do not want in git, place fixtures **locally** and set a **path env var** the agent documents—or approve small **public-domain** snippets committed under `test/fixtures/`.
- You are responsible for **not uploading copyrighted** bulk corpora without rights (§3.1); the agent only provides tooling.

## Instructions for the AI coding agent

1. Add **`lib/ingest/`** (or similar) with pure, testable functions:
   - **`extractText(sourceType, buffer | stream)`** — **`.md` / `.txt`**: UTF-8 read; **PDF**: use a maintained library (**text-layer PDFs only** per §15 #8). Document “no OCR / text-layer only” in a **top-of-module comment** on the extract entrypoint.
   - **`normalizeText(raw)`** — collapse excessive whitespace; preserve paragraph breaks for md.
   - **`chunkText(normalized, options)`** — fixed window + overlap **or** paragraph-based splitting; include **`chunk_index`** stable ordering. For **scripture-shaped** content, optional verse-line splitting behind a flag; default to simple windows if ambiguous (§12 #1).
2. **`runExtractAndChunk(sourceId)`** pipeline:
   - Load `Source` from DB; **skip** if `deleted_at` set.
   - Download bytes from S3 (Step 06 helper).
   - Extract → normalize → chunk → **delete existing chunks** for that `source_id` then **insert** new rows (idempotent re-run).
   - Set **`Source.status`** to `failed` with **`error_message`** on throw; on success leave **`pending`** for embedding step **or** set intermediate state documented in code—**must** align with Step 08/09 (if chunks exist without embeddings, define `chunks_ready` vs `ready`; document one scheme).
3. Attach **metadata JSON** per chunk: `source_id`, `chunk_index`, optional `page`, **`corpus`** copied from Source, **`bible_book`** from Source metadata column if present, sermon id from filename regex if available.
4. Add **committed tiny fixtures**: `fixture.md`, `fixture.txt`, **small text-based PDF** if license permits, or generate PDF in test with a dev dependency—prefer smallest path.
5. **Tests**: markdown source → **N chunks** with consecutive indices; corrupt PDF → `failed` status with non-empty error.
6. Expose operator entry: **extend** Step 06 CLI with `ingest:chunk --sourceId=` **or** internal API—reuse same secret/role guards.

## Definition of done (testable)

- `npm test` (or subset) covers markdown chunking and failure path.
- Running the documented command against a test `source_id` yields **Chunk** rows in DB and stable re-run (no duplicate indices after second run).
