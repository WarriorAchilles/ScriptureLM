/**
 * Step 15: unit tests for the pure pieces of summary assembly — param
 * parsing and the prompt builders. Context loaders (`loadOrderedChunks`,
 * `buildSourceContext`, `buildLibraryContext`) are exercised end-to-end
 * through the API tests so they stay covered against the real DB shape.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_FOCUS_CHARS,
  parseSummaryParams,
} from "@/lib/summaries/params";
import {
  ATTRIBUTION_PREFIX,
  buildLibrarySummaryPrompt,
  buildSourceSummaryPrompt,
} from "@/lib/summaries/summary-prompt";
import type { SummarySourceRecord } from "@/lib/summaries/context";

const genesisSource: SummarySourceRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Genesis",
  corpus: "scripture",
  status: "READY",
  bibleBook: "Genesis",
  bibleTranslation: "KJV",
  sermonCatalogId: null,
  storageKey: "scripture/genesis.md",
};

const sermonSource: SummarySourceRecord = {
  id: "00000000-0000-4000-8000-000000000002",
  title: "63-0728",
  corpus: "sermon",
  status: "READY",
  bibleBook: null,
  bibleTranslation: null,
  sermonCatalogId: "63-0728",
  storageKey: "sermons/63-0728.md",
};

describe("parseSummaryParams", () => {
  it("parses a complete body", () => {
    const result = parseSummaryParams({
      length: "short",
      audience: "plain",
      focus: "   covenant themes   ",
    });
    expect(result).toEqual({
      ok: true,
      params: { length: "short", audience: "plain", focus: "covenant themes" },
    });
  });

  it("treats an empty focus as null", () => {
    const result = parseSummaryParams({
      length: "long",
      audience: "technical",
      focus: "   ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.focus).toBeNull();
    }
  });

  it("rejects bad length / audience values with a clear message", () => {
    expect(parseSummaryParams({ length: "tiny", audience: "plain" }).ok).toBe(false);
    expect(parseSummaryParams({ length: "short", audience: "casual" }).ok).toBe(false);
  });

  it("clamps focus to MAX_FOCUS_CHARS", () => {
    const oversized = "a".repeat(MAX_FOCUS_CHARS + 200);
    const result = parseSummaryParams({
      length: "short",
      audience: "plain",
      focus: oversized,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.focus).not.toBeNull();
      expect(result.params.focus!.length).toBe(MAX_FOCUS_CHARS);
    }
  });
});

describe("buildSourceSummaryPrompt", () => {
  it("embeds the source title and chunk bodies in the user message", () => {
    const { system, userContent } = buildSourceSummaryPrompt({
      source: genesisSource,
      chunks: [
        "In the beginning God created the heaven and the earth.",
        "And the earth was without form, and void.",
      ],
      truncated: false,
      params: { length: "short", audience: "plain", focus: null },
    });

    expect(system).toContain(ATTRIBUTION_PREFIX);
    expect(system).toContain("Genesis");
    expect(userContent).toContain("Genesis");
    expect(userContent).toContain(
      "In the beginning God created the heaven and the earth.",
    );
    expect(userContent).toContain("And the earth was without form, and void.");
  });

  it("surfaces a truncation note when the chunks were budgeted down", () => {
    const { userContent } = buildSourceSummaryPrompt({
      source: genesisSource,
      chunks: ["partial content"],
      truncated: true,
      params: { length: "short", audience: "plain", focus: null },
    });
    expect(userContent).toMatch(/truncated/i);
  });
});

describe("buildLibrarySummaryPrompt", () => {
  it("names every contributing source in both the system and user prompts", () => {
    const { system, userContent } = buildLibrarySummaryPrompt({
      contributingSources: [
        {
          source: genesisSource,
          chunks: ["Genesis chunk text"],
          truncated: false,
        },
        {
          source: sermonSource,
          chunks: ["Sermon chunk text"],
          truncated: true,
        },
      ],
      params: { length: "long", audience: "technical", focus: null },
    });

    // System prompt must list BOTH titles so the model emits a complete
    // `Sources: …` line (master spec §5.4 attribution).
    expect(system).toContain("Genesis");
    expect(system).toContain("63-0728");
    expect(system).toContain(ATTRIBUTION_PREFIX);

    // User prompt carries the grounded context per source.
    expect(userContent).toContain("Genesis");
    expect(userContent).toContain("63-0728");
    expect(userContent).toContain("Genesis chunk text");
    expect(userContent).toContain("Sermon chunk text");
    expect(userContent).toMatch(/truncated/i);
  });
});
