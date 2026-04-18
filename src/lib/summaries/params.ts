/**
 * Shared types and parsing helpers for grounded summarization (Step 15).
 *
 * Master spec refs: §5.4 (per-source + library brief), §6.3 (Claude API),
 * §15 #6 (explicit attribution).
 *
 * Two knobs are exposed to the end user via the UI:
 *  - `length`   — `short` (one paragraph, ~150 words) vs `long` (multi-section).
 *  - `audience` — `plain` (accessible prose) vs `technical` (preserves
 *                 theological / scriptural terminology).
 * An optional free-text `focus` narrows the summary to a theme or question.
 *
 * All three are parsed here (not in the route) so the API handlers stay
 * request/response shaped and the summary generators remain pure.
 */

export const SUMMARY_LENGTHS = ["short", "long"] as const;
export type SummaryLength = (typeof SUMMARY_LENGTHS)[number];

export const SUMMARY_AUDIENCES = ["plain", "technical"] as const;
export type SummaryAudience = (typeof SUMMARY_AUDIENCES)[number];

/** Max chars accepted on the free-text `focus` field (cheap abuse guard). */
export const MAX_FOCUS_CHARS = 500;

export type SummaryParams = Readonly<{
  length: SummaryLength;
  audience: SummaryAudience;
  /** Free-text user guidance; trimmed + length-clamped before reaching the model. */
  focus: string | null;
}>;

export type ParsedSummaryParams =
  | { ok: true; params: SummaryParams }
  | { ok: false; error: string };

function isSummaryLength(value: unknown): value is SummaryLength {
  return (
    typeof value === "string" &&
    (SUMMARY_LENGTHS as readonly string[]).includes(value)
  );
}

function isSummaryAudience(value: unknown): value is SummaryAudience {
  return (
    typeof value === "string" &&
    (SUMMARY_AUDIENCES as readonly string[]).includes(value)
  );
}

/**
 * Parses the length/audience/focus fields out of a POST body. Does not touch
 * scope fields — those are handled separately (per-source uses `sourceId`,
 * library reuses the chat scope parser).
 */
export function parseSummaryParams(raw: unknown): ParsedSummaryParams {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Request body must be an object" };
  }
  const lengthRaw = (raw as { length?: unknown }).length;
  if (!isSummaryLength(lengthRaw)) {
    return {
      ok: false,
      error: `\`length\` must be one of ${SUMMARY_LENGTHS.join(", ")}`,
    };
  }
  const audienceRaw = (raw as { audience?: unknown }).audience;
  if (!isSummaryAudience(audienceRaw)) {
    return {
      ok: false,
      error: `\`audience\` must be one of ${SUMMARY_AUDIENCES.join(", ")}`,
    };
  }
  const focusRaw = (raw as { focus?: unknown }).focus;
  if (focusRaw !== undefined && focusRaw !== null && typeof focusRaw !== "string") {
    return { ok: false, error: "`focus` must be a string if provided" };
  }
  const focusTrimmed =
    typeof focusRaw === "string" ? focusRaw.trim().slice(0, MAX_FOCUS_CHARS) : "";
  return {
    ok: true,
    params: {
      length: lengthRaw,
      audience: audienceRaw,
      focus: focusTrimmed.length > 0 ? focusTrimmed : null,
    },
  };
}
