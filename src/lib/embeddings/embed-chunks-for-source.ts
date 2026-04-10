import type { PrismaClient } from "@prisma/client";
import { getServerEnv } from "@/lib/config";
import prisma from "@/lib/prisma";
import {
  embedTextsWithBedrock,
  type EmbedTextsBedrockOptions,
} from "@/lib/embeddings/bedrock";
import { formatVectorLiteral } from "@/lib/embeddings/pg-vector";

/** One Titan request per chunk; tune batch size vs Bedrock rate limits (Step 08). */
const DEFAULT_EMBED_CHUNK_BATCH_SIZE = 24;

type PendingChunkRow = {
  id: string;
  content: string;
};

export type EmbedChunksForSourceDeps = Readonly<{
  prismaClient?: PrismaClient;
  bedrock?: EmbedTextsBedrockOptions;
  /** Max chunks to embed per Bedrock round-trip group (default 24). */
  chunkBatchSize?: number;
}>;

export type EmbedChunksForSourceResult =
  | { status: "skipped"; reason: "source_not_found" | "deleted" }
  | {
      status: "success";
      embeddedCount: number;
      sourceStatus: "READY" | "PROCESSING";
    }
  | { status: "failed"; errorMessage: string };

function logEmbeddingBatch(payload: {
  sourceId: string;
  embeddedCount: number;
  durationMs: number;
  error?: string;
}): void {
  const line = JSON.stringify({
    level: payload.error ? "error" : "info",
    event: payload.error ? "embedding_batch_failed" : "embedding_batch",
    sourceId: payload.sourceId,
    embeddedCount: payload.embeddedCount,
    durationMs: payload.durationMs,
    ...(payload.error ? { error: payload.error } : {}),
  });
  if (payload.error) {
    console.error(line);
  } else {
    console.info(line);
  }
}

async function loadPendingChunks(
  db: PrismaClient,
  sourceId: string,
): Promise<PendingChunkRow[]> {
  return db.$queryRaw<PendingChunkRow[]>`
    SELECT c.id, c.content
    FROM chunks c
    WHERE c.source_id = ${sourceId}::uuid
      AND c.embedding IS NULL
    ORDER BY (c.metadata->>'chunk_index')::int NULLS LAST, c.id
  `;
}

async function updateChunkEmbedding(
  db: PrismaClient,
  chunkId: string,
  vector: readonly number[],
  embeddingModel: string,
): Promise<void> {
  const literal = formatVectorLiteral(vector);
  await db.$executeRawUnsafe(
    `UPDATE chunks SET embedding = $1::vector, embedding_model = $2 WHERE id = $3::uuid`,
    literal,
    embeddingModel,
    chunkId,
  );
}

async function refreshSourceStatusAfterEmbeddings(
  db: PrismaClient,
  sourceId: string,
): Promise<"READY" | "PROCESSING"> {
  const counts = await db.$queryRaw<{ total: bigint; missing: bigint }[]>`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE embedding IS NULL)::bigint AS missing
    FROM chunks
    WHERE source_id = ${sourceId}::uuid
  `;
  const row = counts[0];
  if (!row || row.total === BigInt(0)) {
    return "PROCESSING";
  }
  if (row.missing !== BigInt(0)) {
    return "PROCESSING";
  }
  await db.source.update({
    where: { id: sourceId },
    data: { status: "READY", errorMessage: null },
  });
  return "READY";
}

/**
 * Embeds all chunks for a source that still have `embedding IS NULL`, writes `embedding_model`,
 * and sets `Source.status` to `READY` when every chunk has an embedding (Step 08).
 * Skips sources with `deleted_at` set.
 */
export async function embedChunksForSource(
  sourceId: string,
  deps: EmbedChunksForSourceDeps = {},
): Promise<EmbedChunksForSourceResult> {
  const db = deps.prismaClient ?? prisma;
  const env = getServerEnv();
  const modelId =
    deps.bedrock?.modelId ?? env.bedrockEmbeddingModelId;
  const embeddingDimensions =
    deps.bedrock?.embeddingDimensions ?? env.embeddingDimensions;
  const chunkBatchSize =
    deps.chunkBatchSize ?? DEFAULT_EMBED_CHUNK_BATCH_SIZE;

  if (!modelId) {
    return {
      status: "failed",
      errorMessage: "Missing BEDROCK_EMBEDDING_MODEL_ID (server config).",
    };
  }

  const source = await db.source.findUnique({ where: { id: sourceId } });
  if (!source) {
    return { status: "skipped", reason: "source_not_found" };
  }
  if (source.deletedAt) {
    return { status: "skipped", reason: "deleted" };
  }

  let totalEmbedded = 0;

  try {
    while (true) {
      const pending = await loadPendingChunks(db, sourceId);
      if (pending.length === 0) {
        const sourceStatus = await refreshSourceStatusAfterEmbeddings(
          db,
          sourceId,
        );
        return {
          status: "success",
          embeddedCount: totalEmbedded,
          sourceStatus,
        };
      }

      const batch = pending.slice(0, chunkBatchSize);
      const texts = batch.map((row) => row.content);
      const batchStart = Date.now();

      let vectors: number[][];
      try {
        vectors = await embedTextsWithBedrock(texts, {
          ...deps.bedrock,
          modelId,
          embeddingDimensions,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        logEmbeddingBatch({
          sourceId,
          embeddedCount: 0,
          durationMs: Date.now() - batchStart,
          error: message.slice(0, 500),
        });
        throw error;
      }

      for (let index = 0; index < batch.length; index += 1) {
        const chunkRow = batch[index]!;
        const vector = vectors[index]!;
        await updateChunkEmbedding(
          db,
          chunkRow.id,
          vector,
          modelId,
        );
      }

      totalEmbedded += batch.length;
      logEmbeddingBatch({
        sourceId,
        embeddedCount: batch.length,
        durationMs: Date.now() - batchStart,
      });
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return { status: "failed", errorMessage };
  }
}
