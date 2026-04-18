/**
 * Step 13: RAG chat with Claude (streaming) and inline citations.
 *
 * Both Anthropic and the retrieval service are mocked so the test stays fast,
 * deterministic, and offline (no `ANTHROPIC_API_KEY` required). Persistence
 * still hits the real Postgres + Prisma — same posture as the other API tests
 * — so we validate the full Route Handler path including DB writes.
 *
 * Definition of done assertions (master spec §5.3, Step 13 #7):
 *   1. With non-empty retrieval, the system prompt handed to Claude contains
 *      the chunk text and labeled citation metadata.
 *   2. With empty retrieval, the persisted assistant message contains the
 *      fixed refusal substring and no fabricated citations leak in.
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
    retrieveContext: vi.fn(),
  };
});

vi.mock("@/lib/llm/claude", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/llm/claude")>("@/lib/llm/claude");
  return {
    ...actual,
    streamClaudeRagResponse: vi.fn(),
  };
});

import { auth } from "@/auth";
import { POST } from "@/app/api/chat/messages/route";
import { retrieveContext, type RetrievedChunk } from "@/lib/retrieval";
import { streamClaudeRagResponse } from "@/lib/llm/claude";
import { REFUSAL_SUBSTRING } from "@/lib/chat/rag-prompt";

const prisma = new PrismaClient();
const createdUserIds: string[] = [];

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(retrieveContext).mockReset();
  vi.mocked(streamClaudeRagResponse).mockReset();
});

async function createTestUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@rag-test.local`;
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

function mockSession(userId: string, email: string) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: userId, email, name: null, image: null },
    expires: new Date(Date.now() + 60_000).toISOString(),
  });
}

function buildPostRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Minimal SSE drain — same wire format the route emits. */
async function readSseFrames(
  response: Response,
): Promise<Array<{ event: string; data: unknown }>> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffered = "";
  const frames: Array<{ event: string; data: unknown }> = [];
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

/**
 * Build a minimal stub `RetrievedChunk` that satisfies the prompt builder
 * without going through the real retrieval pipeline. Only the fields the
 * prompt actually reads are populated; everything else is filled with
 * defensible defaults so a future field addition will surface as a type error.
 */
function buildScriptureChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: overrides.chunkId ?? "chunk-scripture-1",
    content:
      overrides.content ??
      "In the beginning God created the heaven and the earth.",
    metadata: overrides.metadata ?? { chapter: 1, verse: 1 },
    sourceId: overrides.sourceId ?? "source-genesis",
    corpus: overrides.corpus ?? "scripture",
    title: overrides.title ?? "Genesis (KJV)",
    bibleBook: overrides.bibleBook ?? "Genesis",
    bibleTranslation: overrides.bibleTranslation ?? "KJV",
    sermonCatalogId: overrides.sermonCatalogId ?? null,
    storageKey: overrides.storageKey ?? "scripture/genesis.md",
    filename: overrides.filename ?? "genesis",
    distance: overrides.distance ?? 0.05,
  };
}

/**
 * Returns an async generator that yields the supplied text deltas in order,
 * then resolves to a `ClaudeStreamResult`. Mirrors the contract of the real
 * `streamClaudeRagResponse` so the route handler is exercised end-to-end.
 */
function buildClaudeStubStream(deltas: string[]) {
  return async function* stub() {
    for (const delta of deltas) {
      yield delta;
    }
    return {
      text: deltas.join(""),
      usage: { inputTokens: 42, outputTokens: deltas.join("").length },
      stopReason: "end_turn",
    };
  };
}

