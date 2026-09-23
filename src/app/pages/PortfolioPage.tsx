import React from "react";
import clsx from "clsx";

import type {
  BalanceResponse,
  PortfolioReturnAnalytics,
  PortfolioReturnHistoryRow,
  PortfolioReturnMode,
  PortfolioReturnRange,
  PositionRow,
  RealizedPnlResponse,
} from "../api";
import { MetricCard, SectionTitle } from "../components/common";
import {
  cardClassName,
  exitReasonLabel,
  formatDateTime,
  formatPct,
  formatPrice,
  formatUsd,
  parseJsonSafely,
} from "../utils";
import { normalizeDisplaySymbol } from "../../lib/tradingRuntime";

const PortfolioReturnCurveChart = React.lazy(() =>
  import("../components/PortfolioReturnCurveChart").then((module) => ({ default: module.PortfolioReturnCurveChart }))
);

const MODE_OPTIONS: Array<{ key: PortfolioReturnMode; label: string }> = [
  { key: "live", label: "Live" },
  { key: "shadow", label: "Shadow" },
  { key: "demo", label: "OKX demo" },
];

const RANGE_OPTIONS: Array<{ key: PortfolioReturnRange; label: string }> = [
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "all", label: "All" },
];

function trendFor(value?: number | null) {
  const numeric = Number(value || 0);
  if (numeric > 0) return "up" as const;
  if (numeric < 0) return "down" as const;
  return "neutral" as const;
}

function formatNullablePct(value?: number | null, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return formatPct(value, digits);
}

function formatHoldMinutes(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value < 60) return `${formatPrice(value, 0)} min`;
  return `${formatPrice(value / 60, 1)} h`;
}

function statusLabel(row: PortfolioReturnHistoryRow) {
  if (row.source === "exchange_bill" && row.status === "settled") return "Bill settled";
  if (row.source === "shadow" && row.status === "open") return "Shadow open";
  if (row.source === "shadow" && row.status === "closed") return "Shadow closed";
  if (row.status === "closed") return "Closed";
  if (row.status === "open") return "Open";
  return row.status || "—";
}

function modeLabel(mode: PortfolioReturnMode) {
  return MODE_OPTIONS.find((item) => item.key === mode)?.label || mode;
}

function SegmentButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  key?: React.Key;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-xl px-3 py-1.5 text-sm transition",
        active
          ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
          : "border border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

