/**
 * Step 14 integration: source scope on the chat POST endpoint.
 *
 * Two guarantees are asserted end-to-end through the real route handler:
 *
 *   1. Custom scopes with bogus / hidden / soft-deleted UUIDs return **400**
 *      with a JSON body before any message is persisted.
 *   2. Preset / custom scopes change the args reaching `retrieveContext` (the
 *      retrieval module is spied via `vi.mock` so we can snapshot call args
 *      without touching pgvector).
 *
 * The second test also proves the "Scripture-only vs sermon-only return
 * different top chunk" acceptance criterion by stubbing retrieval per corpus
 * and asserting the resulting `retrievalChunkIds` in the `done` SSE frame.
 */
import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/retrieval", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/retrieval")>("@/lib/retrieval");
  return {
    ...actual,
    retrieveContext: vi.fn(async () => []),
  };
});

// Stub Claude so retrieval-returns-chunks paths never make a network call.
// The generator yields a single delta and returns an empty-usage result so
// `runRagTurn` persists an assistant message without hitting Anthropic.
vi.mock("@/lib/llm/claude", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/llm/claude")>(
      "@/lib/llm/claude",
    );
  return {
    ...actual,
    streamClaudeRagResponse: vi.fn(async function* () {
      yield "stubbed";
      return {
        text: "stubbed",
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: "end_turn" as const,
      };
    }),
  };
});

import { auth } from "@/auth";
import { POST } from "@/app/api/chat/messages/route";
import { retrieveContext } from "@/lib/retrieval";

const prisma = new PrismaClient();
const createdUserIds: string[] = [];
const createdSourceIds: string[] = [];

function buildPostRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createTestUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@scope-test.local`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash("testpassword123", 8),
      role: "user",
    },
  });
  createdUserIds.push(user.id);
  return user;
}

function mockAuthenticatedUser(userId: string, email: string) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: userId, email, name: null, image: null },
    expires: new Date(Date.now() + 60_000).toISOString(),
  });
}

type SseFrame = { event: string; data: unknown };

async function readSseFrames(response: Response): Promise<SseFrame[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffered = "";
  const frames: SseFrame[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffered += decoder.decode(value, { stream: true });
    let separatorIndex = buffered.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const rawFrame = buffered.slice(0, separatorIndex);
      buffered = buffered.slice(separatorIndex + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of rawFrame.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (dataLines.length > 0) {
        frames.push({ event, data: JSON.parse(dataLines.join("\n")) });
      }
      separatorIndex = buffered.indexOf("\n\n");
    }
  }
  return frames;
}

afterAll(async () => {
  if (createdSourceIds.length > 0) {
    await prisma.source.deleteMany({
      where: { id: { in: createdSourceIds } },
    });
  }
  await prisma.$disconnect();
});

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

describe("POST /api/chat/messages with source scope (Step 14)", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
    vi.mocked(retrieveContext).mockReset().mockResolvedValue([]);
  });

  it("rejects custom scope with a bogus UUID before persisting anything", async () => {
    const user = await createTestUser("bogus");
    mockAuthenticatedUser(user.id, user.email);

    const response = await POST(
      buildPostRequest({
        message: "hello",
        sourceScope: {
          mode: "custom",
          selectedSourceIds: ["00000000-0000-4000-8000-000000000000"],
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type") ?? "").toContain("application/json");
    const body = (await response.json()) as {
      error: string;
      unknownIds?: string[];
    };
    expect(body.error).toBeTruthy();
    expect(body.unknownIds).toEqual(["00000000-0000-4000-8000-000000000000"]);

    // Nothing should have been persisted — the validator runs before we enter
    // the SSE path that creates the user message / thread.
    const notebook = await prisma.notebook.findUnique({
      where: { userId: user.id },
    });
    expect(notebook).toBeNull();
    expect(vi.mocked(retrieveContext)).not.toHaveBeenCalled();
  });

  it("rejects malformed scope shapes with 400", async () => {
    const user = await createTestUser("malformed");
    mockAuthenticatedUser(user.id, user.email);

    const response = await POST(
      buildPostRequest({
        message: "hello",
        sourceScope: { mode: "not-a-mode" },
      }),
    );
    expect(response.status).toBe(400);
    expect(vi.mocked(retrieveContext)).not.toHaveBeenCalled();
  });

  it("rejects soft-deleted source ids in custom scope", async () => {
    const user = await createTestUser("deleted");
    mockAuthenticatedUser(user.id, user.email);

    const deletedSource = await prisma.source.create({
      data: {
        type: "markdown",
        corpus: "scripture",
        status: "READY",
        bibleBook: "Deleted",
        storageKey: `sources/${crypto.randomUUID()}/deleted.md`,
        deletedAt: new Date(),
      },
    });
    createdSourceIds.push(deletedSource.id);

    const response = await POST(
      buildPostRequest({
        message: "hello",
        sourceScope: {
          mode: "custom",
          selectedSourceIds: [deletedSource.id],
        },
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { unknownIds?: string[] };
    expect(body.unknownIds).toEqual([deletedSource.id]);
  });

  it("forwards scripture/sermon presets as corpus filters to retrieveContext", async () => {
    const user = await createTestUser("presets");
    mockAuthenticatedUser(user.id, user.email);

    // Per-corpus fake chunks so `retrievalChunkIds` in the `done` SSE frame
    // differs by preset — proves scope changes downstream retrieval.
    const scriptureChunk = fakeRetrievalChunk({
      chunkId: "11111111-1111-4111-8111-000000000001",
      corpus: "scripture",
      title: "Scripture chunk",
    });
    const sermonChunk = fakeRetrievalChunk({
      chunkId: "22222222-2222-4222-8222-000000000002",
      corpus: "sermon",
      title: "Sermon chunk",
    });

    vi.mocked(retrieveContext).mockImplementation(async (params) => {
      if (params.corpus === "scripture") {
        return [scriptureChunk];
      }
      if (params.corpus === "sermon") {
        return [sermonChunk];
      }
      return [];
    });

    const scriptureResponse = await POST(
      buildPostRequest({
        message: "what does the text say",
        sourceScope: { mode: "scripture" },
      }),
    );
    expect(scriptureResponse.status).toBe(200);
    const scriptureFrames = await readSseFrames(scriptureResponse);

    const sermonResponse = await POST(
      buildPostRequest({
        message: "what does the text say",
        sourceScope: { mode: "sermon" },
      }),
    );
    expect(sermonResponse.status).toBe(200);
    const sermonFrames = await readSseFrames(sermonResponse);

    const calls = vi.mocked(retrieveContext).mock.calls;
    // First turn uses scripture; second uses sermon. Corpus quota split (no
    // filter) is absent for both because we always pass a preset here.
    expect(calls[0]![0]).toMatchObject({ corpus: "scripture" });
    expect(calls[0]![0].sourceIds).toBeUndefined();
    expect(calls[1]![0]).toMatchObject({ corpus: "sermon" });
    expect(calls[1]![0].sourceIds).toBeUndefined();

    const scriptureDone = scriptureFrames.find((frame) => frame.event === "done");
    const sermonDone = sermonFrames.find((frame) => frame.event === "done");
    const scriptureIds = (scriptureDone!.data as { retrievalChunkIds: string[] })
      .retrievalChunkIds;
    const sermonIds = (sermonDone!.data as { retrievalChunkIds: string[] })
      .retrievalChunkIds;

    // Scope-driven retrieval: different presets surface different top chunks.
    expect(scriptureIds).toEqual([scriptureChunk.chunkId]);
    expect(sermonIds).toEqual([sermonChunk.chunkId]);
    expect(scriptureIds).not.toEqual(sermonIds);
  });

  it("forwards custom scope as a sourceIds filter when UUIDs are valid", async () => {
    const user = await createTestUser("custom-pass");
    mockAuthenticatedUser(user.id, user.email);

    const readySource = await prisma.source.create({
      data: {
        type: "markdown",
        corpus: "sermon",
        status: "READY",
        sermonCatalogId: "SCOPE-TEST-001",
        storageKey: `sources/${crypto.randomUUID()}/sermon.md`,
      },
    });
    createdSourceIds.push(readySource.id);

    vi.mocked(retrieveContext).mockResolvedValue([]);

    const response = await POST(
      buildPostRequest({
        message: "anything",
        sourceScope: {
          mode: "custom",
          selectedSourceIds: [readySource.id],
        },
      }),
    );
    expect(response.status).toBe(200);
    await readSseFrames(response);

    const [firstCallArgs] = vi.mocked(retrieveContext).mock.calls[0]!;
    expect(firstCallArgs).toMatchObject({ sourceIds: [readySource.id] });
    expect(firstCallArgs.corpus).toBeUndefined();
  });

  it("defaults to all (no filter) when the client omits sourceScope", async () => {
    const user = await createTestUser("default");
    mockAuthenticatedUser(user.id, user.email);
    vi.mocked(retrieveContext).mockResolvedValue([]);

    const response = await POST(buildPostRequest({ message: "hi" }));
    expect(response.status).toBe(200);
    await readSseFrames(response);

    const [firstCallArgs] = vi.mocked(retrieveContext).mock.calls[0]!;
    expect(firstCallArgs.corpus).toBeUndefined();
    expect(firstCallArgs.sourceIds).toBeUndefined();
  });
});

/**
 * Minimal `RetrievedChunk` stub tailored for tests that bypass pgvector. Shape
 * mirrors `src/lib/retrieval/search.ts#RetrievedChunk`.
 */
function fakeRetrievalChunk(overrides: {
  chunkId: string;
  corpus: "scripture" | "sermon" | "other";
  title: string;
}) {
  return {
    chunkId: overrides.chunkId,
    content: `stub content for ${overrides.title}`,
    metadata: {},
    sourceId: "00000000-0000-4000-8000-000000000abc",
    corpus: overrides.corpus,
    title: overrides.title,
    bibleBook: null,
    bibleTranslation: null,
    sermonCatalogId: null,
    storageKey: null,
    filename: null,
    distance: 0.1,
  };
}
