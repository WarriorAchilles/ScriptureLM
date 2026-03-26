# Step 13: RAG chat with Claude (streaming) and inline citations

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.3 (RAG, streaming, citations, refusal), §6.3 (Anthropic Messages API), §6.5 (streaming UI), §15 #6 (inline citations).

## Manual actions (you must do)

- Obtain **Anthropic API key** with access to your chosen Claude model; set in server env (Step 04).
- Read current **Anthropic safety/data use** docs you need for your deployment policy (§6.6).
- Draft **system prompt** guidelines: answers must **ground** in retrieved context; if none, **say so** (§5.3 refusal).

## Goal

User sends a message; server **retrieves** (Step 12), **builds context window** with citation-friendly formatting, calls **Claude** with **streaming**, persists **assistant** message, and UI shows streamed tokens (§5.3).

## What you will build

- Chat API: accept **message**, optional **source scope** (wire minimal now—full UX in Step 14), load **recent thread history** with sane token cap (§5.3 conversation memory).
- Server: clamp context size; **deterministic truncation ordering** if needed (§6.3).
- Prompt: require **inline citations** referencing chunk metadata (book/chapter/verse, sermon title/id—whatever exists) (§15 #6).
- Client: consume stream (SSE or provider SDK pattern), append to transcript.
- Optional: store compact **`retrieval_debug`** for admin-only review later (§7)—gate behind role or omit in responses.

## Implementation notes

- When retrieval is **empty**, assistant reply should state **no relevant passages**—add automated test with mocked retrieval (§5.3).
- **Tenant/user logging** hooks only as needed for future ACL (§6.4).

## Definition of done (testable)

- E2E or integration: ask a question against fixture corpus; response **streams** and **mentions** grounding markers tied to retrieved chunk IDs (human review ok in MVP).
- Test asserts **no retrieval ⇒ refusal-style** answer substring (or structured signal) without hallucinated citations.
- Token/cost **logging stub** exists (structured log line)—prepare §9.
