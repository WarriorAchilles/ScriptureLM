/**
 * Operator CLI: register every `*.md` under one or more directories, then run the full
 * pipeline (extract/chunk + Bedrock embeddings) for each source — same outcome as
 * `register-source` + `jobs-enqueue ingest` + worker, in one process.
 *
 * Requires `OPERATOR_INGEST_SECRET` and the same env as single-file ingest (DB, blob
 * storage, AWS/Bedrock for embeddings).
 *
 * Usage:
 *   npx tsx scripts/bulk-ingest-markdown.ts --root ./data/sources/branham-md --corpus sermon
 *   One corpus for every root (typical: Bible vs sermons):
 *   npx tsx scripts/bulk-ingest-markdown.ts --root ./data/sources/bible --corpus scripture --root ./data/sources/branham-md --corpus sermon
 *   npx tsx scripts/bulk-ingest-markdown.ts --root ./a --root ./b --corpus other --dry-run
 */
import { config } from "dotenv";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import type { SourceCorpus } from "@prisma/client";

import { registerSourceFromBuffer } from "@/lib/sources/register-source";
import { runFullIngestPipeline } from "@/lib/jobs/run-full-ingest";

config({ path: resolve(process.cwd(), ".env") });

const CORPUS_VALUES: SourceCorpus[] = ["scripture", "sermon", "other"];

const SKIP_DIR_NAMES = new Set(["node_modules", ".git", ".next"]);

function getArgValues(flag: string): string[] {
  const values: string[] = [];
  const prefix = `${flag}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === flag) {
      const next = process.argv[index + 1];
      if (next && !next.startsWith("-")) {
        values.push(next);
      }
    } else if (arg.startsWith(prefix)) {
      values.push(arg.slice(prefix.length));
    }
  }
  return values;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function isSourceCorpus(value: string): value is SourceCorpus {
  return (CORPUS_VALUES as readonly string[]).includes(value);
}

async function collectMarkdownFiles(rootDir: string): Promise<string[]> {
  const absoluteRoot = resolve(rootDir);
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) {
          continue;
        }
        await walk(fullPath);
      } else if (
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(".md")
      ) {
        results.push(fullPath);
      }
    }
  }

  await walk(absoluteRoot);
  return results.sort((left, right) => left.localeCompare(right));
}

async function main(): Promise<void> {
  const operatorSecret = process.env.OPERATOR_INGEST_SECRET?.trim();
  if (!operatorSecret) {
    console.error("OPERATOR_INGEST_SECRET must be set in the environment (.env).");
    process.exit(1);
  }

  const roots = getArgValues("--root");
  const corpusArgs = getArgValues("--corpus").map((value) => value.trim());

  if (roots.length === 0) {
    console.error(
      "Usage: tsx scripts/bulk-ingest-markdown.ts --root <dir> [--root <dir> ...] --corpus scripture|sermon|other [--dry-run]",
    );
    console.error(
      "  Or one --corpus per --root in order, e.g. --root ./bible --corpus scripture --root ./branham-md --corpus sermon",
    );
    process.exit(1);
  }

  if (corpusArgs.length === 0) {
    console.error("Missing --corpus (scripture|sermon|other).");
    process.exit(1);
  }

  if (corpusArgs.length !== 1 && corpusArgs.length !== roots.length) {
    console.error(
      "Either pass a single --corpus for all roots, or exactly one --corpus per --root (same number as --root), in matching order.",
    );
    process.exit(1);
  }

  const corpusPerRoot: SourceCorpus[] = [];
  for (let index = 0; index < roots.length; index += 1) {
    const raw =
      corpusArgs.length === 1 ? corpusArgs[0]! : corpusArgs[index]!;
    if (!isSourceCorpus(raw)) {
      console.error(
        `Invalid --corpus at index ${index}: ${raw} (expected scripture|sermon|other).`,
      );
      process.exit(1);
    }
    corpusPerRoot.push(raw);
  }

  const dryRun = hasFlag("--dry-run");

  const allFiles: {
    absolutePath: string;
    displayPath: string;
    corpus: SourceCorpus;
  }[] = [];
  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    const absoluteRoot = resolve(process.cwd(), roots[rootIndex]!);
    const corpus = corpusPerRoot[rootIndex]!;
    const files = await collectMarkdownFiles(absoluteRoot);
    for (const filePath of files) {
      allFiles.push({
        absolutePath: filePath,
        displayPath: relative(process.cwd(), filePath) || filePath,
        corpus,
      });
    }
  }

  allFiles.sort((left, right) =>
    left.displayPath.localeCompare(right.displayPath),
  );

  if (allFiles.length === 0) {
    console.error("No .md files found under the given --root path(s).");
    process.exit(1);
  }

  console.error(
    JSON.stringify(
      { event: "bulk_ingest_markdown_start", fileCount: allFiles.length, dryRun },
      null,
      2,
    ),
  );

  if (dryRun) {
    for (const item of allFiles) {
      console.log(
        JSON.stringify({ corpus: item.corpus, path: item.displayPath }),
      );
    }
    process.exit(0);
  }

  let failed = 0;
  for (let index = 0; index < allFiles.length; index += 1) {
    const item = allFiles[index]!;
    const buffer = await readFile(item.absolutePath);
    const basename = item.absolutePath.split(/[/\\]/).pop() || "source.md";

    process.stderr.write(
      `[${index + 1}/${allFiles.length}] ${item.corpus} ${item.displayPath} … `,
    );

    try {
      const registered = await registerSourceFromBuffer({
        buffer,
        originalFilename: basename,
        type: "markdown",
        corpus: item.corpus,
      });

      const pipeline = await runFullIngestPipeline(registered.sourceId);
      if (!pipeline.ok) {
        failed += 1;
        console.error(
          JSON.stringify({
            ok: false,
            corpus: item.corpus,
            path: item.displayPath,
            sourceId: registered.sourceId,
            stage: pipeline.stage,
            message: pipeline.message,
          }),
        );
        continue;
      }

      console.error(
        JSON.stringify({
          ok: true,
          corpus: item.corpus,
          path: item.displayPath,
          sourceId: registered.sourceId,
          chunkCount: pipeline.chunkCount,
          embeddedCount: pipeline.embeddedCount,
        }),
      );
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          ok: false,
          corpus: item.corpus,
          path: item.displayPath,
          error: message,
        }),
      );
    }
  }

  console.error(
    JSON.stringify(
      {
        event: "bulk_ingest_markdown_done",
        total: allFiles.length,
        failed,
      },
      null,
      2,
    ),
  );

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
