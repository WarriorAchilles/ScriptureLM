/**
 * Context assembly for grounded summarization (Step 15).
 *
 * Master spec refs: §5.4 (per-source + library brief), §15 #6 (explicit
 * attribution), §6.3 (token/window limits).
 *
 * This module is responsible for turning a Source (or a set of Sources) into
 * a bounded textual context that Claude can summarize. It does NOT call the
 * model or format the final prompt — `summary-prompt.ts` handles that — so we
 * can unit-test the chunking / budgeting logic against deterministic inputs.
 *
 * Budget model (documented for reviewers):
 *  - Per-source:  concatenate chunks in `metadata.chunk_index` order up to
 *                 `PER_SOURCE_CHAR_BUDGET`. "First-N" is correct here because
 *                 chunks are already contiguous pieces of the source file, so
 *                 including the first span gives the model the canonical
 *                 opening material (title page, intro, Genesis 1, etc.).
 *  - Library:     round-robin across contributing sources. Each source emits
 *                 one chunk at a time (first chunk, then second chunk, …)
 *                 until the shared `LIBRARY_CHAR_BUDGET` is exhausted. This
 *                 keeps every source represented in the prompt so the library
 *                 brief can honestly attribute claims to each one.
 */

import prisma from "@/lib/prisma";
import type { PrismaClient, SourceCorpus, SourceStatus } from "@prisma/client";
import { deriveSourceTitle } from "@/lib/sources/list-catalog";

/**
 * Approximate chars-per-token (same convention as `rag-prompt.ts`). Used only
 * to describe budgets in token units when logging; context assembly itself
 * operates on char budgets so it remains hermetic (no SDK round-trip).
 */
const APPROX_CHARS_PER_TOKEN = 3.5;

/**
 * ~25k chars ≈ ~7k tokens. Leaves comfortable headroom below the smallest
 * Claude context window even with the system prompt and a long reply.
 */
export const PER_SOURCE_CHAR_BUDGET = 25_000;

/** Shared budget for the library brief. */
export const LIBRARY_CHAR_BUDGET = 25_000;

/** Absolute cap on how many sources a library summary will pull from. */
export const MAX_LIBRARY_SOURCES = 12;

/** Per-source chunk fetch cap; rarely exceeds this in practice. */
const MAX_CHUNKS_PER_SOURCE = 400;

/**
 * Minimal projection of a `Source` row needed by the prompt builder. We keep
 * the shape narrow so swapping the data layer (direct SQL, cache, etc.)
 * doesn't ripple into the prompt code.
 */
export type SummarySourceRecord = Readonly<{
  id: string;
  title: string;
  corpus: SourceCorpus;
  status: SourceStatus;
  bibleBook: string | null;
  bibleTranslation: string | null;
  sermonCatalogId: string | null;
  storageKey: string | null;
}>;

/** Ordered chunk text for a single contributing source. */
export type SourceContext = Readonly<{
  source: SummarySourceRecord;
  /** Chunks in `chunk_index` order that survived budgeting. */
  chunks: readonly string[];
  /** True when the char budget cut the source short. */
  truncated: boolean;
}>;

export type SummaryContext = Readonly<{
  sources: readonly SourceContext[];
  approxTokenCount: number;
}>;

/**
 * Raw chunk row shape returned by the `$queryRaw` helper. `chunk_index` is
 * optional because legacy chunks may lack it in `metadata`; we coalesce to a
 * stable fallback order in SQL so callers never see NULL here.
 */
type RawChunkRow = {
  content: string;
  chunk_index: number;
};

/**
 * Loads the first `limit` chunks for a single source in document order.
 * `chunk_index` lives inside the `metadata` JSON blob (see ingest pipeline),
 * so we extract + cast in SQL rather than fetching + sorting in JS.
 */
export async function loadOrderedChunks(
  sourceId: string,
  limit: number,
  deps: { prismaClient?: PrismaClient } = {},
): Promise<string[]> {
  const database = deps.prismaClient ?? prisma;
  const rows = await database.$queryRaw<RawChunkRow[]>`
    SELECT
      c.content,
      COALESCE((c.metadata->>'chunk_index')::int, 0) AS chunk_index
    FROM chunks c
    WHERE c.source_id = ${sourceId}::uuid
    ORDER BY chunk_index ASC, c.id ASC
    LIMIT ${limit}
  `;
  return rows.map((row) => row.content);
}

/**
 * Fetches a `Source` row and projects it into the narrow summary shape
 * (including the human-readable title the catalog UI uses). Returns `null`
 * if the source is missing or soft-deleted.
 */
