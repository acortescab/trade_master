"use client";

import { useState, type FormEvent } from "react";
import { money, qty as fmtQty } from "@/lib/format";
import type { TradeResult, TradeSide } from "@/lib/types";

interface TradeBarProps {
  /** Pre-fills the ticker field whenever the selected ticker changes. */
  selected: string | null;
  onTrade: (ticker: string, side: TradeSide, quantity: number) => Promise<TradeResult>;
}

type Outcome = { kind: "ok"; text: string } | { kind: "error"; text: string } | null;

export function TradeBar({ selected, onTrade }: TradeBarProps) {
  const [ticker, setTicker] = useState(selected ?? "");
  const [lastSelected, setLastSelected] = useState(selected);
  const [quantity, setQuantity] = useState("");
  const [pending, setPending] = useState<TradeSide | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  if (selected !== lastSelected) {
    setLastSelected(selected);
    if (selected) setTicker(selected);
  }

  async function submit(side: TradeSide) {
    const t = ticker.trim().toUpperCase();
    const q = Number(quantity);
    if (!t) return setOutcome({ kind: "error", text: "Enter a ticker symbol." });
    if (!quantity.trim() || !Number.isFinite(q) || q <= 0) {
      return setOutcome({ kind: "error", text: "Enter a quantity greater than 0." });
    }
    setPending(side);
    setOutcome(null);
    try {
      const r = await onTrade(t, side, q);
      const verb = r.side === "buy" ? "Bought" : "Sold";
      setOutcome({ kind: "ok", text: `${verb} ${fmtQty(r.quantity)} ${r.ticker} at ${money(r.price)}` });
      setQuantity("");
    } catch (err) {
      setOutcome({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(null);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit("buy");
  };

  const field =
    "num rounded-sm border border-line bg-canvas px-2 py-1 text-[13px] placeholder:text-ink-3 focus:border-primary focus:outline-none";

  return (
    <form onSubmit={onSubmit} aria-label="Trade" className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
      <span className="text-[13px] font-medium text-ink-2">Market order</span>
      <label className="sr-only" htmlFor="trade-ticker">
        Ticker
      </label>
      <input
        id="trade-ticker"
        data-testid="trade-ticker"
        value={ticker}
        onChange={(e) => setTicker(e.target.value.toUpperCase())}
        placeholder="Ticker"
        autoComplete="off"
        spellCheck={false}
        className={`${field} w-24 uppercase placeholder:normal-case`}
      />
      <label className="sr-only" htmlFor="trade-quantity">
        Quantity
      </label>
      <input
        id="trade-quantity"
        data-testid="trade-quantity"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        placeholder="Shares"
        inputMode="decimal"
        autoComplete="off"
        className={`${field} w-24 text-right`}
      />
      <button
        type="button"
        data-testid="trade-buy"
        disabled={pending !== null}
        onClick={() => submit("buy")}
        className="rounded-sm bg-secondary px-4 py-1 text-[13px] font-semibold text-white hover:bg-secondary-hover disabled:opacity-50"
      >
        {pending === "buy" ? "Buying…" : "Buy"}
      </button>
      <button
        type="button"
        data-testid="trade-sell"
        disabled={pending !== null}
        onClick={() => submit("sell")}
        className="rounded-sm border border-secondary px-4 py-1 text-[13px] font-semibold text-ink hover:bg-secondary/25 disabled:opacity-50"
      >
        {pending === "sell" ? "Selling…" : "Sell"}
      </button>
      <span aria-live="polite" className="min-w-0 flex-1 truncate text-[12px]">
        {outcome?.kind === "error" && (
          <span data-testid="trade-error" role="alert" className="text-down">
            {outcome.text}
          </span>
        )}
        {outcome?.kind === "ok" && (
          <span data-testid="trade-success" className="text-up">
            {outcome.text}
          </span>
        )}
      </span>
    </form>
  );
}
