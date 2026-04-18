"use client";

import { useCallback, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { CatalogSourceSummary } from "@/lib/sources/list-catalog";
import type {
  SummaryAudience,
  SummaryLength,
} from "@/lib/summaries/params";
import styles from "./summaries.module.css";

type SummaryMode = "source" | "library";

type LibraryScopeMode = "all" | "scripture" | "sermon" | "custom";

type SummaryAttribution = { id: string; title: string };

type SummaryResponse = {
  content: string;
  sources: SummaryAttribution[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string | null;
};

type GenerateState = {
  status: "idle" | "loading" | "ready" | "error";
  summary: SummaryResponse | null;
  error: string | null;
};

const INITIAL_STATE: GenerateState = {
  status: "idle",
  summary: null,
  error: null,
};

/**
 * Summaries form + result surface. Fully controlled client component so the
 * "Regenerate" button can re-POST with the same or edited parameters without
 * needing to persist a server-side record (master spec §5.4).
 */
export function SummariesSurface({
  catalog,
}: {
  catalog: readonly CatalogSourceSummary[];
}) {
  const readySources = useMemo(
    () => catalog.filter((source) => source.status === "READY"),
    [catalog],
  );

  const [mode, setMode] = useState<SummaryMode>("source");
  const [length, setLength] = useState<SummaryLength>("short");
  const [audience, setAudience] = useState<SummaryAudience>("plain");
  const [focus, setFocus] = useState<string>("");

  const [selectedSourceId, setSelectedSourceId] = useState<string>(
    readySources[0]?.id ?? "",
  );

  const [libraryScope, setLibraryScope] = useState<LibraryScopeMode>("all");
  const [customSelection, setCustomSelection] = useState<Set<string>>(
    () => new Set(),
  );
  const [customFilter, setCustomFilter] = useState<string>("");

  const [result, setResult] = useState<GenerateState>(INITIAL_STATE);

  const filteredCatalogForCustom = useMemo(() => {
    const needle = customFilter.trim().toLowerCase();
    if (!needle) {
      return readySources;
    }
    return readySources.filter((source) =>
      source.title.toLowerCase().includes(needle),
    );
  }, [readySources, customFilter]);

  const toggleCustomId = useCallback((sourceId: string) => {
    setCustomSelection((previous) => {
      const next = new Set(previous);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  }, []);

  const submit = useCallback(async () => {
    if (mode === "source" && !selectedSourceId) {
      setResult({
        status: "error",
        summary: null,
        error: "Pick a source to summarize.",
      });
      return;
    }
    if (
      mode === "library" &&
      libraryScope === "custom" &&
      customSelection.size === 0
    ) {
      setResult({
        status: "error",
        summary: null,
        error: "Pick at least one source for a custom library brief.",
      });
      return;
    }

    setResult({ status: "loading", summary: null, error: null });
    try {
      const url =
        mode === "source"
          ? "/api/summaries/source"
          : "/api/summaries/library";
      const focusTrimmed = focus.trim();
      const body =
        mode === "source"
          ? {
              sourceId: selectedSourceId,
              length,
              audience,
              ...(focusTrimmed ? { focus: focusTrimmed } : {}),
            }
          : {
              length,
              audience,
              ...(focusTrimmed ? { focus: focusTrimmed } : {}),
              ...(libraryScope === "scripture"
                ? { corpus: "scripture" }
                : libraryScope === "sermon"
                  ? { corpus: "sermon" }
                  : libraryScope === "custom"
                    ? { sourceIds: Array.from(customSelection) }
                    : {}),
            };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errorBody.error ?? `Request failed (${response.status})`,
        );
      }
      const payload = (await response.json()) as SummaryResponse;
      setResult({ status: "ready", summary: payload, error: null });
    } catch (error) {
      setResult({
        status: "error",
        summary: null,
        error:
          error instanceof Error ? error.message : "Failed to generate summary",
      });
    }
  }, [
    audience,
    customSelection,
    focus,
    length,
    libraryScope,
    mode,
    selectedSourceId,
  ]);

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submit();
    },
    [submit],
  );

  const isLoading = result.status === "loading";

  return (
    <section className={styles.surface} aria-label="Summaries">
      <div className={styles.tabs} role="tablist" aria-label="Summary mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "source"}
          className={`${styles.tab} ${mode === "source" ? styles.tabActive : ""}`}
          onClick={() => setMode("source")}
          disabled={isLoading}
        >
          Per-source
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "library"}
          className={`${styles.tab} ${mode === "library" ? styles.tabActive : ""}`}
          onClick={() => setMode("library")}
          disabled={isLoading}
        >
          Library brief
        </button>
      </div>

      <form className={styles.form} onSubmit={handleFormSubmit}>
        {mode === "source" ? (
          <PerSourcePicker
            sources={readySources}
            selectedId={selectedSourceId}
            onChange={setSelectedSourceId}
            disabled={isLoading}
          />
        ) : (
          <LibraryScopePicker
            scope={libraryScope}
            onScopeChange={setLibraryScope}
            customSelection={customSelection}
            onToggleCustom={toggleCustomId}
            customFilter={customFilter}
            onCustomFilterChange={setCustomFilter}
            filteredSources={filteredCatalogForCustom}
            readySourceCount={readySources.length}
            disabled={isLoading}
          />
        )}

        <fieldset className={styles.fieldset} disabled={isLoading}>
          <legend className={styles.legend}>Length</legend>
          <div className={styles.radioRow}>
            <RadioChip
              name="length"
              value="short"
              label="Short"
              hint="~1 paragraph"
              checked={length === "short"}
              onChange={() => setLength("short")}
            />
            <RadioChip
              name="length"
              value="long"
              label="Long"
              hint="Multi-section brief"
              checked={length === "long"}
              onChange={() => setLength("long")}
            />
          </div>
        </fieldset>

        <fieldset className={styles.fieldset} disabled={isLoading}>
          <legend className={styles.legend}>Audience</legend>
          <div className={styles.radioRow}>
            <RadioChip
              name="audience"
              value="plain"
              label="Plain"
              hint="Accessible prose"
              checked={audience === "plain"}
              onChange={() => setAudience("plain")}
            />
            <RadioChip
              name="audience"
              value="technical"
              label="Technical"
              hint="Preserve theological terms"
              checked={audience === "technical"}
              onChange={() => setAudience("technical")}
            />
          </div>
        </fieldset>

        <label className={styles.fieldLabel}>
          <span>Focus (optional)</span>
          <textarea
            className={styles.focusInput}
            placeholder="e.g. How does this passage describe covenant?"
            value={focus}
            onChange={(event) => setFocus(event.target.value)}
            rows={2}
            maxLength={500}
            disabled={isLoading}
          />
        </label>

        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.submit}
            disabled={isLoading}
          >
            {isLoading
              ? "Generating…"
              : result.status === "ready"
                ? "Regenerate"
                : "Generate summary"}
          </button>
          {result.status === "ready" ? (
            <span className={styles.usageNote} aria-live="polite">
              {result.summary!.usage.inputTokens} in /{" "}
              {result.summary!.usage.outputTokens} out tokens
            </span>
          ) : null}
        </div>

        {result.status === "error" && result.error ? (
          <p className={styles.errorMessage} role="alert">
            {result.error}
          </p>
        ) : null}
      </form>

      <SummaryResult state={result} />
    </section>
  );
}

