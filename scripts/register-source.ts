/**
 * Operator CLI: register a source file (bytes + DB row). Requires `OPERATOR_INGEST_SECRET`
 * in the environment as a guard that this runs on a trusted machine (Step 06).
 *
 * Usage:
 *   npx tsx scripts/register-source.ts --file ./sermon.pdf --type pdf --corpus sermon
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SourceCorpus, SourceType } from "@prisma/client";

config({ path: resolve(process.cwd(), ".env") });

const SOURCE_TYPES: SourceType[] = ["pdf", "text", "markdown"];
const CORPUS_VALUES: SourceCorpus[] = ["scripture", "sermon", "other"];

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

function isSourceType(value: string): value is SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}

function isSourceCorpus(value: string): value is SourceCorpus {
  return (CORPUS_VALUES as readonly string[]).includes(value);
}

async function main(): Promise<void> {
  const operatorSecret = process.env.OPERATOR_INGEST_SECRET?.trim();
  if (!operatorSecret) {
    console.error("OPERATOR_INGEST_SECRET must be set in the environment (.env).");
    process.exit(1);
  }

  const filePath = getArg("--file");
  if (!filePath) {
    console.error(
      "Usage: tsx scripts/register-source.ts --file <path> --type pdf|text|markdown --corpus scripture|sermon|other",
    );
    process.exit(1);
  }

  const typeRaw = getArg("--type")?.trim();
  const corpusRaw = getArg("--corpus")?.trim();
  if (!typeRaw || !isSourceType(typeRaw)) {
    console.error("Invalid or missing --type (pdf|text|markdown).");
    process.exit(1);
  }
  if (!corpusRaw || !isSourceCorpus(corpusRaw)) {
    console.error("Invalid or missing --corpus (scripture|sermon|other).");
    process.exit(1);
  }

  const absolutePath = resolve(process.cwd(), filePath);
  const buffer = readFileSync(absolutePath);
  const basename = filePath.split(/[/\\]/).pop() || "upload";

  const bibleTranslation = getArg("--bible-translation");
  const bibleBook = getArg("--bible-book");
  const sermonCatalogId = getArg("--sermon-catalog-id");

  const { registerSourceFromBuffer } = await import(
    "../src/lib/sources/register-source"
  );

  const result = await registerSourceFromBuffer({
    buffer,
    originalFilename: basename,
    type: typeRaw,
    corpus: corpusRaw,
    bibleTranslation: bibleTranslation?.trim() || undefined,
    bibleBook: bibleBook?.trim() || undefined,
    sermonCatalogId: sermonCatalogId?.trim() || undefined,
  });

  console.log(
    JSON.stringify(
      {
        sourceId: result.sourceId,
        storageKey: result.storageKey,
        checksum: result.checksum,
        byteSize: result.byteSize,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
