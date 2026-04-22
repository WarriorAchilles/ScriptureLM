"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CatalogSourceSummary } from "@/lib/sources/list-catalog";
import {
  catalogPathBreadcrumbTrail,
  catalogFolderLabel,
  isCatalogLeafPath,
  parseCatalogPath,
  type ParsedCatalogPath,
} from "@/lib/sources/catalog-folders";
import {
  catalogPathKey,
  computeScopeFolderIndexFromReadySources,
  listChildFolderNavItems,
  listReadySourceIdsInFolder,
  listReadySourcesInFolder,
  parentCatalogPath,
  scopeLeafHeading,
} from "@/lib/sources/scope-folder-model";
import {
  folderPathFullyCoveredByExistingFolders,
  sourceIdCoveredByFolderKeys,
} from "@/lib/sources/custom-scope-selection";
import styles from "./chat.module.css";

type CustomScopeBrowserProps = {
  readySources: readonly CatalogSourceSummary[];
  /** Folder paths added as a single scope unit (see `catalogPathKey`). */
  folderPathKeys: readonly string[];
  selectedIds: ReadonlySet<string>;
  onAddFolder: (path: ParsedCatalogPath) => void;
  onToggleLooseSource: (sourceId: string) => void;
  disabled: boolean;
  /** When false, folder navigation resets when the user returns to Custom. */
  isCustomMode: boolean;
};

