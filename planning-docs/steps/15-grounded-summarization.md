# Step 15: Grounded summarization (per-source and library brief)

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.4, §13, §6.3.

## Manual actions (you must do)

- Decide where summaries **live in the product** (e.g. tab vs modal). If you care, tell the agent **before** implementation; otherwise accept the agent’s default (**Summaries** sub-route under workspace).

## Instructions for the AI coding agent

1. **`POST /api/summaries/source`**: body `{ sourceId, length: 'short'|'long', audience: 'plain'|'technical', focus?: string }`.
   - Load **Source**; if not `ready`, return **409** with clear message.
   - Build context: **concatenate** chunk texts up to a **token/char budget** (document algorithm: first-N chunks vs round-robin across sections); include **source title/filename** in prompt.
   - Call **Claude** non-streaming (or streaming if UI prefers—pick one); require **explicit attribution** lines (“Sources: …”) (§5.4).
2. **`POST /api/summaries/library`**: body `{ length, audience, focus?, sourceIds?, corpus? }` mirroring chat scope rules from Step 14.
   - Pull **top-level** overview across **multiple** sources; response must **name each** contributing source id or title.
3. **UI**: form controls for parameters; **Regenerate** button re-POSTs with same or edited focus (§5.4 regeneration—no duplicate blob storage).
4. **Persistence**: **ephemeral** response in v1 is acceptable (return JSON/markdown to client only); if persisting, add **`Summary` table** optional—only if you implement, add migration + **`params_hash`** dedupe note in code comments.
5. **Tests**:
   - Mock LLM: assert prompt includes **two** source names for library call with two IDs.
   - `not ready` source → **409**.

## Definition of done (testable)

- Mock/integration tests cover **409** and **multi-source** prompt content.
- Manual: per-source and library calls return text that **names** the source(s); changing **`length`** yields visibly different length (agent can add trivial assertion on word count in mock test).
