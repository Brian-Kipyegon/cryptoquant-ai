import React from "react";
import clsx from "clsx";

import type { AuditSummary, ResearchStat, ResearchWeekly } from "../api";
import { MetricCard, SectionTitle } from "../components/common";
import { cardClassName, formatPrice } from "../utils";

export function AuditPage({
  auditSummary,
  researchWeekly,
  onOpenDrilldown,
}: {
  auditSummary: AuditSummary | null;
  researchWeekly: ResearchWeekly | null;
  onOpenDrilldown: (mode: "regime" | "symbol", selectedKey: string | null) => void;
}) {
  return (
    <div className="space-y-6">
      <SectionTitle title="Audit" subtitle="Summary metrics, shadow order stats and trade reviews." />
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Strategy version" value={auditSummary?.version || "—"} />
        <MetricCard label="AI snapshots" value={String(auditSummary?.counts.aiSnapshots || 0)} />
        <MetricCard label="Order receipts" value={String(auditSummary?.counts.orderReceipts || 0)} />
        <MetricCard label="Risk events" value={String(auditSummary?.counts.riskEvents || 0)} />
        <MetricCard label="Shadow orders" value={String(researchWeekly?.totals.shadowOrders || 0)} />
        <MetricCard label="Avg slippage" value={`${formatPrice(researchWeekly?.totals.shadowAvgSlippageBps || 0, 2)} bps`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section
          className={clsx(cardClassName("cursor-pointer transition hover:border-indigo-500/30"))}
          onClick={() => onOpenDrilldown("regime", null)}
        >
          <SectionTitle title="Review by regime" />
          <div className="space-y-2">
            {Object.entries((researchWeekly?.byRegime || {}) as Record<string, ResearchStat>).map(([key, stat]) => (
              <button
                type="button"
                key={key}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenDrilldown("regime", key);
                }}
                className="flex w-full items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-left text-sm text-zinc-200 transition hover:border-zinc-700"
              >
                <span>{key}</span>
                <span>{stat.trades} trades</span>
              </button>
            ))}
          </div>
        </section>

        <section
          className={clsx(cardClassName("cursor-pointer transition hover:border-indigo-500/30"))}
          onClick={() => onOpenDrilldown("symbol", null)}
        >
          <SectionTitle title="Review by symbol" />
          <div className="space-y-2">
            {Object.entries((researchWeekly?.bySymbol || {}) as Record<string, ResearchStat>).map(([key, stat]) => (
              <button
                type="button"
                key={key}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenDrilldown("symbol", key);
                }}
                className="flex w-full items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-left text-sm text-zinc-200 transition hover:border-zinc-700"
              >
                <span>{key}</span>
                <span>{stat.trades} trades</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
