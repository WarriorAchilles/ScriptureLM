"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { ChatMessageSummary } from "@/lib/chat/thread";
import styles from "./chat.module.css";

/**
 * Client chat surface: message list + composer.
 *
 * Keyboard behavior (Step 11 instruction #4; master spec §6.5):
 *  - Enter submits the current message.
 *  - Shift+Enter inserts a newline in the textarea.
 *  - After a successful send, focus returns to the textarea so the user can
 *    keep typing without reaching for the mouse.
 *
 * Append is optimistic — we push the user's message locally immediately, then
 * reconcile with the server response so the persisted `id`/`createdAt` replace
 * the optimistic placeholder. If the request fails we roll back and surface
 * the error inline.
 */
export function ChatSurface({
  initialMessages,
}: {
  initialMessages: ChatMessageSummary[];
}) {
  const [messages, setMessages] = useState<ChatMessageSummary[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Keep the newest message in view whenever the list changes. `scrollIntoView`
    // no-ops gracefully when the ref isn't mounted yet.
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const submit = useCallback(async () => {
    const content = draft.trim();
    if (!content || isSending) {
      return;
    }

    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMessage: ChatMessageSummary = {
      id: optimisticId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    setIsSending(true);
    setSendError(null);
    setDraft("");
    setMessages((previous) => [...previous, optimisticMessage]);

    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Request failed (${response.status})`);
      }

      const body = (await response.json()) as {
        threadId: string;
        message: ChatMessageSummary;
      };

      setMessages((previous) =>
        previous.map((message) =>
          message.id === optimisticId ? body.message : message,
        ),
      );
    } catch (error) {
      setMessages((previous) =>
        previous.filter((message) => message.id !== optimisticId),
      );
      setDraft(content);
      setSendError(
        error instanceof Error ? error.message : "Failed to send message",
      );
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  }, [draft, isSending]);

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
          placeholder="Ask a question about Scripture or the sermons…"
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
            disabled={isSending || draft.trim().length === 0}
          >
            {isSending ? "Sending…" : "Send"}
          </button>
        </div>
        {sendError ? (
          <p className={styles.sendError} role="alert">
            {sendError}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function MessageBubble({ message }: { message: ChatMessageSummary }) {
  const isUser = message.role === "user";
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
      <p className={styles.bubbleBody}>{message.content}</p>
    </article>
  );
}

function EmptyConversation() {
  return (
    <div className={styles.empty} role="status" aria-live="polite">
      <p className={styles.emptyTitle}>No messages yet.</p>
      <p className={styles.emptyBody}>
        Send your first message below. Assistant replies will begin streaming
        once the RAG pipeline is wired up in a later step.
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