export function CustomScopeBrowser({
  readySources,
  folderPathKeys,
  selectedIds,
  onAddFolder,
  onToggleLooseSource,
  disabled,
  isCustomMode,
}: CustomScopeBrowserProps) {
  const searchInputId = useId();
  const listboxId = useId();
  const [browsePath, setBrowsePath] = useState<ParsedCatalogPath>({ kind: "root" });
  const [filter, setFilter] = useState("");
  const wasCustomRef = useRef(false);

  useEffect(() => {
    if (isCustomMode && !wasCustomRef.current) {
      setBrowsePath({ kind: "root" });
      setFilter("");
    }
    wasCustomRef.current = isCustomMode;
  }, [isCustomMode]);

  useEffect(() => {
    setFilter("");
  }, [browsePath]);

  const folderIndex = useMemo(
    () => computeScopeFolderIndexFromReadySources(readySources),
    [readySources],
  );

  const isLeaf = isCatalogLeafPath(browsePath);

  const childFolders = useMemo(
    () => listChildFolderNavItems(browsePath, folderIndex),
    [browsePath, folderIndex],
  );

  const leafSources = useMemo(() => {
    if (!isLeaf) {
      return [];
    }
    return listReadySourcesInFolder(readySources, browsePath);
  }, [readySources, browsePath, isLeaf]);

  const filteredLeafSources = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) {
      return leafSources;
    }
    return leafSources.filter((source) => source.title.toLowerCase().includes(needle));
  }, [leafSources, filter]);

  const addAllInFolder = useCallback(
    (path: ParsedCatalogPath) => {
      if (folderPathFullyCoveredByExistingFolders(readySources, folderPathKeys, path)) {
        return;
      }
      onAddFolder(path);
    },
    [readySources, folderPathKeys, onAddFolder],
  );

  const toggleSource = useCallback(
    (sourceId: string) => {
      onToggleLooseSource(sourceId);
    },
    [onToggleLooseSource],
  );

  const navigateToPathQuery = useCallback((pathQuery: string) => {
    setBrowsePath(parseCatalogPath(pathQuery));
  }, []);

  const breadcrumbTrail = catalogPathBreadcrumbTrail(browsePath);
  const parentPath = parentCatalogPath(browsePath);
  const canGoUp = browsePath.kind !== "root";

  const browseTitle =
    browsePath.kind === "root"
      ? "Browse by folder"
      : catalogFolderLabel(browsePath);

  return (
    <div className={styles.scopeCustomBrowser}>
      <nav className={styles.scopeFolderBreadcrumb} aria-label="Folder path">
        <button
          type="button"
          className={styles.scopeBreadcrumbLink}
          disabled={disabled || browsePath.kind === "root"}
          onClick={() => setBrowsePath({ kind: "root" })}
        >
          All folders
        </button>
        {breadcrumbTrail.map((segment, index) => {
          const isLast = index === breadcrumbTrail.length - 1;
          return (
            <span key={`${segment.pathQuery}-${index}`} className={styles.scopeBreadcrumbSegment}>
              <span className={styles.scopeBreadcrumbSep} aria-hidden="true">
                /
              </span>
              {isLast ? (
                <span className={styles.scopeBreadcrumbCurrent}>{segment.label}</span>
              ) : (
                <button
                  type="button"
                  className={styles.scopeBreadcrumbLink}
                  disabled={disabled}
                  onClick={() => navigateToPathQuery(segment.pathQuery)}
                >
                  {segment.label}
                </button>
              )}
            </span>
          );
        })}
      </nav>

      <div className={styles.scopeFolderToolbar}>
        {canGoUp ? (
          <button
            type="button"
            className={styles.scopeFolderUp}
            disabled={disabled}
            onClick={() => setBrowsePath(parentPath)}
          >
            Back
          </button>
        ) : null}
        {!isLeaf && browsePath.kind !== "root" ? (
          <button
            type="button"
            className={styles.scopeFolderAddAll}
            disabled={
              disabled ||
              folderPathFullyCoveredByExistingFolders(readySources, folderPathKeys, browsePath)
            }
            onClick={() => addAllInFolder(browsePath)}
          >
            Add entire folder
          </button>
        ) : null}
      </div>

      <p className={styles.scopeFolderBrowseTitle}>{browseTitle}</p>

      {!isLeaf ? (
        <ul className={styles.scopeFolderList} key={catalogPathKey(browsePath)}>
          {childFolders.length === 0 ? (
            <li className={styles.scopeFolderEmpty}>
              No sources in this branch yet.
            </li>
          ) : (
            childFolders.map((item) => (
              <li key={catalogPathKey(item.path)} className={styles.scopeFolderRow}>
                <div className={styles.scopeFolderRowMain}>
                  <span className={styles.scopeFolderRowTitle}>{item.label}</span>
                  <span className={styles.scopeFolderRowMeta}>
                    {item.count.toLocaleString()}{" "}
                    {item.count === 1 ? "source" : "sources"}
                  </span>
                </div>
                <div className={styles.scopeFolderRowActions}>
                  <button
                    type="button"
                    className={styles.scopeFolderRowOpen}
                    disabled={disabled}
                    onClick={() => setBrowsePath(item.path)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className={styles.scopeFolderRowAddAll}
                    disabled={
                      disabled ||
                      folderPathFullyCoveredByExistingFolders(
                        readySources,
                        folderPathKeys,
                        item.path,
                      )
                    }
                    onClick={() => addAllInFolder(item.path)}
                  >
                    Add all
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      ) : (
        <div className={styles.scopeLeafWrap}>
          <div className={styles.scopeLeafHeader}>
            <p className={styles.scopeLeafHeading}>{scopeLeafHeading(browsePath)}</p>
            <button
              type="button"
              className={styles.scopeFolderAddAll}
              disabled={
                disabled ||
                leafSources.length === 0 ||
                folderPathFullyCoveredByExistingFolders(readySources, folderPathKeys, browsePath)
              }
              onClick={() => addAllInFolder(browsePath)}
            >
              Add all in folder
            </button>
          </div>

          <label htmlFor={searchInputId} className={styles.visuallyHidden}>
            Filter sources in this folder
          </label>
          <input
            id={searchInputId}
            type="search"
            className={styles.scopeSearch}
            placeholder="Filter by title…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-controls={listboxId}
            autoComplete="off"
            disabled={disabled}
          />

          {filteredLeafSources.length === 0 ? (
            <p className={styles.scopeEmpty} role="status">
              {leafSources.length === 0
                ? "No READY sources in this folder."
                : "No sources match that filter."}
            </p>
          ) : (
            <ul
              id={listboxId}
              role="listbox"
              aria-multiselectable="true"
              aria-label={scopeLeafHeading(browsePath)}
              className={styles.scopeList}
            >
              {filteredLeafSources.map((source) => {
                const coveredByFolder = sourceIdCoveredByFolderKeys(
                  readySources,
                  folderPathKeys,
                  source.id,
                );
                const isSelected = selectedIds.has(source.id);
                return (
                  <li key={source.id} role="none" className={styles.scopeListItem}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`${styles.scopeOption} ${
                        isSelected ? styles.scopeOptionActive : ""
                      }`}
                      disabled={disabled || coveredByFolder}
                      title={
                        coveredByFolder
                          ? "Already included via a folder in custom scope"
                          : undefined
                      }
                      onClick={() => toggleSource(source.id)}
                    >
                      <span className={styles.scopeOptionCheckbox} aria-hidden="true">
                        {isSelected ? "✓" : ""}
                      </span>
                      <span className={styles.scopeOptionLabel}>
                        <span className={styles.scopeOptionTitle}>{source.title}</span>
                        <span className={styles.scopeOptionMeta}>{source.corpus}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
