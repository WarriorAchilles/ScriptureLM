# Step 11: Notebook, single thread, and chat history persistence

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.1 (one notebook, single thread MVP), §7 (`Notebook`, `ChatThread`, `Message`), §15 #4.

## Manual actions (you must do)

- Confirm on **first login** (Step 05) or on first visit to chat UI that **exactly one** `Notebook` and **`ChatThread`** exist; fix up any legacy users with a one-off migration if you iterated early.

## Goal

The product exposes **one conversation surface** per user backed by durable **`Message` rows** (§5.1, §15 #4).

## What you will build

- API to **list messages** for the user’s sole thread (newest first or chronological—pick one and stick to it).
- API to **append** user and assistant messages (assistant insert may start as a stub in Step 11—placeholder content ok until Step 13).
- Chat UI shell: **message list** + input; **without** streaming yet, you can POST a user message and see it echoed or acknowledged.

## Implementation notes

- **`retrieval_debug` JSON** can remain `NULL` until Step 13; schema should allow it (§7).
- Prepare UI for **keyboard-friendly** chat (§6.5)—focus management on send.

## Definition of done (testable)

- Automated test or script: create user session context → POST three messages → GET history returns **3** in correct order.
- Refreshing the page **does not lose** history (persistence verified).
- Enforcing **single thread** per notebook: attempt to create second thread **fails** or is impossible by design (document which).
