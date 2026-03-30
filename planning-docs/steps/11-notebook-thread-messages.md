# Step 11: Notebook, single thread, and chat history persistence

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §5.1, §7, §15 #4.

## Manual actions (you must do)

- If you already have **legacy DB rows** from early experiments (multiple threads per notebook), run the **one-off cleanup** or migration the agent provides, **or** reset your dev database—your choice as operator.

## Instructions for the AI coding agent

1. **`GET /api/chat/messages`**: returns messages for the authenticated user’s **sole** `ChatThread`, **chronological** order (oldest first for chat UI) or document reverse with client handling—**pick one** and stay consistent with Step 13 streaming append.
2. **`POST /api/chat/messages`**: accepts `{ content: string }`; persists **user** message; for this step may return **ack only** or echo—**assistant** reply can be stubbed empty until Step 13 **if** Step 13 will replace the endpoint—prefer **single** evolving endpoint to avoid duplicate routes.
3. **UI**: chat page under workspace with **message list**, **textarea**, **Send** button; after POST, **revalidate** or optimistic append.
4. **Keyboard**: **Enter** to send (with **Shift+Enter** for newline if multiline), **focus** management after send (§6.5).
5. **`retrieval_debug`**: leave **null**; schema already allows JSON from Step 03.
6. **Tests**: with test session/user fixture, POST three messages → GET returns **3** in order; assert **409** or DB error if code path tries second thread (should be impossible via API).
7. Align with Step 05 lazy creation: if thread missing on first message, **create** notebook/thread in same transaction as first message (idempotent).

## Definition of done (testable)

- Automated test or integration: three-round trip messages persist and reload.
- Refreshing browser does **not** lose messages.
- API cannot create a **second** thread for the same notebook (enforced at DB or service layer—document).
