# Step 09: Async ingest and reindex jobs

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §6.1 (async jobs), §6.2 (SQS), §6.4 (reindex), §7 (`Job`), §9 (idempotency).

## Manual actions (you must do)

- If the agent implements **SQS**: create **queue(s)** in AWS dev, copy **queue URL** into `.env.local`, and grant **`sqs:ReceiveMessage`**, **`DeleteMessage`**, **`SendMessage`**, **`ChangeMessageVisibility`** to the worker role/user.
- Run **`npm run worker`** (or Docker worker) in a **second terminal** when testing locally—starting the worker is your ops step, not the agent’s.

## Instructions for the AI coding agent

1. Implement **job lifecycle** on **`Job`** table: `pending` → `running` → `succeeded` | `failed`; increment **`attempts`**, store **`last_error`**, **`started_at`**, **`finished_at`** if columns exist or add them via migration.
2. **Worker entrypoint**: `npm run worker` that:
   - **Mode A (default solo MVP):** polls DB for `pending` jobs with **`FOR UPDATE SKIP LOCKED`** (or equivalent) every N seconds.
   - **Mode B (optional):** long-polls **SQS**; message body contains `jobId` or payload; **delete message** only after success; visibility timeout for retries.
3. **Job handler** for `ingest`: run Step 07 pipeline then Step 08 embed for that `source_id` in one logical unit **or** split sub-steps with clear state—**document**. On failure after max attempts, set **`Source.status=failed`** and job `failed`.
4. **Job handler** for `reindex`: **delete** existing chunks (and embeddings) for `source_id`, reset `Source` to appropriate status, re-run extract/chunk/embed (§6.4). Ensure **no orphan vectors**.
5. **Idempotency**: include **`pipeline_version`** or `text_extraction_version` in job payload; if same version re-enqueued, **no-op** or **replace** deterministically (§9).
6. **Operator CLI**: `npm run jobs:enqueue -- ingest --sourceId=...` and `reindex --sourceId=...` | `all` (iterate all sources—log progress). Guard with **`OPERATOR_INGEST_SECRET`** or DB role.
7. **Tests**: enqueue job → in-process worker function invoked in test → `Source` ends `ready` with chunks+embeddings; simulate throw → `failed` with attempts incremented.

## Definition of done (testable)

- One command enqueues work; worker run completes **`ready`** source without manual SQL.
- Forced failure retries up to **max attempts** then stops with visible error on `Source` and `Job`.
- Documented command lists **recent jobs** (SQL snippet or `npm run jobs:list`).
