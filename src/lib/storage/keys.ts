/**
 * Logical object keys for source blobs (Step 06).
 *
 * Convention: `sources/{sourceId}/{sanitizedFilename}` — stable per source UUID; the
 * filename segment preserves human-readable names for sermon metadata (master spec §12)
 * and operator debugging. Only the basename is kept; path separators and unsafe
 * characters are stripped or replaced.
 */

import path from "node:path";

const UNSAFE_FILENAME = /[^a-zA-Z0-9._-]+/g;

export function sanitizeSourceFilename(originalName: string): string {
  const base = path.basename(originalName.trim() || "upload");
  const cleaned = base.replace(UNSAFE_FILENAME, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 255) : "upload";
}

export function buildSourceStorageKey(
  sourceId: string,
  sanitizedFilename: string,
): string {
  return `sources/${sourceId}/${sanitizedFilename}`;
}

/**
 * Rejects keys that could escape the storage root (`..`, absolute segments, Windows roots).
 */
export function assertSafeStorageKey(storageKey: string): void {
  if (!storageKey || storageKey.trim() !== storageKey) {
    throw new Error("Invalid storage key: empty or untrimmed");
  }
  if (storageKey.startsWith("/") || /^[a-zA-Z]:/.test(storageKey)) {
    throw new Error("Invalid storage key: absolute path not allowed");
  }
  const segments = storageKey.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      throw new Error("Invalid storage key: parent segment not allowed");
    }
  }
}
