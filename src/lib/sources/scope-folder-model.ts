/**
 * Client-side catalog folder grouping for the chat Custom scope picker.
 * Mirrors `loadCatalogFolderIndex` + `listCatalogFolderPage` rules from the
 * Sources page so folder counts and membership match operator expectations.
 */

import type { CatalogFolderIndex } from "@/lib/sources/catalog-browse";
import type { CatalogSourceSummary } from "@/lib/sources/list-catalog";
import {
  catalogFolderLabel,
  formatCatalogPath,
  isBranhamMarkdownFolderMember,
  isVgrSermonRow,
  type ParsedCatalogPath,
  vgrPrefixForCalendarYear,
  vgrYearForSourceRow,
} from "@/lib/sources/catalog-folders";
import {
  effectiveBibleBookForCatalog,
  scriptureRowMatchesBibleBookFolder,
  testamentForBibleBook,
} from "@/lib/sources/bible-testament";

function sourceMatchesMessageYear(
  source: CatalogSourceSummary,
  year: number,
): boolean {
  if (source.corpus !== "sermon") {
    return false;
  }
  const prefix = vgrPrefixForCalendarYear(year);
  const catalogId = source.sermonCatalogId?.trim() ?? "";
  if (
    catalogId.length > 0 &&
    catalogId.toLowerCase().startsWith(prefix.toLowerCase())
  ) {
    return true;
  }
  if (catalogId.length === 0) {
    const storageKey = source.storageKey ?? "";
    if (storageKey.toLowerCase().includes(`/${prefix.toLowerCase()}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a catalog row belongs in the given folder path (same semantics as
 * the Sources browse tree). Does not filter by status — callers pass READY rows only.
 */
export function sourceMatchesCatalogPath(
  source: CatalogSourceSummary,
  path: ParsedCatalogPath,
): boolean {
  switch (path.kind) {
    case "root":
      return false;
    case "bible":
      return source.corpus === "scripture";
    case "bible-ot": {
      if (source.corpus !== "scripture") {
        return false;
      }
      const effective = effectiveBibleBookForCatalog(source);
      return effective ? testamentForBibleBook(effective) === "ot" : false;
    }
    case "bible-nt": {
      if (source.corpus !== "scripture") {
        return false;
      }
      const effective = effectiveBibleBookForCatalog(source);
      return effective ? testamentForBibleBook(effective) === "nt" : false;
    }
    case "bible-book":
      return scriptureRowMatchesBibleBookFolder(source, {
        bookLabel: path.bookLabel,
        ...(path.testament ? { testament: path.testament } : {}),
      });
    case "message":
      return source.corpus === "sermon";
    case "message-year":
      return sourceMatchesMessageYear(source, path.year);
    case "message-transcripts":
      return isBranhamMarkdownFolderMember({
        corpus: source.corpus,
        bibleBook: source.bibleBook,
        sermonCatalogId: source.sermonCatalogId,
        storageKey: source.storageKey,
      });
    case "other":
      return source.corpus === "other";
    default:
      return false;
  }
}

export function listReadySourcesInFolder(
  readySources: readonly CatalogSourceSummary[],
  path: ParsedCatalogPath,
): CatalogSourceSummary[] {
  return readySources.filter((source) => sourceMatchesCatalogPath(source, path));
}

export function listReadySourceIdsInFolder(
  readySources: readonly CatalogSourceSummary[],
  path: ParsedCatalogPath,
): string[] {
  return listReadySourcesInFolder(readySources, path).map((source) => source.id);
}

export type ScopeFolderNavItem = {
  path: ParsedCatalogPath;
  label: string;
  count: number;
};

export function listChildFolderNavItems(
  path: ParsedCatalogPath,
  index: CatalogFolderIndex,
): ScopeFolderNavItem[] {
  const items: ScopeFolderNavItem[] = [];
  switch (path.kind) {
    case "root":
      if (index.bibleCount > 0) {
        items.push({
          path: { kind: "bible" },
          label: catalogFolderLabel({ kind: "bible" }),
          count: index.bibleCount,
        });
      }
      if (index.messageCount > 0) {
        items.push({
          path: { kind: "message" },
          label: catalogFolderLabel({ kind: "message" }),
          count: index.messageCount,
        });
      }
      if (index.otherCount > 0) {
        items.push({
          path: { kind: "other" },
          label: catalogFolderLabel({ kind: "other" }),
          count: index.otherCount,
        });
      }
      break;
    case "bible":
      if (index.bibleOldTestamentCount > 0) {
        items.push({
          path: { kind: "bible-ot" },
          label: catalogFolderLabel({ kind: "bible-ot" }),
          count: index.bibleOldTestamentCount,
        });
      }
      if (index.bibleNewTestamentCount > 0) {
        items.push({
          path: { kind: "bible-nt" },
          label: catalogFolderLabel({ kind: "bible-nt" }),
          count: index.bibleNewTestamentCount,
        });
      }
      if (index.bibleUnspecifiedCount > 0) {
        items.push({
          path: { kind: "bible-book", bookLabel: "Unspecified" },
          label: "Unspecified",
          count: index.bibleUnspecifiedCount,
        });
      }
      for (const entry of index.bibleBooksUnknown) {
        items.push({
          path: { kind: "bible-book", bookLabel: entry.label },
          label: entry.label,
          count: entry.count,
        });
      }
      break;
    case "bible-ot":
      for (const entry of index.bibleBooksOld) {
        items.push({
          path: { kind: "bible-book", testament: "ot", bookLabel: entry.label },
          label: entry.label,
          count: entry.count,
        });
      }
      break;
    case "bible-nt":
      for (const entry of index.bibleBooksNew) {
        items.push({
          path: { kind: "bible-book", testament: "nt", bookLabel: entry.label },
          label: entry.label,
          count: entry.count,
        });
      }
      break;
    case "message":
      if (index.transcriptCount > 0) {
        items.push({
          path: { kind: "message-transcripts" },
          label: catalogFolderLabel({ kind: "message-transcripts" }),
          count: index.transcriptCount,
        });
      }
      for (const entry of index.sermonYears) {
        items.push({
          path: { kind: "message-year", year: entry.year },
          label: String(entry.year),
          count: entry.count,
        });
      }
      break;
    default:
      break;
  }
  return items;
}

/**
 * Folder counts for READY sources only (pickable in Custom scope).
 */
export function computeScopeFolderIndexFromReadySources(
  readySources: readonly CatalogSourceSummary[],
): CatalogFolderIndex {
  let bibleCount = 0;
  let bibleOldTestamentCount = 0;
  let bibleNewTestamentCount = 0;
  let bibleUnspecifiedCount = 0;
  let bibleUnknownBookCount = 0;
  let transcriptCount = 0;
  let datedSermonCount = 0;
  let messageCount = 0;
  let otherCount = 0;
  const bibleBooksOldMap = new Map<string, number>();
  const bibleBooksNewMap = new Map<string, number>();
  const bibleBooksUnknownMap = new Map<string, number>();
  const sermonYearCounts = new Map<number, number>();

  for (const row of readySources) {
    if (row.corpus === "scripture") {
      bibleCount += 1;
      const effective = effectiveBibleBookForCatalog(row);
      if (!effective) {
        bibleUnspecifiedCount += 1;
        continue;
      }
      const testament = testamentForBibleBook(effective);
      if (testament === "ot") {
        bibleOldTestamentCount += 1;
        bibleBooksOldMap.set(effective, (bibleBooksOldMap.get(effective) ?? 0) + 1);
      } else if (testament === "nt") {
        bibleNewTestamentCount += 1;
        bibleBooksNewMap.set(effective, (bibleBooksNewMap.get(effective) ?? 0) + 1);
      } else {
        bibleUnknownBookCount += 1;
        bibleBooksUnknownMap.set(
          effective,
          (bibleBooksUnknownMap.get(effective) ?? 0) + 1,
        );
      }
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

  function compareStrings(left: string, right: string): number {
    return left.localeCompare(right, undefined, { sensitivity: "base" });
  }

  function mapToSortedList(map: Map<string, number>): { label: string; count: number }[] {
    return [...map.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) =>
        compareStrings(
          left.label === "Unspecified" ? "" : left.label,
          right.label === "Unspecified" ? "" : right.label,
        ),
      );
  }

  const bibleBooksOld = mapToSortedList(bibleBooksOldMap);
  const bibleBooksNew = mapToSortedList(bibleBooksNewMap);
  const bibleBooksUnknown = mapToSortedList(bibleBooksUnknownMap);

  const sermonYears = [...sermonYearCounts.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((left, right) => right.year - left.year);

  return {
    totalSources: readySources.length,
    bibleCount,
    bibleOldTestamentCount,
    bibleNewTestamentCount,
    bibleUnspecifiedCount,
    bibleUnknownBookCount,
    messageCount,
    transcriptCount,
    datedSermonCount,
    otherCount,
    bibleBooksOld,
    bibleBooksNew,
    bibleBooksUnknown,
    sermonYears,
  };
}

export function parentCatalogPath(path: ParsedCatalogPath): ParsedCatalogPath {
  switch (path.kind) {
    case "root":
      return { kind: "root" };
    case "bible":
    case "message":
    case "other":
      return { kind: "root" };
    case "bible-ot":
    case "bible-nt":
      return { kind: "bible" };
    case "bible-book": {
      const label = path.bookLabel.trim();
      if (label === "Unspecified" || label === "_unspecified") {
        return { kind: "bible" };
      }
      if (path.testament === "ot") {
        return { kind: "bible-ot" };
      }
      if (path.testament === "nt") {
        return { kind: "bible-nt" };
      }
      return { kind: "bible" };
    }
    case "message-transcripts":
    case "message-year":
      return { kind: "message" };
    default:
      return { kind: "root" };
  }
}

/** Stable key for React state — matches `formatCatalogPath` output. */
export function catalogPathKey(path: ParsedCatalogPath): string {
  return formatCatalogPath(path) || "root";
}

/** Human-readable title for leaf folder source lists (aligned with Sources page). */
export function scopeLeafHeading(path: ParsedCatalogPath): string {
  switch (path.kind) {
    case "bible-book":
      if (path.testament === "ot") {
        return `The Bible — Old Testament — ${path.bookLabel}`;
      }
      if (path.testament === "nt") {
        return `The Bible — New Testament — ${path.bookLabel}`;
      }
      return `The Bible — ${path.bookLabel}`;
    case "message-transcripts":
      return "The Message — CAB";
    case "message-year":
      return `The Message — ${path.year}`;
    case "other":
      return "Other sources";
    default:
      return "Sources";
  }
}
