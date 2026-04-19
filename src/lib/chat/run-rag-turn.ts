/**
 * RAG chat turn orchestrator (Step 13).
 *
 * Master spec refs: §5.3 (retrieval + refusal + streaming), §5.1 (single
 * thread per user, source scope), §6.4 (query path), §15 #6 (inline citations).
 *
 * The orchestrator is exposed as an async generator yielding `RagTurnEvent`s so
 * the API route can pipe them straight to the SSE response without owning any
 * RAG logic itself. Side effects:
 *
 *   1. Persists the **user** message (lazily creating notebook + thread).
 *   2. Calls `retrieveContext` with the active scope.
 *   3. If retrieval is empty → emits the fixed refusal text and persists it as
 *      the assistant message **without** calling Claude (no fabricated
 *      citations possible — required by Step 13 instruction #7).
 *   4. Otherwise streams Claude with the labeled context and persists the
 *      accumulated assistant text + `retrieval_debug` (§5.3, §7).
 *   5. Logs a single structured line with token counts for §9 prep.
 */

import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ensureUserThread, type ChatMessageSummary } from "@/lib/chat/thread";
import {
  retrieveContext,
  type RetrievalCorpus,
} from "@/lib/retrieval";
import {
  buildSystemPrompt,
  labelChunks,
  REFUSAL_TEXT,
  truncateHistoryByTokenBudget,
  type ChatTurn,
  type LabeledChunk,
} from "@/lib/chat/rag-prompt";
import {
  DEFAULT_CHAT_SOURCE_SCOPE,
  expandScopeForRetrieval,
  type ChatSourceScope,
} from "@/lib/chat/source-scope";
import {
  streamClaudeRagResponse,
  type AnthropicClient,
  type ClaudeStreamResult,
} from "@/lib/llm/claude";
import { buildCitationsFromLabeledChunks } from "@/lib/chat/citations";

export type RunRagTurnParams = Readonly<{
  userId: string;
  userMessageContent: string;
  /** Preset-form scope from the UI. Defaults to `{ mode: "all" }`. */
  sourceScope?: ChatSourceScope;
  /** AbortSignal forwarded to Claude when the client disconnects. */
  signal?: AbortSignal;
}>;

export type RunRagTurnDeps = Readonly<{
  /** Inject for tests; defaults to the real implementations. */
  retrieveContextFn?: typeof retrieveContext;
  streamClaudeRagResponseFn?: typeof streamClaudeRagResponse;
  anthropicClient?: AnthropicClient;
  /** Number of nearest chunks to retrieve. Defaults to 8. */
  retrievalLimit?: number;
}>;

export type RagTurnEvent =
  | { type: "user_message"; message: ChatMessageSummary; threadId: string }
  | { type: "delta"; text: string }
  | {
      type: "done";
      message: ChatMessageSummary;
      retrievalChunkIds: string[];
      usedRefusal: boolean;
    };

const DEFAULT_RETRIEVAL_LIMIT = 15;

/**
 * Persisted shape of `Message.retrievalDebug` (master spec §7). Kept narrow on
 * purpose so future fields (e.g. corpus split, model id) can be appended
 * without breaking older rows.
 */
type RetrievalDebugRecord = {
  chunkIds: string[];
  scores: number[];
  scope: {
    mode: ChatSourceScope["mode"];
    sourceIds: string[] | null;
    corpus: RetrievalCorpus | null;
  };
  refusal: boolean;
};

export class EmptyMessageError extends Error {
  constructor() {
    super("Message content is required");
    this.name = "EmptyMessageError";
  }
}

/**
 * Runs the full RAG turn. Yields events in the order: `user_message` → zero or
 * more `delta` → `done`. Throws on retrieval/Claude/persistence errors so the
 * route can surface a typed SSE `error` event before closing the stream.
 */
