/**
 * Normalize extracted text: trim, unify newlines, collapse horizontal whitespace,
 * preserve paragraph breaks (double newlines) for markdown-friendly chunking.
 */
export function normalizeText(raw: string): string {
  const withUnixNewlines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = withUnixNewlines.split("\n");
  const collapsedLines = lines.map((line) => line.replace(/[ \t]+/g, " ").trimEnd());
  const joined = collapsedLines.join("\n");
  return joined.replace(/\n{3,}/g, "\n\n").trim();
}
