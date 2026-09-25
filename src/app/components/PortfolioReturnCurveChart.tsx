import clsx from "clsx";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PortfolioReturnAnalytics } from "../api";
import { formatPct, formatUsd } from "../utils";

function ReturnTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs shadow-2xl">
      <div className="mb-1 font-medium text-zinc-200">{label}</div>
      {payload.map((item: any) => (
        <div key={item.dataKey} className="flex items-center justify-between gap-4 text-zinc-300">
          <span>{item.name}</span>
          <span className={clsx(Number(item.value || 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>
            {String(item.dataKey).includes("Pct") ? formatPct(Number(item.value || 0), 2) : formatUsd(Number(item.value || 0), 2)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PortfolioReturnCurveChart({
  equityCurve,
}: {
  equityCurve: PortfolioReturnAnalytics["equityCurve"];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={equityCurve} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="returnPnlFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="drawdownFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.28} />
            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
        <XAxis dataKey="label" stroke="#71717a" tickLine={false} axisLine={false} />
        <YAxis yAxisId="pnl" stroke="#71717a" tickLine={false} axisLine={false} width={68} />
        <YAxis yAxisId="pct" orientation="right" stroke="#71717a" tickLine={false} axisLine={false} width={52} />
        <Tooltip content={<ReturnTooltip />} />
        <Legend />
        <Area
          yAxisId="pnl"
          type="monotone"
          dataKey="cumulativePnl"
          name="Cumulative return"
          stroke="#22c55e"
          fill="url(#returnPnlFill)"
          strokeWidth={2}
        />
        <Area
          yAxisId="pct"
          type="monotone"
          dataKey="drawdownPct"
          name="Drawdown"
          stroke="#f43f5e"
          fill="url(#drawdownFill)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
