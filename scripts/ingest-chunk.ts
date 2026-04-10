/**
 * Operator CLI: extract + chunk for a registered source. Requires `OPERATOR_INGEST_SECRET`
 * (same guard as Step 06 register script).
 *
 * Usage:
 *   npx tsx scripts/ingest-chunk.ts --sourceId=<uuid>
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });

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

async function main(): Promise<void> {
  const operatorSecret = process.env.OPERATOR_INGEST_SECRET?.trim();
  if (!operatorSecret) {
    console.error("OPERATOR_INGEST_SECRET must be set in the environment (.env).");
    process.exit(1);
  }

  const sourceId = getArg("--sourceId")?.trim();
  if (!sourceId) {
    console.error("Usage: tsx scripts/ingest-chunk.ts --sourceId=<uuid>");
    process.exit(1);
  }

  const { runExtractAndChunk } = await import(
    "../src/lib/ingest/run-extract-and-chunk"
  );

  const result = await runExtractAndChunk(sourceId);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failed") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
