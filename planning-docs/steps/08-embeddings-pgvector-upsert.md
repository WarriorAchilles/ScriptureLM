# Step 08: Embeddings (Bedrock Titan) + pgvector upsert

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §6.2–§6.3, §6.4 steps 5–6, §15 #2.

## Manual actions (you must do)

- In **Bedrock**, ensure **embedding model access** is **Active** in your account/region.
- Copy **`BEDROCK_EMBEDDING_MODEL_ID`** and confirm **output dimension** into `.env` (the agent must read dimension from env or config to size vectors).
- Attach **IAM policy** allowing **`bedrock:InvokeModel`** (or InvokeModelWithResponseStream if applicable) for that model to the credentials the dev app uses.

## Instructions for the AI coding agent

1. Add **`@aws-sdk/client-bedrock-runtime`** (or correct v3 client for your SDK version) and **`lib/embeddings/bedrock.ts`** that:
   - Accepts **string** (chunk text) or batch of strings.
   - Calls the **embedding model** ID from server config.
   - Returns **number[]** vectors; validates **length === expected dimension** from env **`EMBEDDING_DIMENSIONS`**.
2. Add **retry with exponential backoff** on throttling / 5xx (§9 prep).
3. Implement **`embedChunksForSource(sourceId)`**:
   - Select chunks where **embedding is null** (or not yet written).
   - Embed in **batches** respecting token/size limits; update rows with **vector** + **`embedding_model`** = model ID string (§6.3 critical note).
   - **Exclude** sources with `deleted_at` / hidden flag set.
4. Add **migration** if Step 03 used wrong dimension: alter column to correct `vector(N)`.
5. **Structured log** per batch: `sourceId`, `embeddedCount`, `durationMs`, errors (no full text in logs for huge chunks—truncate).
6. **Tests**:
   - **Mock Bedrock** client: assert SQL update receives serialized vector.
   - **Integration** (optional flag `RUN_INTEGRATION=1`): one real embed call—skip in default CI if no creds.
7. Set **`Source.status`** to **`ready`** only when **all** chunks for that source have embeddings **unless** you explicitly split “chunks done” vs “embed done” across Step 09—stay consistent with Job completion there.

## Definition of done (testable)

- With mocks: embedding function writes **non-null** vector and **`embedding_model`** on chunk rows.
- SQL similarity query `ORDER BY embedding <=> $1::vector LIMIT k` runs without error on seeded toy vectors (integration or local script).
- Dimension mismatch throws a **clear config error** at runtime.
