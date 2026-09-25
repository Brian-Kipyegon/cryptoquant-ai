import React from "react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import { ChartSurface } from "../ChartSurface";
import { formatPrice } from "../utils";

export function DashboardPriceChart({
  chartData,
}: {
  chartData: Array<{ time: string; price: number; volume: number }>;
}) {
  return (
    <ChartSurface className="w-full min-w-0" minHeight={320}>
      {({ width, height }) => (
        <AreaChart width={width} height={height} data={chartData}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
          <XAxis dataKey="time" tick={{ fill: "#71717a", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#71717a", fontSize: 12 }} axisLine={false} tickLine={false} width={80} />
          <Tooltip
            contentStyle={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 16 }}
            formatter={(value: number) => [formatPrice(value, 2), "Price"]}
          />
          <Area type="monotone" dataKey="price" stroke="#818cf8" fill="url(#priceFill)" strokeWidth={2} />
        </AreaChart>
      )}
    </ChartSurface>
  );
}
