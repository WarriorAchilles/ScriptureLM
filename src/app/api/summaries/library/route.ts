import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  parseChatSourceScope,
  validateChatSourceScope,
} from "@/lib/chat/source-scope";
import {
  generateLibrarySummary,
  NoContributingSourcesError,
  parseSummaryParams,
} from "@/lib/summaries";
import { resolveLibraryCandidateSources } from "@/lib/summaries/resolve-library-sources";

export const runtime = "nodejs";

/**
 * Library-level grounded brief (Step 15 #2; master spec §5.4).
 *
 * Request body:
 *   {
 *     length:     "short" | "long",
 *     audience:   "plain" | "technical",
 *     focus?:     string,
 *     // Scope mirrors Step 14's chat scope rules. Accepted shapes:
 *     sourceIds?: string[],                  // custom (UUIDs must exist & be READY)
 *     corpus?:    "scripture" | "sermon",    // preset corpus filter
 *     // …or neither → "all" (every READY source, up to MAX_LIBRARY_SOURCES).
 *   }
 *
 * Response 200 JSON:
 *   {
 *     content: string,              // Markdown brief; names each contributing source.
 *     sources: [{ id, title }],     // Exactly the sources that fed the prompt.
 *     usage:   { inputTokens, outputTokens },
 *     stopReason: string | null
 *   }
 *
 * Errors:
 *   400 — malformed body or unknown `sourceIds`.
 *   409 — scope resolves to zero READY sources (nothing to summarize).
 *   500 — downstream failure (DB / Claude).
 */

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
      { error: "Expected JSON body with `length` and `audience`" },
      { status: 400 },
    );
  }

  const paramsParse = parseSummaryParams(body);
  if (!paramsParse.ok) {
    return NextResponse.json({ error: paramsParse.error }, { status: 400 });
  }

  // Accept the same `{ sourceIds?, corpus? }` shape the chat endpoint does,
  // routed through the shared parser/validator so error messages and
  // unknown-id behavior stay consistent (Step 14 DoD).
  const scopeInput = {
    sourceIds: (body as { sourceIds?: unknown }).sourceIds,
    corpus: (body as { corpus?: unknown }).corpus,
  };
  const scopeParse = parseChatSourceScope(scopeInput);
  if (!scopeParse.ok) {
    return NextResponse.json({ error: scopeParse.error }, { status: 400 });
  }
  const scopeValidation = await validateChatSourceScope(scopeParse.scope);
  if (!scopeValidation.ok) {
    return NextResponse.json(
      {
        error: scopeValidation.error,
        ...(scopeValidation.unknownIds
          ? { unknownIds: scopeValidation.unknownIds }
          : {}),
      },
      { status: 400 },
    );
  }

  try {
    const candidateSources = await resolveLibraryCandidateSources(
      scopeValidation.scope,
    );
    const result = await generateLibrarySummary(
      {
        candidateSources,
        params: paramsParse.params,
      },
      { signal: request.signal },
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NoContributingSourcesError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/summaries/library]", message);
    return NextResponse.json(
      { error: "Failed to generate library summary" },
      { status: 500 },
    );
  }
}
