import type { EmbedChunksForSourceDeps } from "@/lib/embeddings/embed-chunks-for-source";
import { embedChunksForSource } from "@/lib/embeddings/embed-chunks-for-source";
import { runExtractAndChunk } from "@/lib/ingest/run-extract-and-chunk";

export type FullIngestPipelineResult =
  | { ok: true; chunkCount: number; embeddedCount: number }
  | { ok: false; stage: "extract" | "embed"; message: string };

/**
 * One logical ingest unit (Step 07 + Step 08): extract/chunk/store rows, then embed until READY.
 * Used by both `ingest` and `reindex` jobs (after reindex clears chunks).
 */
export async function runFullIngestPipeline(
  sourceId: string,
  embedDeps?: EmbedChunksForSourceDeps,
): Promise<FullIngestPipelineResult> {
  const extract = await runExtractAndChunk(sourceId);
  if (extract.status === "skipped") {
    return {
      ok: false,
      stage: "extract",
      message: "source deleted or unavailable",
    };
  }
  if (extract.status === "failed") {
    return { ok: false, stage: "extract", message: extract.errorMessage };
  }

  const embed = await embedChunksForSource(sourceId, embedDeps);
  if (embed.status === "skipped") {
    return {
      ok: false,
      stage: "embed",
      message: `skipped: ${embed.reason}`,
    };
  }
  if (embed.status === "failed") {
    return { ok: false, stage: "embed", message: embed.errorMessage };
  }

  return {
    ok: true,
    chunkCount: extract.chunkCount,
    embeddedCount: embed.embeddedCount,
  };
}
