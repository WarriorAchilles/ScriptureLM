import type { Job, PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { claimNextPendingJob } from "@/lib/jobs/claim-job";
import { computePipelineVersion } from "@/lib/jobs/pipeline-version";
import { getJobMaxAttempts } from "@/lib/jobs/job-config";
import {
  parseIngestPayload,
  parseReindexPayload,
} from "@/lib/jobs/payloads";
import { runFullIngestPipeline } from "@/lib/jobs/run-full-ingest";
import type { EmbedChunksForSourceDeps } from "@/lib/embeddings/embed-chunks-for-source";

export type ExecuteJobOutcome =
  | { kind: "completed"; detail?: string }
  | { kind: "retry_scheduled"; error: string }
  | { kind: "failed_terminal"; error: string };

type ExecuteJobOptions = Readonly<{
  prismaClient?: PrismaClient;
  embedDeps?: EmbedChunksForSourceDeps;
}>;

async function markJobCompleted(
  db: PrismaClient,
  jobId: string,
  detail?: string,
): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      lastError: null,
    },
  });
  if (detail) {
    console.info(
      JSON.stringify({ event: "job_completed", jobId, detail }),
    );
  }
}

/** Payload / missing source errors should not burn retry attempts. */
async function failJobNonRetryable(
  db: PrismaClient,
  job: Job,
  errorMessage: string,
  sourceIdForFailure: string | null,
): Promise<ExecuteJobOutcome> {
  await db.job.update({
    where: { id: job.id },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      lastError: errorMessage,
    },
  });
  if (sourceIdForFailure) {
    await db.source.update({
      where: { id: sourceIdForFailure },
      data: {
        status: "FAILED",
        errorMessage: `Job ${job.id}: ${errorMessage}`,
      },
    });
  }
  return { kind: "failed_terminal", error: errorMessage };
}

async function scheduleRetryOrFail(
  db: PrismaClient,
  job: Job,
  errorMessage: string,
  sourceIdForFailure: string | null,
): Promise<ExecuteJobOutcome> {
  const maxAttempts = getJobMaxAttempts();
  if (job.attempts >= maxAttempts) {
    await db.job.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        lastError: errorMessage,
      },
    });
    if (sourceIdForFailure) {
      await db.source.update({
        where: { id: sourceIdForFailure },
        data: {
          status: "FAILED",
          errorMessage: `Job ${job.id} failed after ${job.attempts} attempt(s): ${errorMessage}`,
        },
      });
    }
    return { kind: "failed_terminal", error: errorMessage };
  }

  await db.job.update({
    where: { id: job.id },
    data: {
      status: "PENDING",
      lastError: errorMessage,
      startedAt: null,
    },
  });
  return { kind: "retry_scheduled", error: errorMessage };
}

async function handleIngest(
  db: PrismaClient,
  job: Job,
  embedDeps: EmbedChunksForSourceDeps | undefined,
): Promise<ExecuteJobOutcome> {
  const parsed = parseIngestPayload(job.payload);
  if (!parsed.ok) {
    return failJobNonRetryable(db, job, parsed.error, null);
  }
  const { source_id: sourceId, pipeline_version: payloadVersion } =
    parsed.value;

  const source = await db.source.findUnique({ where: { id: sourceId } });
  if (!source) {
    return failJobNonRetryable(
      db,
      job,
      `Source not found: ${sourceId}`,
      null,
    );
  }
  if (source.deletedAt) {
    await markJobCompleted(db, job.id, "skipped_deleted_source");
    return { kind: "completed", detail: "skipped_deleted_source" };
  }

  const currentVersion = computePipelineVersion();
  if (
    source.status === "READY" &&
    payloadVersion === currentVersion
  ) {
    await markJobCompleted(
      db,
      job.id,
      "idempotent_noop_same_pipeline_ready",
    );
    return {
      kind: "completed",
      detail: "idempotent_noop_same_pipeline_ready",
    };
  }

  const result = await runFullIngestPipeline(sourceId, embedDeps);
  if (result.ok) {
    await markJobCompleted(db, job.id);
    return { kind: "completed" };
  }

  return scheduleRetryOrFail(db, job, `${result.stage}: ${result.message}`, sourceId);
}

/**
 * Reindex: delete all chunks (embeddings live on chunk rows — no orphan vectors), reset source,
 * then run the same extract/chunk/embed sequence as ingest (§6.4).
 */
async function handleReindex(
  db: PrismaClient,
  job: Job,
  embedDeps: EmbedChunksForSourceDeps | undefined,
): Promise<ExecuteJobOutcome> {
  const parsed = parseReindexPayload(job.payload);
  if (!parsed.ok) {
    return failJobNonRetryable(db, job, parsed.error, null);
  }
  const { source_id: sourceId } = parsed.value;

  const source = await db.source.findUnique({ where: { id: sourceId } });
  if (!source) {
    return failJobNonRetryable(
      db,
      job,
      `Source not found: ${sourceId}`,
      null,
    );
  }
  if (source.deletedAt) {
    await markJobCompleted(db, job.id, "skipped_deleted_source");
    return { kind: "completed", detail: "skipped_deleted_source" };
  }

  await db.$transaction(async (transaction) => {
    await transaction.chunk.deleteMany({ where: { sourceId } });
    await transaction.source.update({
      where: { id: sourceId },
      data: {
        status: "PENDING",
        errorMessage: null,
        textExtractionVersion: null,
      },
    });
  });

  const result = await runFullIngestPipeline(sourceId, embedDeps);
  if (result.ok) {
    await markJobCompleted(db, job.id);
    return { kind: "completed" };
  }

  return scheduleRetryOrFail(db, job, `${result.stage}: ${result.message}`, sourceId);
}

/**
 * Runs the business logic for a job already in `RUNNING` (typically just claimed).
 * Exported for tests and for SQS-driven workers that claim by id separately.
 */
export async function executeClaimedJob(
  job: Job,
  options: ExecuteJobOptions = {},
): Promise<ExecuteJobOutcome> {
  const db = options.prismaClient ?? prisma;
  if (job.status !== "RUNNING") {
    throw new Error(
      `executeClaimedJob expected RUNNING job, got ${job.status}`,
    );
  }

  switch (job.type) {
    case "ingest":
      return handleIngest(db, job, options.embedDeps);
    case "reindex":
      return handleReindex(db, job, options.embedDeps);
    default:
      return failJobNonRetryable(
        db,
        job,
        `Unsupported job type: ${String(job.type)}`,
        null,
      );
  }
}

/**
 * Claim one pending job and execute it (default DB-backed worker loop).
 */
export async function claimAndExecuteNextJob(
  options: ExecuteJobOptions = {},
): Promise<{ job: Job; outcome: ExecuteJobOutcome } | null> {
  const db = options.prismaClient ?? prisma;
  const job = await claimNextPendingJob(db);
  if (!job) {
    return null;
  }
  const outcome = await executeClaimedJob(job, options);
  return { job, outcome };
}
