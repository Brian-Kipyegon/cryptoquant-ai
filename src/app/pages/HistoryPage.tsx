import React from "react";
import clsx from "clsx";

import type { HistoryOrderRow, TradeRow } from "../api";
import { SectionTitle } from "../components/common";
import { cardClassName, formatDateTime, formatPrice, formatUsd } from "../utils";
import { normalizeDisplaySymbol } from "../../lib/tradingRuntime";

export function HistoryPage({
  historyOrders,
  localTrades,
}: {
  historyOrders: HistoryOrderRow[];
  localTrades: TradeRow[];
}) {
  return (
    <div className="space-y-6">
      <SectionTitle title="Trade history" subtitle="Exchange order history and locally recorded closed trades." />
      <div className="grid gap-6 xl:grid-cols-2">
        <section className={cardClassName()}>
          <SectionTitle title="Exchange order history" />
          <div className="overflow-hidden rounded-2xl border border-zinc-800">
            <div className="grid grid-cols-[150px_90px_80px_90px_90px_90px] gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
              <span>Time</span>
              <span>Symbol</span>
              <span>Side</span>
              <span>Price</span>
              <span>Quantity</span>
              <span>Status</span>
            </div>
            <div className="max-h-[480px] overflow-y-auto">
              {historyOrders.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-zinc-500">No order history</div>
              ) : (
                historyOrders.slice(0, 80).map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-[150px_90px_80px_90px_90px_90px] gap-3 border-b border-zinc-900 px-4 py-3 text-sm text-zinc-200 last:border-b-0"
                  >
                    <span className="text-zinc-400">{formatDateTime(row.timestamp)}</span>
                    <span>{normalizeDisplaySymbol(row.symbol)}</span>
                    <span>{row.side.toUpperCase()}</span>
                    <span>{formatPrice(row.price, 2)}</span>
                    <span>{formatPrice(row.amount, 4)}</span>
                    <span>{row.status}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className={cardClassName()}>
          <SectionTitle title="Local trade records" />
          <div className="overflow-hidden rounded-2xl border border-zinc-800">
            <div className="grid grid-cols-[150px_90px_1fr_80px_100px_100px] gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
              <span>Time</span>
              <span>Symbol</span>
              <span>Strategy</span>
              <span>Side</span>
              <span>PnL</span>
              <span>Exit reason</span>
            </div>
            <div className="max-h-[480px] overflow-y-auto">
              {localTrades.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-zinc-500">No local trade records</div>
              ) : (
                localTrades.slice(0, 80).map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-[150px_90px_1fr_80px_100px_100px] gap-3 border-b border-zinc-900 px-4 py-3 text-sm text-zinc-200 last:border-b-0"
                  >
                    <span className="text-zinc-400">{formatDateTime(row.closed_at || row.created_at)}</span>
                    <span>{normalizeDisplaySymbol(String(row.symbol || ""))}</span>
                    <span>{String(row.strategy_id || "—")}</span>
                    <span>{String(row.side || "—").toUpperCase()}</span>
                    <span className={clsx(Number(row.realized_pnl || 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>
                      {formatUsd(Number(row.realized_pnl || 0), 3)}
                    </span>
                    <span>{String(row.exit_reason || "—")}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
