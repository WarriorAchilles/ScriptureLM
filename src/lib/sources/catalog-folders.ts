/**
 * Logical folder layout for the source catalog: **The Bible** (scripture) and
 * **The Message** (all sermon corpora). Subfolders under The Message group
 * dated messages by year (VGR-style ids) and the CAB folder separately.
 *
 * Blob `storage_key` does not preserve on-disk paths (`sources/{uuid}/filename`),
 * so grouping uses corpus fields plus VGR-style sermon ids (see `parseSermonIdFromFilename`).
 */

import type { Prisma, SourceCorpus } from "@prisma/client";
import { parseSermonIdFromFilename } from "@/lib/ingest/filename-meta";

export const CATALOG_ROOT_SEGMENTS: readonly string[] = [];

/** CAB folder (Church Ages Book) — shown under The Message for non–VGR-dated sermon sources. */
export const CAB_FOLDER_DESCRIPTION =
  "An Exposition of the Seven Church Ages";

export type CatalogPathRoot = { kind: "root" };

export type CatalogPathBibleLanding = { kind: "bible" };

export type CatalogPathBibleBook = { kind: "bible-book"; bookLabel: string };

/** The Message — landing (all sermon subfolders). */
export type CatalogPathMessageLanding = { kind: "message" };

/** The Message — one calendar year (VGR-style sermon ids). */
export type CatalogPathMessageYear = { kind: "message-year"; year: number };

/** The Message — CAB (sermons without a VGR date code on catalog id or filename). */
export type CatalogPathMessageTranscripts = { kind: "message-transcripts" };

export type CatalogPathOther = { kind: "other" };

export type ParsedCatalogPath =
  | CatalogPathRoot
  | CatalogPathBibleLanding
  | CatalogPathBibleBook
  | CatalogPathMessageLanding
  | CatalogPathMessageYear
  | CatalogPathMessageTranscripts
  | CatalogPathOther;

export type CatalogSortField = "updated" | "title" | "status";
export type CatalogSortOrder = "asc" | "desc";

export function extractVgrSermonIdFromSource(row: {
  sermonCatalogId: string | null;
  storageKey: string | null;
}): string | undefined {
  const fromCatalog = row.sermonCatalogId?.trim();
  if (fromCatalog && isVgrSermonIdString(fromCatalog)) {
    return fromCatalog;
  }
  const basename = row.storageKey?.split("/").pop() ?? "";
  return parseSermonIdFromFilename(basename);
}

export function isVgrSermonIdString(value: string): boolean {
  return /^\d{2}-\d{4}[A-Z]?$/i.test(value.trim());
}

export function fullYearFromVgrSermonId(sermonId: string): number | null {
  const match = sermonId.trim().match(/^(\d{2})-\d{4}/i);
  if (!match) {
    return null;
  }
  const yy = Number.parseInt(match[1], 10);
  if (!Number.isFinite(yy)) {
    return null;
  }
  return yy >= 40 ? 1900 + yy : 2000 + yy;
}

export function vgrPrefixForCalendarYear(fullYear: number): string {
  const yy = fullYear % 100;
  return `${String(yy).padStart(2, "0")}-`;
}

export function parseCatalogPath(raw: string | null | undefined): ParsedCatalogPath {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    return { kind: "root" };
  }

  const segments = trimmed
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });

  if (segments.some((segment) => segment === "..")) {
    return { kind: "root" };
  }

  const [first, second] = segments;

  if (segments.length === 1 && first === "bible") {
    return { kind: "bible" };
  }
  if (segments.length === 2 && first === "bible" && second) {
    return { kind: "bible-book", bookLabel: second };
  }

  if (segments.length === 1 && first === "message") {
    return { kind: "message" };
  }
  if (segments.length === 2 && first === "message" && second) {
    const messageSub = second.toLowerCase();
    if (messageSub === "cab" || messageSub === "transcripts") {
      return { kind: "message-transcripts" };
    }
    const year = Number.parseInt(second, 10);
    if (
      Number.isFinite(year) &&
      year >= 1900 &&
      year <= 2100 &&
      String(year) === second
    ) {
      return { kind: "message-year", year };
    }
  }

  // Legacy URLs (still recognized)
  if (segments.length === 1 && first === "sermons") {
    return { kind: "message" };
  }
  if (segments.length === 2 && first === "sermons" && second) {
    const year = Number.parseInt(second, 10);
    if (
      Number.isFinite(year) &&
      year >= 1900 &&
      year <= 2100 &&
      String(year) === second
    ) {
      return { kind: "message-year", year };
    }
  }
  if (segments.length === 1 && first === "branham-md") {
    return { kind: "message-transcripts" };
  }

  if (segments.length === 1 && first === "other") {
    return { kind: "other" };
  }

  return { kind: "root" };
}

