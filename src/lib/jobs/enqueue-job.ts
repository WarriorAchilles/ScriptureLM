import { JobType } from "@prisma/client";
import prisma from "@/lib/prisma";
import { computePipelineVersion } from "@/lib/jobs/pipeline-version";
import { buildJobPayload } from "@/lib/jobs/payloads";

export async function enqueueIngestJob(sourceId: string) {
  const pipelineVersion = computePipelineVersion();
  return prisma.job.create({
    data: {
      type: JobType.ingest,
      status: "PENDING",
      payload: buildJobPayload(sourceId, pipelineVersion),
    },
  });
}

export async function enqueueReindexJob(sourceId: string) {
  const pipelineVersion = computePipelineVersion();
  return prisma.job.create({
    data: {
      type: JobType.reindex,
      status: "PENDING",
      payload: buildJobPayload(sourceId, pipelineVersion),
    },
  });
}
