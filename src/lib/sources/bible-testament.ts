/**
 * Maps bible book labels to Old vs New Testament for catalog navigation.
 * When `bibleBook` is unset (common for bulk-ingested files), infers the book from
 * the storage filename stem so folders align with what the catalog title shows.
 */

import type { SourceCorpus } from "@prisma/client";
import { extractFilenameFromStorageKey } from "@/lib/sources/list-catalog";

export type BibleTestamentId = "ot" | "nt";

/** Canonical English names (used as folder keys and for Prisma matching where set). */
const OLD_TESTAMENT_BOOK_DISPLAY: readonly string[] = [
  "Genesis",
  "Exodus",
  "Leviticus",
  "Numbers",
  "Deuteronomy",
  "Joshua",
  "Judges",
  "Ruth",
  "1 Samuel",
  "2 Samuel",
  "1 Kings",
  "2 Kings",
  "1 Chronicles",
  "2 Chronicles",
  "Ezra",
  "Nehemiah",
  "Esther",
  "Job",
  "Psalms",
  "Proverbs",
  "Ecclesiastes",
  "Song of Solomon",
  "Isaiah",
  "Jeremiah",
  "Lamentations",
  "Ezekiel",
  "Daniel",
  "Hosea",
  "Joel",
  "Amos",
  "Obadiah",
  "Jonah",
  "Micah",
  "Nahum",
  "Habakkuk",
  "Zephaniah",
  "Haggai",
  "Zechariah",
  "Malachi",
];

const NEW_TESTAMENT_BOOK_DISPLAY: readonly string[] = [
  "Matthew",
  "Mark",
  "Luke",
  "John",
  "Acts",
  "Romans",
  "1 Corinthians",
  "2 Corinthians",
  "Galatians",
  "Ephesians",
  "Philippians",
  "Colossians",
  "1 Thessalonians",
  "2 Thessalonians",
  "1 Timothy",
  "2 Timothy",
  "Titus",
  "Philemon",
  "Hebrews",
  "James",
  "1 Peter",
  "2 Peter",
  "1 John",
  "2 John",
  "3 John",
  "Jude",
  "Revelation",
];

/** Lowercase token → canonical display (extra aliases beyond full book names). */
const TOKEN_ALIASES: Record<string, string> = {
  gen: "Genesis",
  exo: "Exodus",
  ex: "Exodus",
  lev: "Leviticus",
  num: "Numbers",
  deu: "Deuteronomy",
  deut: "Deuteronomy",
  jos: "Joshua",
  jdg: "Judges",
  psa: "Psalms",
  ps: "Psalms",
  pro: "Proverbs",
  ecc: "Ecclesiastes",
  sng: "Song of Solomon",
  sgs: "Song of Solomon",
  isa: "Isaiah",
  jer: "Jeremiah",
  lam: "Lamentations",
  ezk: "Ezekiel",
  ezr: "Ezra",
  dan: "Daniel",
  mat: "Matthew",
  mrk: "Mark",
  luk: "Luke",
  jhn: "John",
  act: "Acts",
  rom: "Romans",
  gal: "Galatians",
  eph: "Ephesians",
  php: "Philippians",
  col: "Colossians",
  heb: "Hebrews",
  jas: "James",
  rev: "Revelation",
};

const NORMAL_TO_DISPLAY = new Map<string, string>();
const OLD_TESTAMENT_BOOKS = new Set<string>();
const NEW_TESTAMENT_BOOKS = new Set<string>();

function seedMaps(): void {
  if (NORMAL_TO_DISPLAY.size > 0) {
    return;
  }
  for (const name of OLD_TESTAMENT_BOOK_DISPLAY) {
    const key = normalizeBookLabel(name);
    NORMAL_TO_DISPLAY.set(key, name);
    OLD_TESTAMENT_BOOKS.add(key);
  }
  for (const name of NEW_TESTAMENT_BOOK_DISPLAY) {
    const key = normalizeBookLabel(name);
    NORMAL_TO_DISPLAY.set(key, name);
    NEW_TESTAMENT_BOOKS.add(key);
  }
  NORMAL_TO_DISPLAY.set("song of songs", "Song of Solomon");
  NORMAL_TO_DISPLAY.set("psalm", "Psalms");
  OLD_TESTAMENT_BOOKS.add("song of songs");
  OLD_TESTAMENT_BOOKS.add("psalm");

  for (const [token, display] of Object.entries(TOKEN_ALIASES)) {
    NORMAL_TO_DISPLAY.set(token, display);
  }
}

