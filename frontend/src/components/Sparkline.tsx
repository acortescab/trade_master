"use client";

import { memo } from "react";
import { Line, LineChart, YAxis } from "recharts";
import type { PricePoint } from "@/hooks/usePriceStream";

export const SPARK_POINTS = 90;

interface SparklineProps {
  points: PricePoint[];
  color: string;
  width?: number;
  height?: number;
}

export const Sparkline = memo(function Sparkline({ points, color, width = 76, height = 24 }: SparklineProps) {
  const data = points.length > SPARK_POINTS ? points.slice(-SPARK_POINTS) : points;
  if (data.length < 2) {
    return <div style={{ width, height }} className="border-b border-dashed border-line" aria-hidden />;
  }
  return (
    <LineChart width={width} height={height} data={data} margin={{ top: 2, right: 1, bottom: 2, left: 1 }}>
      <YAxis hide domain={["dataMin", "dataMax"]} />
      <Line
        type="linear"
        dataKey="p"
        stroke={color}
        strokeWidth={1.5}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  );
});
