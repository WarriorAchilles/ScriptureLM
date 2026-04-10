/**
 * Step 07: extract, normalize, chunk pipeline.
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
} from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetServerEnvCacheForTests } from "@/lib/config";
import {
  chunkText,
  extractText,
  normalizeText,
  parseSermonIdFromFilename,
  runExtractAndChunk,
} from "@/lib/ingest";
import { registerSourceFromBuffer } from "@/lib/sources/register-source";
import { resetBlobStorageCacheForTests } from "@/lib/storage";

import { tmpdir } from "node:os";

const prisma = new PrismaClient();

/** Set once so integration tests skip cleanly when Postgres is unavailable (e.g. CI without Docker). */
let databaseReady = false;

afterAll(async () => {
  await prisma.$disconnect();
});

describe("normalizeText + chunkText", () => {
  it("produces consecutive chunk_index values for markdown fixture", () => {
    const fixturePath = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "fixture.md",
    );
    const raw = readFileSync(fixturePath, "utf8");
    const normalized = normalizeText(raw);
    const chunks = chunkText(normalized, { maxChars: 120, overlap: 20 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (let index = 0; index < chunks.length; index += 1) {
      expect(chunks[index].chunk_index).toBe(index);
    }
  });
});

describe("parseSermonIdFromFilename", () => {
  it("extracts Branham-style codes from basename", () => {
    expect(parseSermonIdFromFilename("64-0216E.pdf")).toBe("64-0216E");
    expect(parseSermonIdFromFilename("misc.txt")).toBeUndefined();
  });
});

describe("extractText (PDF)", () => {
  it("rejects invalid PDF bytes (no DB)", async () => {
    await expect(
      extractText("pdf", Buffer.from("totally not a pdf")),
    ).rejects.toThrow();
  });
});

describe("runExtractAndChunk", () => {
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
    storageRoot = mkdtempSync(path.join(tmpdir(), "slm-ingest-"));
    process.env.STORAGE_BACKEND = "filesystem";
    process.env.SOURCE_STORAGE_ROOT = storageRoot;
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("chunks markdown source with stable indices; second run is idempotent", async ({
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

    const first = await runExtractAndChunk(sourceId, {
      chunk: { maxChars: 200, overlap: 30 },
    });
    expect(first.status).toBe("success");
    if (first.status !== "success") {
      throw new Error("expected success");
    }
    expect(first.chunkCount).toBeGreaterThanOrEqual(2);

    let rows = await prisma.chunk.findMany({ where: { sourceId } });
    expect(rows.length).toBe(first.chunkCount);
    const indices = rows
      .map((row) => (row.metadata as { chunk_index: number }).chunk_index)
      .sort((a, b) => a - b);
    for (let index = 0; index < indices.length; index += 1) {
      expect(indices[index]).toBe(index);
    }

    const second = await runExtractAndChunk(sourceId, {
      chunk: { maxChars: 200, overlap: 30 },
    });
    expect(second.status).toBe("success");
    if (second.status !== "success") {
      throw new Error("expected success");
    }
    expect(second.chunkCount).toBe(first.chunkCount);

    rows = await prisma.chunk.findMany({ where: { sourceId } });
    expect(rows.length).toBe(first.chunkCount);

    const source = await prisma.source.findUnique({ where: { id: sourceId } });
    expect(source?.status).toBe("PROCESSING");
    expect(source?.errorMessage).toBeNull();

    await prisma.source.delete({ where: { id: sourceId } });
  });

  it("marks source FAILED with non-empty error for corrupt PDF bytes", async ({
    skip,
  }) => {
    if (!databaseReady) {
      skip();
      return;
    }
    const { sourceId } = await registerSourceFromBuffer({
      buffer: Buffer.from("not a pdf at all \xff\xfe"),
      originalFilename: "broken.pdf",
      type: "pdf",
      corpus: "other",
    });

    const result = await runExtractAndChunk(sourceId);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      throw new Error("expected failed");
    }
    expect(result.errorMessage.length).toBeGreaterThan(0);

    const source = await prisma.source.findUnique({ where: { id: sourceId } });
    expect(source?.status).toBe("FAILED");
    expect(source?.errorMessage?.trim().length).toBeGreaterThan(0);

    const chunks = await prisma.chunk.count({ where: { sourceId } });
    expect(chunks).toBe(0);

    await prisma.source.delete({ where: { id: sourceId } });
  });
});

describe("POST /api/internal/sources/ingest-chunk", () => {
  let storageRoot: string;

  beforeEach(() => {
    resetServerEnvCacheForTests();
    resetBlobStorageCacheForTests();
    storageRoot = mkdtempSync(path.join(tmpdir(), "slm-ingest-api-"));
    process.env.STORAGE_BACKEND = "filesystem";
    process.env.SOURCE_STORAGE_ROOT = storageRoot;
    process.env.OPERATOR_INGEST_SECRET = "correct-operator-secret";
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("returns 403 when x-operator-secret is wrong", async () => {
    const { POST } = await import(
      "@/app/api/internal/sources/ingest-chunk/route"
    );

    const response = await POST(
      new Request("http://test.local/api/internal/sources/ingest-chunk", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-operator-secret": "wrong",
        },
        body: JSON.stringify({ sourceId: "00000000-0000-0000-0000-000000000000" }),
      }),
    );

    expect(response.status).toBe(403);
  });
});
