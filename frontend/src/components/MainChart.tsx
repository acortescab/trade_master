"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PricePoint } from "@/hooks/usePriceStream";
import { clockTime, pct, price as fmtPrice, tone } from "@/lib/format";
import { sessionChangePct } from "@/lib/portfolio";
import { MONO, theme } from "@/lib/theme";
import { Panel } from "./Panel";

interface MainChartProps {
  ticker: string | null;
  history: PricePoint[];
  price: number | null;
  sessionOpen: number | null;
}

const axisTick = { fill: theme.ink3, fontSize: 11, fontFamily: MONO };

export function MainChart({ ticker, history, price, sessionOpen }: MainChartProps) {
  const change = sessionChangePct(price, sessionOpen);
  const color = change == null || change >= 0 ? theme.up : theme.down;

  return (
    <Panel
      title={ticker ? `${ticker} price since page load` : "Price chart"}
      testId="main-chart"
      className="h-full"
      bodyClassName="flex flex-col"
      aside={
        ticker && (
          <div className="flex items-baseline gap-3">
            <span data-testid="main-chart-price" className="num text-[15px] text-ink">
              {fmtPrice(price)}
            </span>
            <span className={`num text-[12px] ${tone(change)}`}>{pct(change)} session</span>
          </div>
        )
      }
    >
      {!ticker ? (
        <Empty text="Select a ticker in the watchlist to chart it." />
      ) : history.length < 2 ? (
        <Empty text={price == null ? `Waiting for a price on ${ticker}…` : `Collecting ${ticker} ticks…`} />
      ) : (
        <div className="min-h-0 flex-1 px-1 pb-1 pt-2">
          <ResponsiveContainer width="100%" height="100%" minHeight={120}>
            <AreaChart data={history} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="main-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={theme.line} strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={clockTime}
                tick={axisTick}
                tickLine={false}
                axisLine={{ stroke: theme.line }}
                minTickGap={48}
              />
              <YAxis
                orientation="right"
                // Pad to at least ±0.1% so a nearly flat series doesn't repeat one tick label.
                domain={([min, max]: readonly [number, number]) => {
                  const pad = Math.max((max - min) * 0.1, max * 0.001);
                  return [min - pad, max + pad];
                }}
                tickFormatter={(v: number) => v.toFixed(2)}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={60}
              />
              {sessionOpen != null && (
                <ReferenceLine
                  y={sessionOpen}
                  stroke={theme.ink3}
                  strokeDasharray="4 4"
                  ifOverflow="hidden"
                  label={{ value: "Open", position: "insideTopLeft", fill: theme.ink3, fontSize: 11 }}
                />
              )}
              <Tooltip
                cursor={{ stroke: theme.ink3, strokeWidth: 1 }}
                contentStyle={{
                  background: theme.raised,
                  border: `1px solid ${theme.lineStrong}`,
                  borderRadius: 2,
                  fontFamily: MONO,
                  fontSize: 12,
                }}
                labelStyle={{ color: theme.ink2 }}
                itemStyle={{ color: theme.ink }}
                labelFormatter={(t) => clockTime(Number(t))}
                formatter={(v) => [fmtPrice(Number(v)), ticker]}
              />
              <Area
                type="linear"
                dataKey="p"
                stroke={theme.primary}
                strokeWidth={2}
                fill="url(#main-fill)"
                isAnimationActive={false}
                activeDot={{ r: 4, stroke: theme.panel, strokeWidth: 2, fill: theme.primary }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center p-4 text-[13px] text-ink-3">{text}</div>;
}
