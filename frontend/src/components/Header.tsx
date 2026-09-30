import type { ConnectionStatus } from "@/lib/types";
import { money, signedMoney, tone } from "@/lib/format";

const STATUS_STYLE: Record<ConnectionStatus, { dot: string; label: string }> = {
  connected: { dot: "bg-up", label: "Live" },
  reconnecting: { dot: "bg-accent animate-pulse", label: "Reconnecting" },
  disconnected: { dot: "bg-down", label: "Disconnected" },
};

interface HeaderProps {
  totalValue: number | null;
  cash: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number | null;
  status: ConnectionStatus;
  chatOpen: boolean;
  onToggleChat: () => void;
}

export function Header({ totalValue, cash, unrealizedPnl, realizedPnl, status, chatOpen, onToggleChat }: HeaderProps) {
  const s = STATUS_STYLE[status];
  return (
    <header className="flex h-14 shrink-0 items-stretch border-b border-line bg-panel">
      <div className="flex items-center gap-2 border-r border-line px-4">
        <span aria-hidden className="h-5 w-1.5 bg-accent" />
        <span className="text-[19px] font-semibold tracking-tight">
          Tra<span className="text-ink-2">Ma</span>
        </span>
      </div>

      <dl className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        <Stat label="Portfolio value">
          <span data-testid="header-total-value" className="num text-[20px] font-medium text-ink">
            {money(totalValue)}
          </span>
        </Stat>
        <Stat label="Cash">
          <span data-testid="header-cash" className="num text-[15px] text-ink">
            {money(cash)}
          </span>
        </Stat>
        <Stat label="Unrealized P&L">
          <span data-testid="header-unrealized" className={`num text-[15px] ${tone(unrealizedPnl)}`}>
            {signedMoney(unrealizedPnl)}
          </span>
        </Stat>
        <Stat label="Realized P&L" className="max-md:hidden">
          <span data-testid="header-realized" className={`num text-[15px] ${tone(realizedPnl)}`}>
            {signedMoney(realizedPnl)}
          </span>
        </Stat>
      </dl>

      <div className="flex items-center gap-3 px-4">
        <div
          data-testid="connection-status"
          data-status={status}
          role="status"
          aria-label={`Price stream: ${s.label}`}
          className="flex items-center gap-1.5 text-[12px] text-ink-2"
        >
          <span aria-hidden className={`h-2 w-2 rounded-full ${s.dot}`} />
          <span className="max-sm:hidden">{s.label}</span>
        </div>
        <button
          type="button"
          data-testid="chat-toggle"
          onClick={onToggleChat}
          aria-expanded={chatOpen}
          aria-controls="chat-panel"
          className={`rounded-sm border px-3 py-1 text-[13px] font-medium ${
            chatOpen ? "border-primary/60 bg-primary/15 text-primary" : "border-line-strong text-ink-2 hover:text-ink"
          }`}
        >
          {chatOpen ? "Hide assistant" : "Ask TraMa"}
        </button>
      </div>
    </header>
  );
}

function Stat({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex shrink-0 flex-col justify-center border-r border-line px-4 ${className}`}>
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className="leading-tight">{children}</dd>
    </div>
  );
}
