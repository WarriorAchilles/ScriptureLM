# Step 07: Ingest — extract, normalize, chunk (no embeddings yet)

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §6.4 (steps 2–4), §2 (file types), §15 #8 (text-native PDF only).

## Manual actions (you must do)

- Choose PDF text extraction library compatible with **text-based PDFs** only (§15 #8); document “scanned PDFs unsupported in v1.”
- Add **fixture files** to the repo (small public-domain snippets) or store them locally for tests—avoid committing large corpora.
- Decide **chunking strategy** for **Scripture** (per-book `Source`, verse-aware vs window—§12 open decision #1) and implement **one** concrete approach you can change later with **`text_extraction_version` / pipeline version** metadata (§6.4, §7 `Source` fields).

## Goal

For a `Source` in `pending`, the pipeline **reads from S3**, **extracts text**, **normalizes**, **chunks**, and writes **`Chunk` rows** with rich **metadata** (`source_id`, `chunk_index`, page if PDF, corpus tag, bible_book / sermon id fields when known) (§6.4).

## What you will build

- Ingest module(s) shared by web and future worker: **extract → normalize → chunk → persist**.
- Idempotent guardrails: re-running ingest for the same source **replaces** or **versions** chunks deterministically (prep for §9 idempotency).
- Update **`Source.status`** to `ready` when chunk persistence succeeds, or `failed` with **`error_message`** on failure (§6.4 step 6).

## Implementation notes

- Embeddings **not required** in this step; vector column may be null or empty.
- For **66 Bible books**, each book is its own `Source` with `corpus=scripture` and **`bible_book`** metadata (§15 #1).
- Keep chunk content sized for later embedding token limits (§6.3 token/window note).

## Definition of done (testable)

- Automated test: given a **markdown** `Source` fixture, database contains **N chunks** with consecutive indices and expected metadata.
- Automated test: a **text PDF** fixture extracts non-empty text; **intentionally bad** input marks `Source` as `failed` with a useful error.
- Operator command from Step 06 extended (or new command) runs **extract+chunk only** and completes without manual DB edits.