describe("RAG chat streaming", () => {
  it("includes retrieved chunk text and labels in the system prompt sent to Claude", async () => {
    const user = await createTestUser("with-context");
    mockSession(user.id, user.email);

    const scriptureChunk = buildScriptureChunk({
      chunkId: "chunk-genesis-1-1",
      content: "In the beginning God created the heaven and the earth.",
    });
    const sermonChunk = buildScriptureChunk({
      chunkId: "chunk-sermon-7",
      content: "The eternal Word is the foundation of every doctrine.",
      corpus: "sermon",
      title: "The Eternal Word",
      bibleBook: null,
      bibleTranslation: null,
      sermonCatalogId: "63-0728",
      storageKey: "sermons/63-0728.md",
      filename: "63-0728",
      distance: 0.12,
    });
    vi.mocked(retrieveContext).mockResolvedValue([scriptureChunk, sermonChunk]);

    const claudeDeltas = ["In the beginning ", "[C1] ", "the Word was God [C2]."];
    vi.mocked(streamClaudeRagResponse).mockImplementation(
      buildClaudeStubStream(claudeDeltas),
    );

    const response = await POST(
      buildPostRequest({ message: "What is the Word?" }),
    );
    expect(response.status).toBe(200);
    const frames = await readSseFrames(response);

    const deltaTexts = frames
      .filter((frame) => frame.event === "delta")
      .map((frame) => (frame.data as { text: string }).text);
    expect(deltaTexts).toEqual(claudeDeltas);

    const doneFrame = frames.find((frame) => frame.event === "done");
    expect(doneFrame).toBeDefined();
    const doneData = doneFrame!.data as {
      message: { id: string; role: string; content: string };
      retrievalChunkIds: string[];
      usedRefusal: boolean;
    };
    expect(doneData.usedRefusal).toBe(false);
    expect(doneData.retrievalChunkIds).toEqual([
      scriptureChunk.chunkId,
      sermonChunk.chunkId,
    ]);
    expect(doneData.message.content).toBe(claudeDeltas.join(""));

    // The prompt fed to Claude must include both chunk bodies and stable labels.
    expect(streamClaudeRagResponse).toHaveBeenCalledTimes(1);
    const [{ system, messages }] = vi.mocked(streamClaudeRagResponse).mock.calls[0];
    expect(system).toContain("[C1]");
    expect(system).toContain("[C2]");
    expect(system).toContain(scriptureChunk.content);
    expect(system).toContain(sermonChunk.content);
    expect(system).toContain("Genesis 1:1 (KJV)");
    expect(system).toContain("sermon 63-0728");
    // The user's question must be the final message in chronological order.
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "What is the Word?",
    });

    const persistedAssistant = await prisma.message.findFirst({
      where: { id: doneData.message.id },
      select: { content: true, role: true, retrievalDebug: true },
    });
    expect(persistedAssistant?.role).toBe("assistant");
    expect(persistedAssistant?.content).toBe(claudeDeltas.join(""));
    // `retrieval_debug` should record the chunk ids for later admin inspection
    // (master spec §7); it must not leak chunk content into the Message row.
    const debug = persistedAssistant?.retrievalDebug as {
      chunkIds: string[];
      refusal: boolean;
    } | null;
    expect(debug?.chunkIds).toEqual([scriptureChunk.chunkId, sermonChunk.chunkId]);
    expect(debug?.refusal).toBe(false);
  });

  it("emits the fixed refusal substring without calling Claude when retrieval is empty", async () => {
    const user = await createTestUser("refusal");
    mockSession(user.id, user.email);

    vi.mocked(retrieveContext).mockResolvedValue([]);

    const response = await POST(
      buildPostRequest({ message: "Off-topic question with no matches" }),
    );
    expect(response.status).toBe(200);
    const frames = await readSseFrames(response);

    // Step 13 #7: with empty retrieval, the assistant content must include the
    // refusal substring and we must NOT have called Claude (so there is no way
    // for the model to fabricate a citation).
    expect(streamClaudeRagResponse).not.toHaveBeenCalled();

    const doneFrame = frames.find((frame) => frame.event === "done");
    const doneData = doneFrame!.data as {
      message: { id: string; content: string };
      usedRefusal: boolean;
      retrievalChunkIds: string[];
    };
    expect(doneData.usedRefusal).toBe(true);
    expect(doneData.retrievalChunkIds).toEqual([]);
    expect(doneData.message.content).toContain(REFUSAL_SUBSTRING);
    // No bracketed `[C…]` labels should appear since there were no chunks.
    expect(doneData.message.content).not.toMatch(/\[C\d+\]/);

    // Persisted row matches the streamed content exactly — no drift.
    const persistedAssistant = await prisma.message.findFirst({
      where: { id: doneData.message.id },
      select: { content: true, role: true, retrievalDebug: true },
    });
    expect(persistedAssistant?.content).toContain(REFUSAL_SUBSTRING);
    expect(persistedAssistant?.role).toBe("assistant");
    const debug = persistedAssistant?.retrievalDebug as { refusal: boolean } | null;
    expect(debug?.refusal).toBe(true);
  });
});
