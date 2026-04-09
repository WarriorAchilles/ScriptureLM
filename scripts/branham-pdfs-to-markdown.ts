/**
 * Convert Branham sermon PDFs under data/branham-pdfs/ to Markdown under data/branham-md/,
 * mirroring subfolders. Skips the last N pages (default 2) for copyright / metadata.
 * Drops running headers (page numbers, “THE SPOKEN WORD”, sermon title banner) using geometry
 * (top/bottom bands) plus fuzzy title matching for PDF glyph splits. Transcript paragraph numbers
 * stay on the same line as the text until the next number; paragraph breaks are blank lines before
 * each “N …” block.
 *
 * Usage:
 *   npx tsx scripts/branham-pdfs-to-markdown.ts
 *   npx tsx scripts/branham-pdfs-to-markdown.ts --in ./data/branham-pdfs --out ./data/branham-md
 *   npx tsx scripts/branham-pdfs-to-markdown.ts --dry-run
 *   npm run branham-pdfs-to-md -- --dry-run
 */

import { createRequire } from "node:module";
import { access, constants as fsConstants, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

// --- CLI (match scripts/download-vgr-sermon-pdfs.ts style) ---

function getArg(name: string): string | undefined {
  const prefix = `${name}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === name) {
      return process.argv[index + 1];
    }
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got: ${value}`);
  }
  return parsed;
}

// --- PDF text: lines and paragraphs ---

const LINE_Y_TOLERANCE = 4;

type TextPiece = {
  str: string;
  x: number;
  y: number;
  width: number;
};

function isTextItem(item: unknown): item is { str: string; transform: number[]; width?: number } {
  if (typeof item !== "object" || item === null) {
    return false;
  }
  const record = item as Record<string, unknown>;
  return (
    typeof record.str === "string" &&
    Array.isArray(record.transform) &&
    record.transform.length >= 6
  );
}

function textPiecesFromPageContent(items: readonly unknown[]): TextPiece[] {
  const pieces: TextPiece[] = [];
  for (const item of items) {
    if (!isTextItem(item)) {
      continue;
    }
    const transform = item.transform;
    const x = transform[4];
    const y = transform[5];
    const width =
      typeof item.width === "number" && Number.isFinite(item.width)
        ? item.width
        : Math.max(item.str.length * 3, 1);
    pieces.push({ str: item.str, x, y, width });
  }
  return pieces;
}

/**
 * Sort reading order: top-to-bottom (descending PDF y), then left-to-right.
 */
function sortPiecesReadingOrder(pieces: TextPiece[]): TextPiece[] {
  return [...pieces].sort((pieceA, pieceB) => {
    if (Math.abs(pieceA.y - pieceB.y) > LINE_Y_TOLERANCE) {
      return pieceB.y - pieceA.y;
    }
    return pieceA.x - pieceB.x;
  });
}

/**
 * Cluster sorted pieces into horizontal lines by baseline y.
 */
