"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money, signedMoney, tone } from "@/lib/format";
import { MONO, theme } from "@/lib/theme";
import type { Snapshot } from "@/lib/types";
import { Panel } from "./Panel";

export const STARTING_CASH = 10000;

interface PnlChartProps {
  snapshots: Snapshot[];
}

const axisTick = { fill: theme.ink3, fontSize: 11, fontFamily: MONO };

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function PnlChart({ snapshots }: PnlChartProps) {
  const data = snapshots.map((s) => ({ t: Date.parse(s.recorded_at), v: s.total_value }));
  const last = data[data.length - 1]?.v;
  const vsStart = last == null ? null : last - STARTING_CASH;
  // Show cents when the whole series moves by less than ~$50, otherwise ticks collapse to one label.
  const values = data.map((d) => d.v);
  const span = values.length ? Math.max(...values) - Math.min(...values) : 0;
  const tickDigits = span < 50 ? 2 : 0;
  const yTick = (v: number) =>
    `$${v.toLocaleString("en-US", { minimumFractionDigits: tickDigits, maximumFractionDigits: tickDigits })}`;

  return (
    <Panel
      title="Portfolio value"
      testId="pnl-chart"
      className="h-full"
      bodyClassName="flex flex-col"
      aside={
        <span className={`num text-[12px] ${tone(vsStart)}`} title="Change vs. $10,000 starting cash">
          {signedMoney(vsStart)} vs. start
        </span>
      }
    >
      {data.length < 2 ? (
        <div className="flex h-full items-center justify-center p-4 text-center text-[13px] text-ink-3">
          Value is recorded every 30 seconds. The line appears after two snapshots.
        </div>
      ) : (
        <div className="min-h-0 flex-1 px-1 pb-1 pt-2" data-points={data.length}>
          <ResponsiveContainer width="100%" height="100%" minHeight={100}>
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
              <CartesianGrid stroke={theme.line} strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={timeLabel}
                tick={axisTick}
                tickLine={false}
                axisLine={{ stroke: theme.line }}
                minTickGap={40}
              />
              <YAxis
                orientation="right"
                domain={["auto", "auto"]}
                tickFormatter={yTick}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={tickDigits ? 80 : 64}
              />
              <ReferenceLine
                y={STARTING_CASH}
                stroke={theme.ink3}
                strokeDasharray="4 4"
                ifOverflow="hidden"
                label={{ value: "Start", position: "insideTopLeft", fill: theme.ink3, fontSize: 11 }}
              />
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
                labelFormatter={(t) => new Date(Number(t)).toLocaleString("en-US", { hour12: false })}
                formatter={(v) => [money(Number(v)), "Value"]}
              />
              <Line
                type="linear"
                dataKey="v"
                stroke={theme.accent}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                activeDot={{ r: 4, stroke: theme.panel, strokeWidth: 2, fill: theme.accent }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}
