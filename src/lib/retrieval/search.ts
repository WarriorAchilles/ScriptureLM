/**
 * Scoped vector search over the global chunk index (Step 12).
 *
 * Master spec refs: §5.3 (retrieval with corpus balancing), §5.1 (scope by source
 * selection), §6.4 query path, §15 #7 (vector-only in v1), §12 #2 (citations).
 *
 * Invariants:
 *  - Always joins `sources` to exclude soft-deleted (`deleted_at IS NOT NULL`) and
 *    non-ready sources. "Non-hidden ready sources" per the step doc == this filter.
 *  - Uses the pgvector cosine-distance operator (`<=>`); Titan v2 vectors are
 *    normalized at embed time (see `src/lib/embeddings/bedrock.ts`), so cosine
 *    distance is the correct metric for nearest-neighbour ranking.
 *  - When neither `sourceIds` nor `corpus` is provided we run a simple quota split
 *    (`k/2` scripture + `k/2` sermon) to mitigate sermon-chunk dominance over
 *    Bible chunks (§5.3). The `other` corpus is intentionally excluded from the
 *    quota path — callers wanting it must pass an explicit `corpus` filter or
 *    `sourceIds`. This is a deliberate v1 simplification noted in the step doc.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  embedTextWithBedrock,
  type EmbedTextsBedrockOptions,
} from "@/lib/embeddings/bedrock";
import { formatVectorLiteral } from "@/lib/embeddings/pg-vector";
import {
  deriveSourceTitle,
  extractFilenameFromStorageKey,
} from "@/lib/sources/list-catalog";

export type RetrievalCorpus = "scripture" | "sermon" | "other";

export type RetrieveContextParams = Readonly<{
  query: string;
  /** Requested neighbour count `k`. Clamped to `[1, MAX_RETRIEVAL_LIMIT]`. */
  limit: number;
  /**
   * Explicit scope of source ids to search within. When `undefined` or an empty
   * array, retrieval falls back to "all non-hidden ready sources" (see module doc).
   */
  sourceIds?: readonly string[];
  /** Optional corpus filter joined against `sources.corpus`. */
  corpus?: RetrievalCorpus;
}>;

export type RetrievedChunk = {
  chunkId: string;
  content: string;
  metadata: Record<string, unknown>;
  sourceId: string;
  corpus: RetrievalCorpus;
  /** Human-readable title derived from source metadata (matches catalog UI). */
  title: string;
  bibleBook: string | null;
  bibleTranslation: string | null;
  sermonCatalogId: string | null;
  storageKey: string | null;
  filename: string | null;
  /** Raw pgvector cosine distance (0 = identical, larger = less similar). */
  distance: number;
};

export type RetrieveContextDeps = Readonly<{
  prismaClient?: PrismaClient;
  bedrock?: EmbedTextsBedrockOptions;
  /**
   * Inject a pre-computed query embedding to skip Bedrock entirely (tests, or
   * future re-use when the same query is embedded once per thread turn).
   */
  queryEmbedding?: readonly number[];
}>;

export const MAX_RETRIEVAL_LIMIT = 50;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawSearchRow = {
  chunk_id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  source_id: string;
  corpus: string;
  bible_book: string | null;
  bible_translation: string | null;
  sermon_catalog_id: string | null;
  storage_key: string | null;
  /** `numeric`/`double precision` deserializes as either `number` or `string` depending on driver. */
  distance: number | string;
};

/**
 * Runs vector search against `chunks` joined to `sources`, applying the scope
 * filters. The SQL is built with `Prisma.sql` so all parameters are driver-bound
 * (no string interpolation of user input).
 */
async function runVectorSearch(
  database: PrismaClient,
  vectorLiteral: string,
  limit: number,
  scopedSourceIds: readonly string[] | null,
  corpus: RetrievalCorpus | null,
): Promise<RetrievedChunk[]> {
  const sourceIdFilter =
    scopedSourceIds && scopedSourceIds.length > 0
      ? Prisma.sql`AND c.source_id = ANY(ARRAY[${Prisma.join(
          scopedSourceIds.map((id) => Prisma.sql`${id}::uuid`),
        )}])`
      : Prisma.empty;

  // `s.corpus` is a Postgres enum — compare via `::text` to avoid forcing callers
  // to know the Prisma enum type name (`"SourceCorpus"`) and because the value
  // is a plain string coming from our own validated union.
  const corpusFilter = corpus
    ? Prisma.sql`AND s.corpus::text = ${corpus}`
    : Prisma.empty;

  const rows = await database.$queryRaw<RawSearchRow[]>(Prisma.sql`
    SELECT
      c.id AS chunk_id,
      c.content,
      c.metadata,
      c.source_id,
      s.corpus::text AS corpus,
      s.bible_book,
      s.bible_translation,
      s.sermon_catalog_id,
      s.storage_key,
      (c.embedding <=> ${vectorLiteral}::vector) AS distance
    FROM chunks c
    JOIN sources s ON s.id = c.source_id
    WHERE c.embedding IS NOT NULL
      AND s.deleted_at IS NULL
      AND s.status::text = 'READY'
      ${sourceIdFilter}
      ${corpusFilter}
    ORDER BY c.embedding <=> ${vectorLiteral}::vector
    LIMIT ${limit}
  `);

  return rows.map(toRetrievedChunk);
}

