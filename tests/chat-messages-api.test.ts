/**
 * Chat messages API (Step 11; master spec §5.1, §7, §15 #4). Mocks `auth()`; uses
 * real Prisma so the UNIQUE(notebook_id) chat_threads index is exercised for real.
 * Requires DATABASE_URL and migrations applied (same setup as the other API tests).
 */
import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "@/auth";
import { GET, POST } from "@/app/api/chat/messages/route";

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

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  // Delete in a single pass — ON DELETE CASCADE removes notebooks, threads, and
  // messages so tests stay isolated even when one fails mid-write.
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

describe("chat messages API", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
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

  it("rejects POST with empty content", async () => {
    const user = await createTestUser("empty");
    mockAuthenticatedUser(user.id, user.email);

    const response = await POST(buildPostRequest({ content: "   " }));
    expect(response.status).toBe(400);
  });

  it("persists three messages and returns them in chronological order", async () => {
    const user = await createTestUser("round-trip");
    mockAuthenticatedUser(user.id, user.email);

    const contents = ["first message", "second message", "third message"];
    for (const content of contents) {
      const response = await POST(buildPostRequest({ content }));
      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        threadId: string;
        message: { id: string; role: string; content: string; createdAt: string };
      };
      expect(body.message.role).toBe("user");
      expect(body.message.content).toBe(content);
    }

    const getResponse = await GET();
    expect(getResponse.status).toBe(200);
    const body = (await getResponse.json()) as {
      threadId: string;
      notebookId: string;
      messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
    };

    expect(body.messages).toHaveLength(3);
    expect(body.messages.map((message) => message.content)).toEqual(contents);
    // Timestamps must be non-decreasing so the client can render oldest-first
    // without sorting and Step 13's streamed assistant reply lands at the tail.
    const timestamps = body.messages.map((message) => new Date(message.createdAt).getTime());
    for (let index = 1; index < timestamps.length; index += 1) {
      expect(timestamps[index]).toBeGreaterThanOrEqual(timestamps[index - 1]);
    }

    // Cross-check with the database to catch any serialization drift between the
    // route response and the actual persisted rows.
    const persisted = await prisma.message.findMany({
      where: { threadId: body.threadId },
      orderBy: { createdAt: "asc" },
      select: { content: true, role: true },
    });
    expect(persisted.map((message) => message.content)).toEqual(contents);
    expect(persisted.every((message) => message.role === "user")).toBe(true);
  });

  it("lazily creates the notebook and thread on the first POST", async () => {
    const user = await createTestUser("lazy");
    mockAuthenticatedUser(user.id, user.email);

    // Simulate a user who never triggered the sign-in workspace bootstrap.
    const beforeNotebook = await prisma.notebook.findUnique({ where: { userId: user.id } });
    expect(beforeNotebook).toBeNull();

    const response = await POST(buildPostRequest({ content: "hello world" }));
    expect(response.status).toBe(201);

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

    // Drive the API to create notebook + thread + one message.
    const first = await POST(buildPostRequest({ content: "seed" }));
    expect(first.status).toBe(201);

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
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { threadId: string };
    expect(secondBody.threadId).toBe(notebook!.thread!.id);

    const threadCount = await prisma.chatThread.count({
      where: { notebookId: notebook!.id },
    });
    expect(threadCount).toBe(1);
  });
});
