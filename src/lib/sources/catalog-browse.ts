/**
 * Folder-style browsing for the source catalog (grouped by corpus + VGR sermon year).
 */

import type { Prisma, SourceStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  type CatalogSortField,
  type CatalogSortOrder,
  type ParsedCatalogPath,
  buildCatalogSearchFilter,
  isBranhamMarkdownFolderMember,
  isVgrSermonRow,
  prismaWhereForCatalogLeaf,
  vgrYearForSourceRow,
} from "@/lib/sources/catalog-folders";
import {
  deriveSourceTitle,
  type CatalogSourceSummary,
} from "@/lib/sources/list-catalog";

export type CatalogFolderIndex = {
  totalSources: number;
  bibleCount: number;
  /** All `corpus === sermon` rows (dated + transcripts). */
  messageCount: number;
  transcriptCount: number;
  datedSermonCount: number;
  otherCount: number;
  bibleBooks: { label: string; count: number }[];
  sermonYears: { year: number; count: number }[];
};

type SourceRowForCatalog = {
  id: string;
  corpus: CatalogSourceSummary["corpus"];
  status: SourceStatus;
  errorMessage: string | null;
  bibleBook: string | null;
  bibleTranslation: string | null;
  sermonCatalogId: string | null;
  storageKey: string | null;
  updatedAt: Date;
};

const catalogSelect = {
  id: true,
  corpus: true,
  status: true,
  errorMessage: true,
  bibleBook: true,
  bibleTranslation: true,
  sermonCatalogId: true,
  storageKey: true,
  updatedAt: true,
} satisfies Prisma.SourceSelect;

function mergeFolderAndSearch(
  folderWhere: Prisma.SourceWhereInput,
  q: string | null | undefined,
): Prisma.SourceWhereInput {
  const search = buildCatalogSearchFilter(q ?? "");
  if (!search) {
    return folderWhere;
  }
  return { AND: [folderWhere, search] };
}

