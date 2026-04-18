/**
 * Barrel file for the grounded summarization module (Step 15; master spec §5.4).
 */

export {
  buildLibraryContext,
  buildSourceContext,
  loadOrderedChunks,
  loadSummarySource,
  LIBRARY_CHAR_BUDGET,
  MAX_LIBRARY_SOURCES,
  PER_SOURCE_CHAR_BUDGET,
  type SourceContext,
  type SummaryContext,
  type SummarySourceRecord,
} from "./context";

export {
  generateLibrarySummary,
  generateSourceSummary,
  NoContributingSourcesError,
  SourceNotFoundError,
  SourceNotReadyError,
  type SummaryAttribution,
  type SummaryResult,
} from "./generate";

export {
  MAX_FOCUS_CHARS,
  parseSummaryParams,
  SUMMARY_AUDIENCES,
  SUMMARY_LENGTHS,
  type SummaryAudience,
  type SummaryLength,
  type SummaryParams,
} from "./params";

export {
  ATTRIBUTION_PREFIX,
  buildLibrarySummaryPrompt,
  buildSourceSummaryPrompt,
} from "./summary-prompt";
