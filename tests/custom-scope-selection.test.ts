import { describe, expect, it } from "vitest";
import { parseCatalogPath } from "@/lib/sources/catalog-folders";
import {
  catalogPathIsAncestorOrEqual,
  mergeFolderPathKeysOnAdd,
} from "@/lib/sources/custom-scope-selection";

describe("custom-scope-selection", () => {
  it("mergeFolderPathKeysOnAdd skips when an ancestor folder is already selected", () => {
    const keys = ["message"];
    const next = mergeFolderPathKeysOnAdd(keys, parseCatalogPath("message/2020"));
    expect(next).toEqual(["message"]);
  });

  it("mergeFolderPathKeysOnAdd replaces strict-descendant keys when a broader folder is added", () => {
    const keys = ["message/2020", "bible/ot"];
    const next = mergeFolderPathKeysOnAdd(keys, parseCatalogPath("message"));
    expect(next).toEqual(["bible/ot", "message"]);
  });

  it("mergeFolderPathKeysOnAdd keeps order of unrelated keys and appends the new folder", () => {
    const keys = ["bible/ot"];
    const next = mergeFolderPathKeysOnAdd(keys, parseCatalogPath("message/2021"));
    expect(next).toEqual(["bible/ot", "message/2021"]);
  });

  it("mergeFolderPathKeysOnAdd ignores duplicate keys", () => {
    const keys = ["message"];
    const next = mergeFolderPathKeysOnAdd(keys, parseCatalogPath("message"));
    expect(next).toEqual(["message"]);
  });

  it("catalogPathIsAncestorOrEqual matches parent chain", () => {
    const leaf = parseCatalogPath("bible/ot/Genesis");
    const ot = parseCatalogPath("bible/ot");
    expect(catalogPathIsAncestorOrEqual(ot, leaf)).toBe(true);
    expect(catalogPathIsAncestorOrEqual(leaf, ot)).toBe(false);
  });
});
