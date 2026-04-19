/**
 * Rewrites plain `[C1]` markers into CommonMark links `[[C1]](cite:C1)` **before**
 * remark-parse runs. That guarantees the AST contains real `link` nodes with
 * `url: "cite:C1"` (the remark tree walk alone can miss edge cases or ordering).
 *
 * Replace longer labels first (e.g. `C10` before `C1`) so shared prefixes don't split.
 */
export function injectCitationMarkdownLinks(
  markdown: string,
  labels: ReadonlySet<string>,
): string {
  if (labels.size === 0) {
    return markdown;
  }
  const sorted = [...labels].sort((a, b) => b.length - a.length);
  let result = markdown;
  for (const label of sorted) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Avoid matching the inner `[C1]` inside an already-injected `[[C1]](cite:C1)`.
    const re = new RegExp(`(?<!\\[)\\[${escaped}\\]`, "g");
    result = result.replace(re, `[[${label}]](cite:${label})`);
  }
  return result;
}
