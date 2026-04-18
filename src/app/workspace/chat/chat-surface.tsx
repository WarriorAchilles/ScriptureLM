"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { ChatMessageSummary } from "@/lib/chat/thread";
import type { CatalogSourceSummary } from "@/lib/sources/list-catalog";
import {
  DEFAULT_CHAT_SOURCE_SCOPE,
  type ChatSourceScope,
} from "@/lib/chat/source-scope";
import { ScopePicker } from "./scope-picker";
import styles from "./chat.module.css";

/**
 * Client chat surface: message list + composer with streamed assistant replies.
 *
 * Step 13 wires this up to the SSE endpoint at POST /api/chat/messages. The
 * stream emits four event types — `user_message`, `delta`, `done`, `error` —
 * which we parse with a small inline reader (no EventSource: that API is GET-
 * only). Tokens are appended to a single placeholder assistant bubble so the
 * UI updates incrementally as Claude generates.
 *
 * Keyboard behavior (Step 11 §6.5):
 *  - Enter submits the current message; Shift+Enter inserts a newline.
 *  - Focus returns to the textarea after a successful (or failed) send.
 *
 * Abort: navigation away (or Escape — wired in a later step) cancels the in-
 * flight stream via AbortController so we stop reading from the server.
 */
export function ChatSurface({
  initialMessages,
  catalog,
}: {
  initialMessages: ChatMessageSummary[];
  catalog: readonly CatalogSourceSummary[];
}) {
  const [messages, setMessages] = useState<ChatMessageSummary[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [scope, setScope] = useState<ChatSourceScope>(DEFAULT_CHAT_SOURCE_SCOPE);

  // `custom` mode requires at least one selected source per source-scope.ts
  // validation rules; surface the block in the UI rather than silently
  // defaulting to `all` so the user explicitly sees what's expected.
  const customScopeInvalid =
    scope.mode === "custom" &&
    (scope.selectedSourceIds === undefined ||
      scope.selectedSourceIds.length === 0);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const activeStreamRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    return () => {
      activeStreamRef.current?.abort();
    };
  }, []);

  const submit = useCallback(async () => {
    const content = draft.trim();
    if (!content || isSending || customScopeInvalid) {
      return;
    }

    const optimisticUserId = `optimistic-user-${Date.now()}`;
    const optimisticAssistantId = `optimistic-assistant-${Date.now()}`;
    const optimisticUserMessage: ChatMessageSummary = {
      id: optimisticUserId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    const optimisticAssistantMessage: ChatMessageSummary = {
      id: optimisticAssistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };

    setIsSending(true);
    setSendError(null);
    setDraft("");
    setMessages((previous) => [
      ...previous,
      optimisticUserMessage,
      optimisticAssistantMessage,
    ]);

    const controller = new AbortController();
    activeStreamRef.current = controller;

    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        // Step 14 #7: every chat request carries the serialized scope so the
        // server can expand presets → retrieval args and reject bogus ids.
        body: JSON.stringify({ message: content, sourceScope: scope }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Request failed (${response.status})`);
      }

      const isStream = (response.headers.get("Content-Type") ?? "").includes(
        "text/event-stream",
      );
      if (!isStream || !response.body) {
        throw new Error("Server did not return a streaming response");
      }

      await consumeChatStream(response.body, {
        onUserMessage: (persistedUserMessage) => {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === optimisticUserId ? persistedUserMessage : message,
            ),
          );
        },
        onDelta: (text) => {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === optimisticAssistantId
                ? { ...message, content: message.content + text }
                : message,
            ),
          );
        },
        onDone: (persistedAssistantMessage) => {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === optimisticAssistantId
                ? persistedAssistantMessage
                : message,
            ),
          );
        },
        onError: (message) => {
          throw new Error(message);
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // Quiet abort: user navigated away or cancelled. Leave whatever was
        // already streamed in place rather than rolling back, since those
        // tokens correspond to a real (now closed) server response.
      } else {
        setMessages((previous) =>
          previous.filter(
            (message) =>
              message.id !== optimisticUserId &&
              message.id !== optimisticAssistantId,
          ),
        );
        setDraft(content);
        setSendError(
          error instanceof Error ? error.message : "Failed to send message",
        );
      }
    } finally {
      activeStreamRef.current = null;
      setIsSending(false);
      textareaRef.current?.focus();
    }
  }, [draft, isSending, scope, customScopeInvalid]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submit();
    },
    [submit],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void submit();
      }
    },
    [submit],
  );

  return (
    <section className={styles.surface} aria-label="Chat conversation">
      <div className={styles.surfaceLayout}>
        <aside className={styles.scopeSidebar}>
          <ScopePicker
            scope={scope}
            onScopeChange={setScope}
            catalog={catalog}
            disabled={isSending}
          />
        </aside>

        <div className={styles.mainChat}>
          <div className={styles.messageList} role="log" aria-live="polite">
            {messages.length === 0 ? (
              <EmptyConversation />
            ) : (
              messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))
            )}
            <div ref={listEndRef} />
          </div>

          <form className={styles.composer} onSubmit={handleSubmit}>
            <label htmlFor="chat-composer" className={styles.visuallyHidden}>
              Write a message
            </label>
            <textarea
              id="chat-composer"
              ref={textareaRef}
              className={styles.textarea}
              placeholder="Ask a question about Scripture or the Message..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              disabled={isSending}
              autoFocus
            />
            <div className={styles.composerFoot}>
              <p className={styles.composerHint}>
                Enter to send · Shift + Enter for a newline
              </p>
              <button
                type="submit"
                className={styles.sendButton}
                disabled={
                  isSending || draft.trim().length === 0 || customScopeInvalid
                }
              >
                {isSending ? "Sending…" : "Send"}
              </button>
            </div>
            {customScopeInvalid ? (
              <p className={styles.sendError} role="status">
                Pick at least one source to use Custom scope.
              </p>
            ) : null}
            {sendError ? (
              <p className={styles.sendError} role="alert">
                {sendError}
              </p>
            ) : null}
          </form>
        </div>
      </div>
    </section>
  );
}

function MessageBubble({ message }: { message: ChatMessageSummary }) {
  const isUser = message.role === "user";
  const isStreaming = !isUser && message.content.length === 0;
  return (
    <article
      className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAssistant}`}
      aria-label={isUser ? "Your message" : "Assistant message"}
    >
      <header className={styles.bubbleHeader}>
        <span className={styles.bubbleRole}>{isUser ? "You" : message.role}</span>
        <time className={styles.bubbleTime} dateTime={message.createdAt}>
          {formatTimestamp(message.createdAt)}
        </time>
      </header>
      <p className={styles.bubbleBody}>
        {isStreaming ? <span aria-live="polite">Thinking…</span> : message.content}
      </p>
    </article>
  );
}

function EmptyConversation() {
  return (
    <div className={styles.empty} role="status" aria-live="polite">
      <p className={styles.emptyTitle}>No messages yet.</p>
      <p className={styles.emptyBody}>
        Send your first message below. Assistant replies stream in token-by-
        token, grounded in the curated source catalog.
      </p>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Minimal SSE reader for the chat stream. We can't use the browser EventSource
 * API because it only supports GET requests; instead we hand-parse the
 * `event:` / `data:` frame format produced by the Route Handler.
 */
async function consumeChatStream(
  body: ReadableStream<Uint8Array>,
  handlers: {
    onUserMessage: (message: ChatMessageSummary) => void;
    onDelta: (text: string) => void;
    onDone: (message: ChatMessageSummary) => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffered = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffered += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line (`\n\n`). Process every
      // complete frame in the buffer; keep the trailing partial for the next
      // chunk.
      let separatorIndex = buffered.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const rawFrame = buffered.slice(0, separatorIndex);
        buffered = buffered.slice(separatorIndex + 2);
        dispatchSseFrame(rawFrame, handlers);
        separatorIndex = buffered.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function dispatchSseFrame(
  rawFrame: string,
  handlers: {
    onUserMessage: (message: ChatMessageSummary) => void;
    onDelta: (text: string) => void;
    onDone: (message: ChatMessageSummary) => void;
    onError: (message: string) => void;
  },
): void {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of rawFrame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) {
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }
  switch (event) {
    case "user_message":
      handlers.onUserMessage(
        (payload as { message: ChatMessageSummary }).message,
      );
      break;
    case "delta":
      handlers.onDelta((payload as { text: string }).text ?? "");
      break;
    case "done":
      handlers.onDone((payload as { message: ChatMessageSummary }).message);
      break;
    case "error":
      handlers.onError(
        (payload as { message?: string }).message ?? "Stream error",
      );
      break;
  }
}
