/**
 * Auth-gated workspace API (Step 05). Mocks `auth()`; uses real Prisma for the
 * authenticated case (requires DATABASE_URL and migrations).
 */
import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "@/auth";
import { GET } from "@/app/api/workspace/shell/route";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/workspace/shell", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
  });

  it("returns 401 when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns workspace JSON for an authenticated user with a notebook", async () => {
    const email = `shell-api-${Date.now()}@test.local`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash("testpassword123", 8),
        role: "user",
      },
    });
    const notebook = await prisma.notebook.create({
      data: { userId: user.id, title: "Test notebook" },
    });
    const thread = await prisma.chatThread.create({
      data: { notebookId: notebook.id, title: "Main" },
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

    const response = await GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      notebookId: string;
      threadId: string | null;
    };
    expect(body.notebookId).toBe(notebook.id);
    expect(body.threadId).toBe(thread.id);

    await prisma.user.delete({ where: { id: user.id } });
  });
});
