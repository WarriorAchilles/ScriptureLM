# Step 15: Grounded summarization (per-source and library brief)

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.4 (summaries, controls, regeneration), §13 success criteria (library overview), §6.3 (Claude generation).

## Manual actions (you must do)

- Decide **UX placement**: separate “Summaries” tab vs inline from catalog row actions (read-only users **consume** summaries only—generation triggers may be rate-limited server-side).
- Choose **parameters**: length, audience tone, optional focus prompt (§5.4).

## Goal

Users can generate **per-source** summaries and a **library-level brief**, grounded with **attribution** to sources used—**regeneratable** with different parameters without duplicating source blobs (§5.4).

## What you will build

- API: given **`source_id`** (+ controls), fetch representative chunks (first N, retrieved outline, or full text under token cap—document approach).
- API: given **scope** similar to chat (optional), synthesize **library overview** citing contributing sources.
- Persist or **ephemeral** responses: acceptable if regenerated on demand for MVP—if persisted, store `summary_params` hash to avoid clutter (your call; align with §5.4 regeneration story).

## Implementation notes

- Reuse **Claude** client patterns from Step 13; do **not** leak API keys.
- Summaries must **fail gracefully** if source text unavailable or still indexing.

## Definition of done (testable)

- Integration: for a `ready` fixture source, summary JSON/markdown references **source title or id** explicitly.
- Library brief with **two** sources in scope mentions **both**; with **one** source excluded, that source **does not** appear (given deterministic prompt instructions + fixture).
- Changing **length** parameter yields measurably different output (simple assertion on word count threshold).