export async function* runRagTurn(
  params: RunRagTurnParams,
  deps: RunRagTurnDeps = {},
): AsyncGenerator<RagTurnEvent, void, void> {
  const trimmed = params.userMessageContent.trim();
  if (!trimmed) {
    throw new EmptyMessageError();
  }

  const retrieve = deps.retrieveContextFn ?? retrieveContext;
  const streamClaude = deps.streamClaudeRagResponseFn ?? streamClaudeRagResponse;
  const retrievalLimit = deps.retrievalLimit ?? DEFAULT_RETRIEVAL_LIMIT;

  // 1. Persist the user message + lazily create notebook/thread atomically.
  //    Mirrors Step 11 semantics so the chat history stays consistent even if
  //    Claude later errors out mid-stream.
  const { threadId, userMessage } = await persistUserMessage(
    params.userId,
    trimmed,
  );
  yield { type: "user_message", message: userMessage, threadId };

  // 2. Load short conversation history (excluding the just-persisted user
  //    message; we'll re-add it as the final user turn). Truncate by token
  //    budget per Step 13 instruction #3.
  const priorTurns = await loadPriorTurns(threadId, userMessage.id);
  const { history: trimmedHistory } = truncateHistoryByTokenBudget(priorTurns);
  const messagesForModel: ChatTurn[] = [
    ...trimmedHistory,
    { role: "user", content: trimmed },
  ];

  // 3. Retrieve context with the active scope. Expand preset → retrieval args
  //    here (one place) so callers don't need to know the preset semantics.
  const activeScope = params.sourceScope ?? DEFAULT_CHAT_SOURCE_SCOPE;
  const retrievalScope = expandScopeForRetrieval(activeScope);
  const retrievedChunks = await retrieve({
    query: trimmed,
    limit: retrievalLimit,
    sourceIds: retrievalScope.sourceIds,
    corpus: retrievalScope.corpus,
  });

  // 4a. No retrieval → emit fixed refusal verbatim. Skipping Claude entirely
  //     means we cannot accidentally hallucinate citations (Step 13 #7 test).
  if (retrievedChunks.length === 0) {
    yield { type: "delta", text: REFUSAL_TEXT };
    const assistantMessage = await persistAssistantMessage({
      threadId,
      content: REFUSAL_TEXT,
      retrievalDebug: buildRetrievalDebug({
        chunks: [],
        scope: activeScope,
        refusal: true,
      }),
    });
    logTurnSummary({
      userId: params.userId,
      threadId,
      retrievedChunks: [],
      usage: null,
      refusal: true,
    });
    yield {
      type: "done",
      message: assistantMessage,
      retrievalChunkIds: [],
      usedRefusal: true,
    };
    return;
  }

  // 4b. Build prompts and stream Claude.
  const labeled = labelChunks(retrievedChunks);
  const systemPrompt = buildSystemPrompt(labeled);
  const claudeMessages = messagesForModel.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  const stream = streamClaude(
    {
      system: systemPrompt,
      messages: claudeMessages,
      signal: params.signal,
    },
    deps.anthropicClient ? { client: deps.anthropicClient } : {},
  );

  let claudeResult: ClaudeStreamResult | undefined;
  while (true) {
    const next = await stream.next();
    if (next.done) {
      claudeResult = next.value;
      break;
    }
    yield { type: "delta", text: next.value };
  }

  const finalText = claudeResult?.text ?? "";
  // Defensive: if the model produced an empty response (rare; usually means a
  // policy refusal mapped to an empty content array), substitute the canonical
  // refusal so the UI never renders an empty assistant bubble.
  const persistedContent = finalText.trim() ? finalText : REFUSAL_TEXT;

  const assistantMessage = await persistAssistantMessage({
    threadId,
    content: persistedContent,
    retrievalDebug: buildRetrievalDebug({
      chunks: labeled,
      scope: activeScope,
      refusal: !finalText.trim(),
    }),
  });
  logTurnSummary({
    userId: params.userId,
    threadId,
    retrievedChunks: labeled,
    usage: claudeResult?.usage ?? null,
    refusal: !finalText.trim(),
  });
  const citations = buildCitationsFromLabeledChunks(labeled);
  yield {
    type: "done",
    message: { ...assistantMessage, citations },
    retrievalChunkIds: labeled.map(({ chunk }) => chunk.chunkId),
    usedRefusal: !finalText.trim(),
  };
}

async function persistUserMessage(
  userId: string,
  content: string,
): Promise<{ threadId: string; userMessage: ChatMessageSummary }> {
  return prisma.$transaction(async (transaction) => {
    const { threadId } = await ensureUserThread(userId, transaction);
    const created = await transaction.message.create({
      data: { threadId, role: "user", content },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return {
      threadId,
      userMessage: {
        id: created.id,
        role: created.role,
        content: created.content,
        createdAt: created.createdAt.toISOString(),
      },
    };
  });
}

async function persistAssistantMessage(params: {
  threadId: string;
  content: string;
  retrievalDebug: RetrievalDebugRecord;
}): Promise<ChatMessageSummary> {
  const created = await prisma.message.create({
    data: {
      threadId: params.threadId,
      role: "assistant",
      content: params.content,
      retrievalDebug: params.retrievalDebug as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return {
    id: created.id,
    role: created.role,
    content: created.content,
    createdAt: created.createdAt.toISOString(),
  };
}

/**
 * Loads the persisted history for the thread *excluding* the just-created user
 * message (which is appended explicitly to the model input). Limited to a
 * generous fixed cap because `truncateHistoryByTokenBudget` does the actual
 * budgeting downstream.
 */
async function loadPriorTurns(
  threadId: string,
  excludeMessageId: string,
): Promise<ChatTurn[]> {
  const rows = await prisma.message.findMany({
    where: {
      threadId,
      role: { in: ["user", "assistant"] },
      id: { not: excludeMessageId },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { role: true, content: true },
  });
  return rows.map((row) => ({
    role: row.role as "user" | "assistant",
    content: row.content,
  }));
}

function buildRetrievalDebug(params: {
  chunks: readonly LabeledChunk[];
  scope: ChatSourceScope;
  refusal: boolean;
}): RetrievalDebugRecord {
  const expanded = expandScopeForRetrieval(params.scope);
  return {
    chunkIds: params.chunks.map(({ chunk }) => chunk.chunkId),
    scores: params.chunks.map(({ chunk }) => chunk.distance),
    scope: {
      mode: params.scope.mode,
      sourceIds: expanded.sourceIds ? Array.from(expanded.sourceIds) : null,
      corpus: expanded.corpus ?? null,
    },
    refusal: params.refusal,
  };
}

function logTurnSummary(params: {
  userId: string;
  threadId: string;
  retrievedChunks: readonly LabeledChunk[];
  usage: { inputTokens: number; outputTokens: number } | null;
  refusal: boolean;
}): void {
  const line = JSON.stringify({
    level: "info",
    event: "rag_turn_complete",
    userId: params.userId,
    threadId: params.threadId,
    chunkCount: params.retrievedChunks.length,
    chunkIds: params.retrievedChunks
      .slice(0, 5)
      .map(({ chunk }) => chunk.chunkId),
    inputTokens: params.usage?.inputTokens ?? null,
    outputTokens: params.usage?.outputTokens ?? null,
    refusal: params.refusal,
  });
  console.info(line);
}