function normalizeBookLabel(label: string): string {
  return label
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeBibleBookLabel(label: string): string {
  return normalizeBookLabel(label);
}

/**
 * Returns whether a book label belongs in the OT or NT folder, or `null` if unknown.
 */
export function testamentForBibleBook(bookLabel: string): BibleTestamentId | null {
  seedMaps();
  const normalized = normalizeBookLabel(bookLabel);
  if (normalized.length === 0 || normalized === "unspecified" || normalized === "_unspecified") {
    return null;
  }
  const canon = NORMAL_TO_DISPLAY.get(normalized) ?? bookLabel.trim();
  const canonKey = normalizeBookLabel(canon);
  if (OLD_TESTAMENT_BOOKS.has(canonKey)) {
    return "ot";
  }
  if (NEW_TESTAMENT_BOOKS.has(canonKey)) {
    return "nt";
  }
  return null;
}

/**
 * Resolves the effective bible book for catalog grouping: DB field when present,
 * otherwise inferred from the storage filename (same idea as catalog titles).
 */
export function effectiveBibleBookForCatalog(row: {
  corpus: SourceCorpus;
  bibleBook: string | null;
  storageKey: string | null;
}): string | null {
  if (row.corpus !== "scripture") {
    return null;
  }
  seedMaps();
  const explicit = row.bibleBook?.trim();
  if (explicit) {
    const key = normalizeBookLabel(explicit);
    if (NORMAL_TO_DISPLAY.has(key)) {
      return NORMAL_TO_DISPLAY.get(key)!;
    }
    return explicit;
  }
  return inferBookFromStorageKey(row.storageKey);
}

function inferBookFromStorageKey(storageKey: string | null): string | null {
  const stem = extractFilenameFromStorageKey(storageKey);
  if (!stem) {
    return null;
  }
  seedMaps();

  let probe = normalizeBookLabel(stem);
  probe = probe.replace(/^\d+[-_\s]*/, "");
  probe = probe.replace(/(\d)([a-z])/g, "$1 $2");

  if (NORMAL_TO_DISPLAY.has(probe)) {
    return NORMAL_TO_DISPLAY.get(probe)!;
  }

  const tokens = probe.split(/[^a-z0-9]+/).filter((token) => token.length > 0);
  for (let width = Math.min(4, tokens.length); width >= 1; width -= 1) {
    for (let start = 0; start + width <= tokens.length; start += 1) {
      const phrase = tokens.slice(start, start + width).join(" ");
      if (NORMAL_TO_DISPLAY.has(phrase)) {
        return NORMAL_TO_DISPLAY.get(phrase)!;
      }
    }
  }

  for (const token of tokens) {
    if (TOKEN_ALIASES[token]) {
      return TOKEN_ALIASES[token];
    }
    if (NORMAL_TO_DISPLAY.has(token)) {
      return NORMAL_TO_DISPLAY.get(token)!;
    }
  }

  return null;
}

export function isUnspecifiedScriptureBook(row: {
  corpus: SourceCorpus;
  bibleBook: string | null;
  storageKey: string | null;
}): boolean {
  return row.corpus === "scripture" && effectiveBibleBookForCatalog(row) === null;
}

export function scriptureRowMatchesBibleBookFolder(
  row: {
    corpus: SourceCorpus;
    bibleBook: string | null;
    storageKey: string | null;
  },
  folder: {
    bookLabel: string;
    testament?: "ot" | "nt";
  },
): boolean {
  if (row.corpus !== "scripture") {
    return false;
  }
  const folderBook = folder.bookLabel.trim();
  const unspecified =
    folderBook === "Unspecified" || folderBook === "_unspecified";

  if (unspecified) {
    return isUnspecifiedScriptureBook(row);
  }

  const effective = effectiveBibleBookForCatalog(row);
  if (!effective) {
    return false;
  }

  if (normalizeBookLabel(effective) !== normalizeBookLabel(folderBook)) {
    return false;
  }

  if (folder.testament) {
    const testament = testamentForBibleBook(effective);
    return testament === folder.testament;
  }

  return true;
}