export async function loadSummarySource(
  sourceId: string,
  deps: { prismaClient?: PrismaClient } = {},
): Promise<SummarySourceRecord | null> {
  const database = deps.prismaClient ?? prisma;
  const row = await database.source.findFirst({
    where: { id: sourceId, deletedAt: null },
    select: {
      id: true,
      corpus: true,
      status: true,
      bibleBook: true,
      bibleTranslation: true,
      sermonCatalogId: true,
      storageKey: true,
    },
  });
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    title: deriveSourceTitle(row),
    corpus: row.corpus,
    status: row.status,
    bibleBook: row.bibleBook,
    bibleTranslation: row.bibleTranslation,
    sermonCatalogId: row.sermonCatalogId,
    storageKey: row.storageKey,
  };
}

/**
 * Builds the single-source context: first-N chunks up to the char budget.
 * Trailing chunks are dropped rather than truncated mid-chunk so the model
 * always sees a clean boundary.
 */
export async function buildSourceContext(
  source: SummarySourceRecord,
  deps: { prismaClient?: PrismaClient } = {},
): Promise<SourceContext> {
  const rawChunks = await loadOrderedChunks(
    source.id,
    MAX_CHUNKS_PER_SOURCE,
    deps,
  );
  const { kept, truncated } = takeChunksUpToBudget(rawChunks, PER_SOURCE_CHAR_BUDGET);
  return { source, chunks: kept, truncated };
}

/**
 * Builds a library-level context by round-robin sampling across sources.
 *
 * Flow (deterministic for a given input order):
 *  1. Cap the source set at `MAX_LIBRARY_SOURCES`. The caller is expected to
 *     have sorted / filtered upstream (e.g. by updatedAt DESC).
 *  2. Preload chunks for every source up to the per-source cap.
 *  3. Walk "round 0" across all sources taking chunk 0, then round 1, etc.,
 *     until the shared char budget runs out.
 *  4. Drop sources that contributed zero chunks from the result — they'd
 *     otherwise appear in the prompt's attribution line despite providing no
 *     text, which would mislead the model.
 */
export async function buildLibraryContext(
  candidateSources: readonly SummarySourceRecord[],
  deps: { prismaClient?: PrismaClient } = {},
): Promise<SummaryContext> {
  const limitedSources = candidateSources.slice(0, MAX_LIBRARY_SOURCES);

  const perSourceChunks = await Promise.all(
    limitedSources.map((source) =>
      loadOrderedChunks(source.id, MAX_CHUNKS_PER_SOURCE, deps),
    ),
  );

  const accumulated: string[][] = limitedSources.map(() => []);
  let charsUsed = 0;
  let anyChunkAddedThisRound = true;
  let round = 0;
  while (anyChunkAddedThisRound && charsUsed < LIBRARY_CHAR_BUDGET) {
    anyChunkAddedThisRound = false;
    for (let sourceIndex = 0; sourceIndex < limitedSources.length; sourceIndex += 1) {
      const chunksForSource = perSourceChunks[sourceIndex]!;
      if (round >= chunksForSource.length) {
        continue;
      }
      const candidate = chunksForSource[round]!;
      if (charsUsed + candidate.length > LIBRARY_CHAR_BUDGET) {
        // Budget exhausted for this round's remaining sources; exit outer loop.
        anyChunkAddedThisRound = false;
        break;
      }
      accumulated[sourceIndex]!.push(candidate);
      charsUsed += candidate.length;
      anyChunkAddedThisRound = true;
    }
    round += 1;
  }

  const contributingSources: SourceContext[] = [];
  for (let sourceIndex = 0; sourceIndex < limitedSources.length; sourceIndex += 1) {
    const chunks = accumulated[sourceIndex]!;
    if (chunks.length === 0) {
      continue;
    }
    const totalChunks = perSourceChunks[sourceIndex]!.length;
    contributingSources.push({
      source: limitedSources[sourceIndex]!,
      chunks,
      truncated: chunks.length < totalChunks,
    });
  }

  return {
    sources: contributingSources,
    approxTokenCount: Math.ceil(charsUsed / APPROX_CHARS_PER_TOKEN),
  };
}

/**
 * Pulls whole chunks off `rawChunks` until the next chunk would blow the
 * budget. Returns the kept chunks in order plus whether truncation happened.
 */
function takeChunksUpToBudget(
  rawChunks: readonly string[],
  charBudget: number,
): { kept: string[]; truncated: boolean } {
  const kept: string[] = [];
  let used = 0;
  for (const chunk of rawChunks) {
    if (kept.length > 0 && used + chunk.length > charBudget) {
      return { kept, truncated: true };
    }
    kept.push(chunk);
    used += chunk.length;
    // Edge case: a single chunk larger than the whole budget. We still keep it
    // (better to summarize oversized material than to refuse outright); the
    // `truncated` flag reflects the fact that no more chunks fit.
    if (used >= charBudget) {
      return { kept, truncated: kept.length < rawChunks.length };
    }
  }
  return { kept, truncated: false };
}
