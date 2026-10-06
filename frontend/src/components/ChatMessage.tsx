import { money, qty } from "@/lib/format";
import type { ChatAction, ChatMessage as Message } from "@/lib/types";

/** One renderer for both live responses and messages restored from /api/chat/history. */
export function ChatMessageView({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <li data-testid="chat-message" data-role={msg.role} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[92%] whitespace-pre-wrap break-words rounded-sm px-2.5 py-1.5 text-[13px] leading-snug ${
          isUser ? "bg-primary/15 text-ink" : "border-l-2 border-accent bg-raised text-ink"
        }`}
      >
        {msg.message}
      </div>
      {msg.actions && msg.actions.length > 0 && (
        <ul className="mt-1 flex max-w-[92%] flex-col gap-0.5">
          {msg.actions.map((a, i) => (
            <ActionLine key={i} action={a} />
          ))}
        </ul>
      )}
    </li>
  );
}

function describe(a: ChatAction): string {
  if (a.type === "trade") {
    const verb = a.status === "ok" ? (a.side === "buy" ? "Bought" : "Sold") : a.side === "buy" ? "Buy" : "Sell";
    const at = a.status === "ok" && a.price != null ? ` at ${money(a.price)}` : "";
    return `${verb} ${qty(a.quantity)} ${a.ticker}${at}`;
  }
  if (a.status === "ok") return a.action === "add" ? `Added ${a.ticker} to watchlist` : `Removed ${a.ticker} from watchlist`;
  return a.action === "add" ? `Add ${a.ticker} to watchlist` : `Remove ${a.ticker} from watchlist`;
}

function ActionLine({ action }: { action: ChatAction }) {
  const ok = action.status === "ok";
  return (
    <li
      data-testid="chat-action"
      data-status={action.status}
      className={`num flex items-start gap-1.5 text-[12px] ${ok ? "text-up" : "text-down"}`}
    >
      <span aria-hidden className="font-semibold">
        {ok ? "✓" : "✗"}
      </span>
      <span className="sr-only">{ok ? "Done:" : "Failed:"}</span>
      <span>
        {describe(action)}
        {!ok && action.error && <span className="text-ink-2">: {action.error}</span>}
      </span>
    </li>
  );
}
