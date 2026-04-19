import type { Prisma, SourceCorpus } from "@prisma/client";
import {
  citationHeadingFromRetrievedChunk,
  type LabeledChunk,
} from "@/lib/chat/rag-prompt";
import type { RetrievedChunk, RetrievalCorpus } from "@/lib/retrieval";
import {
  deriveSourceTitle,
  extractFilenameFromStorageKey,
} from "@/lib/sources/list-catalog";

/**
 * Inline citation payload for the chat UI (hover preview). Chunk text is never
 * persisted on `Message` rows — it is joined at read time or attached from the
 * in-memory retrieval result on the SSE `done` event.
 */
export type ChatCitation = Readonly<{
  label: string;
  snippet: string;
  heading: string;
}>;

type PrismaChunkWithSource = Readonly<{
  id: string;
  content: string;
  metadata: Prisma.JsonValue;
  source: {
    id: string;
    corpus: SourceCorpus;
    bibleBook: string | null;
    bibleTranslation: string | null;
    sermonCatalogId: string | null;
    storageKey: string | null;
  };
}>;

/** Maps a persisted chunk row (+ source) into the same display shape as retrieval. */
export function retrievedChunkFromPrismaRow(row: PrismaChunkWithSource): RetrievedChunk {
  const corpus = row.source.corpus as RetrievalCorpus;
  const title = deriveSourceTitle({
    bibleBook: row.source.bibleBook,
    bibleTranslation: row.source.bibleTranslation,
    sermonCatalogId: row.source.sermonCatalogId,
    storageKey: row.source.storageKey,
    corpus: row.source.corpus,
  });
  const meta =
    row.metadata !== null &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  return {
    chunkId: row.id,
    content: row.content,
    metadata: meta,
    sourceId: row.source.id,
    corpus,
    title,
    bibleBook: row.source.bibleBook,
    bibleTranslation: row.source.bibleTranslation,
    sermonCatalogId: row.source.sermonCatalogId,
    storageKey: row.source.storageKey,
    filename: extractFilenameFromStorageKey(row.source.storageKey),
    distance: 0,
  };
}

export function buildCitationsFromLabeledChunks(
  labeled: readonly LabeledChunk[],
): Record<string, ChatCitation> {
  const out: Record<string, ChatCitation> = {};
  for (const { label, chunk } of labeled) {
    out[label] = {
      label,
      snippet: chunk.content.trim(),
      heading: citationHeadingFromRetrievedChunk(chunk),
    };
  }
  return out;
}

/**
 * Builds `C1`…`Cn` keys from ordered chunk ids (same order as `labelChunks` /
 * `retrieval_debug.chunkIds`).
 */
export function buildCitationsFromOrderedChunkIds(
  chunkIds: readonly string[],
  chunkById: ReadonlyMap<string, RetrievedChunk>,
): Record<string, ChatCitation> {
  const out: Record<string, ChatCitation> = {};
  chunkIds.forEach((chunkId, index) => {
    const label = `C${index + 1}`;
    const retrieved = chunkById.get(chunkId);
    if (retrieved) {
      out[label] = {
        label,
        snippet: retrieved.content.trim(),
        heading: citationHeadingFromRetrievedChunk(retrieved),
      };
    } else {
      out[label] = {
        label,
        snippet:
          "This source passage is no longer available in the catalog.",
        heading: "Source unavailable",
      };
    }
  });
  return out;
}
