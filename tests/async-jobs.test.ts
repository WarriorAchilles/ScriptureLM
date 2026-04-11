/**
 * Step 09: async ingest jobs — enqueue, claim, execute (extract + embed), retries.
 */
import "dotenv/config";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
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
import { claimNextPendingJob } from "@/lib/jobs/claim-job";
import { enqueueIngestJob } from "@/lib/jobs/enqueue-job";
import { executeClaimedJob } from "@/lib/jobs/execute-job";
import * as runFullIngest from "@/lib/jobs/run-full-ingest";
import { registerSourceFromBuffer } from "@/lib/sources/register-source";
import { resetBlobStorageCacheForTests } from "@/lib/storage";

const prisma = new PrismaClient();

let databaseReady = false;

afterAll(async () => {
  await prisma.$disconnect();
});

function makeMockEmbedding(length: number, fill = 0.02): number[] {
  return Array.from({ length }, () => fill);
}

describe("async ingest jobs", () => {
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
    storageRoot = mkdtempSync(path.join(tmpdir(), "slm-jobs-"));
    process.env.STORAGE_BACKEND = "filesystem";
    process.env.SOURCE_STORAGE_ROOT = storageRoot;
    process.env.BEDROCK_EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0";
    process.env.EMBEDDING_DIMENSIONS = "1024";
    process.env.AWS_REGION = "us-east-2";
    process.env.JOB_MAX_ATTEMPTS = "3";
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("enqueue → claim → execute leaves Source READY with embeddings", async ({
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

    await enqueueIngestJob(sourceId);

    const claimed = await claimNextPendingJob(prisma);
    expect(claimed).not.toBeNull();
    if (!claimed) {
      throw new Error("expected claimed job");
    }
    expect(claimed.status).toBe("RUNNING");

    const vector = makeMockEmbedding(1024, 0.03125);
    const send = vi.fn().mockImplementation(async () => ({
      body: new TextEncoder().encode(
        JSON.stringify({ embedding: vector }),
      ),
    }));

    const outcome = await executeClaimedJob(claimed, {
      prismaClient: prisma,
      embedDeps: {
        bedrock: {
          client: { send },
          modelId: "amazon.titan-embed-text-v2:0",
          embeddingDimensions: 1024,
        },
        chunkBatchSize: 50,
      },
    });

    expect(outcome.kind).toBe("completed");

    const source = await prisma.source.findUnique({ where: { id: sourceId } });
    expect(source?.status).toBe("READY");

    const jobRow = await prisma.job.findUnique({ where: { id: claimed.id } });
    expect(jobRow?.status).toBe("COMPLETED");
    expect(jobRow?.lastError).toBeNull();

    const firstCall = send.mock.calls[0]?.[0];
    expect(firstCall).toBeInstanceOf(InvokeModelCommand);

    await prisma.source.delete({ where: { id: sourceId } });
  });

  it("increments attempts and fails job and source after max failures", async ({
    skip,
  }) => {
    if (!databaseReady) {
      skip();
      return;
    }

    process.env.JOB_MAX_ATTEMPTS = "2";

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

    await enqueueIngestJob(sourceId);

    const spy = vi
      .spyOn(runFullIngest, "runFullIngestPipeline")
      .mockResolvedValue({
        ok: false,
        stage: "embed",
        message: "simulated_failure",
      });

    const first = await claimNextPendingJob(prisma);
    expect(first).not.toBeNull();
    const outcome1 = await executeClaimedJob(first!, { prismaClient: prisma });
    expect(outcome1.kind).toBe("retry_scheduled");

    const mid = await prisma.job.findUnique({ where: { id: first!.id } });
    expect(mid?.status).toBe("PENDING");
    expect(mid?.attempts).toBe(1);

    const second = await claimNextPendingJob(prisma);
    expect(second?.id).toBe(first!.id);
    const outcome2 = await executeClaimedJob(second!, { prismaClient: prisma });
    expect(outcome2.kind).toBe("failed_terminal");

    const finalJob = await prisma.job.findUnique({ where: { id: first!.id } });
    expect(finalJob?.status).toBe("FAILED");
    expect(finalJob?.attempts).toBe(2);
    expect(finalJob?.lastError).toContain("simulated_failure");

    const failedSource = await prisma.source.findUnique({
      where: { id: sourceId },
    });
    expect(failedSource?.status).toBe("FAILED");
    expect(failedSource?.errorMessage).toContain("simulated_failure");

    expect(spy).toHaveBeenCalled();

    await prisma.source.delete({ where: { id: sourceId } });
  });
});
