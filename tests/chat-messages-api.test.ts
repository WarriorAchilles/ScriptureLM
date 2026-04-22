/**
 * Chat messages API: persistence + thread invariants (Step 11) on top of the
 * Step 13 SSE streaming path.
 *
 * The success path now returns `text/event-stream` instead of a JSON ack, so
 * tests parse the SSE frames inline. We mock retrieval to return `[]` (refusal
 * path) and Claude streaming to stay a no-op, which lets the test focus on the
 * step 11 invariants:
 *   - lazy notebook + thread creation
 *   - chronological persistence of user messages
 *   - the UNIQUE(notebook_id) chat_threads index prevents a second thread
 *
 * Mocks are declared with `vi.mock` so the route handler imports the stubs.
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

import { auth } from "@/auth";
import { DELETE, GET, POST } from "@/app/api/chat/messages/route";
import { retrieveContext } from "@/lib/retrieval";
import { REFUSAL_SUBSTRING } from "@/lib/chat/rag-prompt";

const prisma = new PrismaClient();
const createdUserIds: string[] = [];

function buildPostRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createTestUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@chat-test.local`;
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

/**
 * Drains the SSE stream into structured frames for assertion. The route uses
 * the standard `event:` / `data:` syntax from `buildSseStream` in route.ts.
 */
async function readSseFrames(response: Response): Promise<SseFrame[]> {
  expect(response.headers.get("Content-Type") ?? "").toContain(
    "text/event-stream",
  );
  expect(response.body).not.toBeNull();
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
  await prisma.$disconnect();
});

