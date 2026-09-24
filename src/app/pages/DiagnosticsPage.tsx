import React from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { AutoTradingCycleSummary, AutoTradingTrace, ShadowOrder, ShadowSummary } from "../api";
import { MetricCard, SectionTitle } from "../components/common";
import {
  abbreviateCycleId,
  cardClassName,
  exitReasonLabel,
  formatDateTime,
  formatPrice,
  formatUsd,
  parseJsonSafely,
  stageLabel,
} from "../utils";


export function DiagnosticsPage({
  diagnosticsCycles,
  diagnosticsDate,
  setDiagnosticsDate,
  diagnosticsPage,
  setDiagnosticsPage,
  tracePageCount,
  filteredTraces,
  visibleTraces,
  selectedTraceId,
  setSelectedTraceId,
  selectedTrace,
  shadowSummary,
  shadowOpenOrders,
  shadowClosedOrders,
  selectedShadowOrderId,
  setSelectedShadowOrderId,
  selectedShadowOrder,
  embedded = false,
}: {
  diagnosticsCycles: AutoTradingCycleSummary[];
  diagnosticsDate: string;
  setDiagnosticsDate: React.Dispatch<React.SetStateAction<string>>;
  diagnosticsPage: number;
  setDiagnosticsPage: React.Dispatch<React.SetStateAction<number>>;
  tracePageCount: number;
  filteredTraces: AutoTradingTrace[];
  visibleTraces: AutoTradingTrace[];
  selectedTraceId: string | null;
  setSelectedTraceId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedTrace: AutoTradingTrace | null;
  shadowSummary: ShadowSummary | null;
  shadowOpenOrders: ShadowOrder[];
  shadowClosedOrders: ShadowOrder[];
  selectedShadowOrderId: string | null;
  setSelectedShadowOrderId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedShadowOrder: ShadowOrder | null;
  embedded?: boolean;
}) {
  return (
    <div className="space-y-6">
      <SectionTitle title="Strategy diagnostics" subtitle="Latest cycle funnel, block details, shadow positions and closed trades." />
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          label="Last cycle"
          value={abbreviateCycleId(diagnosticsCycles[0]?.cycleId)}
          valueTitle={diagnosticsCycles[0]?.cycleId || undefined}
          hint={formatDateTime(diagnosticsCycles[0]?.startedAt)}
        />
        <MetricCard label="Symbols scanned" value={String(diagnosticsCycles[0]?.scannedSymbols || 0)} />
        <MetricCard label="Targets scanned" value={String(diagnosticsCycles[0]?.scannedTargets || 0)} />
        <MetricCard label="Duration" value={`${diagnosticsCycles[0]?.durationMs || 0} ms`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_420px]">
        <section className={cardClassName()}>
          <SectionTitle
            title="Block details"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">
                  10 per page
                </div>
                <input
                  type="date"
                  value={diagnosticsDate}
                  onChange={(event) => {
                    setDiagnosticsDate(event.target.value);
                    setDiagnosticsPage(1);
                  }}
                  className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100"
                />
                <button
                  type="button"
                  onClick={() => {
                    setDiagnosticsDate("");
                    setDiagnosticsPage(1);
                  }}
                  className="rounded-xl border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200"
                >
                  All dates
                </button>
              </div>
            }
          />
          <div className="overflow-hidden rounded-2xl border border-zinc-800">
            <div className="grid grid-cols-[150px_90px_70px_1fr_90px_90px_100px_140px] gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
              <span>Time</span>
              <span>Symbol</span>
              <span>Timeframe</span>
              <span>Strategy</span>
              <span>Signal</span>
              <span>Confidence</span>
              <span>Blocked at</span>
              <span>Reason</span>
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              {visibleTraces.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-zinc-500">No diagnostics yet</div>
              ) : (
                visibleTraces.map((trace) => (
                  <button
                    type="button"
                    key={trace.id}
                    onClick={() => setSelectedTraceId(trace.id)}
                    className={clsx(
                      "grid w-full grid-cols-[150px_90px_70px_1fr_90px_90px_100px_140px] gap-3 border-b border-zinc-900 px-4 py-3 text-left text-sm transition last:border-b-0",
                      selectedTraceId === trace.id ? "bg-indigo-500/10 text-indigo-100" : "text-zinc-200 hover:bg-zinc-950/70"
                    )}
                  >
                    <span className="text-zinc-400">{formatDateTime(trace.createdAt)}</span>
                    <span>{trace.symbol}</span>
                    <span>{trace.timeframe}</span>
                    <span>{trace.strategyId}</span>
                    <span>{trace.signal}</span>
                    <span>{trace.confidence} / {trace.requiredConfidence}</span>
                    <span className="text-amber-300">{stageLabel(trace.blockedAt)}</span>
                    <span className="truncate text-zinc-400">{trace.blockedReason || "—"}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-4 text-sm text-zinc-400">
            <div>{filteredTraces.length} records, page {Math.min(diagnosticsPage, tracePageCount)} of {tracePageCount}</div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={diagnosticsPage <= 1}
                onClick={() => setDiagnosticsPage((current) => Math.max(1, current - 1))}
                className="inline-flex items-center gap-1 rounded-xl border border-zinc-700 px-3 py-1.5 text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              <button
                type="button"
                disabled={diagnosticsPage >= tracePageCount}
                onClick={() => setDiagnosticsPage((current) => Math.min(tracePageCount, current + 1))}
                className="inline-flex items-center gap-1 rounded-xl border border-zinc-700 px-3 py-1.5 text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        <section
          className={cardClassName(
            embedded ? "self-start" : "xl:sticky xl:top-6 self-start max-h-[calc(100vh-96px)] overflow-hidden"
          )}
        >
          <SectionTitle title="Step details" />
          {selectedTrace ? (
            <div
              className={clsx(
                "space-y-4 pr-1",
                embedded ? "" : "max-h-[calc(100vh-176px)] overflow-y-auto"
              )}
            >
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="text-sm text-zinc-400">Trade context</div>
                <div className="mt-2 space-y-1 text-sm text-zinc-200">
                  <div>Symbol: {selectedTrace.symbol}</div>
                  <div>Timeframe: {selectedTrace.timeframe}</div>
                  <div>Strategy: {selectedTrace.strategyId}</div>
                  <div>Blocked at: <span className="text-amber-300">{stageLabel(selectedTrace.blockedAt)}</span></div>
                  <div>Reason: {selectedTrace.blockedReason || "—"}</div>
                </div>
              </div>

              <div className="space-y-3">
                {selectedTrace.steps.map((step) => (
                  <div key={`${selectedTrace.id}-${step.name}-${step.at}`} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="font-medium text-zinc-100">{stageLabel(step.name)}</div>
                      <div
                        className={clsx(
                          "rounded-full px-3 py-1 text-xs font-medium",
                          step.status === "pass"
                            ? "bg-emerald-500/15 text-emerald-200"
                            : step.status === "fail"
                              ? "bg-rose-500/15 text-rose-200"
                              : "bg-zinc-800 text-zinc-300"
                    )}
                  >
                    {step.status}
                  </div>
                </div>
                {step.reason ? <div className="mt-2 text-sm text-zinc-400">{step.reason}</div> : null}
                {step.metrics ? (
                      <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-zinc-950 p-3 text-xs text-zinc-400">
                        {JSON.stringify(step.metrics, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-8 text-center text-sm text-zinc-500">
              Select a block record to see its steps.
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Open positions" value={String(shadowSummary?.openCount || 0)} />
        <MetricCard label="Closed trades" value={String(shadowSummary?.closedCount || 0)} />
        <MetricCard label="Unrealized PnL" value={formatUsd(shadowSummary?.unrealizedPnl || 0, 3)} trend={(shadowSummary?.unrealizedPnl || 0) >= 0 ? "up" : "down"} />
        <MetricCard label="Realized PnL" value={formatUsd(shadowSummary?.realizedPnl || 0, 3)} trend={(shadowSummary?.realizedPnl || 0) >= 0 ? "up" : "down"} />
        <MetricCard label="Win rate" value={formatPrice(shadowSummary?.winRate || 0, 2) + "%"} />
        <MetricCard label="Estimated orders" value={String(shadowSummary?.estimatedCount || 0)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_420px]">
        <div className="space-y-6">
          <section className={cardClassName()}>
            <SectionTitle title="Shadow positions" />
            <div className="overflow-hidden rounded-2xl border border-zinc-800">
              <div className="grid grid-cols-[100px_70px_70px_100px_100px_100px_110px_90px] gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
                <span>Symbol</span>
                <span>Timeframe</span>
                <span>Side</span>
                <span>Entry price</span>
                <span>Mark price</span>
                <span>TP / SL</span>
                <span>Unrealized PnL</span>
                <span>Source</span>
              </div>
              <div className="max-h-[320px] overflow-y-auto">
                {shadowOpenOrders.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-zinc-500">No shadow positions</div>
                ) : (
                  shadowOpenOrders.map((row) => (
                    <button
                      type="button"
                      key={row.id}
                      onClick={() => setSelectedShadowOrderId(row.id)}
                      className={clsx(
                        "grid w-full grid-cols-[100px_70px_70px_100px_100px_100px_110px_90px] gap-3 border-b border-zinc-900 px-4 py-3 text-left text-sm transition last:border-b-0",
                        selectedShadowOrderId === row.id ? "bg-indigo-500/10 text-indigo-100" : "text-zinc-200 hover:bg-zinc-950/70"
                      )}
                    >
                      <span>{row.symbol}</span>
                      <span>{row.timeframe || "—"}</span>
                      <span>{row.side}</span>
                      <span>{formatPrice(row.entry_price, 2)}</span>
                      <span>{formatPrice(row.mark_price, 2)}</span>
                      <span>{formatPrice(row.tp_price, 2)} / {formatPrice(row.sl_price, 2)}</span>
                      <span className={clsx(Number(row.unrealized_pnl || 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>
                        {formatUsd(row.unrealized_pnl, 3)}
                      </span>
                      <span>{row.is_estimated ? "Estimated" : "Live"}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className={cardClassName()}>
            <SectionTitle title="Closed shadow trades" />
            <div className="overflow-hidden rounded-2xl border border-zinc-800">
              <div className="grid grid-cols-[100px_70px_70px_100px_100px_110px_110px_90px] gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
                <span>Symbol</span>
                <span>Timeframe</span>
                <span>Side</span>
                <span>Entry price</span>
                <span>Exit price</span>
                <span>Realized PnL</span>
                <span>Exit reason</span>
                <span>Source</span>
              </div>
              <div className="max-h-[320px] overflow-y-auto">
                {shadowClosedOrders.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-zinc-500">No closed shadow trades</div>
                ) : (
                  shadowClosedOrders.map((row) => (
                    <button
                      type="button"
                      key={row.id}
                      onClick={() => setSelectedShadowOrderId(row.id)}
                      className={clsx(
                        "grid w-full grid-cols-[100px_70px_70px_100px_100px_110px_110px_90px] gap-3 border-b border-zinc-900 px-4 py-3 text-left text-sm transition last:border-b-0",
                        selectedShadowOrderId === row.id ? "bg-indigo-500/10 text-indigo-100" : "text-zinc-200 hover:bg-zinc-950/70"
                      )}
                    >
                      <span>{row.symbol}</span>
                      <span>{row.timeframe || "—"}</span>
                      <span>{row.side}</span>
                      <span>{formatPrice(row.entry_price, 2)}</span>
                      <span>{formatPrice(row.exit_price, 2)}</span>
                      <span className={clsx(Number(row.realized_pnl || 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>
                        {formatUsd(row.realized_pnl, 3)}
                      </span>
                      <span>{exitReasonLabel(row.exit_reason)}</span>
                      <span>{row.is_estimated ? "Estimated" : "Live"}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>

        <section
          className={cardClassName(
            embedded ? "self-start" : "xl:sticky xl:top-6 self-start max-h-[calc(100vh-96px)] overflow-hidden"
          )}
        >
          <SectionTitle title="Shadow order details" />
          {selectedShadowOrder ? (
            <div
              className={clsx(
                "space-y-4 pr-1",
                embedded ? "" : "max-h-[calc(100vh-176px)] overflow-y-auto"
              )}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <MetricCard label="Theoretical price" value={formatPrice(selectedShadowOrder.theoretical_price, 2)} />
                <MetricCard label="Executable price" value={formatPrice(selectedShadowOrder.executable_price, 2)} />
                <MetricCard label="Spread" value={`${formatPrice(selectedShadowOrder.spread_bps, 2)} bps`} />
                <MetricCard label="Slippage" value={`${formatPrice(selectedShadowOrder.slippage_bps, 2)} bps`} />
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="mb-2 text-sm font-medium text-zinc-200">signal_json</div>
                <pre className="max-h-72 overflow-auto text-xs text-zinc-400">
                  {JSON.stringify(parseJsonSafely(selectedShadowOrder.signal_json), null, 2)}
                </pre>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="mb-2 text-sm font-medium text-zinc-200">orderbook_json</div>
                <pre className="max-h-72 overflow-auto text-xs text-zinc-400">
                  {JSON.stringify(parseJsonSafely(selectedShadowOrder.orderbook_json), null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-8 text-center text-sm text-zinc-500">
              Select a shadow record to see details.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
