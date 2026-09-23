import React from "react";

import type { AutoTradingConfig, OrderLifecycleEvent, RiskState, SecurityEvent } from "../api";
import { MetricCard, SectionTitle } from "../components/common";
import { cardClassName, formatDateTime, formatPrice, formatUsd, riskStatusLabel } from "../utils";
import { normalizeDisplaySymbol } from "../../lib/tradingRuntime";

export function ReliabilityPage({
  riskState,
  autoConfig,
  orderLifecycle,
  securityEvents,
}: {
  riskState: RiskState | null;
  autoConfig: AutoTradingConfig | null;
  orderLifecycle: OrderLifecycleEvent[];
  securityEvents: SecurityEvent[];
}) {
  return (
    <div className="space-y-6">
      <SectionTitle title="Execution reliability" subtitle="Account risk controls, system state, security events and order lifecycle." />
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Account risk state"
          value={riskStatusLabel(riskState)}
          hint={riskState ? `${riskState.consecutiveStopLosses} / ${autoConfig?.riskConfigSnapshot.maxConsecutiveLosses || 0}` : undefined}
        />
        <MetricCard label="Today's PnL" value={formatUsd(riskState?.dailyPnL || 0)} trend={(riskState?.dailyPnL || 0) >= 0 ? "up" : "down"} />
        <MetricCard label="Macro gate" value={riskState?.macroGate || "—"} hint={`Score ${formatPrice(riskState?.macroScore || 0, 2)}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={cardClassName()}>
          <SectionTitle title="Order lifecycle" />
          <div className="overflow-hidden rounded-2xl border border-zinc-800">
            <div className="grid grid-cols-[150px_100px_80px_90px_100px_120px] gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
              <span>Time</span>
              <span>Symbol</span>
              <span>Side</span>
              <span>Quantity</span>
              <span>Status</span>
              <span>Source</span>
            </div>
            <div className="max-h-[480px] overflow-y-auto">
              {orderLifecycle.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-zinc-500">No order lifecycle records</div>
              ) : (
                orderLifecycle.slice(0, 100).map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-[150px_100px_80px_90px_100px_120px] gap-3 border-b border-zinc-900 px-4 py-3 text-sm text-zinc-200 last:border-b-0"
                  >
                    <span className="text-zinc-400">{formatDateTime(row.timestamp)}</span>
                    <span>{normalizeDisplaySymbol(row.symbol)}</span>
                    <span>{row.side}</span>
                    <span>{formatPrice(row.amount, 4)}</span>
                    <span>{row.status}</span>
                    <span>{row.source || "—"}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className={cardClassName()}>
          <SectionTitle title="Security events" />
          <div className="overflow-hidden rounded-2xl border border-zinc-800">
            <div className="grid grid-cols-[160px_1fr_120px_120px] gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
              <span>Time</span>
              <span>Type</span>
              <span>Method</span>
              <span>Source</span>
            </div>
            <div className="max-h-[480px] overflow-y-auto">
              {securityEvents.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-zinc-500">No security events</div>
              ) : (
                securityEvents.slice(0, 100).map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-[160px_1fr_120px_120px] gap-3 border-b border-zinc-900 px-4 py-3 text-sm text-zinc-200 last:border-b-0"
                  >
                    <span className="text-zinc-400">{formatDateTime(row.timestamp)}</span>
                    <span>{row.type}</span>
                    <span>{row.method || "—"}</span>
                    <span>{row.ip || "—"}</span>
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
