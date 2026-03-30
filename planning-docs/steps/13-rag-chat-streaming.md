# Step 13: RAG chat with Claude (streaming) and inline citations

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.3 (RAG, streaming, refusal), §6.3 (Anthropic Messages API), §6.5, §15 #6.

## Manual actions (you must do)

- Add **`ANTHROPIC_API_KEY`** (and optional **`ANTHROPIC_MODEL`**) to **`.env.local`** using your Anthropic console.
- Read Anthropic’s **data use / retention** policy for your org and ensure settings match your compliance needs (§6.6)—the agent does not configure your Anthropic account.

## Instructions for the AI coding agent

1. Add **`@anthropic-ai/sdk`** (or official client for current API) **server-only** wrapper `lib/llm/claude.ts`.
2. **`POST /api/chat`** (or extend Step 11 route): body `{ message: string, sourceScope?: { sourceIds?: string[], corpus?: ... } }` — minimal scope wiring; full UI in Step 14.
3. **Flow**:
   - Persist **user** message.
   - Call **`retrieveContext`** (Step 12) with scope; build **context blocks** labeled with **chunk id** and **citation metadata** for the model.
   - **System prompt**: require answers **only** from context; if context empty, respond with a **fixed refusal pattern** (e.g. “No relevant passages were found…”) (§5.3).
   - **User prompt**: include short **conversation history** with **token budget** (truncate oldest first); include instructions for **inline citations** referencing chunk labels (§15 #6).
4. **Streaming**: use **SSE** (`text/event-stream`) or SDK streaming; **pipe** tokens to client; on completion persist **full assistant** `Message` row.
5. **Client**: `fetch` with **ReadableStream** or EventSource; append tokens to UI; handle **errors** and **abort**.
6. Optional: store **`retrieval_debug`** JSON on assistant message: `{ chunkIds: [...], scores?: [...] }` — **omit from client JSON** for non-admin if you add roles later.
7. **Tests**:
   - **Mock** Anthropic + retrieval: assert prompt contains chunk text when retrieval non-empty.
   - **Mock** empty retrieval: assert assistant content includes refusal substring **without** fabricated citations.
8. **Logging**: structured line with **approximate** input/output token counts if SDK exposes usage (§9 prep).

## Definition of done (testable)

- Manual: send chat in UI; see **streamed** tokens; refresh shows **persisted** assistant message.
- Automated: empty retrieval → refusal substring assertion.
- No `ANTHROPIC` env read from client bundle.
