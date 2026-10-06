import { money, pct, price as fmtPrice, qty, signedMoney, tone } from "@/lib/format";
import type { LivePosition } from "@/lib/portfolio";

interface PositionsTableProps {
  positions: LivePosition[];
  selected: string | null;
  onSelect: (ticker: string) => void;
}

const th = "px-3 py-1.5 font-normal text-ink-3";

export function PositionsTable({ positions, selected, onSelect }: PositionsTableProps) {
  if (positions.length === 0) {
    return (
      <p data-testid="positions-table" data-empty="true" className="px-3 py-4 text-[13px] text-ink-3">
        No open positions. Buy with the trade bar below or ask TraMa.
      </p>
    );
  }
  return (
    <table data-testid="positions-table" data-empty="false" className="w-full border-collapse text-[13px]">
      <thead className="sticky top-0 bg-panel text-[11px]">
        <tr className="border-b border-line text-right">
          <th className={`${th} text-left`}>Symbol</th>
          <th className={th}>Qty</th>
          <th className={th}>Avg cost</th>
          <th className={th}>Last</th>
          <th className={`${th} max-sm:hidden`}>Market value</th>
          <th className={th}>Unrealized P&L</th>
          <th className={th}>Change</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr
            key={p.ticker}
            data-testid={`position-row-${p.ticker}`}
            onClick={() => onSelect(p.ticker)}
            className={`cursor-pointer border-b border-line/60 text-right ${
              p.ticker === selected ? "bg-raised" : "hover:bg-raised/60"
            }`}
          >
            <td className="px-3 py-1.5 text-left font-semibold">{p.ticker}</td>
            <td className="num px-3" data-testid={`position-qty-${p.ticker}`}>
              {qty(p.quantity)}
            </td>
            <td className="num px-3 text-ink-2">{fmtPrice(p.avg_cost)}</td>
            <td className="num px-3">{fmtPrice(p.price)}</td>
            <td className="num px-3 max-sm:hidden">{money(p.value)}</td>
            <td className={`num px-3 ${tone(p.pnl)}`}>{signedMoney(p.pnl)}</td>
            <td className={`num px-3 ${tone(p.pnlPct)}`}>{pct(p.pnlPct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
