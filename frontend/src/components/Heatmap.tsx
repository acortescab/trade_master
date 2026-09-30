"use client";

import { ResponsiveContainer, Tooltip, Treemap, type TreemapNode } from "recharts";
import { money, pct, signedMoney } from "@/lib/format";
import type { LivePosition } from "@/lib/portfolio";
import { MONO, pnlFill, theme } from "@/lib/theme";
import { Panel } from "./Panel";

interface HeatmapProps {
  positions: LivePosition[];
  onSelect: (ticker: string) => void;
}

interface Cell {
  [key: string]: unknown;
  name: string;
  size: number;
  weight: number;
  pnl: number | null;
  pnlPct: number | null;
}

export function Heatmap({ positions, onSelect }: HeatmapProps) {
  const total = positions.reduce((s, p) => s + p.value, 0);
  const data: Cell[] = positions
    .filter((p) => p.value > 0)
    .map((p) => ({
      name: p.ticker,
      size: p.value,
      weight: total > 0 ? (p.value / total) * 100 : 0,
      pnl: p.pnl,
      pnlPct: p.pnlPct,
    }));

  return (
    <Panel
      title="Holdings heatmap"
      testId="heatmap"
      className="h-full"
      aside={<Legend />}
    >
      {data.length === 0 ? (
        <div className="flex h-full items-center justify-center p-4 text-center text-[13px] text-ink-3">
          No positions yet. Buy shares with the trade bar or ask TraMa.
        </div>
      ) : (
        <div className="h-full p-1">
          <ResponsiveContainer width="100%" height="100%" minHeight={100}>
            <Treemap
              data={data}
              dataKey="size"
              nameKey="name"
              isAnimationActive={false}
              aspectRatio={4 / 3}
              content={HeatCell}
              onClick={(node) => onSelect(String(node.name))}
            >
              <Tooltip content={<HeatTooltip />} />
            </Treemap>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

function HeatCell(props: TreemapNode) {
  const { depth, x, y, width, height, name } = props;
  if (depth !== 1) return <g />;
  const pnlPct = props.pnlPct as number | null;
  const showLabel = width > 44 && height > 28;
  const showDetail = width > 70 && height > 46;
  return (
    <g data-testid={`heatmap-cell-${name}`} data-pnl={pnlPct == null ? "none" : pnlPct >= 0 ? "gain" : "loss"} style={{ cursor: "pointer" }}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={2}
        fill={pnlFill(pnlPct)}
        stroke={theme.panel}
        strokeWidth={2}
      />
      {showLabel && (
        <text x={x + 6} y={y + 17} fill={theme.ink} fontSize={13} fontWeight={600}>
          {name}
        </text>
      )}
      {showDetail && (
        <text x={x + 6} y={y + 33} fill={theme.ink} fillOpacity={0.85} fontSize={11} fontFamily={MONO}>
          {pct(pnlPct)}
        </text>
      )}
    </g>
  );
}

interface TooltipPayload {
  payload?: Cell;
}

function HeatTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  const cell = payload?.[0]?.payload;
  if (!active || !cell) return null;
  return (
    <div className="rounded-sm border border-line-strong bg-raised px-2.5 py-1.5 text-[12px] shadow-lg">
      <div className="font-semibold text-ink">{cell.name}</div>
      <div className="num text-ink-2">
        {money(cell.size)} <span className="text-ink-3">({cell.weight.toFixed(1)}% of holdings)</span>
      </div>
      <div className={`num ${cell.pnl == null ? "text-ink-3" : cell.pnl >= 0 ? "text-up" : "text-down"}`}>
        {signedMoney(cell.pnl)} ({pct(cell.pnlPct)})
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-ink-3" aria-label="Color scale: loss to gain">
      <span className="num">−5%</span>
      <span
        aria-hidden
        className="h-2 w-16 rounded-[1px]"
        style={{ background: `linear-gradient(90deg, ${pnlFill(-5)}, ${pnlFill(0)}, ${pnlFill(5)})` }}
      />
      <span className="num">+5%</span>
    </div>
  );
}
