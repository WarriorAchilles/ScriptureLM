/**
 * Step 15: Grounded summarization API + orchestrator integration tests.
 *
 * Pattern mirrors the Step 14 chat-scope test:
 *  - Real Postgres for persistence (Source + Chunk rows seeded per test).
 *  - Claude mocked via `vi.mock("@/lib/llm/claude")` so prompts are asserted
 *    without any network I/O and `ANTHROPIC_API_KEY` is not required.
 *
 * Covers the Step 15 Definition-of-Done:
 *   1. `not ready` source → 409 on /api/summaries/source.
 *   2. Library call with two source ids includes both source titles in the
 *      prompt handed to Claude.
 *   3. Changing `length` measurably changes the Claude invocation (different
 *      `maxTokens` budget), so the user can see shorter vs longer output.
 */
import "dotenv/config";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/llm/claude", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/llm/claude")>(
      "@/lib/llm/claude",
    );
  return {
    ...actual,
    callClaudeCompletion: vi.fn(),
  };
});

import { auth } from "@/auth";
import { POST as postSourceSummary } from "@/app/api/summaries/source/route";
import { POST as postLibrarySummary } from "@/app/api/summaries/library/route";
import { callClaudeCompletion } from "@/lib/llm/claude";
import { ATTRIBUTION_PREFIX } from "@/lib/summaries/summary-prompt";

const prisma = new PrismaClient();
const createdUserIds: string[] = [];
const createdSourceIds: string[] = [];

function buildPostRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createTestUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@summary-test.local`;
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

/**
 * Helper to seed a fully-indexed source with deterministic chunk content.
 * Returns the inserted source id + the chunks that will surface in the prompt
 * (useful for assertions).
 */
async function seedReadySource(params: {
  corpus: "scripture" | "sermon" | "other";
  title: string;
  chunkTexts: string[];
}): Promise<{ sourceId: string; title: string }> {
  const storageKey = `sources/${crypto.randomUUID()}/summary-test.md`;
  const source = await prisma.source.create({
    data: {
      type: "markdown",
      corpus: params.corpus,
      status: "READY",
      bibleBook: params.corpus === "scripture" ? params.title : null,
      sermonCatalogId: params.corpus === "sermon" ? params.title : null,
      storageKey,
    },
  });
  createdSourceIds.push(source.id);

  await prisma.chunk.createMany({
    data: params.chunkTexts.map((content, index) => ({
      sourceId: source.id,
      content,
      metadata: { chunk_index: index, corpus: params.corpus },
    })),
  });

  return { sourceId: source.id, title: params.title };
}

/** Stub Claude result with a predictable word count for length assertions. */
function buildClaudeResult(text: string) {
  return {
    text,
    usage: { inputTokens: 100, outputTokens: text.split(/\s+/).length },
    stopReason: "end_turn" as const,
  };
}

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(callClaudeCompletion).mockReset();
});

afterEach(async () => {
  if (createdSourceIds.length > 0) {
    // Chunks cascade via `onDelete: Cascade`, so deleting the source is enough.
    await prisma.source.deleteMany({
      where: { id: { in: createdSourceIds } },
    });
    createdSourceIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/summaries/source (Step 15)", () => {
  it("returns 409 when the source is not READY", async () => {
    const user = await createTestUser("not-ready");
    mockAuthenticatedUser(user.id, user.email);

    // PROCESSING is the realistic mid-pipeline state that should still block
    // summarization per Step 15 #1. Same contract applies to PENDING / FAILED.
    const processingSource = await prisma.source.create({
      data: {
        type: "markdown",
        corpus: "scripture",
        status: "PROCESSING",
        bibleBook: "Genesis",
        storageKey: `sources/${crypto.randomUUID()}/genesis.md`,
      },
    });
    createdSourceIds.push(processingSource.id);

    const response = await postSourceSummary(
      buildPostRequest("/api/summaries/source", {
        sourceId: processingSource.id,
        length: "short",
        audience: "plain",
      }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: string;
      sourceId: string;
      status: string;
    };
    expect(body.sourceId).toBe(processingSource.id);
    expect(body.status).toBe("PROCESSING");
    expect(body.error).toMatch(/not ready/i);

    // Critical: Claude must NOT have been invoked when we refuse up front.
    expect(vi.mocked(callClaudeCompletion)).not.toHaveBeenCalled();
  });

  it("returns 404 when the source does not exist", async () => {
    const user = await createTestUser("missing");
    mockAuthenticatedUser(user.id, user.email);

    const response = await postSourceSummary(
      buildPostRequest("/api/summaries/source", {
        sourceId: "00000000-0000-4000-8000-000000000000",
        length: "short",
        audience: "plain",
      }),
    );
    expect(response.status).toBe(404);
    expect(vi.mocked(callClaudeCompletion)).not.toHaveBeenCalled();
  });

  it("generates a per-source summary that names the source in the prompt and response", async () => {
    const user = await createTestUser("source-ok");
    mockAuthenticatedUser(user.id, user.email);

    const seeded = await seedReadySource({
      corpus: "scripture",
      title: "Genesis",
      chunkTexts: [
        "In the beginning God created the heaven and the earth.",
        "And the earth was without form, and void; and darkness was upon the face of the deep.",
      ],
    });

    const stubbedText = `A short overview of Genesis.\n\n${ATTRIBUTION_PREFIX} Genesis`;
    vi.mocked(callClaudeCompletion).mockResolvedValue(buildClaudeResult(stubbedText));

    const response = await postSourceSummary(
      buildPostRequest("/api/summaries/source", {
        sourceId: seeded.sourceId,
        length: "short",
        audience: "plain",
        focus: "the act of creation",
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      content: string;
      sources: { id: string; title: string }[];
    };
    expect(body.sources).toEqual([{ id: seeded.sourceId, title: "Genesis" }]);
    expect(body.content).toBe(stubbedText);

    // Prompt assertions: chunk text AND the source title must reach Claude.
    expect(callClaudeCompletion).toHaveBeenCalledTimes(1);
    const [claudeParams] = vi.mocked(callClaudeCompletion).mock.calls[0]!;
    expect(claudeParams.system).toContain(ATTRIBUTION_PREFIX);
    expect(claudeParams.system).toContain("Genesis");
    expect(claudeParams.system).toContain("the act of creation");
    const userMessage = claudeParams.messages[0]!;
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toContain("Genesis");
    expect(userMessage.content).toContain(
      "In the beginning God created the heaven and the earth.",
    );
  });
});

describe("POST /api/summaries/library (Step 15)", () => {
  it("includes BOTH source titles in the prompt for a two-id library call", async () => {
    const user = await createTestUser("library-two");
    mockAuthenticatedUser(user.id, user.email);

    const genesis = await seedReadySource({
      corpus: "scripture",
      title: "Genesis",
      chunkTexts: ["In the beginning God created the heaven and the earth."],
    });
    const sermon = await seedReadySource({
      corpus: "sermon",
      title: "63-0728",
      chunkTexts: ["The eternal Word is the foundation of every doctrine."],
    });

    const stubbedText =
      `A brief covering the two sources. ${ATTRIBUTION_PREFIX} Genesis, 63-0728`;
    vi.mocked(callClaudeCompletion).mockResolvedValue(buildClaudeResult(stubbedText));

    const response = await postLibrarySummary(
      buildPostRequest("/api/summaries/library", {
        length: "long",
        audience: "technical",
        sourceIds: [genesis.sourceId, sermon.sourceId],
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      content: string;
      sources: { id: string; title: string }[];
    };
    expect(body.content).toBe(stubbedText);
    // Both sources must be named in the response attribution list.
    expect(body.sources.map((s) => s.title).sort()).toEqual(
      ["63-0728", "Genesis"].sort(),
    );

    // Both titles must appear in the SYSTEM prompt (so the model is instructed
    // to attribute to each) AND in the user message (so it has the source text
    // to ground the claims in).
    expect(callClaudeCompletion).toHaveBeenCalledTimes(1);
    const [claudeParams] = vi.mocked(callClaudeCompletion).mock.calls[0]!;
    expect(claudeParams.system).toContain("Genesis");
    expect(claudeParams.system).toContain("63-0728");
    const userContent = claudeParams.messages[0]!.content as string;
    expect(userContent).toContain("Genesis");
    expect(userContent).toContain("63-0728");
    expect(userContent).toContain(
      "In the beginning God created the heaven and the earth.",
    );
    expect(userContent).toContain(
      "The eternal Word is the foundation of every doctrine.",
    );
  });

  it("returns 409 when the requested scope resolves to zero READY sources", async () => {
    const user = await createTestUser("library-empty");
    mockAuthenticatedUser(user.id, user.email);

    // Seed a PENDING source so the `custom` id is valid for the scope
    // validator but contributes nothing to the library context.
    const pending = await prisma.source.create({
      data: {
        type: "markdown",
        corpus: "scripture",
        status: "PENDING",
        bibleBook: "Exodus",
        storageKey: `sources/${crypto.randomUUID()}/pending.md`,
      },
    });
    createdSourceIds.push(pending.id);

    const response = await postLibrarySummary(
      buildPostRequest("/api/summaries/library", {
        length: "short",
        audience: "plain",
        sourceIds: [pending.id],
      }),
    );
    expect(response.status).toBe(409);
    expect(vi.mocked(callClaudeCompletion)).not.toHaveBeenCalled();
  });

  it("passes a larger maxTokens budget for `long` than for `short`", async () => {
    // Step 15 DoD: "changing length yields visibly different length (agent
    // can add trivial assertion on word count in mock test)." Asserting on
    // the `maxTokens` argument is the cleanest deterministic proxy for that
    // in a mocked environment: the model's actual word count depends on the
    // mock, so we instead verify the knob that controls it changed.
    const user = await createTestUser("library-length");
    mockAuthenticatedUser(user.id, user.email);

    await seedReadySource({
      corpus: "scripture",
      title: "Exodus",
      chunkTexts: [
        "And the LORD said unto Moses, Go in unto Pharaoh, and say unto him, Thus saith the LORD, Let my people go, that they may serve me.",
      ],
    });

    // Stub Claude to echo back a word count proportional to maxTokens so we
    // get end-to-end evidence the knob affected the response size the UI
    // would render.
    vi.mocked(callClaudeCompletion).mockImplementation(async (params) => {
      const wordsPerToken = 0.5;
      const requestedTokens = params.maxTokens ?? 0;
      const text = Array.from(
        { length: Math.floor(requestedTokens * wordsPerToken) },
        (_, index) => `word${index}`,
      ).join(" ");
      return buildClaudeResult(text);
    });

    const shortResponse = await postLibrarySummary(
      buildPostRequest("/api/summaries/library", {
        length: "short",
        audience: "plain",
        corpus: "scripture",
      }),
    );
    expect(shortResponse.status).toBe(200);
    const shortBody = (await shortResponse.json()) as { content: string };

    const longResponse = await postLibrarySummary(
      buildPostRequest("/api/summaries/library", {
        length: "long",
        audience: "plain",
        corpus: "scripture",
      }),
    );
    expect(longResponse.status).toBe(200);
    const longBody = (await longResponse.json()) as { content: string };

    const calls = vi.mocked(callClaudeCompletion).mock.calls;
    expect(calls.length).toBe(2);
    const shortMaxTokens = calls[0]![0].maxTokens ?? 0;
    const longMaxTokens = calls[1]![0].maxTokens ?? 0;
    expect(longMaxTokens).toBeGreaterThan(shortMaxTokens);

    // The stub's output length is proportional to maxTokens, so the long call
    // must produce more words than the short one — matching what a user
    // would see on the UI.
    const shortWords = shortBody.content.trim().split(/\s+/).length;
    const longWords = longBody.content.trim().split(/\s+/).length;
    expect(longWords).toBeGreaterThan(shortWords);
  });

  it("rejects malformed summary params with 400", async () => {
    const user = await createTestUser("library-bad");
    mockAuthenticatedUser(user.id, user.email);

    const response = await postLibrarySummary(
      buildPostRequest("/api/summaries/library", {
        length: "enormous",
        audience: "plain",
      }),
    );
    expect(response.status).toBe(400);
    expect(vi.mocked(callClaudeCompletion)).not.toHaveBeenCalled();
  });
});
