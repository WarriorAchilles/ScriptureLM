/**
 * Step 12 manual smoke test: invoke `retrieveContext` against dev data and
 * print the top-k chunk ids + titles so an operator can eyeball the results.
 *
 * Usage:
 *   npm run retrieve:smoke -- "what does the scripture say about grace?"
 *   npm run retrieve:smoke -- "the seven church ages" --corpus=sermon --limit=5
 *
 * Requires Bedrock credentials (calls Titan for the query embedding). For a
 * no-network sanity check against seeded toy vectors, run the retrieval tests
 * (`npm test -- tests/retrieval.test.ts`).
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });

import { retrieveContext, type RetrievalCorpus } from "@/lib/retrieval";
import prisma from "@/lib/prisma";

type ParsedArgs = {
  query: string;
  limit: number;
  corpus: RetrievalCorpus | undefined;
  sourceIds: string[] | undefined;
};

function parseCliArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  let limit = 8;
  let corpus: RetrievalCorpus | undefined;
  let sourceIds: string[] | undefined;

  for (const raw of argv) {
    if (raw.startsWith("--limit=")) {
      const parsed = Number.parseInt(raw.slice("--limit=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = parsed;
      }
      continue;
    }
    if (raw.startsWith("--corpus=")) {
      const value = raw.slice("--corpus=".length);
      if (value === "scripture" || value === "sermon" || value === "other") {
        corpus = value;
      }
      continue;
    }
    if (raw.startsWith("--sources=")) {
      sourceIds = raw
        .slice("--sources=".length)
        .split(",")
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
      continue;
    }
    positional.push(raw);
  }

  return {
    query: positional.join(" ").trim(),
    limit,
    corpus,
    sourceIds,
  };
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.query) {
    console.error(
      'Usage: npm run retrieve:smoke -- "your question" [--limit=N] [--corpus=scripture|sermon|other] [--sources=uuid,uuid]',
    );
    process.exit(1);
  }

  const startedAt = Date.now();
  const results = await retrieveContext({
    query: args.query,
    limit: args.limit,
    corpus: args.corpus,
    sourceIds: args.sourceIds,
  });
  const elapsedMs = Date.now() - startedAt;

  console.log(
    `retrieveContext: query="${args.query}" limit=${args.limit} corpus=${
      args.corpus ?? "(all)"
    } elapsedMs=${elapsedMs} hits=${results.length}`,
  );
  for (const [index, row] of results.entries()) {
    console.log(
      `  #${index + 1} distance=${row.distance.toFixed(4)} corpus=${row.corpus} source=${row.sourceId} chunk=${row.chunkId} — ${row.title}`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("retrieve:smoke failed:", error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
