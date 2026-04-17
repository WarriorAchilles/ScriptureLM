/**
 * Read-only source catalog API (Step 10). Mocks `auth()`; uses real Prisma for the
 * authenticated case (requires DATABASE_URL and migrations applied).
 */
import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "@/auth";
import { GET } from "@/app/api/sources/route";
import {
  deriveSourceTitle,
  encodeCatalogCursor,
  decodeCatalogCursor,
  clampListLimit,
} from "@/lib/sources/list-catalog";

const prisma = new PrismaClient();

function buildRequest(searchParams: Record<string, string> = {}): Request {
  const url = new URL("http://localhost/api/sources");
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString());
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("deriveSourceTitle", () => {
  it("formats scripture rows with translation in parentheses", () => {
    expect(
      deriveSourceTitle({
        corpus: "scripture",
        bibleBook: "Genesis",
        bibleTranslation: "KJV",
        sermonCatalogId: null,
        storageKey: null,
      }),
    ).toBe("Genesis (KJV)");
  });

  it("falls back to sermon catalog id for sermons", () => {
    expect(
      deriveSourceTitle({
        corpus: "sermon",
        bibleBook: null,
        bibleTranslation: null,
        sermonCatalogId: "60-0515E",
        storageKey: "sources/abc/file.pdf",
      }),
    ).toBe("60-0515E");
  });

  it("derives a friendly name from storage key when metadata is absent", () => {
    expect(
      deriveSourceTitle({
        corpus: "other",
        bibleBook: null,
        bibleTranslation: null,
        sermonCatalogId: null,
        storageKey: "sources/abc/Seven_Church_Ages-VGR.md",
      }),
    ).toBe("Seven Church Ages VGR");
  });
});

describe("cursor helpers", () => {
  it("round-trips the cursor payload", () => {
    const payload = {
      updatedAt: "2026-04-17T10:00:00.000Z",
      id: "11111111-1111-1111-1111-111111111111",
    };
    const encoded = encodeCatalogCursor(payload);
    expect(decodeCatalogCursor(encoded)).toEqual(payload);
  });

  it("rejects malformed cursors", () => {
    expect(decodeCatalogCursor("not-base64!!")).toBeNull();
    expect(decodeCatalogCursor(null)).toBeNull();
    expect(decodeCatalogCursor("")).toBeNull();
  });

  it("clamps limit to sensible bounds", () => {
    expect(clampListLimit(undefined)).toBe(50);
    expect(clampListLimit(0)).toBe(50);
    expect(clampListLimit(-10)).toBe(50);
    expect(clampListLimit(10)).toBe(10);
    expect(clampListLimit(9999)).toBe(200);
  });
});

describe("GET /api/sources", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
  });

  it("returns 401 when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const response = await GET(buildRequest());

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns the expected JSON shape for an authenticated user", async () => {
    const email = `sources-api-${Date.now()}@test.local`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash("testpassword123", 8),
        role: "user",
      },
    });

    // Seed a ready scripture row and a failed sermon row so we can assert both
    // the success path and the error-surfacing behavior required by §5.2.
    const readyScripture = await prisma.source.create({
      data: {
        type: "markdown",
        corpus: "scripture",
        status: "READY",
        bibleBook: "John",
        bibleTranslation: "KJV",
        storageKey: `sources/${crypto.randomUUID()}/john.md`,
      },
    });
    const failedSermon = await prisma.source.create({
      data: {
        type: "pdf",
        corpus: "sermon",
        status: "FAILED",
        errorMessage: "PDF extraction failed: stream ended before EOF",
        sermonCatalogId: "TEST-SERMON-001",
        storageKey: `sources/${crypto.randomUUID()}/sermon.pdf`,
      },
    });
    // Soft-deleted rows must NOT appear in the read-only catalog (§5.2).
    const hiddenSource = await prisma.source.create({
      data: {
        type: "text",
        corpus: "other",
        status: "READY",
        deletedAt: new Date(),
        storageKey: `sources/${crypto.randomUUID()}/hidden.txt`,
      },
    });

    vi.mocked(auth).mockResolvedValue({
      user: {
        id: user.id,
        email: user.email,
        name: null,
        image: null,
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    });

    try {
      const response = await GET(buildRequest({ limit: "100" }));
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        items: Array<{
          id: string;
          title: string;
          corpus: string;
          status: string;
          errorMessage: string | null;
          updatedAt: string;
        }>;
        nextCursor: string | null;
        limit: number;
      };

      expect(body.limit).toBe(100);
      expect(Array.isArray(body.items)).toBe(true);

      const ids = body.items.map((item) => item.id);
      expect(ids).toContain(readyScripture.id);
      expect(ids).toContain(failedSermon.id);
      expect(ids).not.toContain(hiddenSource.id);

      const scriptureRow = body.items.find((item) => item.id === readyScripture.id);
      expect(scriptureRow?.title).toBe("John (KJV)");
      expect(scriptureRow?.status).toBe("READY");
      expect(scriptureRow?.errorMessage).toBeNull();

      const sermonRow = body.items.find((item) => item.id === failedSermon.id);
      expect(sermonRow?.title).toBe("TEST-SERMON-001");
      expect(sermonRow?.status).toBe("FAILED");
      expect(sermonRow?.errorMessage).toBe(
        "PDF extraction failed: stream ended before EOF",
      );
    } finally {
      await prisma.source.deleteMany({
        where: { id: { in: [readyScripture.id, failedSermon.id, hiddenSource.id] } },
      });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
