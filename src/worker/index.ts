import "dotenv/config";

/**
 * Background worker (Step 09, master spec §6.1).
 *
 * **Mode A (default):** polls Postgres for `PENDING` jobs using `FOR UPDATE SKIP LOCKED` via
 * `claimNextPendingJob`, then runs `executeClaimedJob` (Step 07 extract/chunk + Step 08 embed).
 *
 * **Mode B:** `WORKER_TRANSPORT=sqs` — long-polls SQS; message JSON `{ "jobId": "<uuid>" }`.
 * Deletes the message only after successful processing; otherwise relies on visibility timeout
 * for retries. Ensure `SQS_QUEUE_URL` and AWS credentials are set.
 *
 * **Ingest vs reindex:** Ingest runs the full pipeline and supports idempotent no-op when the
 * source is already `READY` at the same `pipeline_version`. Reindex deletes all chunks for the
 * source first (embeddings are stored on chunk rows — no orphan vectors), resets the source row,
 * then runs the same pipeline as ingest.
 *
 * Run: `npm run worker` (separate terminal from `npm run dev`).
 */
import { claimAndExecuteNextJob } from "@/lib/jobs/execute-job";
import { getWorkerPollIntervalMs } from "@/lib/jobs/job-config";
import { getServerEnv } from "@/lib/config";
import { runSqsWorkerLoop } from "@/worker/sqs-loop";

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function runDatabasePollLoop(): Promise<void> {
  const intervalMs = getWorkerPollIntervalMs();
  console.info(
    JSON.stringify({
      event: "worker_start",
      transport: "db_poll",
      pollIntervalMs: intervalMs,
    }),
  );

  for (;;) {
    try {
      const batch = await claimAndExecuteNextJob();
      if (!batch) {
        await sleep(intervalMs);
        continue;
      }
      console.info(
        JSON.stringify({
          event: "job_finished",
          jobId: batch.job.id,
          type: batch.job.type,
          outcome: batch.outcome,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          event: "worker_iteration_failed",
          error: message,
        }),
      );
      await sleep(intervalMs);
    }
  }
}

async function main(): Promise<void> {
  const transport = process.env.WORKER_TRANSPORT?.trim().toLowerCase() ?? "";
  if (transport === "sqs") {
    const env = getServerEnv();
    const queueUrl = process.env.SQS_QUEUE_URL?.trim() || env.sqsQueueUrl;
    if (!queueUrl) {
      console.error(
        "WORKER_TRANSPORT=sqs requires SQS_QUEUE_URL (or set it in environment).",
      );
      process.exit(1);
    }
    const region = process.env.AWS_REGION?.trim() || env.awsRegion;
    if (!region) {
      console.error("WORKER_TRANSPORT=sqs requires AWS_REGION.");
      process.exit(1);
    }
    await runSqsWorkerLoop({ queueUrl, region });
    return;
  }

  await runDatabasePollLoop();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
