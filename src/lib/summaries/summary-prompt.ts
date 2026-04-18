/**
 * Prompt assembly for grounded summarization (Step 15).
 *
 * Master spec refs: §5.4 (summary controls), §15 #6 (explicit attribution),
 * §5.3 (grounding rules). Pure module — no DB, no network — so the exact
 * wire format fed to Claude stays auditable in one file and is trivially
 * unit-testable.
 *
 * Attribution contract:
 *  - Every generated summary ends with a literal line starting with
 *    "Sources: " followed by the contributing source titles. This mirrors
 *    the chat-path citation rule while acknowledging that summaries do not
 *    need per-sentence `[C#]` labels — just a clear provenance footer.
 *  - For a library brief, the attribution line must name every contributing
 *    source so the reader can audit which ones actually drove the response.
 */

import type {
  SourceContext,
  SummarySourceRecord,
} from "./context";
import type {
  SummaryAudience,
  SummaryLength,
  SummaryParams,
} from "./params";

/**
 * Exact substring tests assert on the attribution footer. Kept as a const so
 * UI tooling and tests reference the same constant rather than a string
 * literal that could drift.
 */
export const ATTRIBUTION_PREFIX = "Sources:";

type SummaryKind = "source" | "library";

/** Word-count targets used to nudge the model toward the requested length. */
const LENGTH_GUIDANCE: Record<SummaryLength, string> = {
  short:
    "Write one focused paragraph of roughly 120-180 words. No headings, no lists.",
  long:
    "Write a multi-paragraph brief of roughly 400-700 words. Use short headings " +
    "(e.g. `## Overview`, `## Key points`, `## Notes`) where they genuinely help " +
    "the reader navigate; otherwise use plain paragraphs.",
};

const AUDIENCE_GUIDANCE: Record<SummaryAudience, string> = {
  plain:
    "Write for a general reader with no theological training. Prefer accessible " +
    "everyday phrasing; when you use a specialized term, define it in plain words.",
  technical:
    "Write for a theologically literate reader. Preserve scriptural references " +
    "verbatim (book chapter:verse) and keep domain terminology precise.",
};

export type BuildSourceSummaryPromptParams = Readonly<{
  source: SummarySourceRecord;
  /**
   * Chunk bodies in document order, already budgeted. Passing them separately
   * from `source` so callers can precompute a `SourceContext` and hand both
   * halves in one shot.
   */
  chunks: readonly string[];
  truncated: boolean;
  params: SummaryParams;
}>;

/**
 * Builds the system + user prompt pair for a per-source summary.
 *
 * The system prompt pins the grounding rules (summary comes only from the
 * context); the user prompt carries the actual chunk text. Keeping the
 * context in the user turn (rather than appending to the system prompt)
 * matches Anthropic's recommended pattern for "summarize this document" and
 * keeps the system text small + cacheable across requests.
 */
export function buildSourceSummaryPrompt(
  params: BuildSourceSummaryPromptParams,
): { system: string; userContent: string } {
  const { source, chunks, truncated, params: summaryParams } = params;
  const system = buildSystemPrompt({
    kind: "source",
    length: summaryParams.length,
    audience: summaryParams.audience,
    focus: summaryParams.focus,
    attribution: [source.title],
  });

  const truncationNote = truncated
    ? "\n\n(Note: the following text is truncated because the full source " +
      "exceeded the context window. Summarize what is present without " +
      "speculating about omitted material.)"
    : "";

  const userContent = [
    `Source title: ${source.title}`,
    `Source id: ${source.id}`,
    truncationNote.trim(),
    "",
    "Source content:",
    "",
    chunks.join("\n\n---\n\n"),
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { system, userContent };
}

export type BuildLibrarySummaryPromptParams = Readonly<{
  contributingSources: readonly SourceContext[];
  params: SummaryParams;
}>;

/**
 * Builds the system + user prompt pair for a library-level brief.
 *
 * The user prompt groups chunks under a heading per contributing source so
 * the model can name each source accurately in the attribution footer. The
 * system prompt instructs the model to acknowledge every contributing source
 * by title in the "Sources: …" line (§5.4 attribution requirement).
 */
export function buildLibrarySummaryPrompt(
  params: BuildLibrarySummaryPromptParams,
): { system: string; userContent: string } {
  const { contributingSources, params: summaryParams } = params;
  const attributionTitles = contributingSources.map(({ source }) => source.title);

  const system = buildSystemPrompt({
    kind: "library",
    length: summaryParams.length,
    audience: summaryParams.audience,
    focus: summaryParams.focus,
    attribution: attributionTitles,
  });

  const body = contributingSources
    .map(({ source, chunks, truncated }) => {
      const header = `### Source — ${source.title} (id: ${source.id})${
        truncated ? " [truncated]" : ""
      }`;
      return `${header}\n\n${chunks.join("\n\n---\n\n")}`;
    })
    .join("\n\n===\n\n");

  const userContent = [
    `Library brief across ${contributingSources.length} source(s).`,
    "",
    "The following blocks contain excerpts from each contributing source.",
    "Synthesize a brief that covers the whole set while making clear which",
    "source each observation comes from.",
    "",
    body,
  ].join("\n");

  return { system, userContent };
}

/**
 * Internal helper that builds the shared system prompt. Centralized so the
 * attribution rule is worded identically for per-source and library paths.
 */
function buildSystemPrompt(params: {
  kind: SummaryKind;
  length: SummaryLength;
  audience: SummaryAudience;
  focus: string | null;
  attribution: readonly string[];
}): string {
  const roleLine =
    params.kind === "source"
      ? "You are ScriptureLM, preparing a grounded summary of a single curated source."
      : "You are ScriptureLM, preparing a grounded library brief across multiple curated sources.";

  const attributionInstruction =
    params.attribution.length === 1
      ? `End the response with the exact line: "${ATTRIBUTION_PREFIX} ${
          params.attribution[0]
        }" on its own line.`
      : [
          `End the response with an attribution line that starts with "${ATTRIBUTION_PREFIX} "`,
          "and names every contributing source by title, comma-separated, in the",
          "order they appear in the context. Every title listed below MUST appear",
          "in that line verbatim:",
          "",
          ...params.attribution.map((title) => `  - ${title}`),
        ].join("\n");

  const focusLine = params.focus
    ? `Reader focus (prioritize this theme when choosing what to include): ${params.focus}`
    : "No specific focus was requested; cover the most salient points.";

  return [
    roleLine,
    "",
    "Write the summary using ONLY the content provided in the user message.",
    "Do not draw on outside knowledge, training data, memory of Scripture, or",
    "general theological commentary. If the provided content is insufficient",
    "to answer on a point, say so explicitly rather than filling the gap.",
    "",
    LENGTH_GUIDANCE[params.length],
    "",
    AUDIENCE_GUIDANCE[params.audience],
    "",
    focusLine,
    "",
    attributionInstruction,
  ].join("\n");
}
