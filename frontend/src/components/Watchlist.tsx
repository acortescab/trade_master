"use client";

import { memo, useState, type FormEvent } from "react";
import type { PricePoint } from "@/hooks/usePriceStream";
import { usePriceFlash } from "@/hooks/usePriceFlash";
import { pct, price as fmtPrice, tone } from "@/lib/format";
import { sessionChangePct } from "@/lib/portfolio";
import { theme } from "@/lib/theme";
import { Panel } from "./Panel";
import { Sparkline } from "./Sparkline";

export interface WatchRow {
  ticker: string;
  price: number | null;
  sessionOpen: number | null;
  history: PricePoint[];
}

interface WatchlistProps {
  rows: WatchRow[];
  selected: string | null;
  onSelect: (ticker: string) => void;
  onAdd: (ticker: string) => Promise<void>;
  onRemove: (ticker: string) => Promise<void>;
}

export function Watchlist({ rows, selected, onSelect, onAdd, onRemove }: WatchlistProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ticker = draft.trim().toUpperCase();
    if (!ticker) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(ticker);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(ticker: string) {
    setError(null);
    try {
      await onRemove(ticker);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Panel
      title="Watchlist"
      aside={<span className="num text-[11px] text-ink-3">{rows.length} symbols</span>}
      className="h-full"
      bodyClassName="flex flex-col"
    >
      <form onSubmit={submit} className="flex gap-1.5 border-b border-line p-2">
        <label htmlFor="watchlist-add" className="sr-only">
          Add a ticker
        </label>
        <input
          id="watchlist-add"
          data-testid="watchlist-add-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          placeholder="Add ticker, e.g. PYPL"
          autoComplete="off"
          spellCheck={false}
          className="num min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-1 text-[13px] uppercase placeholder:normal-case placeholder:text-ink-3 focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          data-testid="watchlist-add-button"
          disabled={busy || !draft.trim()}
          className="rounded-sm bg-secondary px-3 text-[13px] font-medium text-white hover:bg-secondary-hover disabled:opacity-40"
        >
          Add
        </button>
      </form>
      {error && (
        <p role="alert" data-testid="watchlist-error" className="border-b border-line px-3 py-1.5 text-[12px] text-down">
          {error}
        </p>
      )}

      <div className="grid grid-cols-[1fr_76px_78px_64px_20px] gap-x-2 border-b border-line px-3 py-1 text-[11px] text-ink-3">
        <span>Symbol</span>
        <span>Session</span>
        <span className="text-right">Last</span>
        <span className="text-right">Chg</span>
        <span />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((row) => (
          <WatchlistRow
            key={row.ticker}
            row={row}
            selected={row.ticker === selected}
            onSelect={onSelect}
            onRemove={remove}
          />
        ))}
        {rows.length === 0 && (
          <li className="px-3 py-6 text-center text-[13px] text-ink-3">
            Your watchlist is empty. Add a ticker above.
          </li>
        )}
      </ul>
    </Panel>
  );
}

interface RowProps {
  row: WatchRow;
  selected: boolean;
  onSelect: (ticker: string) => void;
  onRemove: (ticker: string) => void;
}

export const WatchlistRow = memo(function WatchlistRow({ row, selected, onSelect, onRemove }: RowProps) {
  const flash = usePriceFlash(row.price);
  const change = sessionChangePct(row.price, row.sessionOpen);
  const sparkColor = change == null || change >= 0 ? theme.up : theme.down;

  return (
    <li
      data-testid={`watchlist-row-${row.ticker}`}
      data-selected={selected}
      className={`group relative flex items-center gap-x-2 border-b border-line/60 px-3 ${
        selected ? "bg-raised" : "hover:bg-raised/60"
      }`}
    >
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
      <button
        type="button"
        onClick={() => onSelect(row.ticker)}
        aria-pressed={selected}
        aria-label={`Show ${row.ticker} chart`}
        className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_76px_78px_64px] items-center gap-x-2 py-1.5 text-left focus-visible:outline-offset-[-2px]"
      >
        <span className={`text-[14px] font-semibold tracking-wide ${selected ? "text-accent" : "text-ink"}`}>
          {row.ticker}
        </span>
        <Sparkline points={row.history} color={sparkColor} />
        <span
          data-testid={`watchlist-price-${row.ticker}`}
          data-flash={flash ?? "none"}
          className={`num flash-cell rounded-sm px-1 text-right text-[13px] ${
            flash === "up" ? "flash-up" : flash === "down" ? "flash-down" : ""
          }`}
        >
          {fmtPrice(row.price)}
        </span>
        <span data-testid={`watchlist-change-${row.ticker}`} className={`num text-right text-[12px] ${tone(change)}`}>
          {pct(change)}
        </span>
      </button>
      <button
        type="button"
        data-testid={`watchlist-remove-${row.ticker}`}
        onClick={() => onRemove(row.ticker)}
        aria-label={`Remove ${row.ticker} from watchlist`}
        title={`Remove ${row.ticker}`}
        className="flex h-5 w-5 items-center justify-center rounded-sm text-[15px] leading-none text-ink-3 opacity-50 hover:bg-down/20 hover:text-down group-hover:opacity-100 focus-visible:opacity-100"
      >
        ×
      </button>
    </li>
  );
});
