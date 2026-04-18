import prisma from "@/lib/prisma";
import type { Message, MessageRole, Prisma } from "@prisma/client";

/**
 * Persistence for the signed-in user's single chat thread (Step 11; master spec §5.1, §7, §15 #4).
 *
 * v1 invariant: exactly one Notebook per user and one ChatThread per notebook. The
 * `UNIQUE(user_id)` / `UNIQUE(notebook_id)` indexes in Prisma (see
 * `prisma/schema.prisma`) make a second thread structurally impossible — any attempt
 * surfaces as Prisma error `P2002`. These helpers use `upsert` so they are safe to
 * call concurrently or on every POST (idempotent).
 */

export type ChatMessageSummary = {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
};

export type ChatThreadState = {
  threadId: string;
  notebookId: string;
  messages: ChatMessageSummary[];
};

const DEFAULT_NOTEBOOK_TITLE = "My notebook";
const DEFAULT_THREAD_TITLE = "Main";

/**
 * Returns the `{ notebookId, threadId }` for the given user, creating missing rows
 * atomically. Aligns with Step 05's `ensureDefaultWorkspaceForUser` but re-runs on
 * every chat call so a user who never hit the sign-in event (e.g. fixture-seeded)
 * still lands in a consistent state.
 */
export async function ensureUserThread(
  userId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ notebookId: string; threadId: string }> {
  const notebook = await client.notebook.upsert({
    where: { userId },
    create: { userId, title: DEFAULT_NOTEBOOK_TITLE },
    update: {},
    select: { id: true },
  });
  const thread = await client.chatThread.upsert({
    where: { notebookId: notebook.id },
    create: { notebookId: notebook.id, title: DEFAULT_THREAD_TITLE },
    update: {},
    select: { id: true },
  });
  return { notebookId: notebook.id, threadId: thread.id };
}

/**
 * Returns messages in chronological order (oldest first) so the chat UI can append
 * the streamed assistant reply from Step 13 without reversing the array.
 */
export async function listThreadMessages(userId: string): Promise<ChatThreadState> {
  const { notebookId, threadId } = await ensureUserThread(userId);
  const messages = await prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return {
    notebookId,
    threadId,
    messages: messages.map(serializeMessage),
  };
}

/** Deletes all messages in the signed-in user's single chat thread. */
export async function clearThreadMessages(userId: string): Promise<{ deletedCount: number }> {
  const { threadId } = await ensureUserThread(userId);
  const result = await prisma.message.deleteMany({ where: { threadId } });
  return { deletedCount: result.count };
}

/**
 * Persists a user message, lazily creating the notebook + thread in the same
 * transaction per Step 11 instruction #7. Returns the created row and the thread
 * id so callers can ack immediately (Step 13 will extend this path to kick off
 * the streamed assistant reply — keeping a single evolving endpoint).
 */
export async function appendUserMessage(
  userId: string,
  content: string,
): Promise<{ threadId: string; message: ChatMessageSummary }> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new EmptyMessageError();
  }

  const { threadId, message } = await prisma.$transaction(async (transaction) => {
    const { threadId: resolvedThreadId } = await ensureUserThread(userId, transaction);
    const created = await transaction.message.create({
      data: {
        threadId: resolvedThreadId,
        role: "user",
        content: trimmed,
      },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return { threadId: resolvedThreadId, message: created };
  });

  return { threadId, message: serializeMessage(message) };
}

export class EmptyMessageError extends Error {
  constructor() {
    super("Message content is required");
    this.name = "EmptyMessageError";
  }
}

function serializeMessage(message: Pick<Message, "id" | "role" | "content" | "createdAt">): ChatMessageSummary {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}
