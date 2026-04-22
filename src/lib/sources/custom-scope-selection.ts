/**
 * Helpers for chat Custom scope: folder pills vs loose source ids, ancestor
 * folder deduplication, and building the wire `selectedSourceIds` list.
 */

import {
  parseCatalogPath,
  type ParsedCatalogPath,
} from "@/lib/sources/catalog-folders";
import type { CatalogSourceSummary } from "@/lib/sources/list-catalog";
import {
  catalogPathKey,
  listReadySourceIdsInFolder,
  parentCatalogPath,
  sourceMatchesCatalogPath,
} from "@/lib/sources/scope-folder-model";

/** True when `ancestor` is `descendant` or strictly above it in the browse tree. */
export function catalogPathIsAncestorOrEqual(
  ancestor: ParsedCatalogPath,
  descendant: ParsedCatalogPath,
): boolean {
  let current: ParsedCatalogPath = descendant;
  for (let depth = 0; depth < 24; depth += 1) {
    if (catalogPathKey(current) === catalogPathKey(ancestor)) {
      return true;
    }
    if (current.kind === "root") {
      return false;
    }
    current = parentCatalogPath(current);
  }
  return false;
}

function isStrictAncestor(
  ancestor: ParsedCatalogPath,
  descendant: ParsedCatalogPath,
): boolean {
  return (
    catalogPathIsAncestorOrEqual(ancestor, descendant) &&
    catalogPathKey(ancestor) !== catalogPathKey(descendant)
  );
}

/**
 * Inserts a folder add into an ordered key list: skips duplicates, rejects adds
 * already covered by an ancestor folder, and drops strict-descendant folder keys
 * when a broader folder is added.
 */
export function mergeFolderPathKeysOnAdd(
  existingOrderedKeys: readonly string[],
  addedPath: ParsedCatalogPath,
): string[] {
  const addedKey = catalogPathKey(addedPath);
  if (addedKey === "root") {
    return [...existingOrderedKeys];
  }
  if (existingOrderedKeys.includes(addedKey)) {
    return [...existingOrderedKeys];
  }
  const existingPaths = existingOrderedKeys.map((key) => parseCatalogPath(key));
  for (const existingPath of existingPaths) {
    if (isStrictAncestor(existingPath, addedPath)) {
      return [...existingOrderedKeys];
    }
  }
  const filteredKeys = existingOrderedKeys.filter((key) => {
    const path = parseCatalogPath(key);
    return !isStrictAncestor(addedPath, path);
  });
  return [...filteredKeys, addedKey];
}

export function sourceIdCoveredByFolderKeys(
  readySources: readonly CatalogSourceSummary[],
  folderPathKeys: readonly string[],
  sourceId: string,
): boolean {
  const source = readySources.find((row) => row.id === sourceId);
  if (!source) {
    return false;
  }
  return folderPathKeys.some((key) =>
    sourceMatchesCatalogPath(source, parseCatalogPath(key)),
  );
}

export function buildCustomSelectedSourceIds(
  readySources: readonly CatalogSourceSummary[],
  folderPathKeys: readonly string[],
  looseSourceIds: readonly string[],
): string[] {
  const set = new Set<string>();
  for (const key of folderPathKeys) {
    for (const id of listReadySourceIdsInFolder(readySources, parseCatalogPath(key))) {
      set.add(id);
    }
  }
  for (const id of looseSourceIds) {
    set.add(id);
  }
  return Array.from(set);
}

export function pruneLooseIdsCoveredByFolders(
  readySources: readonly CatalogSourceSummary[],
  folderPathKeys: readonly string[],
  looseSourceIds: readonly string[],
): string[] {
  return looseSourceIds.filter(
    (id) => !sourceIdCoveredByFolderKeys(readySources, folderPathKeys, id),
  );
}

/** True when every READY source in `path` is already covered by `folderPathKeys`. */
export function folderPathFullyCoveredByExistingFolders(
  readySources: readonly CatalogSourceSummary[],
  folderPathKeys: readonly string[],
  path: ParsedCatalogPath,
): boolean {
  const candidateIds = listReadySourceIdsInFolder(readySources, path);
  if (candidateIds.length === 0) {
    return false;
  }
  return candidateIds.every((id) =>
    sourceIdCoveredByFolderKeys(readySources, folderPathKeys, id),
  );
}
