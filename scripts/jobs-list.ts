/**
 * Lists recent jobs (Step 09). Guarded like other operator scripts.
 *
 * Usage: npx tsx scripts/jobs-list.ts [--limit=20]
 */
import "dotenv/config";
import prisma from "@/lib/prisma";

function getArg(name: string): string | undefined {
  const prefix = `${name}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  if (!process.env.OPERATOR_INGEST_SECRET?.trim()) {
    console.error("OPERATOR_INGEST_SECRET must be set in the environment (.env).");
    process.exit(1);
  }

  const limitRaw = getArg("--limit") ?? "20";
  const limit = Math.min(200, Math.max(1, Number.parseInt(limitRaw, 10) || 20));

  const rows = await prisma.job.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      status: true,
      attempts: true,
      payload: true,
      lastError: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
    },
  });

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
