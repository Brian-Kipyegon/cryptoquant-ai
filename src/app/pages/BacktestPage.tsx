import React from "react";
import clsx from "clsx";

import type { FactorAuditItem, StrategyWalkForwardSummary, WalkForwardBacktestResponse, WalkForwardRound, WalkForwardValidationStatus } from "../api";
import { MetricCard, SectionTitle } from "../components/common";
import { cardClassName, DEFAULT_STRATEGIES, formatDateTime, formatPct, formatPrice, formatUsd, type BacktestForm } from "../utils";
import { AUTO_TRADING_ALLOWED_SYMBOLS } from "../../lib/tradingRuntime";

const STATUS_LABELS: Record<FactorAuditItem["status"], string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  unavailable: "No history available",
  latest_revision_blocked: "Latest revision blocked",
};

function strategyLabel(strategy: string) {
  if (strategy === "trend-breakout") return "Trend breakout";
  if (strategy === "mean-reversion") return "Mean reversion";
  return strategy;
}

function trendFor(value?: number | null): "up" | "down" | "neutral" {
  const numeric = Number(value || 0);
  if (numeric > 0) return "up";
  if (numeric < 0) return "down";
  return "neutral";
}

function summaryCards(summary: StrategyWalkForwardSummary | undefined) {
  return [
    { label: "Rounds", value: String(summary?.rounds || 0), trend: "neutral" as const },
    { label: "Valid rounds", value: String(summary?.validRounds || 0), trend: "up" as const },
    { label: "Too few trades", value: String(summary?.insufficientTradeRounds || 0), trend: summary?.insufficientTradeRounds ? "down" as const : "neutral" as const },
    { label: "No validation trades", value: String(summary?.noValidationTradeRounds || 0), trend: summary?.noValidationTradeRounds ? "down" as const : "neutral" as const },
    { label: "Median return", value: formatPct(summary?.medianReturn || 0), trend: trendFor(summary?.medianReturn) },
    { label: "Worst return", value: formatPct(summary?.worstReturn || 0), trend: trendFor(summary?.worstReturn) },
    { label: "Worst drawdown", value: formatPct(summary?.worstMaxDrawdown || 0), trend: "down" as const },
    { label: "Profit Factor", value: formatPrice(summary?.medianProfitFactor || 0, 2), trend: "neutral" as const },
    { label: "Fragile rounds", value: String(summary?.fragileRounds || 0), trend: summary?.fragileRounds ? "down" as const : "neutral" as const },
  ];
}

const STATUS_META: Record<WalkForwardValidationStatus, { label: string; className: string }> = {
  stable: { label: "Stable", className: "text-emerald-300" },
  fragile: { label: "Fragile", className: "text-amber-200" },
  insufficient_trades: { label: "Too few trades", className: "text-rose-300" },
  no_validation_trades: { label: "No validation trades", className: "text-amber-200" },
};

const REASON_LABELS: Record<string, string> = {
  risk_off_blocked: "Risk off",
  macro_gate_blocked: "Macro gate",
  trend_regime_not_ready: "Trend regime not ready",
  trend_filters_not_aligned: "Trend filters not aligned",
  mean_reversion_wrong_regime: "Not a ranging market",
  higher_timeframe_trend_blocked: "Higher-timeframe trend filter",
  volatility_expansion_blocked: "Volatility expansion",
  mean_reversion_not_extreme: "No extreme reached",
  risk_sizing_invalid: "Invalid risk sizing",
  other_hold: "Other hold",
};

function statusMeta(status?: WalkForwardValidationStatus) {
  return STATUS_META[status || "stable"] || STATUS_META.stable;
}

function topReason(round: WalkForwardRound) {
  const reason = round.diagnostics?.noEntryReasons?.[0];
  if (!reason) return "--";
  return `${REASON_LABELS[reason.reason] || reason.reason} (${reason.count})`;
}

function FormNumber({
  label,
  value,
  onChange,
  min,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <label className="text-sm text-zinc-400">
      {label}
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
      />
    </label>
  );
}

