"use client";

import { useCallback, useId, useMemo, useRef } from "react";
import type { CatalogSourceSummary } from "@/lib/sources/list-catalog";
import type { ParsedCatalogPath } from "@/lib/sources/catalog-folders";
import type { ChatSourceScope, ScopeMode } from "@/lib/chat/source-scope";
import { buildCustomSelectedSourceIds } from "@/lib/sources/custom-scope-selection";
import { CustomScopeBrowser } from "./custom-scope-browser";
import styles from "./chat.module.css";

/**
 * Source-scope picker for the chat composer (Step 14; master spec §5.1, §6.5).
 *
 * Controls:
 *  - A radio group of four preset modes — **All / Scripture / Sermons / Custom**.
 *    Implemented as `role="radio"` buttons so we can style them as pills while
 *    preserving arrow-key navigation and `aria-checked` semantics per §6.5.
 *  - When `Custom` is active, a folder browser (same tree as Sources) appears:
 *    open subfolders, add entire folders, or pick individual sources in a leaf;
 *    leaf lists use `role="listbox"` + `role="option"` for accessibility.
 *
 * The picker is controlled by the parent (ChatSurface): preset mode plus, for
 * Custom, folder path keys and loose source ids that the parent folds into
 * `ChatSourceScope.selectedSourceIds` for each POST.
 */

const PRESETS: ReadonlyArray<{
  mode: ScopeMode;
  label: string;
  description: string;
}> = [
  {
    mode: "all",
    label: "All",
    description: "Scripture and sermon transcripts",
  },
  {
    mode: "scripture",
    label: "Scripture",
    description: "Bible passages only",
  },
  {
    mode: "sermon",
    label: "Sermons",
    description: "Sermon transcripts only",
  },
  {
    mode: "custom",
    label: "Custom",
    description: "Pick specific sources",
  },
];

export type ScopePickerProps = {
  scope: ChatSourceScope;
  onScopeModeChange: (mode: ScopeMode) => void;
  customFolderPathKeys: readonly string[];
  customLooseSourceIds: readonly string[];
  onAddCustomFolder: (path: ParsedCatalogPath) => void;
  onToggleCustomLooseSource: (sourceId: string) => void;
  onClearCustomSelection: () => void;
  catalog: readonly CatalogSourceSummary[];
  /** Disables all controls while a turn is streaming. */
  disabled?: boolean;
};

export function ScopePicker({
  scope,
  onScopeModeChange,
  customFolderPathKeys,
  customLooseSourceIds,
  onAddCustomFolder,
  onToggleCustomLooseSource,
  onClearCustomSelection,
  catalog,
  disabled = false,
}: ScopePickerProps) {
  const groupLabelId = useId();
  const comboLabelId = useId();

  const radioContainerRef = useRef<HTMLDivElement | null>(null);

  const selectableCatalog = useMemo(() => {
    // Only READY sources can contribute retrieval hits (Step 12), so they're
    // the only meaningful candidates for `custom`. Non-READY rows are still
    // shown on the catalog page so operators can diagnose failures.
    return catalog.filter((source) => source.status === "READY");
  }, [catalog]);

  const selectedIds = useMemo(
    () =>
      new Set(
        buildCustomSelectedSourceIds(
          selectableCatalog,
          customFolderPathKeys,
          customLooseSourceIds,
        ),
      ),
    [selectableCatalog, customFolderPathKeys, customLooseSourceIds],
  );

  const handleSelectMode = useCallback(
    (nextMode: ScopeMode) => {
      onScopeModeChange(nextMode);
    },
    [onScopeModeChange],
  );

  const handleClearSelection = useCallback(() => {
    onClearCustomSelection();
  }, [onClearCustomSelection]);

  // Arrow-key navigation across the radio pills (§6.5).
  const handleRadioKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) {
        return;
      }
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
        return;
      }
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const currentIndex = PRESETS.findIndex((preset) => preset.mode === scope.mode);
      const nextIndex =
        (currentIndex + direction + PRESETS.length) % PRESETS.length;
      handleSelectMode(PRESETS[nextIndex]!.mode);
      const container = radioContainerRef.current;
      if (container) {
        const button = container.querySelectorAll<HTMLButtonElement>(
          '[role="radio"]',
        )[nextIndex];
        button?.focus();
      }
    },
    [disabled, handleSelectMode, scope.mode],
  );

  const isCustomActive = scope.mode === "custom";
  const selectionSummary = describeSelection(scope, catalog);

  return (
    <div className={styles.scopePicker} aria-label="Source scope">
      <div className={styles.scopeHeader}>
        <span id={groupLabelId} className={styles.scopeLabel}>
          Scope
        </span>
        <span className={styles.scopeSummary} aria-live="polite">
          {selectionSummary}
        </span>
      </div>

      <div
        ref={radioContainerRef}
        role="radiogroup"
        aria-labelledby={groupLabelId}
        className={styles.scopePresets}
        onKeyDown={handleRadioKeyDown}
      >
        {PRESETS.map((preset) => {
          const isActive = scope.mode === preset.mode;
          return (
            <button
              key={preset.mode}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-pressed={isActive}
              aria-label={`${preset.label} — ${preset.description}`}
              tabIndex={isActive ? 0 : -1}
              className={`${styles.scopePreset} ${
                isActive ? styles.scopePresetActive : ""
              }`}
              disabled={disabled}
              onClick={() => handleSelectMode(preset.mode)}
            >
              <span className={styles.scopePresetLabel}>{preset.label}</span>
              <span className={styles.scopePresetHint}>{preset.description}</span>
            </button>
          );
        })}
      </div>

      {isCustomActive ? (
        <div className={styles.scopeCustom} aria-labelledby={comboLabelId}>
          <div className={styles.scopeCustomHeader}>
            <span id={comboLabelId} className={styles.scopeLabel}>
              Select sources
            </span>
            {selectedIds.size > 0 ? (
              <button
                type="button"
                className={styles.scopeClear}
                onClick={handleClearSelection}
                disabled={disabled}
              >
                Clear ({selectedIds.size})
              </button>
            ) : null}
          </div>

          {selectableCatalog.length === 0 ? (
            <p className={styles.scopeEmpty} role="status">
              No READY sources available yet.
            </p>
          ) : (
            <CustomScopeBrowser
              readySources={selectableCatalog}
              folderPathKeys={customFolderPathKeys}
              selectedIds={selectedIds}
              onAddFolder={onAddCustomFolder}
              onToggleLooseSource={onToggleCustomLooseSource}
              disabled={disabled}
              isCustomMode={isCustomActive}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Human-readable summary shown to the right of the scope pills. For `custom`
 * we surface either the count or the single selected title so sighted users
 * don't need to expand the listbox to confirm what's active.
 */
function describeSelection(
  scope: ChatSourceScope,
  catalog: readonly CatalogSourceSummary[],
): string {
  switch (scope.mode) {
    case "all":
      return "Searching the full catalog";
    case "scripture":
      return "Searching Scripture only";
    case "sermon":
      return "Searching sermon transcripts only";
    case "custom": {
      const ids = scope.selectedSourceIds ?? [];
      if (ids.length === 0) {
        return "Select at least one source below";
      }
      if (ids.length === 1) {
        const match = catalog.find((source) => source.id === ids[0]);
        return match ? `Searching ${match.title}` : "Searching 1 source";
      }
      return `Searching ${ids.length} sources`;
    }
  }
}
