# Step 09: Async ingest and reindex jobs

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §6.1 (async jobs), §6.2 (SQS or worker), §6.4 (reindex), §7 (`Job` entity), §9 (idempotency).

## Manual actions (you must do)

- Choose **MVP orchestration**: **Amazon SQS + Fargate worker**, **in-process queue**, or **Step Functions**—simplest that you will actually operate (§6.2). For solo MVP, an **SQS-free** worker polling a `jobs` table is acceptable if documented.
- Configure IAM for **SQS** if used; create queues **dev** / **prod**.
- Decide operator UX: **CLI triggers job** with `source_id` or `full-catalog` flag (§5.5).

## Goal

Ingest + embed work is **non-blocking** and **retryable**: failures surface on `Job` and `Source` without wedging the web server (§6.1, §6.4).

## What you will build

- `Job` rows: `pending` → `running` → `succeeded` / `failed`; **attempts** incremented with backoff policy.
- Worker process entry (`npm run worker` or second container) consuming messages or claiming DB jobs.
- **Idempotency keys** on ingest (same `source_id` + pipeline version should not duplicate chargeable work blindly—§9).
- Operator command: **enqueue ingest** / **reindex** for one source or all (full catalog may be slow—log progress).

## Implementation notes

- **Poison messages**: after max attempts, mark job failed and leave **`Source` in `failed`** with last error (§5.2).
- **Reindex** implies **delete/replace vectors** for that source consistently to avoid orphaned vectors (align with §15 #9 later for hard purge).

## Definition of done (testable)

- Enqueue a job for a **`pending` source**; worker processes it to **`ready`** without manual intervention.
- Kill worker mid-job once; on retry, system **recovers** to correct final status without duplicate chunks (assert in test or scripted scenario).
- Operator can list **recent jobs** via CLI or SQL query documented in step README—human-visible status counts as testable for MVP ops.
