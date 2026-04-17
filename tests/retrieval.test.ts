/**
 * Step 12: retrieval service (scoped pgvector search).
 *
 * These tests seed sources + chunks with deterministic unit vectors so the
 * cosine-distance ordering is knowable without calling Bedrock. Every test
 * injects `queryEmbedding` on `retrieveContext` to bypass the real embedding
 * model.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, type SourceCorpus } from "@prisma/client";
import { resetServerEnvCacheForTests } from "@/lib/config";
import { retrieveContext } from "@/lib/retrieval";
import { formatVectorLiteral } from "@/lib/embeddings/pg-vector";

const EMBEDDING_DIMENSIONS = 1024;
const prisma = new PrismaClient();

let databaseReady = false;
/** All source ids created by this suite so cleanup is surgical (no TRUNCATE). */
const createdSourceIds = new Set<string>();

afterAll(async () => {
  for (const sourceId of createdSourceIds) {
    await prisma.source.delete({ where: { id: sourceId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseReady = true;
  } catch {
    databaseReady = false;
  }
});

beforeEach(() => {
  resetServerEnvCacheForTests();
  process.env.EMBEDDING_DIMENSIONS = String(EMBEDDING_DIMENSIONS);
});

/**
 * Builds a unit vector of length 1024 whose first two components are
 * `(cos(angle), sin(angle))` and the rest are zero. Cosine distance between two
 * such vectors equals `1 - cos(angle1 - angle2)`, so small angle differences
 * produce predictable, monotonic ordering.
 */
function unitVectorAtAngle(angleRadians: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[0] = Math.cos(angleRadians);
  vector[1] = Math.sin(angleRadians);
  return vector;
}

async function createReadySource(
  corpus: SourceCorpus,
  labelHint: string,
): Promise<string> {
  const source = await prisma.source.create({
    data: {
      id: randomUUID(),
      type: "markdown",
      corpus,
      status: "READY",
      storageKey: `test/${labelHint}-${randomUUID()}.md`,
      bibleBook: corpus === "scripture" ? labelHint : null,
      sermonCatalogId: corpus === "sermon" ? labelHint : null,
    },
    select: { id: true },
  });
  createdSourceIds.add(source.id);
  return source.id;
}

async function createChunkWithVector(
  sourceId: string,
  content: string,
  vector: readonly number[] | null,
): Promise<string> {
  const chunk = await prisma.chunk.create({
    data: { sourceId, content },
    select: { id: true },
  });
  if (vector) {
    await prisma.$executeRawUnsafe(
      `UPDATE chunks SET embedding = $1::vector, embedding_model = 'test-model' WHERE id = $2::uuid`,
      formatVectorLiteral(vector),
      chunk.id,
    );
  }
  return chunk.id;
}

describe("retrieveContext", () => {
  it("returns the nearest chunk first for the injected query vector", async ({
    skip,
  }) => {
    if (!databaseReady) {
      skip();
      return;
    }

    const sermonSource = await createReadySource("sermon", "TestSermon");
    const nearChunkId = await createChunkWithVector(
      sermonSource,
      "The nearest sermon passage.",
      unitVectorAtAngle(0),
    );
    await createChunkWithVector(
      sermonSource,
      "A less related sermon passage.",
      unitVectorAtAngle(Math.PI / 3),
    );
    await createChunkWithVector(
      sermonSource,
      "An even less related sermon passage.",
      unitVectorAtAngle(Math.PI / 2),
    );

    const results = await retrieveContext(
      {
        query: "nearest sermon",
        limit: 2,
        // Scope to this source only so pre-existing dev data cannot intrude.
        sourceIds: [sermonSource],
      },
      {
        prismaClient: prisma,
        queryEmbedding: unitVectorAtAngle(0),
      },
    );

    expect(results).toHaveLength(2);
    expect(results[0]?.chunkId).toBe(nearChunkId);
    expect(results[0]?.sourceId).toBe(sermonSource);
    expect(results[0]?.corpus).toBe("sermon");
    expect(results[0]?.title).toBe("TestSermon");
    // Distance should be monotonically non-decreasing across the ranked set.
    expect(results[0]!.distance).toBeLessThanOrEqual(results[1]!.distance);
  });

  it("excludes chunks from sources outside the scoped sourceIds", async ({
    skip,
  }) => {
    if (!databaseReady) {
      skip();
      return;
    }

    // The globally-nearest chunk lives in `sourceA`, but the caller asks only
    // for chunks from `sourceB`. The result must not leak `sourceA`.
    const sourceA = await createReadySource("sermon", "SermonA");
    const sourceB = await createReadySource("sermon", "SermonB");

    await createChunkWithVector(
      sourceA,
      "Globally nearest chunk — excluded by scope.",
      unitVectorAtAngle(0),
    );
    const inScopeChunkId = await createChunkWithVector(
      sourceB,
      "Farther chunk in the scoped source.",
      unitVectorAtAngle(Math.PI / 4),
    );

    const results = await retrieveContext(
      {
        query: "scoped retrieval",
        limit: 5,
        sourceIds: [sourceB],
      },
      {
        prismaClient: prisma,
        queryEmbedding: unitVectorAtAngle(0),
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.chunkId).toBe(inScopeChunkId);
    expect(results[0]?.sourceId).toBe(sourceB);
    expect(results.every((row) => row.sourceId !== sourceA)).toBe(true);
  });

  it("returns [] without throwing when the scope has no embedded chunks", async ({
    skip,
  }) => {
    if (!databaseReady) {
      skip();
      return;
    }

    const emptySource = await createReadySource("sermon", "Empty");
    // Intentionally skip writing an embedding — the source exists, is READY,
    // but has no nearest-neighbour candidate and must not throw.
    await createChunkWithVector(
      emptySource,
      "Chunk without an embedding.",
      null,
    );

    const results = await retrieveContext(
      {
        query: "anything",
        limit: 3,
        sourceIds: [emptySource],
      },
      {
        prismaClient: prisma,
        queryEmbedding: unitVectorAtAngle(0),
      },
    );

    expect(results).toEqual([]);
  });

  it("ignores soft-deleted sources even when passed explicitly", async ({
    skip,
  }) => {
    if (!databaseReady) {
      skip();
      return;
    }

    const deletedSource = await createReadySource("sermon", "Deleted");
    await createChunkWithVector(
      deletedSource,
      "Chunk from a soft-deleted source.",
      unitVectorAtAngle(0),
    );
    await prisma.source.update({
      where: { id: deletedSource },
      data: { deletedAt: new Date() },
    });

    const results = await retrieveContext(
      {
        query: "tombstoned",
        limit: 3,
        sourceIds: [deletedSource],
      },
      {
        prismaClient: prisma,
        queryEmbedding: unitVectorAtAngle(0),
      },
    );

    expect(results).toEqual([]);
  });

  it("respects an explicit corpus filter across sources", async ({ skip }) => {
    if (!databaseReady) {
      skip();
      return;
    }

    const scriptureSource = await createReadySource("scripture", "Genesis");
    const sermonSource = await createReadySource("sermon", "SermonCorpus");

    // Scripture chunk is globally nearest, but we filter to sermons only.
    await createChunkWithVector(
      scriptureSource,
      "Scripture passage that would otherwise win.",
      unitVectorAtAngle(0),
    );
    const sermonChunkId = await createChunkWithVector(
      sermonSource,
      "Sermon passage within the corpus filter.",
      unitVectorAtAngle(Math.PI / 6),
    );

    const results = await retrieveContext(
      {
        query: "doctrine",
        limit: 3,
        corpus: "sermon",
        // Scope to our two fixture sources so the assertion is not polluted by
        // pre-existing dev data in either corpus.
        sourceIds: [scriptureSource, sermonSource],
      },
      {
        prismaClient: prisma,
        queryEmbedding: unitVectorAtAngle(0),
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.chunkId).toBe(sermonChunkId);
    expect(results[0]?.corpus).toBe("sermon");
  });
});
