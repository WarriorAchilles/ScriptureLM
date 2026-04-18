"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CatalogSourceSummary } from "@/lib/sources/list-catalog";
import type { ChatSourceScope, ScopeMode } from "@/lib/chat/source-scope";
import styles from "./chat.module.css";

/**
 * Source-scope picker for the chat composer (Step 14; master spec §5.1, §6.5).
 *
 * Controls:
 *  - A radio group of four preset modes — **All / Scripture / Sermons / Custom**.
 *    Implemented as `role="radio"` buttons so we can style them as pills while
 *    preserving arrow-key navigation and `aria-checked` semantics per §6.5.
 *  - When `Custom` is active, an expanded listbox-style multi-select with a
 *    free-text filter appears under the radios. The listbox uses standard
 *    `role="listbox"` + `role="option"` + `aria-multiselectable="true"`
 *    patterns so screen readers announce selection changes.
 *
 * The picker is fully controlled by the parent (ChatSurface) so the same
 * `scope` object is serialized into every chat POST; no hidden client state.
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
  onScopeChange: (next: ChatSourceScope) => void;
  catalog: readonly CatalogSourceSummary[];
  /** Disables all controls while a turn is streaming. */
  disabled?: boolean;
};

export function ScopePicker({
  scope,
  onScopeChange,
  catalog,
  disabled = false,
}: ScopePickerProps) {
  const groupLabelId = useId();
  const comboLabelId = useId();
  const listboxId = useId();
  const searchInputId = useId();

  const [filter, setFilter] = useState("");
  const radioContainerRef = useRef<HTMLDivElement | null>(null);

  const selectedIds = useMemo(
    () => new Set(scope.selectedSourceIds ?? []),
    [scope.selectedSourceIds],
  );

  const selectableCatalog = useMemo(() => {
    // Only READY sources can contribute retrieval hits (Step 12), so they're
    // the only meaningful candidates for `custom`. Non-READY rows are still
    // shown on the catalog page so operators can diagnose failures.
    return catalog.filter((source) => source.status === "READY");
  }, [catalog]);

  const filteredCatalog = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) {
      return selectableCatalog;
    }
    return selectableCatalog.filter((source) =>
      source.title.toLowerCase().includes(needle),
    );
  }, [selectableCatalog, filter]);

  const handleSelectMode = useCallback(
    (nextMode: ScopeMode) => {
      if (nextMode === "custom") {
        onScopeChange({
          mode: "custom",
          // Preserve any prior selection so toggling presets doesn't forget work.
          selectedSourceIds: scope.selectedSourceIds ?? [],
        });
        return;
      }
      onScopeChange({ mode: nextMode });
    },
    [onScopeChange, scope.selectedSourceIds],
  );

  const handleToggleSource = useCallback(
    (sourceId: string) => {
      const next = new Set(selectedIds);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      onScopeChange({
        mode: "custom",
        selectedSourceIds: Array.from(next),
      });
    },
    [onScopeChange, selectedIds],
  );

  const handleClearSelection = useCallback(() => {
    onScopeChange({ mode: "custom", selectedSourceIds: [] });
  }, [onScopeChange]);

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

  // Keep the filter in sync with mode changes: leaving `custom` clears the
  // search text so the next opening starts fresh instead of carrying stale
  // input forward.
  useEffect(() => {
    if (scope.mode !== "custom" && filter.length > 0) {
      setFilter("");
    }
  }, [scope.mode, filter.length]);

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

          <label htmlFor={searchInputId} className={styles.visuallyHidden}>
            Filter sources
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

          {filteredCatalog.length === 0 ? (
            <p className={styles.scopeEmpty} role="status">
              {selectableCatalog.length === 0
                ? "No READY sources available yet."
                : "No sources match that filter."}
            </p>
          ) : (
            <ul
              id={listboxId}
              role="listbox"
              aria-multiselectable="true"
              aria-labelledby={comboLabelId}
              className={styles.scopeList}
            >
              {filteredCatalog.map((source) => {
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
                      disabled={disabled}
                      onClick={() => handleToggleSource(source.id)}
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
