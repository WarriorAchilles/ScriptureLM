/**
 * Summary generation orchestrators (Step 15).
 *
 * Master spec refs: §5.4 (per-source + library brief), §15 #6 (attribution),
 * §9 prep (usage logging).
 *
 * Each orchestrator:
 *   1. Loads the Source(s) and enforces lifecycle rules (e.g. 409 for
 *      not-READY per-source requests).
 *   2. Builds a bounded context via `context.ts`.
 *   3. Calls Claude non-streaming via `callClaudeCompletion` with the
 *      prompt pair built in `summary-prompt.ts`.
 *   4. Logs a structured summary-turn line and returns the generated text
 *      plus the list of contributing sources for the API response.
 *
 * v1 is **ephemeral**: we do not persist `Summary` rows. Regenerating with
 * edited parameters simply re-calls this pipeline (§5.4). If we ever add
 * persistence, the `params_hash` dedupe key should be built from
 * `{ sourceId | sourceIds, length, audience, focus }`.
 */

import type { PrismaClient } from "@prisma/client";
import {
  callClaudeCompletion,
  type CallClaudeCompletionDeps,
} from "@/lib/llm/claude";
import {
  buildLibraryContext,
  buildSourceContext,
  loadSummarySource,
  MAX_LIBRARY_SOURCES,
  type SummarySourceRecord,
} from "./context";
import {
  buildLibrarySummaryPrompt,
  buildSourceSummaryPrompt,
} from "./summary-prompt";
import type { SummaryParams } from "./params";

export type SummaryAttribution = Readonly<{
  id: string;
  title: string;
}>;

export type SummaryResult = Readonly<{
  content: string;
  sources: readonly SummaryAttribution[];
  usage: Readonly<{ inputTokens: number; outputTokens: number }>;
  stopReason: string | null;
}>;

/**
 * Error raised when a per-source summary is requested for a Source that is
 * not `READY`. The route handler converts this into a 409 Conflict per
 * Step 15 #1.
 */
export class SourceNotReadyError extends Error {
  constructor(
    public readonly sourceId: string,
    public readonly status: string,
  ) {
    super(
      `Source ${sourceId} is not ready for summarization (status: ${status}).`,
    );
    this.name = "SourceNotReadyError";
  }
}

/** Raised when a requested Source does not exist or is soft-deleted. */
export class SourceNotFoundError extends Error {
  constructor(public readonly sourceId: string) {
    super(`Source ${sourceId} not found.`);
    this.name = "SourceNotFoundError";
  }
}

/** Raised when a library request resolves to zero candidate sources. */
export class NoContributingSourcesError extends Error {
  constructor() {
    super(
      "No READY sources matched the requested scope; there is nothing to summarize.",
    );
    this.name = "NoContributingSourcesError";
  }
}

/** Default Claude `max_tokens` budget per summary length. */
const MAX_OUTPUT_TOKENS_BY_LENGTH = {
  short: 512,
  long: 2048,
} as const;

export type GenerateSourceSummaryDeps = Readonly<{
  prismaClient?: PrismaClient;
  callClaudeCompletionFn?: typeof callClaudeCompletion;
  anthropicClient?: CallClaudeCompletionDeps["client"];
  signal?: AbortSignal;
}>;

export async function generateSourceSummary(
  request: {
    sourceId: string;
    params: SummaryParams;
  },
  deps: GenerateSourceSummaryDeps = {},
): Promise<SummaryResult> {
  const prismaDeps = deps.prismaClient ? { prismaClient: deps.prismaClient } : {};
  const source = await loadSummarySource(request.sourceId, prismaDeps);
  if (!source) {
    throw new SourceNotFoundError(request.sourceId);
  }
  if (source.status !== "READY") {
    throw new SourceNotReadyError(request.sourceId, source.status);
  }

  const context = await buildSourceContext(source, prismaDeps);
  const { system, userContent } = buildSourceSummaryPrompt({
    source,
    chunks: context.chunks,
    truncated: context.truncated,
    params: request.params,
  });

  const completion = await invokeClaude({
    system,
    userContent,
    length: request.params.length,
    deps,
  });

  logSummaryTurn({
    kind: "source",
    sourceIds: [source.id],
    params: request.params,
    usage: completion.usage,
    chunkCount: context.chunks.length,
  });

  return {
    content: completion.text,
    sources: [{ id: source.id, title: source.title }],
    usage: completion.usage,
    stopReason: completion.stopReason,
  };
}

