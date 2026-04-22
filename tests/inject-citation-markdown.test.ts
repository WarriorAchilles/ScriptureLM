import { describe, expect, it } from "vitest";
import {
  collectCitationLabelsFromContentAndRecord,
  injectCitationMarkdownLinks,
} from "@/lib/chat/inject-citation-markdown";

describe("collectCitationLabelsFromContentAndRecord", () => {
  it("adds labels from [Cn] markers even when citations metadata is absent", () => {
    const labels = collectCitationLabelsFromContentAndRecord(
      "Hello [C2] and [C10].",
      undefined,
    );
    expect([...labels].sort()).toEqual(["C10", "C2"]);
  });

  it("merges citation record keys with bracket markers in content", () => {
    const labels = collectCitationLabelsFromContentAndRecord("See [C1].", {
      C1: { label: "C1", snippet: "x", heading: "y" },
    });
    expect(labels.has("C1")).toBe(true);
  });
});

describe("injectCitationMarkdownLinks", () => {
  it("turns [C1] into a cite: markdown link", () => {
    const out = injectCitationMarkdownLinks("See [C1] here.", new Set(["C1"]));
    expect(out).toBe("See [[C1]](cite:C1) here.");
  });

  it("replaces longer labels first so C10 is not split by C1", () => {
    const out = injectCitationMarkdownLinks("[C10] [C1]", new Set(["C1", "C10"]));
    expect(out).toBe("[[C10]](cite:C10) [[C1]](cite:C1)");
  });

  it("does not corrupt an already-injected [[C1]](cite:C1)", () => {
    const already = "x [[C1]](cite:C1) y";
    const out = injectCitationMarkdownLinks(already, new Set(["C1"]));
    expect(out).toBe(already);
  });
});
