import { NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";

/**
 * Protected workspace summary for the signed-in user (MVP shell; no RAG/catalog).
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const notebook = await prisma.notebook.findUnique({
    where: { userId },
    include: {
      thread: { select: { id: true, title: true } },
    },
  });

  if (!notebook) {
    return NextResponse.json(
      { error: "Workspace not ready" },
      { status: 503 },
    );
  }

  return NextResponse.json({
    notebookId: notebook.id,
    notebookTitle: notebook.title,
    threadId: notebook.thread?.id ?? null,
    threadTitle: notebook.thread?.title ?? null,
  });
}
