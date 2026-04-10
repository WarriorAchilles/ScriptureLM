/**
 * Ingest: extract text from blobs, normalize, chunk (Step 07). Embeddings are Step 08.
 */

export { extractText } from "@/lib/ingest/extract-text";
export { normalizeText } from "@/lib/ingest/normalize-text";
export {
  chunkText,
  type ChunkMetadataPayload,
  type ChunkTextOptions,
  type TextChunk,
} from "@/lib/ingest/chunk-text";
export { parseSermonIdFromFilename } from "@/lib/ingest/filename-meta";
export {
  runExtractAndChunk,
  TEXT_EXTRACTION_VERSION,
  type RunExtractAndChunkResult,
} from "@/lib/ingest/run-extract-and-chunk";
