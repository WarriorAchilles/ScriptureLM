import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getObjectBuffer } from "@/lib/storage";
import {
  chunkText,
  type ChunkMetadataPayload,
  type ChunkTextOptions,
} from "@/lib/ingest/chunk-text";
import { extractText } from "@/lib/ingest/extract-text";
import { parseSermonIdFromFilename } from "@/lib/ingest/filename-meta";
import { normalizeText } from "@/lib/ingest/normalize-text";

/** Bump when extract/normalize rules change materially. */
export const TEXT_EXTRACTION_VERSION = "extract-v1";

/**
 * Source lifecycle vs Step 08 embeddings:
 * - After successful chunking (this step): `PROCESSING` — chunks exist; embeddings may be null.
 * - Step 08 sets `READY` when every chunk for the source has a non-null embedding.
 * - `PENDING` is reserved for “registered but extract/chunk not finished yet” (or not re-run).
 */
export type RunExtractAndChunkResult =
  | { status: "skipped"; reason: "deleted" }
  | { status: "success"; chunkCount: number }
  | { status: "failed"; errorMessage: string };

export async function runExtractAndChunk(
  sourceId: string,
  options?: { chunk?: ChunkTextOptions },
): Promise<RunExtractAndChunkResult> {
  const source = await prisma.source.findUnique({ where: { id: sourceId } });
  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }
  if (source.deletedAt) {
    return { status: "skipped", reason: "deleted" };
  }
  if (!source.storageKey) {
    await prisma.source.update({
      where: { id: sourceId },
      data: {
        status: "FAILED",
        errorMessage: "Source has no storage_key; cannot read blob.",
      },
    });
    return { status: "failed", errorMessage: "missing storage_key" };
  }

  try {
    const buffer = await getObjectBuffer(source.storageKey);
    const raw = await extractText(source.type, buffer);
    const normalized = normalizeText(raw);
    const chunks = chunkText(normalized, options?.chunk ?? {});

    if (chunks.length === 0) {
      await prisma.source.update({
        where: { id: sourceId },
        data: {
          status: "FAILED",
          errorMessage:
            "No chunkable text after extract/normalize (empty or whitespace only).",
        },
      });
      return {
        status: "failed",
        errorMessage: "empty chunks",
      };
    }

    const basename = source.storageKey.split("/").pop() ?? "";
    const sermonIdFromFile = parseSermonIdFromFilename(basename);

    await prisma.$transaction(async (tx) => {
      await tx.chunk.deleteMany({ where: { sourceId } });
      await tx.chunk.createMany({
        data: chunks.map((chunk) => {
          const metadata: ChunkMetadataPayload = {
            source_id: sourceId,
            chunk_index: chunk.chunk_index,
            corpus: source.corpus,
            bible_book: source.bibleBook ?? undefined,
            sermon_id_from_filename: sermonIdFromFile ?? undefined,
          };
          return {
            sourceId,
            content: chunk.content,
            metadata: metadata as unknown as Prisma.InputJsonValue,
          };
        }),
      });
      await tx.source.update({
        where: { id: sourceId },
        data: {
          status: "PROCESSING",
          errorMessage: null,
          textExtractionVersion: TEXT_EXTRACTION_VERSION,
        },
      });
    });

    return { status: "success", chunkCount: chunks.length };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    await prisma.source.update({
      where: { id: sourceId },
      data: {
        status: "FAILED",
        errorMessage,
      },
    });
    return { status: "failed", errorMessage };
  }
}
