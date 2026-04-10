import type { SourceCorpus } from "@prisma/client";

export type ChunkTextOptions = {
  /** Maximum characters per chunk (after normalization). */
  maxChars?: number;
  /** Overlap between consecutive fixed windows (characters). */
  overlap?: number;
  /**
   * When true, try verse-shaped splitting (numbered lines) before falling back to windows.
   * Default false: paragraph packing then fixed windows.
   */
  splitVerses?: boolean;
};

export type TextChunk = {
  content: string;
  chunk_index: number;
};

const DEFAULT_MAX = 1800;
const DEFAULT_OVERLAP = 200;

/**
 * Heuristic: lines that look like "12 Something" or "12. Something" (scripture-style).
 */
function looksLikeVerseLine(line: string): boolean {
  return /^\s*\d{1,3}\s+[^\n]+/.test(line) || /^\s*\d{1,3}\.\s+[^\n]+/.test(line);
}

function chunkByVerses(normalized: string, maxChars: number): string[] | null {
  const lines = normalized.split("\n");
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) {
    return null;
  }
  const verseLikeRatio =
    lines.filter((line) => looksLikeVerseLine(line)).length / nonEmpty.length;
  if (verseLikeRatio < 0.4) {
    return null;
  }

  const blocks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxChars && current) {
      blocks.push(current.trim());
      current = line;
    } else {
      current = next;
    }
  }
  if (current.trim()) {
    blocks.push(current.trim());
  }
  return blocks.length > 0 ? blocks : null;
}

function chunkFixedWindows(
  text: string,
  maxChars: number,
  overlap: number,
): string[] {
  if (text.length === 0) {
    return [];
  }
  const step = Math.max(1, maxChars - overlap);
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    const slice = text.slice(start, end).trim();
    if (slice.length > 0) {
      parts.push(slice);
    }
    if (end >= text.length) {
      break;
    }
    start += step;
  }
  return parts;
}

/**
 * Greedy pack paragraphs (split on blank lines) into chunks up to maxChars; oversized
 * paragraphs are split with fixed windows.
 */
function chunkByParagraphs(
  normalized: string,
  maxChars: number,
  overlap: number,
): string[] {
  const paragraphs = normalized.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) {
    return [];
  }

  const out: string[] = [];
  let buffer = "";

  const flushBuffer = () => {
    if (buffer.trim()) {
      out.push(buffer.trim());
    }
    buffer = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flushBuffer();
      out.push(...chunkFixedWindows(paragraph, maxChars, overlap));
      continue;
    }
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      buffer = candidate;
    } else {
      flushBuffer();
      buffer = paragraph;
    }
  }
  flushBuffer();
  return out;
}

/**
 * Splits normalized text into ordered chunks with stable `chunk_index` (0-based).
 */
export function chunkText(
  normalized: string,
  options: ChunkTextOptions = {},
): TextChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX;
  const overlap = Math.min(options.overlap ?? DEFAULT_OVERLAP, maxChars - 1);

  if (!normalized.trim()) {
    return [];
  }

  let pieces: string[] = [];

  if (options.splitVerses) {
    const versePieces = chunkByVerses(normalized, maxChars);
    if (versePieces) {
      pieces = versePieces;
    }
  }

  if (pieces.length === 0) {
    pieces = chunkByParagraphs(normalized, maxChars, overlap);
  }

  if (pieces.length === 0) {
    pieces = chunkFixedWindows(normalized, maxChars, overlap);
  }

  return pieces.map((content, chunk_index) => ({ content, chunk_index }));
}

/** Typed chunk metadata stored in `Chunk.metadata` (JSON). */
export type ChunkMetadataPayload = {
  source_id: string;
  chunk_index: number;
  corpus: SourceCorpus;
  page?: number;
  bible_book?: string | null;
  sermon_id_from_filename?: string | null;
};