function PerSourcePicker({
  sources,
  selectedId,
  onChange,
  disabled,
}: {
  sources: readonly CatalogSourceSummary[];
  selectedId: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  if (sources.length === 0) {
    return (
      <p className={styles.emptyNote} role="status">
        No READY sources available yet. Ask an operator to finish indexing a
        source, then reload this page.
      </p>
    );
  }
  return (
    <label className={styles.fieldLabel}>
      <span>Source</span>
      <select
        className={styles.select}
        value={selectedId}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.title} ({source.corpus})
          </option>
        ))}
      </select>
    </label>
  );
}

function LibraryScopePicker({
  scope,
  onScopeChange,
  customSelection,
  onToggleCustom,
  customFilter,
  onCustomFilterChange,
  filteredSources,
  readySourceCount,
  disabled,
}: {
  scope: LibraryScopeMode;
  onScopeChange: (next: LibraryScopeMode) => void;
  customSelection: ReadonlySet<string>;
  onToggleCustom: (sourceId: string) => void;
  customFilter: string;
  onCustomFilterChange: (next: string) => void;
  filteredSources: readonly CatalogSourceSummary[];
  readySourceCount: number;
  disabled: boolean;
}) {
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>Library scope</legend>
      <div className={styles.radioRow}>
        <RadioChip
          name="library-scope"
          value="all"
          label="All"
          hint={`Up to the 12 most recent of ${readySourceCount} ready sources`}
          checked={scope === "all"}
          onChange={() => onScopeChange("all")}
        />
        <RadioChip
          name="library-scope"
          value="scripture"
          label="Scripture"
          hint="Bible only"
          checked={scope === "scripture"}
          onChange={() => onScopeChange("scripture")}
        />
        <RadioChip
          name="library-scope"
          value="sermon"
          label="Sermons"
          hint="Sermon transcripts"
          checked={scope === "sermon"}
          onChange={() => onScopeChange("sermon")}
        />
        <RadioChip
          name="library-scope"
          value="custom"
          label="Custom"
          hint="Pick specific sources"
          checked={scope === "custom"}
          onChange={() => onScopeChange("custom")}
        />
      </div>

      {scope === "custom" ? (
        <div className={styles.customPicker}>
          <label className={styles.fieldLabel}>
            <span className={styles.visuallyHidden}>Filter sources</span>
            <input
              type="search"
              className={styles.filterInput}
              placeholder="Filter by title…"
              value={customFilter}
              onChange={(event) => onCustomFilterChange(event.target.value)}
              autoComplete="off"
              disabled={disabled}
            />
          </label>
          {filteredSources.length === 0 ? (
            <p className={styles.emptyNote} role="status">
              No sources match that filter.
            </p>
          ) : (
            <ul className={styles.customList} role="listbox" aria-multiselectable="true">
              {filteredSources.map((source) => {
                const checked = customSelection.has(source.id);
                return (
                  <li key={source.id} role="none">
                    <button
                      type="button"
                      role="option"
                      aria-selected={checked}
                      className={`${styles.customOption} ${
                        checked ? styles.customOptionActive : ""
                      }`}
                      onClick={() => onToggleCustom(source.id)}
                      disabled={disabled}
                    >
                      <span className={styles.customCheckbox} aria-hidden="true">
                        {checked ? "✓" : ""}
                      </span>
                      <span className={styles.customLabel}>
                        <span className={styles.customTitle}>{source.title}</span>
                        <span className={styles.customMeta}>{source.corpus}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className={styles.customCount} aria-live="polite">
            {customSelection.size} selected
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}

function RadioChip({
  name,
  value,
  label,
  hint,
  checked,
  onChange,
}: {
  name: string;
  value: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`${styles.chip} ${checked ? styles.chipActive : ""}`}
      aria-label={`${label} — ${hint}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className={styles.visuallyHidden}
      />
      <span className={styles.chipLabel}>{label}</span>
      <span className={styles.chipHint}>{hint}</span>
    </label>
  );
}

function SummaryResult({ state }: { state: GenerateState }) {
  if (state.status === "idle") {
    return null;
  }
  if (state.status === "loading") {
    return (
      <div className={styles.resultPane} aria-live="polite">
        <p className={styles.resultStatus}>Generating summary…</p>
      </div>
    );
  }
  if (state.status === "error") {
    return null;
  }
  const summary = state.summary!;
  return (
    <article
      className={styles.resultPane}
      aria-label="Generated summary"
      aria-live="polite"
    >
      <header className={styles.resultHeader}>
        <h2 className={styles.resultTitle}>Summary</h2>
        <span className={styles.resultSources}>
          {summary.sources.length === 1
            ? summary.sources[0]!.title
            : `${summary.sources.length} contributing sources`}
        </span>
      </header>
      <div className={styles.resultBody}>{summary.content}</div>
      {summary.sources.length > 1 ? (
        <aside className={styles.sourcesList} aria-label="Contributing sources">
          <p className={styles.sourcesListHead}>Contributing sources:</p>
          <ul>
            {summary.sources.map((source) => (
              <li key={source.id}>{source.title}</li>
            ))}
          </ul>
        </aside>
      ) : null}
    </article>
  );
}