function piecesToLines(pieces: TextPiece[]): TextPiece[][] {
  const sorted = sortPiecesReadingOrder(pieces);
  const lines: TextPiece[][] = [];
  let current: TextPiece[] = [];
  let currentY: number | undefined;

  for (const piece of sorted) {
    if (currentY === undefined || Math.abs(piece.y - currentY) <= LINE_Y_TOLERANCE) {
      current.push(piece);
      if (currentY === undefined) {
        currentY = piece.y;
      }
    } else {
      lines.push(current);
      current = [piece];
      currentY = piece.y;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

/**
 * Join pieces on one line; insert a space when the horizontal gap suggests a word boundary.
 */
function linePiecesToString(linePieces: TextPiece[]): string {
  const sortedLine = [...linePieces].sort((pieceA, pieceB) => pieceA.x - pieceB.x);
  let result = "";
  for (let index = 0; index < sortedLine.length; index += 1) {
    const piece = sortedLine[index];
    if (index > 0) {
      const previous = sortedLine[index - 1];
      const previousEnd = previous.x + previous.width;
      const gap = piece.x - previousEnd;
      if (gap > Math.max(1.5, previous.width * 0.08)) {
        result += " ";
      }
    }
    result += piece.str;
  }
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Lines with y positions: merge into paragraphs using vertical gaps.
 */
type LineWithY = { y: number; text: string };

function linesWithYToParagraphs(lines: LineWithY[]): string[] {
  const nonEmpty = lines
    .map((line) => ({ y: line.y, text: line.text.trim() }))
    .filter((line) => line.text.length > 0);
  if (nonEmpty.length === 0) {
    return [];
  }

  const gaps: number[] = [];
  for (let index = 0; index < nonEmpty.length - 1; index += 1) {
    gaps.push(nonEmpty[index].y - nonEmpty[index + 1].y);
  }
  const avgGap =
    gaps.length > 0 ? gaps.reduce((accumulator, value) => accumulator + value, 0) / gaps.length : 8;
  const paragraphGapThreshold = Math.max(avgGap * 1.45, 10);

  const paragraphs: string[] = [];
  let buffer = nonEmpty[0].text;

  for (let index = 0; index < nonEmpty.length - 1; index += 1) {
    const verticalGap = nonEmpty[index].y - nonEmpty[index + 1].y;
    const nextLine = nonEmpty[index + 1].text;

    if (verticalGap > paragraphGapThreshold) {
      paragraphs.push(buffer);
      buffer = nextLine;
      continue;
    }

    if (/[-\u2010-\u2014]\s*$/.test(buffer)) {
      buffer = buffer.replace(/[-\u2010-\u2014]\s*$/, "") + nextLine;
    } else {
      buffer = `${buffer} ${nextLine}`;
    }
  }
  paragraphs.push(buffer);

  return paragraphs.map((paragraph) => paragraph.replace(/\s+/g, " ").trim());
}

function pagePiecesToParagraphs(pieces: TextPiece[], heading: string): string[] {
  const lineGroups = piecesToLines(pieces);
  const linesWithY: LineWithY[] = lineGroups.map((group) => ({
    y: group.length > 0 ? group[0].y : 0,
    text: linePiecesToString(group),
  }));
  const withoutHeaders = filterHeaderLines(linesWithY, heading);
  if (withoutHeaders.length === 0) {
    return [];
  }
  return linesWithYToParagraphs(withoutHeaders);
}

function fileStemToHeading(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, "");
  const slug = base.replace(/^\d{2}-\d{4}[A-Za-z]?-/, "");
  return slug
    .split(/[-_]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Letters only, uppercased — matches PDF title even when spaces break mid-word (“FA ITH …”). */
function compactTitleLetters(text: string): string {
  return text.toUpperCase().replace(/[^A-Z]/g, "");
}

/** Uppercase words from the sermon title (for matching running headers in PDFs). */
function headingToTitleBannerRegex(heading: string): RegExp {
  const words = heading
    .toUpperCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  const body = words.map((word) => escapeRegex(word)).join("\\s+");
  // Optional page number after the title; allow extra spaces from PDF extraction.
  return new RegExp(`^${body}(?:\\s+\\d{1,4})?\\s*$`, "i");
}

/**
 * True if this line is the sermon title banner with optional page number, including glyph-split
 * spacing (e.g. “FA ITH IS THE SUBSTA NCE 3”).
 */
function shouldDropFuzzyTitleLine(trimmed: string, heading: string): boolean {
  const expected = compactTitleLetters(heading);
  if (expected.length < 6) {
    return false;
  }
  let letters = compactTitleLetters(trimmed);
  letters = letters.replace(/\d+$/g, "");
  return letters === expected;
}

function isSpokenWordLine(normalized: string): boolean {
  return /^(\d{1,4}\s+)?the\s+spoken\s+word(\s+\d{1,4})?$|^the\s+spoken\s+word(\s+\d{1,4})?$/i.test(
    normalized,
  );
}

/**
 * True if this line is only a page number, running header, or title banner (drop entirely).
 */
function shouldDropHeaderFooterLine(trimmed: string, titleLineRegex: RegExp): boolean {
  if (trimmed.length === 0) {
    return true;
  }
  const normalized = trimmed.replace(/\s+/g, " ");
  // Standalone page or paragraph index lines used as folios (1–4 digits only).
  if (/^\d{1,4}$/.test(normalized)) {
    return true;
  }
  if (isSpokenWordLine(normalized)) {
    return true;
  }
  if (titleLineRegex.test(normalized)) {
    return true;
  }
  return false;
}

/**
 * Drop lines in the top/bottom margin bands that look like headers (page #, title, Spoken Word).
 * VGR PDFs place title left, page # right, or page # left + “THE SPOKEN WORD” right on one band.
 */
function filterHeaderLines(lines: LineWithY[], heading: string): LineWithY[] {
  const titleLineRegex = headingToTitleBannerRegex(heading);
  if (lines.length === 0) {
    return lines;
  }

  const yValues = lines.map((line) => line.y);
  const yMax = Math.max(...yValues);
  const yMin = Math.min(...yValues);
  const yRange = yMax - yMin;
  // ~top 11% and ~bottom 11% of the page, clamped (PDF units vary by layout).
  const band = yRange > 4 ? Math.min(Math.max(yRange * 0.11, 26), 78) : 0;
  const headerCutoff = yMax - band;
  const footerCutoff = yMin + band;

  return lines.filter((line) => {
    const trimmed = line.text.trim();
    if (shouldDropFuzzyTitleLine(trimmed, heading)) {
      return false;
    }
    if (shouldDropHeaderFooterLine(trimmed, titleLineRegex)) {
      return false;
    }

    const normalized = trimmed.replace(/\s+/g, " ");
    const inHeaderBand = band > 0 && line.y >= headerCutoff;
    const inFooterBand = band > 0 && line.y <= footerCutoff;

    if (inHeaderBand || inFooterBand) {
      if (/^\d{1,4}$/.test(normalized)) {
        return false;
      }
      if (isSpokenWordLine(normalized)) {
        return false;
      }
      if (shouldDropFuzzyTitleLine(trimmed, heading)) {
        return false;
      }
      // Short all-caps banner lines (title fragments) in margins.
      if (/^[A-Z0-9][A-Z0-9\s]{2,85}$/.test(normalized) && normalized.length < 92) {
        const letters = compactTitleLetters(normalized).replace(/\d+$/g, "");
        const expected = compactTitleLetters(heading);
        if (letters.length >= 6 && letters === expected) {
          return false;
        }
        if (/THE\s+SPOKEN\s+WORD/i.test(normalized)) {
          return false;
        }
      }
    }

    return true;
  });
}

/** Avoid splitting "2 Timothy"–style references into fake paragraph breaks. */
function isBibleLeadingNumeral(numericText: string, followingWord: string): boolean {
  const value = Number.parseInt(numericText, 10);
  const word = followingWord.toLowerCase().replace(/[^a-z]/g, "");
  if (value === 1) {
    return ["samuel", "kings", "chronicles", "corinthians", "thessalonians", "john", "peter"].includes(word);
  }
  if (value === 2) {
    return ["timothy", "thessalonians", "corinthians", "kings", "samuel", "peter", "john"].includes(word);
  }
  if (value === 3) {
    return word === "john";
  }
  return false;
}

/**
 * Remove embedded running titles, “The Spoken Word”, and title banners; normalize paragraph
 * indices so each is “N firstWord…” on one line with a blank line only between paragraphs.
 */
function postProcessSermonBody(body: string, heading: string): string {
  let text = body;

  const words = heading
    .toUpperCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const titlePattern = words.map((word) => escapeRegex(word)).join("\\s+");

  // "12 THE SPOKEN WORD 34 ..." or "THE SPOKEN WORD 5" mid-paragraph (PDFs use all caps).
  text = text.replace(
    new RegExp(`\\b\\d{1,4}\\s+THE\\s+SPOKEN\\s+WORD(?:\\s+\\d{1,4})?\\s*`, "g"),
    " ",
  );
  text = text.replace(new RegExp(`\\bTHE\\s+SPOKEN\\s+WORD(?:\\s+\\d{1,4})?\\s*`, "g"), " ");

  // Running sermon title + page number (match case-insensitive letters for odd PDF encodings).
  text = text.replace(new RegExp(`\\b${titlePattern}\\s+\\d{1,4}\\s*`, "gi"), " ");

  // Collapse spaces/tabs inside each line; keep newlines so page blocks stay separated.
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");

  // Drop any line that is only a fuzzy title banner (including mid-document leaks).
  text = text
    .split("\n")
    .filter((line) => line.length === 0 || !shouldDropFuzzyTitleLine(line.trim(), heading))
    .join("\n");

  const splitParagraph = (
    full: string,
    punct: string,
    numericText: string,
    word: string,
  ): string => {
    if (!/^[A-Z]/.test(word)) {
      return full;
    }
    if (isBibleLeadingNumeral(numericText, word)) {
      return full;
    }
    return `${punct}\n\n${numericText} ${word}`;
  };

  // Sentence end, then paragraph index + capitalized word → blank line, then “N word…”.
  text = text.replace(
    /([.!?…][""''‚\u201c\u201d]?)\s+(\d{1,3})\s+([A-Za-z0-9'’\-]+)/g,
    (full, punct, numericText, word) => splitParagraph(full, punct, numericText, word),
  );

  // After closing bracket or em dash before index.
  text = text.replace(
    /([\]\u2014])\s+(\d{1,3})\s+([A-Za-z0-9'’\-]+)/g,
    (full, punct, numericText, word) => splitParagraph(full, punct, numericText, word),
  );

  // Paragraph numbers at document start or after a blank line (page joins).
  text = text.replace(/(^|\n\n)(\d{1,3})\s+([A-Za-z0-9'’\-]+)/g, (full, lead, numericText, word) => {
    if (!/^[A-Z]/.test(word)) {
      return full;
    }
    if (isBibleLeadingNumeral(numericText, word)) {
      return full;
    }
    return `${lead}${numericText} ${word}`;
  });

  // Orphan index lines: “\n\n3\n\nI trust” → “\n\n3 I trust”
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text.replace(/\n\n(\d{1,3})\n\n+([A-Z])/g, "\n\n$1 $2");
    text = text.replace(/\n(\d{1,3})\n\n+([A-Z])/g, "\n$1 $2");
  }

  text = text.replace(/\n{3,}/g, "\n\n");

  // Drop standalone broken title lines left after PDF word-splitting (e.g. “THE A NGEL OF GOD”).
  text = text.replace(/^\s*THE\s+A\s+NGEL\s+OF\s+GOD\s*$/gim, "");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

async function pdfToMarkdownBody(
  pdfBytes: Uint8Array,
  skipTailPages: number,
  sermonHeading: string,
): Promise<{ body: string; numPages: number; contentPages: number }> {
  const loadingTask = getDocument({ data: pdfBytes });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const lastIncluded = Math.max(0, numPages - skipTailPages);

  if (lastIncluded < 1) {
    await pdf.cleanup();
    return { body: "", numPages, contentPages: 0 };
  }

  const pageParagraphs: string[][] = [];

  for (let pageNumber = 1; pageNumber <= lastIncluded; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pieces = textPiecesFromPageContent(textContent.items);
    pageParagraphs.push(pagePiecesToParagraphs(pieces, sermonHeading));
    await page.cleanup();
  }

  await pdf.cleanup();

  const blocks: string[] = [];
  for (const paragraphs of pageParagraphs) {
    if (paragraphs.length > 0) {
      blocks.push(paragraphs.join("\n\n"));
    }
  }

  const rawBody = blocks.join("\n\n");
  const body = postProcessSermonBody(rawBody, sermonHeading);

  return {
    body,
    numPages,
    contentPages: lastIncluded,
  };
}

async function* walkPdfFiles(directory: string): AsyncGenerator<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkPdfFiles(fullPath);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      yield fullPath;
    }
  }
}

async function main(): Promise<void> {
  const inputRoot = resolve(process.cwd(), getArg("--in") ?? "./data/branham-pdfs");
  const outputRoot = resolve(process.cwd(), getArg("--out") ?? "./data/branham-md");
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const skipTailPages = parsePositiveInt(getArg("--skip-pages"), 2);

  let converted = 0;
  let skipped = 0;
  let warnedShort = 0;

  for await (const pdfPath of walkPdfFiles(inputRoot)) {
    const relativePdf = relative(inputRoot, pdfPath);
    const mdRelative = relativePdf.replace(/\.pdf$/i, ".md");
    const mdPath = join(outputRoot, mdRelative);

    if (dryRun) {
      console.log(`[dry-run] ${pdfPath} -> ${mdPath}`);
      continue;
    }

    const pdfBytes = await readFile(pdfPath);
    const sermonHeading = fileStemToHeading(relativePdf.split(/[/\\]/).pop() ?? "sermon");
    const { body, numPages, contentPages } = await pdfToMarkdownBody(
      new Uint8Array(pdfBytes),
      skipTailPages,
      sermonHeading,
    );

    if (contentPages < 1) {
      console.warn(
        `[skip] ${relativePdf}: only ${numPages} page(s); nothing left after skipping last ${skipTailPages} page(s).`,
      );
      warnedShort += 1;
      continue;
    }

    try {
      await mkdir(dirname(mdPath), { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create ${dirname(mdPath)}: ${error}`);
    }

    const markdown = `# ${sermonHeading}\n\n${body}\n`;

    try {
      await access(mdPath, fsConstants.F_OK);
      if (!force) {
        console.warn(`[skip] ${mdPath} exists (use --force to overwrite)`);
        skipped += 1;
        continue;
      }
    } catch {
      // file does not exist
    }

    await writeFile(mdPath, markdown, "utf8");
    console.log(`Wrote ${mdPath} (${contentPages} content page(s) of ${numPages})`);
    converted += 1;
  }

  if (dryRun) {
    console.log("Dry run complete (no files written).");
    return;
  }

  console.log(
    `Done. Converted: ${converted}, skipped (exists): ${skipped}, skipped (too few pages): ${warnedShort}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
