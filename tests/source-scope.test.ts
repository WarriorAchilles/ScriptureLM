/**
 * Step 14: source scope — parser, validator, and preset→retrieval mapping.
 *
 * The mapping snapshot is the single source of truth the UI and the chat route
 * both depend on. Keeping it locked here means that changing the preset
 * semantics requires updating this assertion — which forces a matching UI /
 * docs update.
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_CHAT_SOURCE_SCOPE,
  MAX_CUSTOM_SOURCE_IDS,
  expandScopeForRetrieval,
  parseChatSourceScope,
  validateChatSourceScope,
  type ChatSourceScope,
} from "@/lib/chat/source-scope";

const VALID_UUID_A = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_B = "22222222-2222-4222-8222-222222222222";
const VALID_UUID_C = "33333333-3333-4333-8333-333333333333";

describe("expandScopeForRetrieval", () => {
  it("maps every preset to the expected retrieval args (snapshot)", () => {
    const allModes: ChatSourceScope[] = [
      { mode: "all" },
      { mode: "scripture" },
      { mode: "sermon" },
      { mode: "custom", selectedSourceIds: [VALID_UUID_A, VALID_UUID_B] },
    ];

    const mapping = Object.fromEntries(
      allModes.map((scope) => [
        scope.mode,
        expandScopeForRetrieval(scope),
      ]),
    );

    expect(mapping).toMatchInlineSnapshot(`
      {
        "all": {},
        "custom": {
          "sourceIds": [
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
          ],
        },
        "scripture": {
          "corpus": "scripture",
        },
        "sermon": {
          "corpus": "sermon",
        },
      }
    `);
  });

  it("returns an empty sourceIds array when custom has no selection", () => {
    // Defence-in-depth: validator rejects this shape, but retrieval itself
    // treats `[]` as "zero sources → zero results", so the mapping must not
    // collapse back to `{}`.
    expect(
      expandScopeForRetrieval({ mode: "custom", selectedSourceIds: [] }),
    ).toEqual({ sourceIds: [] });
  });
});

describe("parseChatSourceScope", () => {
  it("defaults to `all` when payload is missing", () => {
    expect(parseChatSourceScope(undefined)).toEqual({
      ok: true,
      scope: DEFAULT_CHAT_SOURCE_SCOPE,
    });
    expect(parseChatSourceScope(null)).toEqual({
      ok: true,
      scope: DEFAULT_CHAT_SOURCE_SCOPE,
    });
  });

  it("accepts each preset without extra keys", () => {
    for (const mode of ["all", "scripture", "sermon"] as const) {
      const result = parseChatSourceScope({ mode });
      expect(result).toEqual({ ok: true, scope: { mode } });
    }
  });

  it("rejects unknown modes with a stable error", () => {
    const result = parseChatSourceScope({ mode: "bogus" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/mode/);
    }
  });

  it("requires a non-empty, UUID-only array for custom", () => {
    expect(parseChatSourceScope({ mode: "custom" }).ok).toBe(false);
    expect(
      parseChatSourceScope({ mode: "custom", selectedSourceIds: [] }).ok,
    ).toBe(false);
    expect(
      parseChatSourceScope({
        mode: "custom",
        selectedSourceIds: ["not-a-uuid"],
      }).ok,
    ).toBe(false);
    const good = parseChatSourceScope({
      mode: "custom",
      selectedSourceIds: [VALID_UUID_A, VALID_UUID_B],
    });
    expect(good).toEqual({
      ok: true,
      scope: {
        mode: "custom",
        selectedSourceIds: [VALID_UUID_A, VALID_UUID_B],
      },
    });
  });

  it("dedupes selected ids while preserving first-seen order", () => {
    const result = parseChatSourceScope({
      mode: "custom",
      selectedSourceIds: [VALID_UUID_B, VALID_UUID_A, VALID_UUID_B],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scope.selectedSourceIds).toEqual([
        VALID_UUID_B,
        VALID_UUID_A,
      ]);
    }
  });

  it("caps selected ids at MAX_CUSTOM_SOURCE_IDS", () => {
    const tooMany = Array.from({ length: MAX_CUSTOM_SOURCE_IDS + 1 }, (_, index) =>
      // Construct distinct UUIDs so dedupe doesn't hide the limit.
      `${"0".repeat(8)}-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    const result = parseChatSourceScope({
      mode: "custom",
      selectedSourceIds: tooMany,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects selectedSourceIds on non-custom modes", () => {
    expect(
      parseChatSourceScope({
        mode: "scripture",
        selectedSourceIds: [VALID_UUID_A],
      }).ok,
    ).toBe(false);
  });

  it("coerces the Step 13 legacy `{ corpus }` shape into a preset", () => {
    expect(parseChatSourceScope({ corpus: "scripture" })).toEqual({
      ok: true,
      scope: { mode: "scripture" },
    });
    expect(parseChatSourceScope({ corpus: "sermon" })).toEqual({
      ok: true,
      scope: { mode: "sermon" },
    });
  });

  it("coerces the Step 13 legacy `{ sourceIds }` shape into custom", () => {
    expect(
      parseChatSourceScope({ sourceIds: [VALID_UUID_A] }),
    ).toEqual({
      ok: true,
      scope: { mode: "custom", selectedSourceIds: [VALID_UUID_A] },
    });
  });
});

describe("validateChatSourceScope", () => {
  it("passes preset modes through untouched (no DB round-trip)", async () => {
    const findMany = vi.fn();
    const prismaClient = {
      source: { findMany },
    } as unknown as PrismaClient;

    for (const mode of ["all", "scripture", "sermon"] as const) {
      const result = await validateChatSourceScope(
        { mode },
        { prismaClient },
      );
      expect(result).toEqual({ ok: true, scope: { mode } });
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns ok when every custom id resolves to a visible row", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ id: VALID_UUID_A }, { id: VALID_UUID_B }]);
    const prismaClient = {
      source: { findMany },
    } as unknown as PrismaClient;

    const result = await validateChatSourceScope(
      { mode: "custom", selectedSourceIds: [VALID_UUID_A, VALID_UUID_B] },
      { prismaClient },
    );
    expect(result.ok).toBe(true);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [VALID_UUID_A, VALID_UUID_B] },
        deletedAt: null,
      },
      select: { id: true },
    });
  });

  it("reports the missing ids when one is hidden/unknown", async () => {
    // `VALID_UUID_C` is the bogus/hidden one — Prisma returns only the other two.
    const findMany = vi
      .fn()
      .mockResolvedValue([{ id: VALID_UUID_A }, { id: VALID_UUID_B }]);
    const prismaClient = {
      source: { findMany },
    } as unknown as PrismaClient;

    const result = await validateChatSourceScope(
      {
        mode: "custom",
        selectedSourceIds: [VALID_UUID_A, VALID_UUID_B, VALID_UUID_C],
      },
      { prismaClient },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unknownIds).toEqual([VALID_UUID_C]);
    }
  });
});
