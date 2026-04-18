/**
 * Read-only source catalog listing for end users (Step 10).
 *
 * Scope:
 *  - Excludes soft-deleted entries (`deletedAt IS NOT NULL`) — matches Step 03 lifecycle rules.
 *  - Deterministic ordering by (updatedAt DESC, id DESC) so keyset pagination is stable even
 *    when two rows share the same `updatedAt` (common for bulk-ingested batches).
 *  - Returns only fields needed by the workspace UI (§5.2). The API route is responsible for
 *    truncating error messages for display; this module returns the full string so callers
 *    such as future admin tooling can decide on their own truncation.
 *
 * Pagination model: opaque base64-encoded JSON cursor `{ updatedAt, id }`. We prefer keyset
 * pagination over offset because the catalog is expected to grow toward **~1,200 rows**
 * (master spec §4) and keyset queries stay O(log N) with the `(updated_at, id)` ordering.
 */

import type { Prisma, SourceCorpus, SourceStatus } from "@prisma/client";
import prisma from "@/lib/prisma";

export type CatalogSourceSummary = {
  id: string;
  title: string;
  corpus: SourceCorpus;
  status: SourceStatus;
  errorMessage: string | null;
  updatedAt: string;
};

export type ListCatalogPage = {
  items: CatalogSourceSummary[];
  nextCursor: string | null;
};

export type ListCatalogOptions = {
  limit: number;
  cursor?: string | null;
  /**
   * Free-text filter matched against derived title fields (bible book, sermon
   * catalog id, storage key basename). Case-insensitive, trimmed; empty string
   * behaves as no filter. Master spec §15 #8 + Step 14 #2.
   */
  q?: string | null;
};

type CursorPayload = { updatedAt: string; id: string };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function clampListLimit(rawLimit: number | null | undefined): number {
  if (!Number.isFinite(rawLimit ?? NaN)) {
    return DEFAULT_LIMIT;
  }
  const rounded = Math.floor(rawLimit as number);
  if (rounded <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(rounded, MAX_LIMIT);
}

export function encodeCatalogCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCatalogCursor(raw: string | null | undefined): CursorPayload | null {
  if (!raw) {
    return null;
  }
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<CursorPayload>;
    if (typeof parsed.id !== "string" || typeof parsed.updatedAt !== "string") {
      return null;
    }
    if (Number.isNaN(Date.parse(parsed.updatedAt))) {
      return null;
    }
    return { id: parsed.id, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

/**
 * Derive a human-readable title for the catalog UI.
 *
 * Scripture rows typically have `bibleBook` + `bibleTranslation`; sermons typically carry
 * `sermonCatalogId` or a descriptive filename (see `scripts/register-source.ts`). Falling
 * back to the storage key basename preserves operator-provided names for `other` corpora.
 */
export function deriveSourceTitle(source: {
  bibleBook: string | null;
  bibleTranslation: string | null;
  sermonCatalogId: string | null;
  storageKey: string | null;
  corpus: SourceCorpus;
}): string {
  if (source.corpus === "scripture" && source.bibleBook) {
    const translation = source.bibleTranslation?.trim();
    return translation
      ? `${source.bibleBook} (${translation})`
      : source.bibleBook;
  }

  if (source.corpus === "sermon" && source.sermonCatalogId) {
    return source.sermonCatalogId;
  }

  const filename = extractFilenameFromStorageKey(source.storageKey);
  if (filename) {
    return filename;
  }

  return "Untitled source";
}

export function extractFilenameFromStorageKey(storageKey: string | null): string | null {
  if (!storageKey) {
    return null;
  }
  const trailingSlash = storageKey.lastIndexOf("/");
  const basename =
    trailingSlash >= 0 ? storageKey.slice(trailingSlash + 1) : storageKey;
  if (!basename) {
    return null;
  }
  const lastDot = basename.lastIndexOf(".");
  const stem = lastDot > 0 ? basename.slice(0, lastDot) : basename;
  // Restore operator-friendly spacing: `My_File-Name` -> `My File Name`.
  return stem.replace(/[_-]+/g, " ").trim() || basename;
}

/**
 * Shared `where` for catalog list + total count (same visibility rules: not soft-deleted,
 * optional title search). Keyset `cursor` is omitted when counting the full catalog.
 */
function buildCatalogWhere(options: {
  cursor: CursorPayload | null;
  q?: string | null;
}): Prisma.SourceWhereInput {
  const searchTerm = (options.q ?? "").trim();
  const where: Prisma.SourceWhereInput = { deletedAt: null };
  if (options.cursor) {
    const cursorUpdatedAt = new Date(options.cursor.updatedAt);
    where.OR = [
      { updatedAt: { lt: cursorUpdatedAt } },
      { updatedAt: cursorUpdatedAt, id: { lt: options.cursor.id } },
    ];
  }
  if (searchTerm.length > 0) {
    // Search across the three fields that feed `deriveSourceTitle`. Case-
    // insensitive `contains` is cheap here because the catalog is ~1,200 rows
    // (§4) and queries are further bounded by the keyset cursor.
    const substring: Prisma.StringFilter = { contains: searchTerm, mode: "insensitive" };
    const titleFilter: Prisma.SourceWhereInput = {
      OR: [
        { bibleBook: substring },
        { sermonCatalogId: substring },
        { storageKey: substring },
      ],
    };
    // Merge with the cursor disjunction if present so both constraints apply.
    where.AND = where.OR ? [{ OR: where.OR }, titleFilter] : [titleFilter];
    delete where.OR;
  }
  return where;
}

export async function countCatalogSources(options: {
  q?: string | null;
} = {}): Promise<number> {
  const where = buildCatalogWhere({ cursor: null, q: options.q });
  return prisma.source.count({ where });
}

export async function listCatalogSources(
  options: ListCatalogOptions,
): Promise<ListCatalogPage> {
  const limit = clampListLimit(options.limit);
  const cursor = decodeCatalogCursor(options.cursor ?? null);
  const where = buildCatalogWhere({ cursor, q: options.q });

  // Fetch `limit + 1` to detect whether another page exists without a separate COUNT query.
  const rows = await prisma.source.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      corpus: true,
      status: true,
      errorMessage: true,
      bibleBook: true,
      bibleTranslation: true,
      sermonCatalogId: true,
      storageKey: true,
      updatedAt: true,
    },
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const items: CatalogSourceSummary[] = pageRows.map((row) => ({
    id: row.id,
    title: deriveSourceTitle({
      bibleBook: row.bibleBook,
      bibleTranslation: row.bibleTranslation,
      sermonCatalogId: row.sermonCatalogId,
      storageKey: row.storageKey,
      corpus: row.corpus,
    }),
    corpus: row.corpus,
    status: row.status,
    errorMessage: row.errorMessage,
    updatedAt: row.updatedAt.toISOString(),
  }));

  const nextCursor =
    hasMore && pageRows.length > 0
      ? encodeCatalogCursor({
          updatedAt: pageRows[pageRows.length - 1].updatedAt.toISOString(),
          id: pageRows[pageRows.length - 1].id,
        })
      : null;

  return { items, nextCursor };
}