export function formatCatalogPath(path: ParsedCatalogPath): string {
  switch (path.kind) {
    case "root":
      return "";
    case "bible":
      return "bible";
    case "bible-book":
      return `bible/${encodeURIComponent(path.bookLabel)}`;
    case "message":
      return "message";
    case "message-transcripts":
      return "message/cab";
    case "message-year":
      return `message/${path.year}`;
    case "other":
      return "other";
    default:
      return "";
  }
}

export function isCatalogLeafPath(path: ParsedCatalogPath): boolean {
  return (
    path.kind === "bible-book" ||
    path.kind === "message-transcripts" ||
    path.kind === "message-year" ||
    path.kind === "other"
  );
}

export function catalogFolderLabel(path: ParsedCatalogPath): string {
  switch (path.kind) {
    case "root":
      return "All folders";
    case "bible":
      return "The Bible";
    case "bible-book":
      return path.bookLabel;
    case "message":
      return "The Message";
    case "message-transcripts":
      return "CAB";
    case "message-year":
      return String(path.year);
    case "other":
      return "Other";
    default:
      return "";
  }
}

type MinimalSourceRow = {
  corpus: SourceCorpus;
  bibleBook: string | null;
  sermonCatalogId: string | null;
  storageKey: string | null;
};

/** Sermon rows without a VGR-style id (transcripts vs dated message codes). */
export function isBranhamMarkdownFolderMember(row: MinimalSourceRow): boolean {
  if (row.corpus !== "sermon") {
    return false;
  }
  return !extractVgrSermonIdFromSource(row);
}

export function isVgrSermonRow(row: MinimalSourceRow): boolean {
  return extractVgrSermonIdFromSource(row) !== undefined;
}

export function vgrYearForSourceRow(row: MinimalSourceRow): number | null {
  const sermonId = extractVgrSermonIdFromSource(row);
  if (!sermonId) {
    return null;
  }
  return fullYearFromVgrSermonId(sermonId);
}

export function prismaWhereForCatalogLeaf(
  path: ParsedCatalogPath,
): Prisma.SourceWhereInput | null {
  switch (path.kind) {
    case "bible-book": {
      const book = path.bookLabel.trim();
      if (book === "Unspecified" || book === "_unspecified") {
        return {
          deletedAt: null,
          corpus: "scripture",
          OR: [{ bibleBook: null }, { bibleBook: "" }],
        };
      }
      return {
        deletedAt: null,
        corpus: "scripture",
        bibleBook: book,
      };
    }
    case "other":
      return { deletedAt: null, corpus: "other" };
    case "message-year": {
      const prefix = vgrPrefixForCalendarYear(path.year);
      return {
        deletedAt: null,
        corpus: "sermon",
        OR: [
          { sermonCatalogId: { startsWith: prefix, mode: "insensitive" } },
          {
            AND: [
              { OR: [{ sermonCatalogId: null }, { sermonCatalogId: "" }] },
              { storageKey: { contains: `/${prefix}`, mode: "insensitive" } },
            ],
          },
        ],
      };
    }
    case "message-transcripts":
      return null;
    default:
      return null;
  }
}

export function catalogPathBreadcrumbTrail(
  path: ParsedCatalogPath,
): { label: string; pathQuery: string }[] {
  const trail: { label: string; pathQuery: string }[] = [];
  switch (path.kind) {
    case "root":
      break;
    case "bible":
      trail.push({ label: "The Bible", pathQuery: "bible" });
      break;
    case "bible-book":
      trail.push({ label: "The Bible", pathQuery: "bible" });
      trail.push({
        label: path.bookLabel,
        pathQuery: formatCatalogPath(path),
      });
      break;
    case "message":
      trail.push({ label: "The Message", pathQuery: "message" });
      break;
    case "message-transcripts":
      trail.push({ label: "The Message", pathQuery: "message" });
      trail.push({
        label: "CAB",
        pathQuery: formatCatalogPath(path),
      });
      break;
    case "message-year":
      trail.push({ label: "The Message", pathQuery: "message" });
      trail.push({
        label: String(path.year),
        pathQuery: formatCatalogPath(path),
      });
      break;
    case "other":
      trail.push({ label: "Other", pathQuery: "other" });
      break;
    default:
      break;
  }
  return trail;
}

export function buildCatalogSearchFilter(
  searchTerm: string,
): Prisma.SourceWhereInput | null {
  const trimmed = searchTerm.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const substring: Prisma.StringFilter = {
    contains: trimmed,
    mode: "insensitive",
  };
  return {
    OR: [
      { bibleBook: substring },
      { sermonCatalogId: substring },
      { storageKey: substring },
    ],
  };
}
