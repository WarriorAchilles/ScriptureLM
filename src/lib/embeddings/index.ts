/**
 * Embeddings: Bedrock Titan + pgvector persistence (Step 08).
 */

export {
  embedChunksForSource,
  type EmbedChunksForSourceDeps,
  type EmbedChunksForSourceResult,
} from "@/lib/embeddings/embed-chunks-for-source";
export {
  embedTextWithBedrock,
  embedTextsWithBedrock,
  EmbeddingDimensionMismatchError,
  withEmbeddingRetry,
  type BedrockEmbeddingClient,
  type EmbedTextsBedrockOptions,
} from "@/lib/embeddings/bedrock";
export { formatVectorLiteral } from "@/lib/embeddings/pg-vector";
