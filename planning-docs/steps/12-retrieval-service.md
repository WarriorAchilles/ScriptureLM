# Step 12: Retrieval service (scoped vector search)

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.3 (retrieval + scope), §5.1 (active source set), §6.4 query path, §15 #7 (vector-only first), §12 open #2.

## Manual actions (you must do)

- Build a **small golden fixture set**: 2–3 chunks with **known text** and distinct `source_id` / `corpus` to eval retrieval (prep for §8 golden set).
- If retrieval quality is weak on toy data, **iterate chunk sizes** before wiring Claude (§12 #1).

## Goal

A pure function / module: given **`query text`**, **`embedding model`**, **`active_source_ids`** (optional “all ready sources”), and **`k`**, returns **ranked chunks** with metadata needed for citations (§6.4 query path).

## What you will build

- **Embed query** via same Bedrock model as Step 08.
- **pgvector similarity search** with **`WHERE source_id = ANY($1)`** or equivalent; exclude hidden/deleted sources.
- Optional **MMR** or simple **diversity** hook—only if timeboxed; otherwise document as Phase 2 (§10 Phase 2).
- Corpus-level tuning hooks: even a basic **`corpus filter`** (`scripture` only / `sermon` only) at SQL level satisfies early §5.3 intent.

## Implementation notes

- **Vector-only** default; hybrid/BM25 explicitly deferred unless you reopen §12 #2 with evidence.
- Log **which source_ids** matched for debugging—later `retrieval_debug` can store this (§5.3).

## Definition of done (testable)

- Unit/integration test: with controlled embeddings (can be **deterministic tiny vectors** in test), top-1 hit is the expected chunk when scopes include its `source_id`.
- Test: with **excluded** `source_id`, that chunk **never appears** in top-k.
- Test: **empty** `active_source_ids` or no matches returns **empty list** without throwing (§5.3 refusal path prep).