export type GenerateLibrarySummaryDeps = Readonly<{
  prismaClient?: PrismaClient;
  callClaudeCompletionFn?: typeof callClaudeCompletion;
  anthropicClient?: CallClaudeCompletionDeps["client"];
  signal?: AbortSignal;
}>;

export async function generateLibrarySummary(
  request: {
    /** Already-validated candidate sources (READY, non-soft-deleted). */
    candidateSources: readonly SummarySourceRecord[];
    params: SummaryParams;
  },
  deps: GenerateLibrarySummaryDeps = {},
): Promise<SummaryResult> {
  if (request.candidateSources.length === 0) {
    throw new NoContributingSourcesError();
  }

  const prismaDeps = deps.prismaClient ? { prismaClient: deps.prismaClient } : {};
  const context = await buildLibraryContext(request.candidateSources, prismaDeps);

  if (context.sources.length === 0) {
    // Every candidate returned zero chunks (e.g. still indexing). Surface as a
    // typed error so the route can 409 rather than send an empty prompt.
    throw new NoContributingSourcesError();
  }

  const { system, userContent } = buildLibrarySummaryPrompt({
    contributingSources: context.sources,
    params: request.params,
  });

  const completion = await invokeClaude({
    system,
    userContent,
    length: request.params.length,
    deps,
  });

  const attribution = context.sources.map(({ source }) => ({
    id: source.id,
    title: source.title,
  }));

  logSummaryTurn({
    kind: "library",
    sourceIds: attribution.map((entry) => entry.id),
    params: request.params,
    usage: completion.usage,
    chunkCount: context.sources.reduce(
      (total, entry) => total + entry.chunks.length,
      0,
    ),
  });

  return {
    content: completion.text,
    sources: attribution,
    usage: completion.usage,
    stopReason: completion.stopReason,
  };
}

/**
 * Thin wrapper around `callClaudeCompletion` that applies the length-aware
 * `max_tokens` budget and threads the abort signal / injectable client. Kept
 * private because both orchestrators call it in the same shape.
 */
async function invokeClaude(params: {
  system: string;
  userContent: string;
  length: SummaryParams["length"];
  deps: GenerateSourceSummaryDeps & GenerateLibrarySummaryDeps;
}) {
  const callClaude = params.deps.callClaudeCompletionFn ?? callClaudeCompletion;
  return callClaude(
    {
      system: params.system,
      messages: [{ role: "user", content: params.userContent }],
      maxTokens: MAX_OUTPUT_TOKENS_BY_LENGTH[params.length],
      signal: params.deps.signal,
    },
    params.deps.anthropicClient ? { client: params.deps.anthropicClient } : {},
  );
}

function logSummaryTurn(params: {
  kind: "source" | "library";
  sourceIds: readonly string[];
  params: SummaryParams;
  usage: { inputTokens: number; outputTokens: number };
  chunkCount: number;
}): void {
  const line = JSON.stringify({
    level: "info",
    event: "summary_turn_complete",
    kind: params.kind,
    // Cap logged ids so a wide library brief doesn't blow up the log line.
    sourceIds: params.sourceIds.slice(0, MAX_LIBRARY_SOURCES),
    sourceCount: params.sourceIds.length,
    length: params.params.length,
    audience: params.params.audience,
    focus: params.params.focus ?? null,
    inputTokens: params.usage.inputTokens,
    outputTokens: params.usage.outputTokens,
    chunkCount: params.chunkCount,
  });
  console.info(line);
}
