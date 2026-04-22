import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { clearThreadMessages, listThreadMessages } from "@/lib/chat/thread";
import {
  EmptyMessageError,
  runRagTurn,
  type RagTurnEvent,
} from "@/lib/chat/run-rag-turn";
import {
  parseChatSourceScope,
  validateChatSourceScope,
  type ChatSourceScope,
} from "@/lib/chat/source-scope";
import {
  claudeModelForResponseLength,
  parseChatResponseLength,
} from "@/lib/chat/response-length";

export const runtime = "nodejs";

/**
 * Chat endpoint for the signed-in user's single thread.
 *
 * GET (Step 11): returns the full persisted history.
 *
 * DELETE: removes all messages in the user's chat thread (clear history).
 *
 * POST (Step 11 + 13): persists the user message, runs the RAG pipeline, and
 * streams the assistant reply as Server-Sent Events. Single evolving endpoint
 * — same URL/body shape as Step 11, but the success response is now a stream
 * instead of a single JSON ack (master spec §5.3, §15 #6). Validation errors
 * still return JSON (4xx) so clients can branch on `Content-Type`.
 *
 * Event protocol (one `data:` JSON object per event):
 *   - `event: user_message` — the persisted user `Message` + thread id.
 *   - `event: delta`       — `{ "text": "..." }` token chunks.
 *   - `event: done`        — the persisted assistant `Message`.
 *   - `event: error`       — `{ "message": "..." }` if anything fails after
 *                             the user message is persisted.
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

export async function DELETE(): Promise<NextResponse> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await clearThreadMessages(userId);
    return NextResponse.json({ ok: true as const, deletedCount: result.deletedCount });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[api/chat/messages DELETE]", errorMessage);
    return NextResponse.json(
      { error: "Failed to clear messages" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
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
      { error: "Expected JSON body with a `content` (or `message`) string" },
      { status: 400 },
    );
  }

  const parsed = parseRequestBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  // Validate custom source-id references against the live catalog before we
  // persist anything. Bogus / soft-deleted UUIDs must 400 per Step 14 DoD.
  const validation = await validateChatSourceScope(parsed.sourceScope);
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: validation.error,
        ...(validation.unknownIds ? { unknownIds: validation.unknownIds } : {}),
      },
      { status: 400 },
    );
  }

  const stream = buildSseStream({
    userId,
    content: parsed.content,
    sourceScope: validation.scope,
    claudeModel: parsed.claudeModel,
    abortSignal: request.signal,
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // `no-cache` lets browsers and proxies stop buffering; `no-transform`
      // tells CDNs (CloudFront in production) not to gzip mid-flight, which
      // would defeat token-by-token streaming (master spec §6.2 / §15 #10).
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disables Nginx-style proxy buffering; harmless when not behind one.
      "X-Accel-Buffering": "no",
    },
  });
}

type ParsedRequest =
  | { content: string; sourceScope: ChatSourceScope; claudeModel?: string }
  | { error: string; status: number };

function parseRequestBody(body: unknown): ParsedRequest {
  if (!body || typeof body !== "object") {
    return { error: "`content` must be a non-empty string", status: 400 };
  }
  // Spec for Step 13 names the field `message`; Step 11 used `content`. Accept
  // either so the client and the older test suite both keep working.
  const candidate =
    (body as { message?: unknown }).message ??
    (body as { content?: unknown }).content;
  if (typeof candidate !== "string") {
    return { error: "`content` must be a non-empty string", status: 400 };
  }
  const trimmed = candidate.trim();
  if (trimmed.length === 0) {
    return { error: "`content` must be a non-empty string", status: 400 };
  }
  if (trimmed.length > MAX_MESSAGE_CHARS) {
    return {
      error: `Message exceeds ${MAX_MESSAGE_CHARS} character limit`,
      status: 413,
    };
  }
  const scopeParse = parseChatSourceScope(
    (body as { sourceScope?: unknown }).sourceScope,
  );
  if (!scopeParse.ok) {
    return { error: scopeParse.error, status: 400 };
  }
  const lengthParse = parseChatResponseLength(
    (body as { responseLength?: unknown }).responseLength,
  );
  if (!lengthParse.ok) {
    return { error: lengthParse.error, status: 400 };
  }
  const claudeModel =
    lengthParse.value !== undefined
      ? claudeModelForResponseLength(lengthParse.value)
      : undefined;
  return { content: trimmed, sourceScope: scopeParse.scope, claudeModel };
}

/**
 * Wraps `runRagTurn` in a `ReadableStream` of SSE bytes. Errors thrown after
 * the first event (i.e. during retrieval/Claude) become an `event: error`
 * frame so the client can render them inline instead of seeing a half-stream.
 */
function buildSseStream(params: {
  userId: string;
  content: string;
  sourceScope: ChatSourceScope;
  claudeModel?: string;
  abortSignal: AbortSignal;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeEvent = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      try {
        const generator = runRagTurn(
          {
            userId: params.userId,
            userMessageContent: params.content,
            sourceScope: params.sourceScope,
            ...(params.claudeModel ? { claudeModel: params.claudeModel } : {}),
            signal: params.abortSignal,
          },
        );
        for await (const event of generator as AsyncGenerator<RagTurnEvent>) {
          switch (event.type) {
            case "user_message":
              writeEvent("user_message", {
                threadId: event.threadId,
                message: event.message,
              });
              break;
            case "delta":
              writeEvent("delta", { text: event.text });
              break;
            case "done":
              writeEvent("done", {
                message: event.message,
                retrievalChunkIds: event.retrievalChunkIds,
                usedRefusal: event.usedRefusal,
              });
              break;
          }
        }
      } catch (error) {
        // EmptyMessageError shouldn't reach here (we validate earlier), but
        // keep the branch so a programmer-error throw still surfaces clearly.
        if (error instanceof EmptyMessageError) {
          writeEvent("error", { message: error.message });
        } else if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          // Belt-and-suspenders: the UNIQUE(notebook_id) chat_threads index
          // makes a second thread structurally impossible, but if a concurrent
          // writer races us we surface a clean error instead of leaking Prisma.
          writeEvent("error", {
            message: "Chat thread already exists for this notebook",
          });
        } else {
          const message =
            error instanceof Error ? error.message : "RAG chat turn failed";
          console.error("[api/chat/messages POST stream]", message);
          writeEvent("error", { message });
        }
      } finally {
        controller.close();
      }
    },
  });
}
