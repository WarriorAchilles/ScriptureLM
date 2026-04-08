import prisma from "@/lib/prisma";

/**
 * Ensures the v1 invariant: exactly one Notebook and one ChatThread per user.
 * Idempotent; safe under concurrency (unique indexes + upsert).
 */
export async function ensureDefaultWorkspaceForUser(userId: string): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const notebook = await transaction.notebook.upsert({
      where: { userId },
      create: { userId, title: "My notebook" },
      update: {},
    });
    await transaction.chatThread.upsert({
      where: { notebookId: notebook.id },
      create: { notebookId: notebook.id, title: "Main" },
      update: {},
    });
  });
}
