/**
 * Async ingest / reindex jobs (Step 09): DB-backed worker, operator enqueue CLI, idempotent ingest.
 */

export {
  claimNextPendingJob,
  claimPendingJobById,
} from "@/lib/jobs/claim-job";
export { computePipelineVersion } from "@/lib/jobs/pipeline-version";
export { getJobMaxAttempts, getWorkerPollIntervalMs } from "@/lib/jobs/job-config";
export {
  buildJobPayload,
  parseIngestPayload,
  parseReindexPayload,
  type IngestJobPayload,
  type ReindexJobPayload,
} from "@/lib/jobs/payloads";
export { runFullIngestPipeline } from "@/lib/jobs/run-full-ingest";
export {
  claimAndExecuteNextJob,
  executeClaimedJob,
  type ExecuteJobOutcome,
} from "@/lib/jobs/execute-job";
export { enqueueIngestJob, enqueueReindexJob } from "@/lib/jobs/enqueue-job";
