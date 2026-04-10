/**
 * Best-effort sermon / catalog id from uploaded filename (e.g. `64-0216E.pdf` → `64-0216E`).
 */
export function parseSermonIdFromFilename(basename: string): string | undefined {
  const match = basename.match(/\b(\d{2}-\d{4}[A-Z]?)\b/);
  return match?.[1];
}
