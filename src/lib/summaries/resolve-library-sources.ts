/**
 * Resolves the candidate Source rows for a library-brief request (Step 15 #2).
 *
 * Library scope mirrors the chat scope rules from Step 14 (§5.1, §5.3):
 *  - `sourceIds` explicitly listed → custom scope; validate every id exists
 *    and is non-deleted (done upstream by `validateChatSourceScope`).
 *  - `corpus` filter → narrows to a single corpus across READY sources.
 *  - Neither → "all" over every READY source in the catalog.
 *
 * Only **READY** sources are eligible contributors: per Step 12, non-READY
 * sources have either no chunks or incomplete embeddings, so they'd either
 * produce empty context or mislead the model. The bound `MAX_LIBRARY_SOURCES`
 * keeps prompts predictably sized even if the catalog is the full ~1,200 rows.
 *
 * Deterministic ordering (`updatedAt DESC, id DESC`) mirrors the catalog list
 * so the brief is reproducible for the same inputs (master spec §13).
 */

import type { PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { ChatSourceScope } from "@/lib/chat/source-scope";
import { deriveSourceTitle } from "@/lib/sources/list-catalog";
import {
  MAX_LIBRARY_SOURCES,
  loadSummarySource,
  type SummarySourceRecord,
} from "@/lib/summaries/context";

export async function resolveLibraryCandidateSources(
  scope: ChatSourceScope,
  deps: { prismaClient?: PrismaClient } = {},
): Promise<SummarySourceRecord[]> {
  const database = deps.prismaClient ?? prisma;

  if (scope.mode === "custom") {
    const ids = scope.selectedSourceIds ?? [];
    if (ids.length === 0) {
      return [];
    }
    // `loadSummarySource` rejects soft-deleted rows; validation upstream has
    // already proven they exist, but we re-check status here so a non-READY
    // id in a user-picked list silently drops out of the brief rather than
    // 500ing during context build.
    const loaded = await Promise.all(
      ids.map((sourceId) => loadSummarySource(sourceId, { prismaClient: database })),
    );
    return loaded
      .filter((row): row is SummarySourceRecord => row !== null)
      .filter((row) => row.status === "READY")
      .slice(0, MAX_LIBRARY_SOURCES);
  }

  const corpusFilter =
    scope.mode === "scripture"
      ? { corpus: "scripture" as const }
      : scope.mode === "sermon"
        ? { corpus: "sermon" as const }
        : {};

  const rows = await database.source.findMany({
    where: {
      deletedAt: null,
      status: "READY",
      ...corpusFilter,
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: MAX_LIBRARY_SOURCES,
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

  return rows.map((row) => ({
    id: row.id,
    title: deriveSourceTitle(row),
    corpus: row.corpus,
    status: row.status,
    bibleBook: row.bibleBook,
    bibleTranslation: row.bibleTranslation,
    sermonCatalogId: row.sermonCatalogId,
    storageKey: row.storageKey,
  }));
}