function orderByForLeaf(
  path: ParsedCatalogPath,
  sort: CatalogSortField,
  order: CatalogSortOrder,
): Prisma.SourceOrderByWithRelationInput | Prisma.SourceOrderByWithRelationInput[] {
  const dir = order;
  if (sort === "updated") {
    return [{ updatedAt: dir }, { id: dir }];
  }
  if (sort === "status") {
    return [{ status: dir }, { id: dir }];
  }
  // title — stable proxies per folder
  if (path.kind === "message-year") {
    return [{ sermonCatalogId: dir }, { storageKey: dir }, { id: dir }];
  }
  if (path.kind === "bible-book") {
    return [{ bibleTranslation: dir }, { storageKey: dir }, { id: dir }];
  }
  return [{ storageKey: dir }, { id: dir }];
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareTitles(left: CatalogSourceSummary, right: CatalogSourceSummary): number {
  return compareStrings(left.title, right.title);
}

function compareStatus(
  left: CatalogSourceSummary,
  right: CatalogSourceSummary,
  order: CatalogSortOrder,
): number {
  const cmp = compareStrings(left.status, right.status);
  return order === "asc" ? cmp : -cmp;
}

function compareUpdated(
  left: CatalogSourceSummary,
  right: CatalogSourceSummary,
  order: CatalogSortOrder,
): number {
  const leftTime = Date.parse(left.updatedAt);
  const rightTime = Date.parse(right.updatedAt);
  const cmp =
    leftTime === rightTime
      ? compareStrings(left.id, right.id)
      : leftTime - rightTime;
  return order === "asc" ? cmp : -cmp;
}

function sortSummaries(
  items: CatalogSourceSummary[],
  sort: CatalogSortField,
  order: CatalogSortOrder,
): CatalogSourceSummary[] {
  const copy = [...items];
  copy.sort((left, right) => {
    if (sort === "title") {
      const titleCmp = compareTitles(left, right);
      if (titleCmp !== 0) {
        return order === "asc" ? titleCmp : -titleCmp;
      }
      return compareStrings(left.id, right.id);
    }
    if (sort === "status") {
      const statusCmp = compareStatus(left, right, order);
      if (statusCmp !== 0) {
        return statusCmp;
      }
      return compareStrings(left.id, right.id);
    }
    return compareUpdated(left, right, order);
  });
  return copy;
}

function mapRowsToSummaries(rows: SourceRowForCatalog[]): CatalogSourceSummary[] {
  return rows.map((row) => ({
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
}

export async function loadCatalogFolderIndex(): Promise<CatalogFolderIndex> {
  const rows = await prisma.source.findMany({
    where: { deletedAt: null },
    select: {
      corpus: true,
      bibleBook: true,
      sermonCatalogId: true,
      storageKey: true,
    },
  });

  let bibleCount = 0;
  let transcriptCount = 0;
  let datedSermonCount = 0;
  let messageCount = 0;
  let otherCount = 0;
  const bibleBookCounts = new Map<string, number>();
  const sermonYearCounts = new Map<number, number>();

  for (const row of rows) {
    if (row.corpus === "scripture") {
      bibleCount += 1;
      const label =
        row.bibleBook && row.bibleBook.trim().length > 0
          ? row.bibleBook.trim()
          : "Unspecified";
      bibleBookCounts.set(label, (bibleBookCounts.get(label) ?? 0) + 1);
      continue;
    }
    if (row.corpus === "other") {
      otherCount += 1;
      continue;
    }
    if (row.corpus === "sermon") {
      messageCount += 1;
      const minimal = {
        corpus: row.corpus,
        bibleBook: row.bibleBook,
        sermonCatalogId: row.sermonCatalogId,
        storageKey: row.storageKey,
      };
      if (isVgrSermonRow(minimal)) {
        datedSermonCount += 1;
        const year = vgrYearForSourceRow(minimal);
        if (year !== null) {
          sermonYearCounts.set(year, (sermonYearCounts.get(year) ?? 0) + 1);
        }
      } else if (isBranhamMarkdownFolderMember(minimal)) {
        transcriptCount += 1;
      }
    }
  }

  const bibleBooks = [...bibleBookCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) =>
      compareStrings(
        left.label === "Unspecified" ? "" : left.label,
        right.label === "Unspecified" ? "" : right.label,
      ),
    );

  const sermonYears = [...sermonYearCounts.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((left, right) => right.year - left.year);

  return {
    totalSources: rows.length,
    bibleCount,
    messageCount,
    transcriptCount,
    datedSermonCount,
    otherCount,
    bibleBooks,
    sermonYears,
  };
}

export type ListCatalogFolderPageResult = {
  items: CatalogSourceSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
};

export function clampCatalogPage(raw: number | null | undefined): number {
  if (!Number.isFinite(raw ?? NaN)) {
    return 1;
  }
  const page = Math.floor(raw as number);
  if (page < 1) {
    return 1;
  }
  return page;
}

export async function listCatalogFolderPage(options: {
  path: ParsedCatalogPath;
  limit: number;
  page: number;
  q?: string | null;
  sort: CatalogSortField;
  order: CatalogSortOrder;
}): Promise<ListCatalogFolderPageResult> {
  const limit = Math.min(Math.max(1, options.limit), 200);
  const page = clampCatalogPage(options.page);
  const skip = (page - 1) * limit;
  const path = options.path;

  if (path.kind === "message-transcripts") {
    const sermonRows = await prisma.source.findMany({
      where: mergeFolderAndSearch({ deletedAt: null, corpus: "sermon" }, options.q),
      select: catalogSelect,
    });
    const filtered = sermonRows.filter((row) =>
      isBranhamMarkdownFolderMember({
        corpus: row.corpus,
        bibleBook: row.bibleBook,
        sermonCatalogId: row.sermonCatalogId,
        storageKey: row.storageKey,
      }),
    );
    let summaries = sortSummaries(
      mapRowsToSummaries(filtered),
      options.sort,
      options.order,
    );
    const totalCount = summaries.length;
    summaries = summaries.slice(skip, skip + limit);
    return { items: summaries, totalCount, page, pageSize: limit };
  }

  const folderWhere = prismaWhereForCatalogLeaf(path);
  if (!folderWhere) {
    return { items: [], totalCount: 0, page, pageSize: limit };
  }

  const where = mergeFolderAndSearch(folderWhere, options.q);
  const orderBy = orderByForLeaf(path, options.sort, options.order);

  const totalCount = await prisma.source.count({ where });
  const rows = await prisma.source.findMany({
    where,
    orderBy,
    skip,
    take: limit,
    select: catalogSelect,
  });

  const summaries = mapRowsToSummaries(rows);

  return {
    items: summaries,
    totalCount,
    page,
    pageSize: limit,
  };
}

export function parseCatalogSortParams(
  sortRaw: string | null | undefined,
  orderRaw: string | null | undefined,
): { sort: CatalogSortField; order: CatalogSortOrder } {
  const sort: CatalogSortField =
    sortRaw === "title" || sortRaw === "status" || sortRaw === "updated"
      ? sortRaw
      : "updated";
  const order: CatalogSortOrder = orderRaw === "asc" ? "asc" : "desc";
  return { sort, order };
}
