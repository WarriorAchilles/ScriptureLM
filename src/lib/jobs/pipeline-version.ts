import { getServerEnv } from "@/lib/config";
import { TEXT_EXTRACTION_VERSION } from "@/lib/ingest/run-extract-and-chunk";

/**
 * Single string for job idempotency (§9): extract rules + embedding model identity.
 * If a completed job is re-enqueued with the same version and the source is already READY, the worker no-ops.
 */
export function computePipelineVersion(): string {
  const env = getServerEnv();
  const modelId = env.bedrockEmbeddingModelId.trim() || "unset";
  return `${TEXT_EXTRACTION_VERSION}|embed:${modelId}`;
}
