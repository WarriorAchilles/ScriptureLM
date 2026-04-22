/**
 * RAG prompt assembly for the Claude chat path (Step 13).
 *
 * Master spec refs: §5.3 (RAG / refusal), §6.4 query path, §15 #6 (inline
 * citations). This module is **pure** — no DB, no network — so it is trivially
 * unit-testable and the prompt shape stays auditable in one place.
 *
 * Citation strategy:
 *  - Each retrieved chunk is rendered with a stable label `[C1]`, `[C2]`, …
 *    that the model is instructed to reuse inline so end users can match a
 *    claim to the supporting passage. Step 14 will expose source-scope UI; the
 *    label format here is forward-compatible with that work.
 *  - Display metadata (book/chapter/verse for scripture, sermon id/filename
 *    for sermons) is included on the same line as the label so the model can
 *    surface those identifiers verbatim in citations.
 */

import type { RetrievedChunk } from "@/lib/retrieval";

/** Exact substring asserted in tests so refusals never look like real answers. */
export const REFUSAL_SUBSTRING = "No relevant passages were found";

/**
 * Frozen refusal text used when retrieval returns no chunks. Kept short and
 * recognizably unlike a normal grounded reply (master spec §5.3).
 */
export const REFUSAL_TEXT =
  `${REFUSAL_SUBSTRING} in the source catalog for this question, ` +
  "so I can't answer it from the available material. Try rewording, " +
  "broadening the source scope, or asking about a different topic.";

/**
 * Conservative chars-per-token approximation used to budget conversation
 * history without paying for an Anthropic `countTokens` round-trip. Anthropic's
 * own rule of thumb for English text is ~3.5–4 chars/token; we round down to
 * stay safely under the budget.
 */
const APPROX_CHARS_PER_TOKEN = 3.5;

/**
 * Default token budget for prior conversation turns. Leaves ample headroom for
 * the system prompt (which can be large with retrieval context) and the
 * model's `max_tokens` reply. Tunable once we measure real workloads (§9).
 */
export const DEFAULT_HISTORY_TOKEN_BUDGET = 4_000;

/** Single conversation turn from the persisted `Message` history. */
export type ChatTurn = Readonly<{
  role: "user" | "assistant";
  content: string;
}>;

/**
 * Render a single context block. Public for tests; not re-exported in the
 * barrel because external callers should always go through `buildSystemPrompt`.
 */
export function renderContextBlock(label: string, chunk: RetrievedChunk): string {
  const metadata = describeChunkMetadata(chunk);
  // Single trailing newline before content keeps the heading visually grouped
  // with its body in Claude's view (the model is sensitive to whitespace cues).
  return `[${label}] ${chunk.title}${metadata ? ` — ${metadata}` : ""}\n${chunk.content.trim()}`;
}

/** One-line title for citation previews (matches the context block heading without `[label]`). */
export function citationHeadingFromRetrievedChunk(chunk: RetrievedChunk): string {
  const metadata = describeChunkMetadata(chunk);
  return metadata ? `${chunk.title} — ${metadata}` : chunk.title;
}

function describeChunkMetadata(chunk: RetrievedChunk): string {
  const parts: string[] = [];
  if (chunk.bibleBook) {
    const reference = formatScriptureReference(chunk);
    if (reference) {
      parts.push(reference);
    }
  }
  if (chunk.sermonCatalogId) {
    parts.push(`sermon ${chunk.sermonCatalogId}`);
  }
  if (chunk.filename && !chunk.bibleBook && !chunk.sermonCatalogId) {
    parts.push(chunk.filename);
  }
  return parts.join(" · ");
}

/**
 * Pull `chapter` / `verse` from the chunk metadata when present. The chunk
 * `metadata` field is `Record<string, unknown>` because callers (ingest) can
 * stamp arbitrary keys; we narrow defensively here so a malformed chunk never
 * crashes the prompt builder.
 */
