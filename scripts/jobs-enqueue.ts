/**
 * Operator CLI: enqueue async ingest / reindex jobs (Step 09).
 * Requires OPERATOR_INGEST_SECRET (same as register-source / ingest-chunk).
 *
 * Usage:
 *   npx tsx scripts/jobs-enqueue.ts ingest --sourceId=<uuid>
 *   npx tsx scripts/jobs-enqueue.ts reindex --sourceId=<uuid>
 *   npx tsx scripts/jobs-enqueue.ts reindex --all
 */
import "dotenv/config";
import prisma from "@/lib/prisma";
import { enqueueIngestJob, enqueueReindexJob } from "@/lib/jobs/enqueue-job";

function getArg(name: string): string | undefined {
  const prefix = `${name}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === name) {
      return process.argv[index + 1];
    }
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const operatorSecret = process.env.OPERATOR_INGEST_SECRET?.trim();
  if (!operatorSecret) {
    console.error("OPERATOR_INGEST_SECRET must be set in the environment (.env).");
    process.exit(1);
  }

  const sub = process.argv[2]?.trim();
  if (sub !== "ingest" && sub !== "reindex") {
    console.error(
      "Usage: tsx scripts/jobs-enqueue.ts ingest --sourceId=<uuid>",
    );
    console.error(
      "       tsx scripts/jobs-enqueue.ts reindex --sourceId=<uuid> | --all",
    );
    process.exit(1);
  }

  if (sub === "ingest") {
    const sourceId = getArg("--sourceId")?.trim();
    if (!sourceId) {
      console.error("ingest requires --sourceId=<uuid>");
      process.exit(1);
    }
    const job = await enqueueIngestJob(sourceId);
    console.log(
      JSON.stringify({ enqueued: "ingest", jobId: job.id, sourceId }, null, 2),
    );
    return;
  }

  if (hasFlag("--all")) {
    const sources = await prisma.source.findMany({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    console.error(`Enqueueing reindex for ${sources.length} source(s)...`);
    for (const row of sources) {
      const job = await enqueueReindexJob(row.id);
      console.log(
        JSON.stringify({ enqueued: "reindex", jobId: job.id, sourceId: row.id }),
      );
    }
    return;
  }

  const sourceId = getArg("--sourceId")?.trim();
  if (!sourceId) {
    console.error("reindex requires --sourceId=<uuid> or --all");
    process.exit(1);
  }
  const job = await enqueueReindexJob(sourceId);
  console.log(
    JSON.stringify({ enqueued: "reindex", jobId: job.id, sourceId }, null, 2),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
