# Step 06: S3 originals and `Source` records

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.2 (store originals), §6.2 (S3), §6.4 step 1 (persist global Source pending), §15 #3 (operator paths, no admin UI).

## Manual actions (you must do)

- Create an **S3 bucket** (dev) with **encryption at rest** and **blocked public access** (§6.6).
- Configure **IAM** user/role with least privilege for `PutObject`/`GetObject` on a prefix you will use for catalog originals.
- For local development, either use **real S3** in a dev account or add **LocalStack**—pick one and document it.

## Goal

Operators can **register a catalog entry**: a binary lands in S3 and a **`Source` row** exists with `storage_key`, `type`, `corpus`, and `pending` status—ready for ingest later (§6.4).

## What you will build

- Server-side S3 client wrapper using config from Step 04.
- A **protected operator entrypoint**: CLI script under `scripts/` *or* **internal API route** gated by **secret header**, **IP allowlist**, **VPN**, or **`admin` role**—must not be usable by normal session-only users (§5.5, §6.6).
- Flow: upload/register file → insert `Source` with checksum/size → return `source_id`.

## Implementation notes

- **End users never upload** corpus files in v1 (§5.2); this path is operator-only even if you personally use it daily.
- Filename conventions for sermons feed later citation metadata (§12 open decision #3)—record your convention in code comments or a tiny `README` in `scripts/` if needed (avoid new top-level docs unless necessary).

## Definition of done (testable)

- Running the operator command with a small **`.txt` or `.md` fixture** creates a **`Source` row** and the object exists in S3 at the expected key.
- `GET` (or download helper) can retrieve the same bytes and verify checksum if you store one.
- A non-operator caller **cannot** invoke the register/upload path (automated test with wrong secret / wrong role).
