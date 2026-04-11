import type { Job, PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";

/**
 * Claims one pending job using row-level locking (PostgreSQL `FOR UPDATE SKIP LOCKED`)
 * so multiple worker processes can run without double-processing the same job.
 */
export async function claimNextPendingJob(
  client: PrismaClient = prisma,
): Promise<Job | null> {
  return client.$transaction(async (transaction) => {
    const locked = await transaction.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM jobs
      WHERE status = 'PENDING'::"JobStatus"
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    if (locked.length === 0) {
      return null;
    }
    const jobId = locked[0]!.id;
    return transaction.job.update({
      where: { id: jobId },
      data: {
        status: "RUNNING",
        attempts: { increment: 1 },
        startedAt: new Date(),
        lastError: null,
      },
    });
  });
}

/**
 * Used when an SQS message names a specific job id (Mode B). No-ops if the job is not pending.
 */
export async function claimPendingJobById(
  jobId: string,
  client: PrismaClient = prisma,
): Promise<Job | null> {
  return client.$transaction(async (transaction) => {
    const locked = await transaction.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM jobs
      WHERE id = ${jobId}::uuid
        AND status = 'PENDING'::"JobStatus"
      FOR UPDATE
    `;
    if (locked.length === 0) {
      return null;
    }
    return transaction.job.update({
      where: { id: jobId },
      data: {
        status: "RUNNING",
        attempts: { increment: 1 },
        startedAt: new Date(),
        lastError: null,
      },
    });
  });
}