function formatScriptureReference(chunk: RetrievedChunk): string | null {
  if (!chunk.bibleBook) {
    return null;
  }
  const chapter = readNumberOrString(chunk.metadata, "chapter");
  const verse = readNumberOrString(chunk.metadata, "verse");
  const verseEnd = readNumberOrString(chunk.metadata, "verseEnd");
  const translation = chunk.bibleTranslation?.trim();

  let reference = chunk.bibleBook;
  if (chapter) {
    reference += ` ${chapter}`;
    if (verse) {
      reference += `:${verse}`;
      if (verseEnd && verseEnd !== verse) {
        reference += `-${verseEnd}`;
      }
    }
  }
  return translation ? `${reference} (${translation})` : reference;
}

function readNumberOrString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return null;
}

export type LabeledChunk = Readonly<{
  /** Stable `C1`, `C2`, … label inserted into both the prompt and `retrieval_debug`. */
  label: string;
  chunk: RetrievedChunk;
}>;

/**
 * Assigns deterministic `C1`, `C2`, … labels to retrieved chunks. The order is
 * the retrieval order (best-first), which matches what the user's UI will eventually
 * display so labels stay meaningful end-to-end.
 */
export function labelChunks(chunks: readonly RetrievedChunk[]): LabeledChunk[] {
  return chunks.map((chunk, index) => ({
    label: `C${index + 1}`,
    chunk,
  }));
}

/**
 * Builds the system prompt. When `labeledChunks` is empty we instruct the
 * model to emit the fixed refusal text verbatim — but the route also short-
 * circuits without calling Claude in that case (see `run-rag-turn.ts`), so this
 * branch exists mostly for defense-in-depth and easier prompt diffing.
 */
export function buildSystemPrompt(labeledChunks: readonly LabeledChunk[]): string {
  const basePrompt = "You are ScriptureLM, a research assistant for a curated catalog of Scripture (KJV) " +
  "and sermon transcripts of William Marrion Branham (referred to as Brother Branham or Bro Branham). " +
  "The sermon transcripts are commonly referred to as 'The Message' or 'The Spoken Word'." +
  "You are not a preacher or minister, you are a research assistant.";
  if (labeledChunks.length === 0) {
    return [
      basePrompt,
      "",
      "No source passages were retrieved for this question.",
      `Reply with exactly this sentence and nothing else: "${REFUSAL_TEXT}"`,
    ].join("\n");
  }

  const contextBody = labeledChunks
    .map(({ label, chunk }) => renderContextBlock(label, chunk))
    .join("\n\n---\n\n");

  return [
    basePrompt,
    "",
    "Answer the user's question using ONLY the numbered context passages",
    "below. Do not draw on outside knowledge, training data, memory of",
    "Scripture, or general theological commentary. If the passages do not",
    `contain enough information to answer, reply with: "${REFUSAL_TEXT}"`,
    "",
    "Cite every claim inline using the bracketed labels exactly as shown",
    "(for example `[C1]`, `[C2]`). When a passage has a scripture or",
    "sermon reference in its heading, mention that reference in prose so",
    "the user can locate it (e.g. \"Genesis 1:1 [C1]\").",
    "",
    "Context passages:",
    "",
    contextBody,
  ].join("\n");
}

/**
 * Truncates `history` (oldest first) so the *combined* character count of the
 * remaining turns fits the token budget. We always keep the most recent turns
 * because they carry the active question's context.
 *
 * Returns the truncated history in chronological order plus a flag indicating
 * whether anything was dropped (useful for logging/debug, master spec §9 prep).
 */
export function truncateHistoryByTokenBudget(
  history: readonly ChatTurn[],
  options?: { tokenBudget?: number },
): { history: ChatTurn[]; truncated: boolean } {
  const tokenBudget = options?.tokenBudget ?? DEFAULT_HISTORY_TOKEN_BUDGET;
  const charBudget = Math.floor(tokenBudget * APPROX_CHARS_PER_TOKEN);

  const kept: ChatTurn[] = [];
  let usedChars = 0;
  // Walk newest -> oldest, keep turns until we'd exceed the budget. Reverse at
  // the end so the model still sees chronological order.
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    const turnCost = turn.content.length;
    if (kept.length > 0 && usedChars + turnCost > charBudget) {
      return { history: kept.reverse(), truncated: true };
    }
    kept.push(turn);
    usedChars += turnCost;
  }
  return { history: kept.reverse(), truncated: kept.length < history.length };
}
