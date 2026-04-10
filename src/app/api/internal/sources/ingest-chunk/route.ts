import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/config";
import { runExtractAndChunk } from "@/lib/ingest/run-extract-and-chunk";
import { isOperatorSecretValid } from "@/lib/sources/operator-secret";

export const runtime = "nodejs";

/**
 * Operator-only: run extract + chunk for an existing source. Header: `x-operator-secret`
 * must match `OPERATOR_INGEST_SECRET`.
 *
 * Body JSON: `{ "sourceId": "<uuid>" }`
 */
export async function POST(request: Request): Promise<NextResponse> {
  const env = getServerEnv();
  const secretHeader = request.headers.get("x-operator-secret");
  if (!isOperatorSecretValid(env.operatorIngestSecret, secretHeader)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const sourceId =
    typeof body === "object" &&
    body !== null &&
    "sourceId" in body &&
    typeof (body as { sourceId: unknown }).sourceId === "string"
      ? (body as { sourceId: string }).sourceId.trim()
      : undefined;

  if (!sourceId) {
    return NextResponse.json(
      { error: 'Missing string field "sourceId"' },
      { status: 400 },
    );
  }

  try {
    const result = await runExtractAndChunk(sourceId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[internal/sources/ingest-chunk]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
