"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";
import { ChatMessageView } from "./ChatMessage";

interface ChatPanelProps {
  /** Called after a response that carried actions, so the page can refetch portfolio + watchlist. */
  onActions: () => void;
  onClose?: () => void;
}

const SUGGESTIONS = ["How is my portfolio doing?", "Buy 5 NVDA", "Add PYPL to my watchlist"];

export function ChatPanel({ onActions, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .chatHistory(50)
      .then((history) => {
        // Keep anything sent before history arrived.
        if (!cancelled) setMessages((current) => [...history, ...current]);
      })
      .catch((err: Error) => {
        if (!cancelled) setHistoryError(`Couldn't load earlier messages: ${err.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || loading) return;
    const local: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      message,
      actions: null,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, local]);
    setDraft("");
    setLoading(true);
    try {
      const reply = await api.chat(message);
      setMessages((m) => [...m, reply]);
      if (reply.actions && reply.actions.length > 0) onActions();
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: `local-err-${Date.now()}`,
          role: "assistant",
          message: `Message not delivered: ${err instanceof Error ? err.message : String(err)}`,
          actions: null,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  };

  return (
    <aside
      id="chat-panel"
      aria-label="TraMa assistant"
      className="flex h-full min-h-0 flex-col border border-line bg-panel"
    >
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-[13px] font-medium text-ink-2">
          <span className="text-accent">TraMa</span> assistant
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Hide assistant"
            className="rounded-sm px-1.5 text-[15px] leading-none text-ink-3 hover:text-ink"
          >
            ×
          </button>
        )}
      </header>

      <ul ref={listRef} data-testid="chat-messages" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
        {historyError && <li className="text-[12px] text-down">{historyError}</li>}
        {messages.length === 0 && !historyError && (
          <li className="flex flex-col gap-2 text-[13px] text-ink-2">
            <p>Ask about your positions, or tell TraMa what to trade. Orders fill immediately at market.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-sm border border-line-strong px-2 py-0.5 text-[12px] text-ink-2 hover:border-primary hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </li>
        )}
        {messages.map((m) => (
          <ChatMessageView key={m.id} msg={m} />
        ))}
        {loading && (
          <li data-testid="chat-loading" role="status" className="flex items-center gap-1.5 text-[12px] text-ink-3">
            <span className="flex gap-1" aria-hidden>
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
            </span>
            TraMa is thinking
          </li>
        )}
      </ul>

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-line p-2">
        <label htmlFor="chat-input" className="sr-only">
          Message TraMa
        </label>
        <textarea
          id="chat-input"
          data-testid="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Ask TraMa or say “buy 10 AAPL”"
          className="min-h-0 flex-1 resize-none rounded-sm border border-line bg-canvas px-2 py-1.5 text-[13px] placeholder:text-ink-3 focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          data-testid="chat-send"
          disabled={loading || !draft.trim()}
          className="rounded-sm bg-secondary px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-secondary-hover disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </aside>
  );
}