function StrategyTabs({
  strategies,
  activeStrategy,
  onChange,
}: {
  strategies: string[];
  activeStrategy: string;
  onChange: (strategy: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {strategies.map((strategy) => (
        <button
          key={strategy}
          type="button"
          onClick={() => onChange(strategy)}
          className={clsx(
            "rounded-xl px-3 py-2 text-sm transition",
            activeStrategy === strategy
              ? "bg-zinc-100 text-zinc-950"
              : "border border-zinc-800 bg-zinc-950/80 text-zinc-300 hover:border-zinc-600 hover:text-white"
          )}
        >
          {strategyLabel(strategy)}
        </button>
      ))}
    </div>
  );
}

function FactorAudit({ audit }: { audit: FactorAuditItem[] }) {
  return (
    <section className={cardClassName()}>
      <SectionTitle title="Data integrity audit" subtitle="In strict mode only data with real timestamps enters the backtest." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {audit.map((item) => (
          <div
            key={item.factor}
            className={clsx(
              "rounded-2xl border p-4",
              item.usedInBacktest ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium text-zinc-100">{item.label}</div>
              <span className={clsx("text-xs", item.usedInBacktest ? "text-emerald-300" : "text-amber-200")}>
                {STATUS_LABELS[item.status]}
              </span>
            </div>
            <div className="mt-3 text-sm leading-6 text-zinc-300">{item.message}</div>
            {item.requiredTimestamp ? (
              <div className="mt-3 text-xs text-zinc-500">Required timestamp field: {item.requiredTimestamp}</div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function RoundsTable({ rounds }: { rounds: WalkForwardRound[] }) {
  return (
    <section className={cardClassName()}>
      <SectionTitle title="Round details" subtitle="Training windows always precede validation windows; zero-trade and under-trained rounds are flagged, never shown as stable." />
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <div className="min-w-[1780px]">
          <div className="grid grid-cols-[110px_150px_150px_80px_80px_95px_95px_80px_95px_110px_145px_145px_120px_130px] gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
            <span>Symbol</span>
            <span>Training window</span>
            <span>Validation window</span>
            <span>Stop loss</span>
            <span>Take profit</span>
            <span>Validation return</span>
            <span>Max drawdown</span>
            <span>Win rate</span>
            <span>Train/validate</span>
            <span>Status</span>
            <span>Main no-entry reason</span>
            <span>Exit stats</span>
            <span>Avg win/loss</span>
            <span>Costs/gross profit</span>
          </div>
          <div>
            {rounds.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-zinc-500">No walk-forward rounds yet</div>
            ) : (
              rounds.map((round, index) => {
                const status = statusMeta(round.validationStatus);
                const diagnostics = round.diagnostics;
                return (
                  <div
                    key={`${round.strategy}-${round.symbol}-${round.validationStart}-${index}`}
                    className="grid grid-cols-[110px_150px_150px_80px_80px_95px_95px_80px_95px_110px_145px_145px_120px_130px] gap-3 border-b border-zinc-900 px-4 py-3 text-sm text-zinc-200 last:border-b-0"
                  >
                    <span>{round.symbol}</span>
                    <span className="text-zinc-400">
                      {formatDateTime(round.trainStart).slice(0, 10)} - {formatDateTime(round.trainEnd).slice(0, 10)}
                    </span>
                    <span className="text-zinc-400">
                      {formatDateTime(round.validationStart).slice(0, 10)} - {formatDateTime(round.validationEnd).slice(0, 10)}
                    </span>
                    <span>{formatPct(round.selectedParams.stopLoss)}</span>
                    <span>{formatPct(round.selectedParams.takeProfit)}</span>
                    <span className={clsx(trendFor(round.validation.totalReturn) === "up" ? "text-emerald-300" : "text-rose-300")}>
                      {formatPct(round.validation.totalReturn || 0)}
                    </span>
                    <span>{formatPct(round.validation.maxDrawdown || 0)}</span>
                    <span>{formatPct(round.validation.winRate || 0)}</span>
                    <span>{diagnostics?.trainTrades ?? round.train.totalTrades}/{diagnostics?.validationTrades ?? round.validation.totalTrades ?? 0}</span>
                    <span className={status.className}>{status.label}</span>
                    <span className="truncate text-zinc-400" title={round.insufficientReason || topReason(round)}>
                      {round.insufficientReason || topReason(round)}
                    </span>
                    <span className="text-zinc-400">
                      SL {diagnostics?.stopLossCount || 0} / TP {diagnostics?.takeProfitCount || 0} / Reverse {diagnostics?.oppositeSignalCount || 0}
                    </span>
                    <span className="text-zinc-400">{formatUsd(diagnostics?.avgWin || 0, 2)} / {formatUsd(diagnostics?.avgLoss || 0, 2)}</span>
                    <span>{formatPct(diagnostics?.feeSlippageToGrossProfitPct || 0)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function BacktestPage({
  backtestForm,
  setBacktestForm,
  backtestResult,
  backtestLoading,
  backtestError,
  handleRunBacktest,
}: {
  backtestForm: BacktestForm;
  setBacktestForm: React.Dispatch<React.SetStateAction<BacktestForm>>;
  backtestResult: WalkForwardBacktestResponse | null;
  backtestLoading: boolean;
  backtestError: string;
  handleRunBacktest: () => Promise<void>;
}) {
  const resultStrategies = backtestResult?.strategies?.length ? backtestResult.strategies : backtestForm.strategyIds;
  const [activeStrategy, setActiveStrategy] = React.useState(resultStrategies[0] || DEFAULT_STRATEGIES[0]);

  React.useEffect(() => {
    if (resultStrategies.length && !resultStrategies.includes(activeStrategy)) {
      setActiveStrategy(resultStrategies[0]);
    }
  }, [activeStrategy, resultStrategies]);

  const activeBucket = backtestResult?.byStrategy?.[activeStrategy];
  const activeSummary = activeBucket?.summary;
  const activeRounds = activeBucket?.rounds || [];
  const selectedSymbols = backtestForm.symbols?.length ? backtestForm.symbols : [backtestForm.symbol];

  const toggleSymbol = React.useCallback((symbol: string) => {
    setBacktestForm((current) => {
      const currentSymbols = current.symbols?.length ? current.symbols : [current.symbol];
      const exists = currentSymbols.includes(symbol);
      const nextSymbols = exists ? currentSymbols.filter((item) => item !== symbol) : [...currentSymbols, symbol];
      const safeSymbols = nextSymbols.length ? nextSymbols : [symbol];
      return { ...current, symbol: safeSymbols[0], symbols: safeSymbols };
    });
  }, [setBacktestForm]);

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Walk-forward strategy validation"
        subtitle="Trend breakout and mean reversion are validated separately by default. Price candles replay in time order; news, on-chain and macro data stay out until point-in-time data is available."
      />

      <section className={cardClassName()}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm text-zinc-400">
            Timeframe
            <select
              value={backtestForm.timeframe}
              onChange={(event) => setBacktestForm((current) => ({ ...current, timeframe: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
            >
              <option value="15m">15m</option>
              <option value="1h">1h</option>
            </select>
          </label>
          <FormNumber label="Initial capital" value={backtestForm.initialEquity} min={1} onChange={(value) => setBacktestForm((current) => ({ ...current, initialEquity: value }))} />
          <FormNumber label="Training window (days)" value={backtestForm.trainDays} min={1} onChange={(value) => setBacktestForm((current) => ({ ...current, trainDays: value }))} />
          <FormNumber label="Validation window (days)" value={backtestForm.validationDays} min={1} onChange={(value) => setBacktestForm((current) => ({ ...current, validationDays: value }))} />
          <FormNumber label="Step (days)" value={backtestForm.stepDays} min={1} onChange={(value) => setBacktestForm((current) => ({ ...current, stepDays: value }))} />
          <FormNumber label="Data limit (bars)" value={backtestForm.period} min={120} onChange={(value) => setBacktestForm((current) => ({ ...current, period: value }))} />
          <FormNumber label="Base stop loss" value={backtestForm.stopLoss} min={0.1} step={0.1} onChange={(value) => setBacktestForm((current) => ({ ...current, stopLoss: value }))} />
          <FormNumber label="Base take profit" value={backtestForm.takeProfit} min={0.1} step={0.1} onChange={(value) => setBacktestForm((current) => ({ ...current, takeProfit: value }))} />
          <FormNumber label="Min training trades" value={backtestForm.minTrainTrades} min={0} onChange={(value) => setBacktestForm((current) => ({ ...current, minTrainTrades: value }))} />
          <FormNumber label="Risk per trade (%)" value={backtestForm.riskPerTradePct} min={0.1} step={0.1} onChange={(value) => setBacktestForm((current) => ({ ...current, riskPerTradePct: value }))} />
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="text-sm text-zinc-400">Symbols</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {AUTO_TRADING_ALLOWED_SYMBOLS.map((symbol) => (
                <button
                  key={symbol}
                  type="button"
                  onClick={() => toggleSymbol(symbol)}
                  className={clsx(
                    "rounded-xl px-3 py-2 text-sm transition",
                    selectedSymbols.includes(symbol)
                      ? "bg-indigo-500 text-white"
                      : "border border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600 hover:text-white"
                  )}
                >
                  {symbol}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm text-zinc-400">Strategies</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {DEFAULT_STRATEGIES.map((strategy) => (
                <span key={strategy} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
                  {strategyLabel(strategy)}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">
          Strict mode: only price candles feed signals. News, on-chain and macro data need a real publication or vintage timestamp; otherwise they appear only as audit notes, never in the strategy context.
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleRunBacktest()}
            disabled={backtestLoading}
            className="rounded-2xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-indigo-900"
          >
            {backtestLoading ? "Validating..." : "Run walk-forward validation"}
          </button>
          <span className="text-sm text-zinc-500">
            Initial capital: {formatUsd(backtestForm.initialEquity, 2)}, risk per trade {formatPct(backtestForm.riskPerTradePct)}; rounds with fewer than {backtestForm.minTrainTrades} training trades are flagged as too few trades.
          </span>
        </div>
      </section>

      {backtestError ? (
        <section className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm leading-6 text-rose-100">
          <div className="font-semibold text-rose-200">Walk-forward backtest failed</div>
          <div className="mt-2 whitespace-pre-wrap break-words">{backtestError}</div>
          <div className="mt-3 text-xs text-rose-200/70">
            There is no fallback to the old single-period backtest or a fake 0% curve. Shorten the training/validation windows, raise the bar limit, or check the OKX OHLCV data.
          </div>
        </section>
      ) : null}

      {backtestResult ? (
        <div className="space-y-6">
          <section className={cardClassName("space-y-5")}>
            <SectionTitle
              title="Strategy overview"
              subtitle={`Each strategy is judged on its own; zero-trade trend breakout and mean reversion results are never merged into one verdict. Risk per trade ${formatPct(backtestResult.config.riskPerTradePct)}, minimum ${backtestResult.config.minTrainTrades} training trades.`}
            />
            <StrategyTabs strategies={resultStrategies} activeStrategy={activeStrategy} onChange={setActiveStrategy} />
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              {summaryCards(activeSummary).map((item) => (
                <React.Fragment key={item.label}>
                  <MetricCard label={item.label} value={item.value} trend={item.trend} />
                </React.Fragment>
              ))}
            </div>
          </section>

          <RoundsTable rounds={activeRounds} />

          <section className={cardClassName("space-y-4")}>
            <SectionTitle title="All rounds audit" subtitle="For checking sample coverage only, not a verdict on strategy returns." />
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              {summaryCards(backtestResult.summary).map((item) => (
                <React.Fragment key={item.label}>
                  <MetricCard label={item.label} value={item.value} trend={item.trend} />
                </React.Fragment>
              ))}
            </div>
          </section>

          <FactorAudit audit={backtestResult.factorAudit || []} />

          <section className={cardClassName()}>
            <SectionTitle title="Time consistency" />
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(backtestResult.timeConsistency || {}).map(([key, value]) => (
                <div key={key} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <div className="text-sm font-medium text-zinc-200">{key}</div>
                  <div className="mt-2 text-sm leading-6 text-zinc-400">{value}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
