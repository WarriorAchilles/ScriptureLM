# Step 08: Embeddings (Bedrock Titan) + pgvector upsert

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §6.2–§6.3 (Bedrock embeddings), §6.4 steps 5–6, §15 #2, §12 open #4.

## Manual actions (you must do)

- In AWS **Bedrock**, enable and note the **exact embedding model ID** and **output dimension** you will store.
- Confirm **regional quotas** and retry behavior for embedding batch throughput (large corpus will matter—§11).
- Add Bedrock **IAM permissions** to the role/user used by local dev and later by deployed compute.

## Goal

Every chunk from Step 07 receives an **embedding vector** stored alongside metadata, with **`embedding_model` name/version** recorded for safe re-indexing (§6.3).

## What you will build

- Server-side Bedrock client wrapper; batching + rate-limit handling with backoff.
- Pipeline step: **for each chunk without embedding**, embed text → **upsert** vector in pgvector column (or companion table).
- Migration adjustment if Step 02 used placeholder dimensions—**must** match model output exactly.

## Implementation notes

- Log **embedding count and failures** structurally (prep for §9 observability).
- **Do not** embed hidden/soft-deleted sources’ new chunks in default paths once deletion semantics exist (wire filters when Sources can be hidden).

## Definition of done (testable)

- Integration test (or script) embeds **3–5 chunks** and performs a raw SQL **`ORDER BY embedding <=> :query_embedding LIMIT k`** returning expected ordering on a toy example.
- `Source` transitions to **`ready`** only after **all chunks have embeddings** (or define and document partial states if you split jobs—be consistent with Step 09).
- Stored metadata row or column records **`embedding_model`** string identical to Bedrock model ID used.
