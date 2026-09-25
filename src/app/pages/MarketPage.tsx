import React from "react";
import clsx from "clsx";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

import { ChartSurface } from "../ChartSurface";
import { MetricCard, SectionTitle } from "../components/common";
import type { RuntimeMarketState } from "../utils";
import { cardClassName, formatPct, formatPrice } from "../utils";

export function MarketPage({
  selectedSymbol,
  chartTimeframe,
  setChartTimeframe,
  runtimeMarket,
  chartData,
}: {
  selectedSymbol: string;
  chartTimeframe: "15m" | "1h";
  setChartTimeframe: React.Dispatch<React.SetStateAction<"15m" | "1h">>;
  runtimeMarket: RuntimeMarketState;
  chartData: Array<{ time: string; price: number; volume: number }>;
}) {
  return (
    <div className="space-y-6">
      <SectionTitle title="Market analysis" subtitle="Prices, order book, macro factors and market microstructure." />
      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <section className={cardClassName()}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-zinc-50">{selectedSymbol}</div>
              <div className="text-sm text-zinc-400">Price {formatPrice(runtimeMarket.ticker?.last || 0, 2)}</div>
            </div>
            <div className="flex gap-2">
              {(["15m", "1h"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setChartTimeframe(value)}
                  className={clsx(
                    "rounded-full border px-3 py-1.5 text-sm transition",
                    chartTimeframe === value
                      ? "border-indigo-500/30 bg-indigo-500/15 text-indigo-100"
                      : "border-zinc-800 bg-zinc-950 text-zinc-400"
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <ChartSurface className="w-full min-w-0" minHeight={360}>
            {({ width, height }) => (
              <LineChart width={width} height={height} data={chartData}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fill: "#71717a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#71717a", fontSize: 12 }} axisLine={false} tickLine={false} width={80} />
                <Tooltip
                  contentStyle={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 16 }}
                  formatter={(value: number) => [formatPrice(value, 2), "Close"]}
                />
                <Line type="monotone" dataKey="price" stroke="#22c55e" strokeWidth={2.5} dot={false} />
              </LineChart>
            )}
          </ChartSurface>
        </section>

        <div className="space-y-6">
          <section className={cardClassName()}>
            <SectionTitle title="Macro factors" />
            <div className="grid gap-4 md:grid-cols-2">
              <MetricCard
                label="DXY dollar index"
                value={
                  runtimeMarket.macro?.dxySource === "unavailable"
                    ? "No live data"
                    : formatPrice(runtimeMarket.macro?.dxy || 0, 3)
                }
                hint={`Source: ${runtimeMarket.macro?.dxySource || "unknown"}`}
              />
              <MetricCard label="M2 money supply" value={runtimeMarket.macro?.m2 ? formatPrice(runtimeMarket.macro.m2, 1) : "—"} />
              <MetricCard label="GLI global liquidity" value={runtimeMarket.macro?.m2 ? formatPrice(runtimeMarket.macro.m2 / 200, 2) : "—"} />
              <MetricCard label="Macro Gate" value={runtimeMarket.macro?.macroGate?.state || "—"} hint={runtimeMarket.macro?.macroGate?.reason} />
            </div>
          </section>

          <section className={cardClassName()}>
            <SectionTitle title="Order book and funding rate" />
            <div className="grid gap-4 md:grid-cols-2">
              <MetricCard
                label="Funding Rate"
                value={formatPct(Number(runtimeMarket.funding?.fundingRate || 0) * 100, 4)}
              />
              <MetricCard
                label="Order book depth"
                value={String((runtimeMarket.orderBook?.bids?.length || 0) + (runtimeMarket.orderBook?.asks?.length || 0))}
              />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                <div className="mb-2 text-sm font-medium text-zinc-200">Bids</div>
                <div className="space-y-2 text-sm">
                  {(runtimeMarket.orderBook?.bids || []).slice(0, 6).map(([price, size]) => (
                    <div key={`bid-${price}`} className="flex items-center justify-between text-emerald-300">
                      <span>{formatPrice(price, 2)}</span>
                      <span>{formatPrice(size, 4)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                <div className="mb-2 text-sm font-medium text-zinc-200">Asks</div>
                <div className="space-y-2 text-sm">
                  {(runtimeMarket.orderBook?.asks || []).slice(0, 6).map(([price, size]) => (
                    <div key={`ask-${price}`} className="flex items-center justify-between text-rose-300">
                      <span>{formatPrice(price, 2)}</span>
                      <span>{formatPrice(size, 4)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
