# Step 14: Source scope and corpus presets (UI + API)

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.1, §5.3, §6.5, §13 success criteria.

## Manual actions (you must do)

- **QA pass**: click through **All / Scripture / Sermons** and multi-select in the browser; file issues if copy is unclear. No code.

## Instructions for the AI coding agent

1. **Client state** (React context, URL query params, or Zustand—match project): **`scopeMode`**: `all` | `scripture` | `sermon` | `custom`; **`selectedSourceIds`**: `string[]` when `custom`.
2. **UI** on chat (and optionally catalog link “Use in chat”): preset **radio group** + **multi-select** with **search/filter** over sources (client-side filter ok until pagination forces server search—add `q` param to `/api/sources` if needed).
3. **Accessibility**: label presets; **aria-pressed** on toggles; listbox patterns for multi-select (§6.5).
4. **Server validation** on chat POST: expand presets to **`source_id` list** or pass **`corpus` filter** to retrieval per Step 12; **reject** unknown UUIDs with **400**; **reject** hidden/deleted IDs.
5. **Default**: `all` = no `sourceIds` filter, optional corpus quota behavior from Step 12 remains active.
6. **Tests**:
   - **Unit**: preset → SQL params / retrieval args mapping snapshot.
   - **Integration**: seed two sources different corpus; same query with `scripture` vs `sermon` returns different **top chunk** (mock or real DB).
7. Wire **every** chat request from UI to include serialized scope in body.

## Definition of done (testable)

- Automated **400** on bogus `source_id`.
- Integration or e2e proves **scope changes** `retrieveContext` inputs (assert via mock or spy).
- Manual: Scripture-only does not surface sermon-only fixture chunk for a query crafted to differ (given seeded data).
