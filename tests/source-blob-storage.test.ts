/**
 * Step 06: source blob storage (filesystem + mocked S3) and operator register API.
 */
import "dotenv/config";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetServerEnvCacheForTests } from "@/lib/config";
import { registerSourceFromBuffer } from "@/lib/sources/register-source";
import { resetBlobStorageCacheForTests } from "@/lib/storage";

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({}),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(function MockS3Client() {
    return { send: sendMock };
  }),
  PutObjectCommand: class PutObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  GetObjectCommand: class GetObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  DeleteObjectCommand: class DeleteObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("registerSourceFromBuffer (filesystem backend)", () => {
  let storageRoot: string;

  beforeEach(() => {
    resetServerEnvCacheForTests();
    resetBlobStorageCacheForTests();
    sendMock.mockClear();
    storageRoot = mkdtempSync(path.join(tmpdir(), "slm-src-"));
    process.env.STORAGE_BACKEND = "filesystem";
    process.env.SOURCE_STORAGE_ROOT = storageRoot;
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("creates a Source row and writes the file at the expected path", async () => {
    const result = await registerSourceFromBuffer({
      buffer: Buffer.from("hello corpus", "utf8"),
      originalFilename: "notes.txt",
      type: "text",
      corpus: "scripture",
    });

    const row = await prisma.source.findUnique({
      where: { id: result.sourceId },
    });
    expect(row).not.toBeNull();
    expect(row?.status).toBe("PENDING");
    expect(row?.storageKey).toBe(result.storageKey);
    expect(row?.storageKey).toMatch(
      new RegExp(`^sources/${result.sourceId}/notes\\.txt$`),
    );
    expect(row?.checksum).toBeTruthy();
    expect(Number(row?.byteSize)).toBe(Buffer.byteLength("hello corpus", "utf8"));

    const diskPath = path.join(storageRoot, ...result.storageKey.split("/"));
    expect(readFileSync(diskPath, "utf8")).toBe("hello corpus");

    await prisma.source.delete({ where: { id: result.sourceId } });
  });
});

describe("POST /api/internal/sources/register", () => {
  let storageRoot: string;

  beforeEach(() => {
    resetServerEnvCacheForTests();
    resetBlobStorageCacheForTests();
    storageRoot = mkdtempSync(path.join(tmpdir(), "slm-api-"));
    process.env.STORAGE_BACKEND = "filesystem";
    process.env.SOURCE_STORAGE_ROOT = storageRoot;
    process.env.OPERATOR_INGEST_SECRET = "correct-operator-secret";
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("returns 403 when x-operator-secret is wrong", async () => {
    const { POST } = await import("@/app/api/internal/sources/register/route");
    const form = new FormData();
    form.append("file", new File([Buffer.from("x")], "x.txt", { type: "text/plain" }));
    form.append("type", "text");
    form.append("corpus", "other");

    const response = await POST(
      new Request("http://test.local/api/internal/sources/register", {
        method: "POST",
        headers: { "x-operator-secret": "wrong" },
        body: form,
      }),
    );

    expect(response.status).toBe(403);
  });

  it("returns 201/200 JSON when secret and form are valid", async () => {
    const { POST } = await import("@/app/api/internal/sources/register/route");
    const form = new FormData();
    form.append("file", new File([Buffer.from("ab")], "doc.md", { type: "text/plain" }));
    form.append("type", "markdown");
    form.append("corpus", "sermon");

    const response = await POST(
      new Request("http://test.local/api/internal/sources/register", {
        method: "POST",
        headers: { "x-operator-secret": "correct-operator-secret" },
        body: form,
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sourceId: string;
      storageKey: string;
    };
    const diskPath = path.join(storageRoot, ...body.storageKey.split("/"));
    expect(readFileSync(diskPath).toString()).toBe("ab");

    await prisma.source.delete({ where: { id: body.sourceId } });
  });
});

describe("registerSourceFromBuffer (S3 backend, mocked client)", () => {
  beforeEach(() => {
    resetServerEnvCacheForTests();
    resetBlobStorageCacheForTests();
    sendMock.mockClear();
    process.env.STORAGE_BACKEND = "s3";
    process.env.AWS_REGION = "us-east-1";
    process.env.S3_BUCKET = "test-bucket-sl";
    process.env.S3_ENDPOINT_URL = "http://localhost:4566";
  });

  it("puts object via S3 PutObject and creates DB row", async () => {
    const result = await registerSourceFromBuffer({
      buffer: Buffer.from("s3-payload"),
      originalFilename: "paper.pdf",
      type: "pdf",
      corpus: "other",
    });

    expect(sendMock).toHaveBeenCalled();
    const putCall = sendMock.mock.calls.find((call) => {
      const command = call[0] as { input?: { Bucket?: string; Key?: string } };
      return command?.input?.Bucket === "test-bucket-sl";
    });
    expect(putCall).toBeDefined();
    const command = putCall![0] as { input: { Bucket: string; Key: string } };
    expect(command.input.Bucket).toBe("test-bucket-sl");
    expect(command.input.Key).toBe(result.storageKey);
    expect(command.input.Key).toMatch(
      new RegExp(`^sources/${result.sourceId}/paper\\.pdf$`),
    );

    const row = await prisma.source.findUnique({
      where: { id: result.sourceId },
    });
    expect(row?.storageKey).toBe(result.storageKey);

    await prisma.source.delete({ where: { id: result.sourceId } });
  });
});
