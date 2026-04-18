import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  generateSourceSummary,
  parseSummaryParams,
  SourceNotFoundError,
  SourceNotReadyError,
} from "@/lib/summaries";

export const runtime = "nodejs";

/**
 * Per-source grounded summary (Step 15; master spec §5.4).
 *
 * Request body:
 *   {
 *     sourceId: string,           // Source UUID; must be READY.
 *     length:   "short" | "long",
 *     audience: "plain" | "technical",
 *     focus?:   string             // Optional free-text emphasis (<=500 chars).
 *   }
 *
 * Response 200 JSON:
 *   {
 *     content: string,              // Markdown summary ending in attribution line.
 *     sources: [{ id, title }],     // Contributing source (always exactly 1 here).
 *     usage:   { inputTokens, outputTokens },
 *     stopReason: string | null
 *   }
 *
 * Errors:
 *   400 — malformed body (missing `sourceId`, invalid `length`/`audience`).
 *   404 — `sourceId` does not exist or has been soft-deleted.
 *   409 — Source exists but is not in `READY` status (PENDING / PROCESSING /
 *         FAILED). Per Step 15 #1 we refuse rather than summarize partially.
 *   500 — downstream failure (DB / Claude); details kept server-side.
 *
 * v1 is ephemeral: regeneration re-runs this pipeline (§5.4); no `Summary`
 * row is persisted so there is no blob duplication across regenerations.
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      { error: "Expected JSON body with `sourceId`, `length`, `audience`" },
      { status: 400 },
    );
  }

  const sourceIdRaw = (body as { sourceId?: unknown })?.sourceId;
  if (typeof sourceIdRaw !== "string" || !UUID_REGEX.test(sourceIdRaw.trim())) {
    return NextResponse.json(
      { error: "`sourceId` must be a source UUID string" },
      { status: 400 },
    );
  }

  const paramsParse = parseSummaryParams(body);
  if (!paramsParse.ok) {
    return NextResponse.json({ error: paramsParse.error }, { status: 400 });
  }

  try {
    const result = await generateSourceSummary(
      {
        sourceId: sourceIdRaw.trim(),
        params: paramsParse.params,
      },
      { signal: request.signal },
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SourceNotReadyError) {
      // Step 15 #1: clear 409 so the UI can tell the user to wait for
      // indexing rather than retrying with the same payload.
      return NextResponse.json(
        {
          error: error.message,
          sourceId: error.sourceId,
          status: error.status,
        },
        { status: 409 },
      );
    }
    if (error instanceof SourceNotFoundError) {
      return NextResponse.json(
        { error: error.message, sourceId: error.sourceId },
        { status: 404 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/summaries/source]", message);
    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 },
    );
  }
}
