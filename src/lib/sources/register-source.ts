/**
 * Server-only: persist raw bytes and create a pending Source row (Step 06).
 */

import { createHash, randomUUID } from "node:crypto";
import type { SourceCorpus, SourceType } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  buildSourceStorageKey,
  getBlobStorage,
  sanitizeSourceFilename,
} from "@/lib/storage";

export type RegisterSourceFromBufferInput = {
  buffer: Buffer;
  originalFilename: string;
  type: SourceType;
  corpus: SourceCorpus;
  bibleTranslation?: string | null;
  bibleBook?: string | null;
  sermonCatalogId?: string | null;
  createdById?: string | null;
};

export type RegisterSourceResult = {
  sourceId: string;
  storageKey: string;
  checksum: string;
  byteSize: number;
};

export async function registerSourceFromBuffer(
  input: RegisterSourceFromBufferInput,
): Promise<RegisterSourceResult> {
  const sourceId = randomUUID();
  const sanitizedName = sanitizeSourceFilename(input.originalFilename);
  const storageKey = buildSourceStorageKey(sourceId, sanitizedName);
  const checksum = createHash("sha256").update(input.buffer).digest("hex");
  const storage = getBlobStorage();

  await storage.put(storageKey, input.buffer);

  try {
    await prisma.source.create({
      data: {
        id: sourceId,
        type: input.type,
        corpus: input.corpus,
        storageKey,
        byteSize: BigInt(input.buffer.length),
        checksum,
        status: "PENDING",
        bibleTranslation: input.bibleTranslation ?? undefined,
        bibleBook: input.bibleBook ?? undefined,
        sermonCatalogId: input.sermonCatalogId ?? undefined,
        createdById: input.createdById ?? undefined,
      },
    });
  } catch (error) {
    await storage.delete(storageKey).catch(() => {});
    throw error;
  }

  return {
    sourceId,
    storageKey,
    checksum,
    byteSize: input.buffer.length,
  };
}