afterEach(async () => {
  // Delete in a single pass — ON DELETE CASCADE removes notebooks, threads,
  // and messages so tests stay isolated even when one fails mid-write.
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

describe("chat messages API", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
    vi.mocked(retrieveContext).mockReset().mockResolvedValue([]);
  });

  it("returns 401 on GET without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns 401 on POST without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const response = await POST(buildPostRequest({ content: "hello" }));
    expect(response.status).toBe(401);
  });

  it("returns 401 on DELETE without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const response = await DELETE();
    expect(response.status).toBe(401);
  });

  it("DELETE removes all messages for the thread", async () => {
    const user = await createTestUser("clear");
    mockAuthenticatedUser(user.id, user.email);

    const postResponse = await POST(buildPostRequest({ content: "to be cleared" }));
    expect(postResponse.status).toBe(200);
    await readSseFrames(postResponse);

    const beforeGet = await GET();
    expect(beforeGet.status).toBe(200);
    const beforeBody = (await beforeGet.json()) as { messages: unknown[] };
    expect(beforeBody.messages.length).toBeGreaterThan(0);

    const deleteResponse = await DELETE();
    expect(deleteResponse.status).toBe(200);
    const deleteBody = (await deleteResponse.json()) as {
      ok: boolean;
      deletedCount: number;
    };
    expect(deleteBody.ok).toBe(true);
    expect(deleteBody.deletedCount).toBeGreaterThan(0);

    const afterGet = await GET();
    expect(afterGet.status).toBe(200);
    const afterBody = (await afterGet.json()) as { messages: unknown[] };
    expect(afterBody.messages).toHaveLength(0);
  });

  it("rejects POST with empty content", async () => {
    const user = await createTestUser("empty");
    mockAuthenticatedUser(user.id, user.email);

    const response = await POST(buildPostRequest({ content: "   " }));
    expect(response.status).toBe(400);
  });

  it("rejects POST with invalid responseLength", async () => {
    const user = await createTestUser("bad-length");
    mockAuthenticatedUser(user.id, user.email);

    const response = await POST(
      buildPostRequest({ content: "hello", responseLength: "xlarge" }),
    );
    expect(response.status).toBe(400);
  });

  it("persists three messages and returns them in chronological order", async () => {
    const user = await createTestUser("round-trip");
    mockAuthenticatedUser(user.id, user.email);

    const contents = ["first message", "second message", "third message"];
    for (const content of contents) {
      const response = await POST(buildPostRequest({ content }));
      expect(response.status).toBe(200);
      const frames = await readSseFrames(response);
      const userFrame = frames.find((frame) => frame.event === "user_message");
      const doneFrame = frames.find((frame) => frame.event === "done");
      expect(userFrame).toBeDefined();
      expect(doneFrame).toBeDefined();
      expect((userFrame!.data as { message: { content: string } }).message.content).toBe(
        content,
      );
    }

    const getResponse = await GET();
    expect(getResponse.status).toBe(200);
    const body = (await getResponse.json()) as {
      threadId: string;
      notebookId: string;
      messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
    };

    // 3 user + 3 assistant (refusal) messages = 6 rows persisted.
    expect(body.messages).toHaveLength(6);
    const userMessages = body.messages.filter((message) => message.role === "user");
    expect(userMessages.map((message) => message.content)).toEqual(contents);
    // Assistant rows always carry the refusal text since retrieval returns [].
    const assistantMessages = body.messages.filter(
      (message) => message.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(3);
    for (const assistant of assistantMessages) {
      expect(assistant.content).toContain(REFUSAL_SUBSTRING);
    }

    // Timestamps must be non-decreasing so the client renders oldest-first
    // without sorting.
    const timestamps = body.messages.map((message) => new Date(message.createdAt).getTime());
    for (let index = 1; index < timestamps.length; index += 1) {
      expect(timestamps[index]).toBeGreaterThanOrEqual(timestamps[index - 1]);
    }

    // Cross-check with the database to catch serialization drift between the
    // route response and the persisted rows.
    const persisted = await prisma.message.findMany({
      where: { threadId: body.threadId },
      orderBy: { createdAt: "asc" },
      select: { content: true, role: true },
    });
    expect(persisted.filter((m) => m.role === "user").map((m) => m.content)).toEqual(
      contents,
    );
  });

  it("lazily creates the notebook and thread on the first POST", async () => {
    const user = await createTestUser("lazy");
    mockAuthenticatedUser(user.id, user.email);

    const beforeNotebook = await prisma.notebook.findUnique({ where: { userId: user.id } });
    expect(beforeNotebook).toBeNull();

    const response = await POST(buildPostRequest({ content: "hello world" }));
    expect(response.status).toBe(200);
    await readSseFrames(response);

    const notebook = await prisma.notebook.findUnique({
      where: { userId: user.id },
      include: { thread: true },
    });
    expect(notebook).not.toBeNull();
    expect(notebook?.thread).not.toBeNull();
  });

  it("never creates a second thread for the same notebook (DB-enforced)", async () => {
    const user = await createTestUser("uniq");
    mockAuthenticatedUser(user.id, user.email);

    const first = await POST(buildPostRequest({ content: "seed" }));
    expect(first.status).toBe(200);
    await readSseFrames(first);

    const notebook = await prisma.notebook.findUnique({
      where: { userId: user.id },
      include: { thread: true },
    });
    expect(notebook?.thread).not.toBeNull();

    // Direct DB insert must fail with P2002 — this is the guarantee the API
    // relies on (single UNIQUE(notebook_id) index on chat_threads).
    await expect(
      prisma.chatThread.create({
        data: { notebookId: notebook!.id, title: "Second" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    // Subsequent API calls keep reusing the existing thread.
    const second = await POST(buildPostRequest({ content: "follow-up" }));
    expect(second.status).toBe(200);
    const secondFrames = await readSseFrames(second);
    const secondUserFrame = secondFrames.find(
      (frame) => frame.event === "user_message",
    );
    expect((secondUserFrame!.data as { threadId: string }).threadId).toBe(
      notebook!.thread!.id,
    );

    const threadCount = await prisma.chatThread.count({
      where: { notebookId: notebook!.id },
    });
    expect(threadCount).toBe(1);
  });
});
