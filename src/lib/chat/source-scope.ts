/**
 * Shared source-scope types, parser, validator, and preset→retrieval mapping
 * used by chat (Step 14).
 *
 * Master spec refs: §5.1 (scope per turn), §5.3 (retrieval filters), §6.5
 * (accessible controls), §13 success criteria.
 *
 * The chat client serializes a small JSON object describing what the user has
 * scoped the conversation to: one of four preset modes (`all`, `scripture`,
 * `sermon`, `custom`) plus — in the `custom` case — a list of source UUIDs.
 * This module owns the full round-trip:
 *
 *   raw JSON  →  `parseChatSourceScope`        (shape check)
 *             →  `validateChatSourceScope`     (DB existence + soft-delete check)
 *             →  `expandScopeForRetrieval`     (preset → `retrieveContext` args)
 *
 * Keeping all three in one module means the UI, the route handler, and the
 * unit tests agree on the invariants instead of reinventing them.
 */

import type { PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { RetrievalCorpus } from "@/lib/retrieval";

export const SCOPE_MODES = ["all", "scripture", "sermon", "custom"] as const;
export type ScopeMode = (typeof SCOPE_MODES)[number];

/**
 * Wire shape posted by the chat client. `selectedSourceIds` is only meaningful
 * when `mode === "custom"`; the validator rejects other combinations.
 */
export type ChatSourceScope = Readonly<{
  mode: ScopeMode;
  selectedSourceIds?: readonly string[];
}>;

/** Retrieval-layer shape, matching `retrieveContext` params. */
export type RetrievalScope = Readonly<{
  sourceIds?: readonly string[];
  corpus?: RetrievalCorpus;
}>;

export const DEFAULT_CHAT_SOURCE_SCOPE: ChatSourceScope = { mode: "all" };

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Caller-facing limit so a pathological request can't hammer the DB. */
export const MAX_CUSTOM_SOURCE_IDS = 200;

export type ParsedScopeResult =
  | { ok: true; scope: ChatSourceScope }
  | { ok: false; error: string };

/**
 * Validates the *shape* of a scope payload without touching the DB. Accepts
 * `undefined` (legacy clients, tests) as "default to `all`" so that unwired
 * callers still work. Returns a typed `error` string that the route surfaces
 * as an HTTP 400 body.
 */
export function parseChatSourceScope(raw: unknown): ParsedScopeResult {
  if (raw === undefined || raw === null) {
    return { ok: true, scope: DEFAULT_CHAT_SOURCE_SCOPE };
  }
  if (typeof raw !== "object") {
    return { ok: false, error: "`sourceScope` must be an object" };
  }

  const modeRaw = (raw as { mode?: unknown }).mode;
  const selectedRaw = (raw as { selectedSourceIds?: unknown })
    .selectedSourceIds;

  // Backwards compatibility with Step 13's ad-hoc shape
  // (`{ sourceIds?, corpus? }`): if we see `corpus` or `sourceIds` and no
  // `mode`, translate to the preset form so older clients keep working.
  if (modeRaw === undefined) {
    const legacy = parseLegacyScope(raw);
    if (legacy) {
      return legacy;
    }
    return { ok: true, scope: DEFAULT_CHAT_SOURCE_SCOPE };
  }

  if (!isScopeMode(modeRaw)) {
    return {
      ok: false,
      error: `\`mode\` must be one of ${SCOPE_MODES.join(", ")}`,
    };
  }

  if (modeRaw === "custom") {
    if (!Array.isArray(selectedRaw) || selectedRaw.length === 0) {
      return {
        ok: false,
        error: "`selectedSourceIds` must be a non-empty array when mode is `custom`",
      };
    }
    if (selectedRaw.length > MAX_CUSTOM_SOURCE_IDS) {
      return {
        ok: false,
        error: `\`selectedSourceIds\` exceeds the ${MAX_CUSTOM_SOURCE_IDS}-id limit`,
      };
    }
    const normalized: string[] = [];
    for (const candidate of selectedRaw) {
      if (typeof candidate !== "string" || !UUID_REGEX.test(candidate.trim())) {
        return {
          ok: false,
          error: "`selectedSourceIds` must contain only source UUID strings",
        };
      }
      normalized.push(candidate.trim());
    }
    // Dedupe while preserving order so DB validation queries are tight.
    const deduped = Array.from(new Set(normalized));
    return { ok: true, scope: { mode: "custom", selectedSourceIds: deduped } };
  }

  // Non-custom presets must not smuggle in source ids — that combination is
  // ambiguous (does the user want the corpus filter AND the id list?).
  if (Array.isArray(selectedRaw) && selectedRaw.length > 0) {
    return {
      ok: false,
      error: "`selectedSourceIds` is only allowed when mode is `custom`",
    };
  }

  return { ok: true, scope: { mode: modeRaw } };
}

function isScopeMode(value: unknown): value is ScopeMode {
  return (
    typeof value === "string" &&
    (SCOPE_MODES as readonly string[]).includes(value)
  );
}

/**
 * Translates Step 13's untyped `{ sourceIds?, corpus? }` body into the new
 * preset form. Returned only when the raw object actually carries one of those
 * legacy keys so we don't mask real validation errors.
 */
function parseLegacyScope(raw: object): ParsedScopeResult | null {
  const legacySourceIds = (raw as { sourceIds?: unknown }).sourceIds;
  const legacyCorpus = (raw as { corpus?: unknown }).corpus;

  if (legacySourceIds === undefined && legacyCorpus === undefined) {
    return null;
  }

  if (Array.isArray(legacySourceIds) && legacySourceIds.length > 0) {
    const ids = legacySourceIds.filter(
      (id): id is string => typeof id === "string" && UUID_REGEX.test(id.trim()),
    );
    if (ids.length === 0) {
      return {
        ok: false,
        error: "`sourceIds` must contain only source UUID strings",
      };
    }
    return {
      ok: true,
      scope: { mode: "custom", selectedSourceIds: Array.from(new Set(ids)) },
    };
  }

  if (legacyCorpus === "scripture" || legacyCorpus === "sermon") {
    return { ok: true, scope: { mode: legacyCorpus } };
  }

  return null;
}

export type ValidatedScopeResult =
  | { ok: true; scope: ChatSourceScope }
  | { ok: false; error: string; unknownIds?: string[] };

/**
 * Confirms that every UUID in a `custom` scope resolves to a non-hidden,
 * non-deleted catalog source. Passes through non-custom scopes unchanged —
 * corpus filters are enforced at retrieval time via the SQL join, so there's
 * nothing to pre-validate.
 *
 * Hidden means soft-deleted (`deleted_at IS NOT NULL`). Per spec §5.2 the
 * catalog is shared globally and there's no per-user visibility bit, so "hidden"
 * and "deleted" collapse to the same predicate in v1.
 */
export async function validateChatSourceScope(
  scope: ChatSourceScope,
  deps: { prismaClient?: PrismaClient } = {},
): Promise<ValidatedScopeResult> {
  if (scope.mode !== "custom") {
    return { ok: true, scope };
  }

  const ids = scope.selectedSourceIds ?? [];
  if (ids.length === 0) {
    return {
      ok: false,
      error: "`selectedSourceIds` must be a non-empty array when mode is `custom`",
    };
  }

  const database = deps.prismaClient ?? prisma;
  // `deletedAt: null` rejects soft-deleted ids per spec §5.1: custom scope must
  // only reference visible catalog rows. We do NOT filter by status here — a
  // PENDING/PROCESSING source is still a legitimate selection, retrieval will
  // simply return no chunks until it reaches READY. That keeps the UX honest:
  // "I picked this source and got no hits" is clearer than a silent 400.
  const visible = await database.source.findMany({
    where: { id: { in: Array.from(ids) }, deletedAt: null },
    select: { id: true },
  });
  const visibleIds = new Set(visible.map((row) => row.id));
  const unknown = ids.filter((id) => !visibleIds.has(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: "One or more `selectedSourceIds` do not exist or are no longer available",
      unknownIds: unknown,
    };
  }
  return { ok: true, scope };
}

/**
 * Preset → retrieval arg mapping (master spec §5.3):
 *  - `all`       → no filter; retrieval uses its default corpus quota.
 *  - `scripture` → `corpus: "scripture"`.
 *  - `sermon`    → `corpus: "sermon"`.
 *  - `custom`    → `sourceIds` drives the pgvector join; no corpus filter.
 *
 * This is pure and side-effect free so the unit test can snapshot the mapping.
 */
export function expandScopeForRetrieval(scope: ChatSourceScope): RetrievalScope {
  switch (scope.mode) {
    case "all":
      return {};
    case "scripture":
      return { corpus: "scripture" };
    case "sermon":
      return { corpus: "sermon" };
    case "custom":
      return { sourceIds: scope.selectedSourceIds ?? [] };
  }
}
