# Step 06: S3 originals and `Source` records

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.2 (store originals), §6.2 (S3), §6.4 step 1, §5.5 / §15 #3 (operator-only, no admin UI).

## Manual actions (you must do)

- In **AWS**: create an **S3 bucket** for dev with **default encryption** and **block all public access** (§6.6).
- Create an **IAM user or role** with least privilege: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` (if needed later) on a **prefix** such as `sources/`.
- Put **credentials or role ARN** into `.env.local` per `.env.example` (never commit).
- Optionally enable **LocalStack** yourself if you use it; the agent should support **real S3** via env-configured endpoint for simplicity.

## Instructions for the AI coding agent

1. Add **`@aws-sdk/client-s3`** (or existing AWS v3 client) and a **server-only** module `lib/s3.ts` that builds a client from **Step 04 config** (`region`, credentials or default provider chain).
2. Implement **key naming**: e.g. `sources/{sourceId}/{sanitizedFilename}`—document the convention in a file-level comment (sermon metadata §12 will build on filenames).
3. Add **operator-only** registration path—**pick one** (both is ok):
   - **`scripts/register-source.ts`** (or `.mjs`) using env `OPERATOR_INGEST_SECRET` **only** as CLI guard **or** direct DB access from trusted machine, **or**
   - **`POST /api/internal/sources/register`** protected by **shared secret header** (`x-operator-secret`) **and** optional `ADMIN` role check.
4. Flow: accept **file path or multipart upload** → stream to S3 → **insert `Source`** with `pending` status, `storage_key`, `type`, `corpus`, `byte_size`, **checksum** (SHA-256), timestamps.
5. Implement **`getObject`** helper for downstream ingest (Step 07).
6. Add **tests**:
   - With **mock S3** (e.g. MSW, moto, or injected client), assert DB row + PutObject params.
   - Assert **wrong secret** → **403** on internal API.
7. **End users must not** hit this route from the app UI (§5.2); no upload dropzone for corpus files.

## Definition of done (testable)

- Operator script or curl with correct secret creates a **`Source`** row and the object exists in S3 (verify in AWS console or `GetObject` in test).
- Wrong secret / missing role → **403**.
- `.env.example` lists all new variables.
