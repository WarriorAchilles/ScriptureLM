/**
 * Server-only Anthropic Claude wrapper for the RAG chat path (Step 13).
 *
 * Master spec refs: §6.3 (Anthropic Messages API), §5.3 (RAG / streaming /
 * refusal), §15 #4 (single thread). All call sites live in Route Handlers,
 * Server Actions, or the worker — **never** import this module from a `"use
 * client"` component or any browser bundle: doing so would leak
 * `ANTHROPIC_API_KEY` into the client bundle (master spec §6.6).
 *
 * The module exposes `streamClaudeRagResponse()`, an async generator that yields
 * text deltas (one per `content_block_delta` event) and finally returns the
 * accumulated text plus token usage so callers can persist the assistant message
 * and log usage (§9 prep). A real Anthropic client is constructed lazily; tests
 * inject a stub `AnthropicClient` to avoid network calls.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";
import { getServerEnv } from "@/lib/config";

/** Default Claude model when `ANTHROPIC_MODEL` is unset. Cheap + fast for chat. */
const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5";

/**
 * Default `max_tokens`: enough for a multi-paragraph grounded answer with
 * inline citations, without letting a runaway response burn the budget.
 */
const DEFAULT_MAX_TOKENS = 1024;

/** Token usage emitted by the SDK for the completed message. */
export type ClaudeUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
}>;

/** Final accumulated result returned by the generator. */
export type ClaudeStreamResult = Readonly<{
  text: string;
  usage: ClaudeUsage;
  stopReason: string | null;
}>;

export type AnthropicCreateBody = {
  model: string;
  max_tokens: number;
  system: string;
  messages: MessageParam[];
  stream: true;
};

export type AnthropicCreateOptions = {
  signal?: AbortSignal;
};

/**
 * Minimal interface we depend on from the Anthropic SDK. Tests substitute a
 * stub returning a hand-rolled async iterable so we don't require network
 * access (and so `ANTHROPIC_API_KEY` need not be set in CI).
 */
export type AnthropicClient = {
  messages: {
    create(
      body: AnthropicCreateBody,
      options?: AnthropicCreateOptions,
    ): Promise<AsyncIterable<RawMessageStreamEvent>> | AsyncIterable<RawMessageStreamEvent>;
  };
};

export type StreamClaudeRagResponseParams = Readonly<{
  /** System prompt with retrieval context blocks + grounding rules. */
  system: string;
  /** Conversation messages (already truncated to the token budget). */
  messages: readonly MessageParam[];
  /** Optional override; defaults to `ANTHROPIC_MODEL` env or `DEFAULT_CLAUDE_MODEL`. */
  model?: string;
  /** Optional override; defaults to `DEFAULT_MAX_TOKENS`. */
  maxTokens?: number;
  /** Abort signal forwarded to the SDK so client disconnects stop billing. */
  signal?: AbortSignal;
}>;

export type StreamClaudeRagResponseDeps = Readonly<{
  /** Inject a stub client in tests; otherwise we lazily construct from env. */
  client?: AnthropicClient;
}>;

let cachedClient: AnthropicClient | undefined;

function buildAnthropicClient(): AnthropicClient {
  // Reading env lazily so importing this module in tests (without an API key)
  // doesn't fail at import time — only when we actually try to talk to Claude.
  const env = getServerEnv();
  if (!env.anthropicApiKey) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY (server config). Set it in `.env` to enable RAG chat (master spec §6.3).",
    );
  }
  return new Anthropic({ apiKey: env.anthropicApiKey });
}

function resolveAnthropicClient(deps: StreamClaudeRagResponseDeps): AnthropicClient {
  if (deps.client) {
    return deps.client;
  }
  if (!cachedClient) {
    cachedClient = buildAnthropicClient();
  }
  return cachedClient;
}

function resolveModel(override: string | undefined): string {
  if (override && override.trim()) {
    return override.trim();
  }
  const fromEnv = (process.env.ANTHROPIC_MODEL ?? "").trim();
  return fromEnv || DEFAULT_CLAUDE_MODEL;
}

/**
 * Streams a Claude completion as an async generator yielding text deltas. The
 * generator's final return value carries the full accumulated text plus token
 * usage (so the caller can persist the assistant `Message` row and log usage in
 * one place).
 *
 * Caller pattern:
 *   const stream = streamClaudeRagResponse({ system, messages, signal });
 *   let result: ClaudeStreamResult | undefined;
 *   while (true) {
 *     const next = await stream.next();
 *     if (next.done) { result = next.value; break; }
 *     yieldDeltaToClient(next.value);
 *   }
 */
export async function* streamClaudeRagResponse(
  params: StreamClaudeRagResponseParams,
  deps: StreamClaudeRagResponseDeps = {},
): AsyncGenerator<string, ClaudeStreamResult, void> {
  const client = resolveAnthropicClient(deps);
  const model = resolveModel(params.model);
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;

  const stream = await client.messages.create(
    {
      model,
      max_tokens: maxTokens,
      system: params.system,
      messages: params.messages as MessageParam[],
      stream: true,
    },
    // The SDK forwards `signal` to the underlying fetch, so a client disconnect
    // on the Next.js Route Handler propagates and stops Anthropic from billing.
    params.signal ? { signal: params.signal } : undefined,
  );

  let accumulatedText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;

  for await (const event of stream) {
    if (event.type === "message_start") {
      // `message_start` includes the initial usage (prompt token counts).
      const usage = event.message?.usage;
      if (usage) {
        inputTokens = usage.input_tokens ?? inputTokens;
        outputTokens = usage.output_tokens ?? outputTokens;
      }
      continue;
    }
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      const text = event.delta.text;
      if (text) {
        accumulatedText += text;
        yield text;
      }
      continue;
    }
    if (event.type === "message_delta") {
      // `message_delta` carries the running output_tokens count + final stop_reason.
      const usage = event.usage;
      if (usage?.output_tokens != null) {
        outputTokens = usage.output_tokens;
      }
      if (event.delta.stop_reason) {
        stopReason = event.delta.stop_reason;
      }
      continue;
    }
    // Other event types (`content_block_start/stop`, `message_stop`, thinking,
    // tool use) are intentionally ignored: this RAG path is text-only with no
    // tools, and we already track usage from message_start / message_delta.
  }

  return {
    text: accumulatedText,
    usage: { inputTokens, outputTokens },
    stopReason,
  };
}

/** Test-only: clears the cached lazily-built client. */
export function resetClaudeClientCacheForTests(): void {
  cachedClient = undefined;
}
