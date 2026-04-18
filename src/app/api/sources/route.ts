import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  clampListLimit,
  listCatalogSources,
} from "@/lib/sources/list-catalog";

export const runtime = "nodejs";

/**
 * Read-only catalog feed for the signed-in user (Step 10; master spec §5.2).
 *
 * Mutations (add/remove/reindex) are operator-only via internal routes — this handler
 * deliberately has no POST/DELETE/PATCH counterpart.
 *
 * Query params:
 *  - `limit`   — page size (default 50, capped at 200).
 *  - `cursor`  — opaque keyset cursor returned as `nextCursor` in the previous response.
 *
 * The UI-facing `errorMessage` is truncated here so failure details render predictably in
 * table cells; the full error remains available to operator tooling via raw DB access.
 */
const ERROR_MESSAGE_UI_MAX = 240;

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = clampListLimit(limitParam ? Number(limitParam) : undefined);
  const cursor = url.searchParams.get("cursor");
  // Optional free-text filter (Step 14). Empty/whitespace `q` is treated as
  // "no filter" by the data layer so callers can pass the raw query string.
  const q = url.searchParams.get("q");

  try {
    const page = await listCatalogSources({ limit, cursor, q });

    return NextResponse.json({
      items: page.items.map((item) => ({
        ...item,
        errorMessage: truncateForUi(item.errorMessage, ERROR_MESSAGE_UI_MAX),
      })),
      nextCursor: page.nextCursor,
      limit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/sources]", message);
    return NextResponse.json(
      { error: "Failed to load sources" },
      { status: 500 },
    );
  }
}

function truncateForUi(value: string | null, maxLength: number): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}