function toRetrievedChunk(row: RawSearchRow): RetrievedChunk {
  const corpus = row.corpus as RetrievalCorpus;
  const title = deriveSourceTitle({
    bibleBook: row.bible_book,
    bibleTranslation: row.bible_translation,
    sermonCatalogId: row.sermon_catalog_id,
    storageKey: row.storage_key,
    corpus,
  });
  return {
    chunkId: row.chunk_id,
    content: row.content,
    metadata: row.metadata ?? {},
    sourceId: row.source_id,
    corpus,
    title,
    bibleBook: row.bible_book,
    bibleTranslation: row.bible_translation,
    sermonCatalogId: row.sermon_catalog_id,
    storageKey: row.storage_key,
    filename: extractFilenameFromStorageKey(row.storage_key),
    distance: typeof row.distance === "string" ? Number(row.distance) : row.distance,
  };
}

function normalizeSourceIds(
  rawSourceIds: readonly string[] | undefined,
): string[] | null {
  if (!rawSourceIds || rawSourceIds.length === 0) {
    return null;
  }
  const validIds: string[] = [];
  for (const candidate of rawSourceIds) {
    const trimmed = candidate.trim();
    if (UUID_REGEX.test(trimmed)) {
      validIds.push(trimmed);
    }
  }
  // If the caller passed ids but none survived validation, treat as empty scope
  // (no results) rather than silently widening to "all sources".
  return validIds;
}

function logTopSources(
  rows: readonly RetrievedChunk[],
  context: { scoped: boolean; corpus: RetrievalCorpus | null },
): void {
  // Debug-level so prod log volume stays low; JSON line for easy grep/parse.
  const line = JSON.stringify({
    level: "debug",
    event: "retrieval_result",
    hitCount: rows.length,
    topSourceIds: rows.slice(0, 5).map((row) => row.sourceId),
    scoped: context.scoped,
    corpus: context.corpus,
  });
  // eslint-disable-next-line no-console
  console.debug(line);
}

/**
 * Embed `query` (unless `queryEmbedding` is injected), run scoped vector search,
 * and return ranked chunks with citation-ready display fields.
 *
 * Returns `[]` — never throws — when there are no matches, when the validated
 * `sourceIds` scope is empty after filtering, or when the query is blank.
 */
export async function retrieveContext(
  params: RetrieveContextParams,
  deps: RetrieveContextDeps = {},
): Promise<RetrievedChunk[]> {
  const database = deps.prismaClient ?? prisma;
  const trimmedQuery = params.query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const limit = clampLimit(params.limit);
  const scopedSourceIds = normalizeSourceIds(params.sourceIds);
  // Caller passed non-null `sourceIds`, but after validation the set is empty:
  // honour the scope literally (zero sources → zero results).
  if (scopedSourceIds !== null && scopedSourceIds.length === 0) {
    logTopSources([], { scoped: true, corpus: params.corpus ?? null });
    return [];
  }

  const queryVector = deps.queryEmbedding
    ? Array.from(deps.queryEmbedding)
    : await embedTextWithBedrock(trimmedQuery, deps.bedrock ?? {});
  const vectorLiteral = formatVectorLiteral(queryVector);

  const hasExplicitScope = scopedSourceIds !== null || Boolean(params.corpus);
  if (hasExplicitScope) {
    const rows = await runVectorSearch(
      database,
      vectorLiteral,
      limit,
      scopedSourceIds,
      params.corpus ?? null,
    );
    logTopSources(rows, {
      scoped: scopedSourceIds !== null,
      corpus: params.corpus ?? null,
    });
    return rows;
  }

  // No scope + no corpus → quota split to avoid one corpus dominating top-k.
  // Over-fetch each corpus up to `limit` so we can top-up if one side is sparse.
  const scriptureQuota = Math.ceil(limit / 2);
  const sermonQuota = limit - scriptureQuota;
  const [scriptureRows, sermonRows] = await Promise.all([
    runVectorSearch(database, vectorLiteral, limit, null, "scripture"),
    runVectorSearch(database, vectorLiteral, limit, null, "sermon"),
  ]);

  const merged: RetrievedChunk[] = [
    ...scriptureRows.slice(0, scriptureQuota),
    ...sermonRows.slice(0, sermonQuota),
  ];
  // Top up with the leftover rows when one corpus returned fewer than its quota
  // (e.g., scripture not yet indexed). Ordering by distance keeps the best-first
  // contract regardless of which side contributed the filler.
  if (merged.length < limit) {
    const leftover = [
      ...scriptureRows.slice(scriptureQuota),
      ...sermonRows.slice(sermonQuota),
    ].sort(byAscendingDistance);
    for (const candidate of leftover) {
      if (merged.length >= limit) {
        break;
      }
      merged.push(candidate);
    }
  }
  merged.sort(byAscendingDistance);
  const finalRows = merged.slice(0, limit);
  logTopSources(finalRows, { scoped: false, corpus: null });
  return finalRows;
}

function byAscendingDistance(
  left: RetrievedChunk,
  right: RetrievedChunk,
): number {
  return left.distance - right.distance;
}

function clampLimit(rawLimit: number): number {
  if (!Number.isFinite(rawLimit)) {
    return 1;
  }
  const rounded = Math.floor(rawLimit);
  if (rounded < 1) {
    return 1;
  }
  if (rounded > MAX_RETRIEVAL_LIMIT) {
    return MAX_RETRIEVAL_LIMIT;
  }
  return rounded;
}
