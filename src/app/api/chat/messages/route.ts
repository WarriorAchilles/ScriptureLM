import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import {
  appendUserMessage,
  EmptyMessageError,
  listThreadMessages,
} from "@/lib/chat/thread";

export const runtime = "nodejs";

/**
 * Chat history endpoint for the signed-in user's single thread (Step 11; master
 * spec §5.1, §7, §15 #4).
 *
 * Single evolving endpoint — Step 13 will extend POST to stream an assistant reply,
 * but the URL, request body, and GET contract stay the same so clients don't need to
 * migrate routes between steps.
 */

const MAX_MESSAGE_CHARS = 32_000;

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const state = await listThreadMessages(userId);
    return NextResponse.json(state);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[api/chat/messages GET]", errorMessage);
    return NextResponse.json(
      { error: "Failed to load messages" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Expected JSON body with a `content` string" },
      { status: 400 },
    );
  }

  const content = extractContent(body);
  if (content === null) {
    return NextResponse.json(
      { error: "`content` must be a non-empty string" },
      { status: 400 },
    );
  }
  if (content.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Message exceeds ${MAX_MESSAGE_CHARS} character limit` },
      { status: 413 },
    );
  }

  try {
    const { threadId, message } = await appendUserMessage(userId, content);
    return NextResponse.json({ threadId, message }, { status: 201 });
  } catch (error) {
    if (error instanceof EmptyMessageError) {
      return NextResponse.json(
        { error: "`content` must be a non-empty string" },
        { status: 400 },
      );
    }
    // The UNIQUE(notebook_id) index on chat_threads means a second thread is
    // impossible to create for the same notebook — if we somehow get here via a
    // concurrent writer, surface 409 rather than leaking a Prisma error.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Chat thread already exists for this notebook" },
        { status: 409 },
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[api/chat/messages POST]", errorMessage);
    return NextResponse.json(
      { error: "Failed to persist message" },
      { status: 500 },
    );
  }
}

function extractContent(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const candidate = (body as { content?: unknown }).content;
  if (typeof candidate !== "string") {
    return null;
  }
  const trimmed = candidate.trim();
  return trimmed.length === 0 ? null : trimmed;
}
