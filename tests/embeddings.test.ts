/**
 * Step 08: Bedrock embeddings + pgvector persistence.
 */
import "dotenv/config";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PrismaClient } from "@prisma/client";
import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { resetServerEnvCacheForTests } from "@/lib/config";
import { embedChunksForSource, embedTextWithBedrock } from "@/lib/embeddings";
import { formatVectorLiteral } from "@/lib/embeddings/pg-vector";
import { runExtractAndChunk } from "@/lib/ingest";
import { registerSourceFromBuffer } from "@/lib/sources/register-source";
import { resetBlobStorageCacheForTests } from "@/lib/storage";

import { tmpdir } from "node:os";

const prisma = new PrismaClient();

let databaseReady = false;

afterAll(async () => {
  await prisma.$disconnect();
});

function makeMockEmbedding(length: number, fill = 0.02): number[] {
  return Array.from({ length }, () => fill);
}

describe("embedTextWithBedrock (mocked client)", () => {
  beforeEach(() => {
    resetServerEnvCacheForTests();
  });

  it("throws EmbeddingDimensionMismatchError when response length mismatches EMBEDDING_DIMENSIONS", async () => {
    process.env.EMBEDDING_DIMENSIONS = "1024";
    process.env.BEDROCK_EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0";
    process.env.AWS_REGION = "us-east-2";

    const send = vi.fn().mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({ embedding: makeMockEmbedding(8) }),
      ),
    });
    const client = { send };

    await expect(
      embedTextWithBedrock("hello", {
        client,
        modelId: "amazon.titan-embed-text-v2:0",
        embeddingDimensions: 1024,
      }),
    ).rejects.toMatchObject({
      name: "EmbeddingDimensionMismatchError",
      receivedLength: 8,
      expectedLength: 1024,
    });

    expect(send).toHaveBeenCalled();
    const firstCall = send.mock.calls[0]?.[0];
    expect(firstCall).toBeInstanceOf(InvokeModelCommand);
  });
});

describe("embedChunksForSource (mocked Bedrock)", () => {
  let storageRoot: string;

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
    resetBlobStorageCacheForTests();
    storageRoot = mkdtempSync(path.join(tmpdir(), "slm-embed-"));
    process.env.STORAGE_BACKEND = "filesystem";
    process.env.SOURCE_STORAGE_ROOT = storageRoot;
    process.env.BEDROCK_EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0";
    process.env.EMBEDDING_DIMENSIONS = "1024";
    process.env.AWS_REGION = "us-east-2";
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("writes serialized vectors and embedding_model on chunk rows", async ({
    skip,
  }) => {
    if (!databaseReady) {
      skip();
      return;
    }

    const fixturePath = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "fixture.md",
    );
    const buffer = readFileSync(fixturePath);

    const { sourceId } = await registerSourceFromBuffer({
      buffer,
      originalFilename: "fixture.md",
      type: "markdown",
      corpus: "sermon",
    });

    const extract = await runExtractAndChunk(sourceId, {
      chunk: { maxChars: 200, overlap: 30 },
    });
    expect(extract.status).toBe("success");
    if (extract.status !== "success") {
      throw new Error("expected success");
    }

    const chunkRows = await prisma.chunk.findMany({
      where: { sourceId },
      select: { id: true },
    });
    expect(chunkRows.length).toBeGreaterThan(0);

    const vector = makeMockEmbedding(1024, 0.03125);
    const send = vi.fn().mockImplementation(async () => ({
      body: new TextEncoder().encode(
        JSON.stringify({ embedding: vector }),
      ),
    }));

    const result = await embedChunksForSource(sourceId, {
      prismaClient: prisma,
      bedrock: {
        client: { send },
        modelId: "amazon.titan-embed-text-v2:0",
        embeddingDimensions: 1024,
      },
      chunkBatchSize: 50,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("expected success");
    }
    expect(result.embeddedCount).toBe(chunkRows.length);
    expect(result.sourceStatus).toBe("READY");

    const rows = await prisma.$queryRaw<
      { has_embedding: boolean; embedding_model: string | null }[]
    >`
      SELECT (embedding IS NOT NULL) AS has_embedding, embedding_model
      FROM chunks
      WHERE source_id = ${sourceId}::uuid
    `;
    expect(rows.every((row) => row.has_embedding)).toBe(true);
    expect(rows.every((row) => row.embedding_model === "amazon.titan-embed-text-v2:0")).toBe(
      true,
    );

    await prisma.source.delete({ where: { id: sourceId } });
  });
});

describe("pgvector similarity (toy vectors)", () => {
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
    process.env.EMBEDDING_DIMENSIONS = "1024";
  });

  it("runs ORDER BY embedding <=> query on seeded vectors", async ({
    skip,
  }) => {
    if (!databaseReady) {
      skip();
      return;
    }

    const buffer = readFileSync(
      path.join(process.cwd(), "tests", "fixtures", "fixture.md"),
    );
    const { sourceId } = await registerSourceFromBuffer({
      buffer,
      originalFilename: "fixture.md",
      type: "markdown",
      corpus: "sermon",
    });

    const extract = await runExtractAndChunk(sourceId, {
      chunk: { maxChars: 400, overlap: 40 },
    });
    expect(extract.status).toBe("success");

    const chunks = await prisma.chunk.findMany({
      where: { sourceId },
      select: { id: true },
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const vectorA = makeMockEmbedding(1024, 1);
    const vectorB = makeMockEmbedding(1024, 2);
    await prisma.$executeRawUnsafe(
      `UPDATE chunks SET embedding = $1::vector, embedding_model = $2 WHERE id = $3::uuid`,
      formatVectorLiteral(vectorA),
      "test-model",
      chunks[0]!.id,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE chunks SET embedding = $1::vector, embedding_model = $2 WHERE id = $3::uuid`,
      formatVectorLiteral(vectorB),
      "test-model",
      chunks[1]!.id,
    );

    const queryVector = makeMockEmbedding(1024, 1);
    const literal = `[${queryVector.join(",")}]`;

    const nearest = await prisma.$queryRaw<{ id: string; distance: number }[]>`
      SELECT id, (embedding <=> ${literal}::vector) AS distance
      FROM chunks
      WHERE source_id = ${sourceId}::uuid
      ORDER BY embedding <=> ${literal}::vector
      LIMIT 1
    `;

    expect(nearest[0]?.id).toBe(chunks[0]!.id);
    expect(nearest[0]?.distance).toBe(0);

    await prisma.source.delete({ where: { id: sourceId } });
  });
});

describe("Bedrock integration (optional)", () => {
  beforeEach(() => {
    resetServerEnvCacheForTests();
  });

  it("calls Titan once when RUN_INTEGRATION=1 and AWS credentials work", async ({
    skip,
  }) => {
    if (process.env.RUN_INTEGRATION !== "1") {
      skip();
      return;
    }
    process.env.BEDROCK_EMBEDDING_MODEL_ID =
      process.env.BEDROCK_EMBEDDING_MODEL_ID ||
      "amazon.titan-embed-text-v2:0";
    process.env.EMBEDDING_DIMENSIONS = "1024";
    process.env.AWS_REGION = process.env.AWS_REGION || "us-east-2";

    const vector = await embedTextWithBedrock("integration probe", {});
    expect(vector.length).toBe(1024);
  });
});