function ReturnControls({
  returnMode,
  setReturnMode,
  returnRange,
  setReturnRange,
}: {
  returnMode: PortfolioReturnMode;
  setReturnMode: React.Dispatch<React.SetStateAction<PortfolioReturnMode>>;
  returnRange: PortfolioReturnRange;
  setReturnRange: React.Dispatch<React.SetStateAction<PortfolioReturnRange>>;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <div className="flex flex-wrap gap-2">
        {MODE_OPTIONS.map((item) => (
          <SegmentButton key={item.key} active={returnMode === item.key} onClick={() => setReturnMode(item.key)}>
            {item.label}
          </SegmentButton>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {RANGE_OPTIONS.map((item) => (
          <SegmentButton key={item.key} active={returnRange === item.key} onClick={() => setReturnRange(item.key)}>
            {item.label}
          </SegmentButton>
        ))}
      </div>
    </div>
  );
}

function ReturnDetails({ row }: { row: PortfolioReturnHistoryRow | null }) {
  if (!row) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-8 text-center text-sm text-zinc-500">
        Select a return record to see trade details.
      </div>
    );
  }

  const detailPairs = [
    ["Symbol", row.symbol],
    ["Side", row.side],
    ["Strategy", row.strategyId || "—"],
    ["Timeframe", row.timeframe || "—"],
    ["Status", statusLabel(row)],
    ["Opened", formatDateTime(row.openedAt)],
    ["Closed/updated", formatDateTime(row.closedAt || row.timestamp)],
    ["Entry price", formatPrice(row.entryPrice, 2)],
    ["Exit price", formatPrice(row.exitPrice, 2)],
    ["Mark price", formatPrice(row.markPrice, 2)],
    ["Take profit", formatPrice(row.tpPrice, 2)],
    ["Stop loss", formatPrice(row.slPrice, 2)],
    ["Margin/amount", formatUsd(row.margin || row.amount || 0, 2)],
    ["Notional", formatUsd(row.notional || 0, 2)],
    ["Leverage", row.leverage ? `${formatPrice(row.leverage, 1)}x` : "—"],
    ["Hold time", formatHoldMinutes(row.holdMinutes)],
    ["Regime", row.regime || "—"],
    ["Macro gate", row.macroGate || "—"],
    ["Entry reason", row.entryReason || "—"],
    ["Exit reason", exitReasonLabel(row.exitReason)],
    ["Data source", row.source === "exchange_bill" ? "OKX bill" : row.source === "shadow" ? "Shadow execution" : "Local trade"],
    ["Bill type", row.type || "—"],
    ["Bill subtype", row.subType || "—"],
    ["Currency", row.ccy || "—"],
    ["Balance change", row.balanceChange === null ? "—" : formatUsd(row.balanceChange, 3)],
    ["Linked local trade", row.localTradeId || "—"],
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {detailPairs.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-xs text-zinc-500">{label}</div>
            <div className="mt-1 break-words text-sm text-zinc-200">{value}</div>
          </div>
        ))}
      </div>

      {row.source === "shadow" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-xs text-zinc-500">Slippage</div>
            <div className="mt-1 text-sm text-zinc-200">
              {row.slippageBps === null ? "—" : `${formatPrice(row.slippageBps, 2)} bps`}
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-xs text-zinc-500">Estimate source</div>
            <div className="mt-1 text-sm text-zinc-200">{row.isEstimated ? "Estimated" : "Live"}</div>
          </div>
        </div>
      ) : null}

      {row.signalJson ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-2 text-sm font-medium text-zinc-200">signal_json</div>
          <pre className="max-h-72 overflow-auto text-xs text-zinc-400">
            {JSON.stringify(parseJsonSafely(row.signalJson), null, 2)}
          </pre>
        </div>
      ) : null}

      {row.orderbookJson ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-2 text-sm font-medium text-zinc-200">orderbook_json</div>
          <pre className="max-h-72 overflow-auto text-xs text-zinc-400">
            {JSON.stringify(parseJsonSafely(row.orderbookJson), null, 2)}
          </pre>
        </div>
      ) : null}

      {row.rawJson ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-2 text-sm font-medium text-zinc-200">raw_json</div>
          <pre className="max-h-72 overflow-auto text-xs text-zinc-400">
            {JSON.stringify(parseJsonSafely(row.rawJson), null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

type ReturnAnalyticsTab = "overview" | "history" | "detail";

const RETURN_TABS: Array<{ key: ReturnAnalyticsTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "history", label: "History" },
  { key: "detail", label: "Details" },
];

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-xl px-3 py-2 text-sm transition",
        active
          ? "bg-zinc-100 text-zinc-950"
          : "border border-zinc-800 bg-zinc-950/80 text-zinc-300 hover:border-zinc-600 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

function ReturnNotice({
  error,
  staleWarning,
}: {
  error: string;
  staleWarning: string;
}) {
  return (
    <>
      {error ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {staleWarning ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {staleWarning}
        </div>
      ) : null}
    </>
  );
}

function ReturnMetricsGrid({ summary }: { summary: PortfolioReturnAnalytics["summary"] | undefined }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Cumulative PnL" value={formatUsd(summary?.totalPnl || 0, 3)} trend={trendFor(summary?.totalPnl)} />
      <MetricCard label="Account return" value={formatNullablePct(summary?.accountReturnPct)} trend={trendFor(summary?.accountReturnPct)} />
      <MetricCard label="Avg ROI per trade" value={formatNullablePct(summary?.avgTradeRoiPct)} trend={trendFor(summary?.avgTradeRoiPct)} />
      <MetricCard label="Win rate" value={formatNullablePct(summary?.winRate)} />
      <MetricCard label="Profit Factor" value={formatPrice(summary?.profitFactor || 0, 2)} />
      <MetricCard label="Max drawdown" value={formatNullablePct(summary?.maxDrawdownPct)} trend={trendFor(summary?.maxDrawdownPct)} />
      <MetricCard label="Closed trades" value={String(summary?.closedTrades || 0)} hint={`Open: ${summary?.openTrades || 0}`} />
      <MetricCard label="Unrealized PnL" value={formatUsd(summary?.unrealizedPnl || 0, 3)} trend={trendFor(summary?.unrealizedPnl)} />
    </div>
  );
}

function ReturnCurvePanel({
  returnAnalytics,
  refreshing,
}: {
  returnAnalytics: PortfolioReturnAnalytics | null;
  refreshing: boolean;
}) {
  return (
    <section className={cardClassName()}>
      <SectionTitle
        title="Equity curve"
        subtitle={`Capital base: ${formatUsd(returnAnalytics?.capitalBase || 0, 2)} (${returnAnalytics?.capitalBaseSource === "equity" ? "account equity" : returnAnalytics?.capitalBaseSource === "fallback" ? "estimated from local trades" : "none"})`}
        action={refreshing ? <span className="text-sm text-zinc-500">Refreshing...</span> : null}
      />
      <div className="h-[320px]">
        {returnAnalytics?.equityCurve.length ? (
          <React.Suspense
            fallback={
              <div className="flex h-full items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950/60 text-sm text-zinc-500">
                Loading equity curve...
              </div>
            }
          >
            <PortfolioReturnCurveChart equityCurve={returnAnalytics.equityCurve} />
          </React.Suspense>
        ) : (
          <div className="flex h-full items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950/60 text-sm text-zinc-500">
            No return curve data yet
          </div>
        )}
      </div>
    </section>
  );
}

function ReturnHistoryTable({
  history,
  selectedId,
  onSelect,
}: {
  history: PortfolioReturnHistoryRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className={cardClassName()}>
      <SectionTitle title="Return history" subtitle="Key fields only; bill fields, signals and raw JSON are in the record details." />
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <div className="min-w-[920px]">
          <div className="grid grid-cols-[150px_100px_70px_150px_110px_120px_100px_100px] gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
            <span>Time</span>
            <span>Symbol</span>
            <span>Side</span>
            <span>Strategy</span>
            <span>Status</span>
            <span>PnL</span>
            <span>ROI</span>
            <span>Fees/slippage</span>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {history.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-zinc-500">No auto-trading return records</div>
            ) : (
              history.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  onClick={() => onSelect(row.id)}
                  className={clsx(
                    "grid w-full grid-cols-[150px_100px_70px_150px_110px_120px_100px_100px] gap-3 border-b border-zinc-900 px-4 py-3 text-left text-sm transition last:border-b-0",
                    selectedId === row.id ? "bg-indigo-500/10 text-indigo-100" : "text-zinc-200 hover:bg-zinc-950/70"
                  )}
                >
                  <span className="text-zinc-400">{formatDateTime(row.timestamp)}</span>
                  <span>{row.symbol}</span>
                  <span>{row.side}</span>
                  <span className="truncate" title={row.strategyId || "—"}>{row.strategyId || "—"}</span>
                  <span>{statusLabel(row)}</span>
                  <span className={clsx(Number(row.totalPnl || 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>
                    {formatUsd(row.totalPnl, 3)}
                  </span>
                  <span className={clsx(Number(row.tradeRoiPct || 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>
                    {formatPct(row.tradeRoiPct, 2)}
                  </span>
                  <span>
                    {row.source === "shadow"
                      ? row.slippageBps === null ? "—" : `${formatPrice(row.slippageBps, 1)} bps`
                      : formatUsd(row.fee, 3)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ReturnAnalyticsModule({
  returnMode,
  setReturnMode,
  returnRange,
  setReturnRange,
  returnAnalytics,
  returnAnalyticsLoadingInitial,
  returnAnalyticsRefreshing,
  returnAnalyticsError,
  returnAnalyticsStaleWarning,
}: {
  returnMode: PortfolioReturnMode;
  setReturnMode: React.Dispatch<React.SetStateAction<PortfolioReturnMode>>;
  returnRange: PortfolioReturnRange;
  setReturnRange: React.Dispatch<React.SetStateAction<PortfolioReturnRange>>;
  returnAnalytics: PortfolioReturnAnalytics | null;
  returnAnalyticsLoadingInitial: boolean;
  returnAnalyticsRefreshing: boolean;
  returnAnalyticsError: string;
  returnAnalyticsStaleWarning: string;
}) {
  const [activeTab, setActiveTab] = React.useState<ReturnAnalyticsTab>("overview");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const history = returnAnalytics?.history || [];

  React.useEffect(() => {
    if (!history.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !history.some((row) => row.id === selectedId)) {
      setSelectedId(history[0].id);
    }
  }, [history, selectedId]);

  const selectedRow = React.useMemo(
    () => history.find((row) => row.id === selectedId) || null,
    [history, selectedId]
  );
  const summary = returnAnalytics?.summary;
  const activeRangeLabel = RANGE_OPTIONS.find((item) => item.key === returnRange)?.label || returnRange;

  const handleHistorySelect = React.useCallback((id: string) => {
    setSelectedId(id);
    setActiveTab("detail");
  }, []);

  const shell = (children: React.ReactNode) => (
    <div className="space-y-5">
      <SectionTitle
        title="Auto-trading returns"
        subtitle={`Scope: ${modeLabel(returnMode)} / ${activeRangeLabel}`}
        action={<ReturnControls returnMode={returnMode} setReturnMode={setReturnMode} returnRange={returnRange} setReturnRange={setReturnRange} />}
      />
      <div className="flex flex-wrap gap-2">
        {RETURN_TABS.map((item) => (
          <React.Fragment key={item.key}>
            <TabButton active={activeTab === item.key} onClick={() => setActiveTab(item.key)}>
              {item.label}
            </TabButton>
          </React.Fragment>
        ))}
      </div>
      <ReturnNotice error={returnAnalyticsError} staleWarning={returnAnalyticsStaleWarning} />
      {children}
    </div>
  );

  if (returnAnalyticsError && !returnAnalytics) {
    return shell(
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 py-10 text-center text-sm text-zinc-400">
        The returns panel stays hidden until real return data arrives, rather than showing zeros. Check the OKX credentials, account mode and network, then retry.
      </div>
    );
  }

  if (!returnAnalytics && !returnAnalyticsError) {
    return shell(
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 py-10 text-center text-sm text-zinc-400">
        {returnAnalyticsLoadingInitial ? "Loading real return data..." : "Waiting for return data to refresh..."}
      </div>
    );
  }

  return shell(
    <>
      {activeTab === "overview" ? (
        <div className="space-y-5">
          <ReturnMetricsGrid summary={summary} />
          <ReturnCurvePanel returnAnalytics={returnAnalytics} refreshing={returnAnalyticsRefreshing} />
        </div>
      ) : null}

      {activeTab === "history" ? (
        <ReturnHistoryTable history={history} selectedId={selectedId} onSelect={handleHistorySelect} />
      ) : null}

      {activeTab === "detail" ? (
        <section className={cardClassName()}>
          <SectionTitle
            title="Record details"
            subtitle={selectedRow ? `${selectedRow.symbol} / ${formatDateTime(selectedRow.timestamp)}` : "Select a record in the return history to see details."}
            action={
              history.length ? (
                <button
                  type="button"
                  onClick={() => setActiveTab("history")}
                  className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-white"
                >
                  Back to history
                </button>
              ) : null
            }
          />
          <ReturnDetails row={selectedRow} />
        </section>
      ) : null}
    </>
  );
}

export function PortfolioPage({
  balance,
  positions,
  realizedPnl,
  returnMode,
  setReturnMode,
  returnRange,
  setReturnRange,
  returnAnalytics,
  returnAnalyticsLoadingInitial,
  returnAnalyticsRefreshing,
  returnAnalyticsError,
  returnAnalyticsStaleWarning,
}: {
  balance: BalanceResponse | null;
  positions: PositionRow[];
  realizedPnl: RealizedPnlResponse | null;
  returnMode: PortfolioReturnMode;
  setReturnMode: React.Dispatch<React.SetStateAction<PortfolioReturnMode>>;
  returnRange: PortfolioReturnRange;
  setReturnRange: React.Dispatch<React.SetStateAction<PortfolioReturnRange>>;
  returnAnalytics: PortfolioReturnAnalytics | null;
  returnAnalyticsLoadingInitial: boolean;
  returnAnalyticsRefreshing: boolean;
  returnAnalyticsError: string;
  returnAnalyticsStaleWarning: string;
}) {
  const holdingPnl = positions.reduce((sum, row) => sum + Number(row.pnl || 0), 0);
  const autoTradingPnl = returnAnalytics?.summary.totalPnl || 0;

  return (
    <div className="space-y-6">
      <SectionTitle title="Portfolio" subtitle="Account equity, position risk, today's PnL and auto-trading returns." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Account equity" value={formatUsd(balance?.equityUSDT || 0)} />
        <MetricCard label="Available balance" value={formatUsd(balance?.availableUSDT || 0)} />
        <MetricCard
          label="Today's realized PnL"
          value={formatUsd(realizedPnl?.dailyPnL || 0)}
          trend={trendFor(realizedPnl?.dailyPnL)}
        />
        <MetricCard label="Position unrealized PnL" value={formatUsd(holdingPnl, 3)} trend={trendFor(holdingPnl)} />
        <MetricCard label="Open positions" value={String(positions.length)} hint="Currently open" />
        <MetricCard label="Auto-trading cumulative PnL" value={formatUsd(autoTradingPnl, 3)} trend={trendFor(autoTradingPnl)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={cardClassName()}>
          <SectionTitle title="Open positions" subtitle="Check exposure and unrealized PnL first." />
          <div className="overflow-x-auto rounded-2xl border border-zinc-800">
            <div className="min-w-[680px]">
              <div className="grid grid-cols-[120px_80px_110px_110px_110px_120px] gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
                <span>Symbol</span>
                <span>Side</span>
                <span>Contracts</span>
                <span>Entry price</span>
                <span>Mark price</span>
                <span>PnL</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                {positions.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-zinc-500">No open positions</div>
                ) : (
                  positions.map((row, index) => (
                    <div
                      key={`${row.symbol}-${index}`}
                      className="grid grid-cols-[120px_80px_110px_110px_110px_120px] gap-3 border-b border-zinc-900 px-4 py-3 text-sm text-zinc-200 last:border-b-0"
                    >
                      <span>{normalizeDisplaySymbol(row.symbol)}</span>
                      <span>{row.side}</span>
                      <span>{formatPrice(Number(row.contracts || 0), 4)}</span>
                      <span>{formatPrice(Number(row.entryPrice || 0), 2)}</span>
                      <span>{formatPrice(Number(row.markPrice || 0), 2)}</span>
                      <span className={clsx(Number(row.pnl || 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>
                        {formatUsd(Number(row.pnl || 0), 3)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        <section className={cardClassName()}>
          <SectionTitle title="Recent realized PnL" subtitle="Recent settlements from OKX bills." />
          <div className="overflow-x-auto rounded-2xl border border-zinc-800">
            <div className="min-w-[560px]">
              <div className="grid grid-cols-[160px_100px_80px_100px_100px] gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
                <span>Time</span>
                <span>Symbol</span>
                <span>Type</span>
                <span>PnL</span>
                <span>Fees</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                {(realizedPnl?.rows || []).length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-zinc-500">No recent realized PnL</div>
                ) : (
                  (realizedPnl?.rows || []).slice(0, 30).map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[160px_100px_80px_100px_100px] gap-3 border-b border-zinc-900 px-4 py-3 text-sm text-zinc-200 last:border-b-0"
                    >
                      <span className="text-zinc-400">{formatDateTime(row.timestamp)}</span>
                      <span>{normalizeDisplaySymbol(row.symbol)}</span>
                      <span>{row.subType || row.type}</span>
                      <span className={clsx(row.pnl >= 0 ? "text-emerald-300" : "text-rose-300")}>
                        {formatUsd(row.pnl, 3)}
                      </span>
                      <span>{formatUsd(row.fee, 3)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      <ReturnAnalyticsModule
        returnMode={returnMode}
        setReturnMode={setReturnMode}
        returnRange={returnRange}
        setReturnRange={setReturnRange}
        returnAnalytics={returnAnalytics}
        returnAnalyticsLoadingInitial={returnAnalyticsLoadingInitial}
        returnAnalyticsRefreshing={returnAnalyticsRefreshing}
        returnAnalyticsError={returnAnalyticsError}
        returnAnalyticsStaleWarning={returnAnalyticsStaleWarning}
      />
    </div>
  );
}
