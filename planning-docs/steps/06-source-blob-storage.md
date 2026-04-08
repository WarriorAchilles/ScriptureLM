# Step 06: Source blob storage (local + S3) and `Source` records

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.2 (store originals), §6.2 (blob storage), §6.4 step 1, §5.5 / §15 #3 (operator-only, no admin UI), §15 #11 (source blob storage).

## Manual actions (you must do)

- **Local development (default):** choose a directory for source files (e.g. `./data/sources` or outside the repo). Add it to **`.gitignore`**. Set **`SOURCE_STORAGE_ROOT`** (or the env name the agent documents) in **`.env`** so the app reads/writes blobs there. No AWS or S3 required for this path.
- **Production / AWS:** when you deploy (Step 16), create an **S3 bucket** with **default encryption** and **block all public access** (§6.6). Create an **IAM user or role** with least privilege: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on a prefix such as `sources/`. Put **credentials or role ARN** into `.env` per `.env.example` (never commit).
- **Optional:** enable **LocalStack** or **MinIO** if you want to exercise the **S3 code path** without a real AWS bucket; the agent should support **S3** via **env-configured endpoint** and region. This is secondary to **plain filesystem** for daily dev.

## Instructions for the AI coding agent

1. Add a **server-only** storage module (e.g. `src/lib/storage/` or `src/lib/blob-storage.ts`) that abstracts **put**, **get** (read stream or buffer), and **delete** by logical **`storage_key`** (same key shape for every backend). Implement:
   - **`filesystem`** backend — root = `SOURCE_STORAGE_ROOT`; keys map to paths under that root (document traversal-safety: reject `..` and absolute paths).
   - **`s3`** backend — use **`@aws-sdk/client-s3`** from **Step 04 config** (`region`, bucket, credentials or default provider chain, optional **custom endpoint** for LocalStack/MinIO).
   - Selection via env, e.g. **`STORAGE_BACKEND=filesystem|s3`** (names may match `.env.example`).
2. Implement **key naming**: e.g. `sources/{sourceId}/{sanitizedFilename}` — document the convention in a file-level comment (sermon metadata §12 will build on filenames).
3. Add **operator-only** registration path — **pick one** (both is ok):
   - **`scripts/register-source.ts`** (or `.mjs`) using env `OPERATOR_INGEST_SECRET` **only** as CLI guard **or** direct DB access from trusted machine, **or**
   - **`POST /api/internal/sources/register`** protected by **shared secret header** (`x-operator-secret`) **and** optional `ADMIN` role check.
4. Flow: accept **file path or multipart upload** → **persist bytes via storage module** → **insert `Source`** with `pending` status, `storage_key`, `type`, `corpus`, `byte_size`, **checksum** (SHA-256), timestamps.
5. Implement **`getObject`** (or equivalent read helper) for downstream ingest (Step 07).
6. Add **tests**:
   - With **filesystem** backend and a **temporary directory**, assert DB row + file on disk at the expected path.
   - With **mock S3** (e.g. MSW, moto, or injected client) **or** LocalStack in CI if available, assert DB row + PutObject params when `STORAGE_BACKEND=s3`.
   - Assert **wrong secret** → **403** on internal API.
7. **End users must not** hit this route from the app UI (§5.2); no upload dropzone for corpus files.

## Definition of done (testable)

- Operator script or curl with correct secret creates a **`Source`** row and the object **exists on the local filesystem** when using the **filesystem** backend (no AWS required).
- With **`STORAGE_BACKEND=s3`** and valid AWS (or LocalStack) config, the same flow creates the object in **S3** (verify in console or `GetObject` in test).
- Wrong secret / missing role → **403**.
- `.env.example` lists **`STORAGE_BACKEND`**, **`SOURCE_STORAGE_ROOT`** (filesystem), and S3-related variables when using **`s3`**.
