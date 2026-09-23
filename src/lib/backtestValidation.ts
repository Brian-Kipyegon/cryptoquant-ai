export type WalkForwardValidationStatus = "stable" | "fragile" | "insufficient_trades" | "no_validation_trades";

export type HigherTimeframeTrend = {
  direction: "up" | "down" | "neutral";
  fourHourChangePct: number;
  dailyChangePct: number;
};

export type BacktestDiagnostics = {
  noEntryReasons: Array<{ reason: string; count: number }>;
  stopLossCount: number;
  takeProfitCount: number;
  oppositeSignalCount: number;
  endExitCount: number;
  avgWin: number;
  avgLoss: number;
  grossProfit: number;
  grossLoss: number;
  totalFees: number;
  totalExecutionCost: number;
  feeSlippageToGrossProfitPct: number;
  trainTrades?: number;
  validationTrades?: number;
};

export function normalizeMinTrainTrades(value: unknown, fallback = 5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1000, Math.max(0, Math.round(numeric)));
}

export function normalizeRiskPerTradePct(value: unknown, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(2, Math.max(0.1, numeric));
}

export function calculateRiskSizedQuantity({
  equity,
  entryPrice,
  stopPrice,
  riskPerTradePct,
  maxCash,
  partialFillRatio = 1,
}: {
  equity: number;
  entryPrice: number;
  stopPrice?: number | null;
  riskPerTradePct: number;
  maxCash: number;
  partialFillRatio?: number;
}) {
  const normalizedEquity = Math.max(0, Number(equity) || 0);
  const normalizedEntry = Number(entryPrice);
  const normalizedStop = Number(stopPrice);
  const normalizedCash = Math.max(0, Number(maxCash) || 0);
  if (!Number.isFinite(normalizedEntry) || normalizedEntry <= 0) {
    return { qty: 0, notional: 0, riskBudget: 0, stopDistance: 0, cappedByCash: false };
  }

  const riskBudget = normalizedEquity * (normalizeRiskPerTradePct(riskPerTradePct) / 100);
  const stopDistance = Number.isFinite(normalizedStop) && normalizedStop > 0
    ? Math.abs(normalizedEntry - normalizedStop)
    : 0;
  if (riskBudget <= 0 || stopDistance <= 0) {
    return { qty: 0, notional: 0, riskBudget, stopDistance, cappedByCash: false };
  }

  const riskQty = riskBudget / stopDistance;
  const affordableNotional = normalizedCash * Math.min(1, Math.max(0, Number(partialFillRatio) || 1));
  const riskNotional = riskQty * normalizedEntry;
  const notional = Math.min(riskNotional, affordableNotional);
  const qty = notional / normalizedEntry;
  return {
    qty,
    notional,
    riskBudget,
    stopDistance,
    cappedByCash: affordableNotional < riskNotional,
  };
}

export function classifyValidationStatus({
  trainTrades,
  validationTrades,
  minTrainTrades,
  fragile,
}: {
  trainTrades: number;
  validationTrades: number;
  minTrainTrades: number;
  fragile: boolean;
}): WalkForwardValidationStatus {
  if (trainTrades < minTrainTrades) return "insufficient_trades";
  if (validationTrades <= 0) return "no_validation_trades";
  if (fragile) return "fragile";
  return "stable";
}

export function createBacktestDiagnostics(args: {
  noEntryReasonCounts?: Record<string, number>;
  exitReasonCounts?: Record<string, number>;
  winPnls?: number[];
  lossPnls?: number[];
  totalFees?: number;
  totalExecutionCost?: number;
  trainTrades?: number;
  validationTrades?: number;
}): BacktestDiagnostics {
  const winPnls = (args.winPnls || []).filter(Number.isFinite);
  const lossPnls = (args.lossPnls || []).filter(Number.isFinite);
  const grossProfit = winPnls.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(lossPnls.reduce((sum, value) => sum + value, 0));
  const totalFees = Number(args.totalFees || 0);
  const totalExecutionCost = Number(args.totalExecutionCost || 0);
  const noEntryReasons = Object.entries(args.noEntryReasonCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
  const exitReasonCounts = args.exitReasonCounts || {};

  return {
    noEntryReasons,
    stopLossCount: Number(exitReasonCounts.stop_loss || 0),
    takeProfitCount: Number(exitReasonCounts.take_profit || 0),
    oppositeSignalCount: Number(exitReasonCounts.opposite_signal || 0),
    endExitCount: Number(exitReasonCounts.end || 0),
    avgWin: winPnls.length ? grossProfit / winPnls.length : 0,
    avgLoss: lossPnls.length ? grossLoss / lossPnls.length : 0,
    grossProfit,
    grossLoss,
    totalFees,
    totalExecutionCost,
    feeSlippageToGrossProfitPct: grossProfit > 0 ? ((totalFees + totalExecutionCost) / grossProfit) * 100 : 0,
    trainTrades: args.trainTrades,
    validationTrades: args.validationTrades,
  };
}

export function categorizeNoEntryReason(strategy: string, reasoning: string) {
  const text = `${strategy || ""} ${reasoning || ""}`;
  if (/RISK_OFF|Risk Kill Switch/i.test(text)) return "risk_off_blocked";
  if (/Macro Gate|Macro risk/i.test(text)) return "macro_gate_blocked";
  if (/regime=.*RANGE|clear direction|regime/i.test(text) && /Trend Breakout|trend-breakout/i.test(text)) return "trend_regime_not_ready";
  if (/not aligned|breakout|momentum|MACD|Trend Breakout/i.test(text)) return "trend_filters_not_aligned";
  if (/trending market|Mean Reversion/i.test(text) && /regime/i.test(text)) return "mean_reversion_wrong_regime";
  if (/higher timeframe/i.test(text)) return "higher_timeframe_trend_blocked";
  if (/volatility/i.test(text)) return "volatility_expansion_blocked";
  if (/Bollinger|RSI|Mean Reversion/i.test(text)) return "mean_reversion_not_extreme";
  return "other_hold";
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function closeAt(row: any) {
  const value = Number(Array.isArray(row) ? row[4] : NaN);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function pctChange(recent: number, previous: number) {
  return previous > 0 ? ((recent - previous) / previous) * 100 : 0;
}

function windowChangePct(ohlcv: any[], lookbackBars: number) {
  const rows = ohlcv.filter(row => closeAt(row) !== null);
  if (rows.length < lookbackBars * 2) return 0;
  const closes = rows.map(row => closeAt(row) as number);
  const previous = average(closes.slice(-lookbackBars * 2, -lookbackBars));
  const recent = average(closes.slice(-lookbackBars));
  return pctChange(recent, previous);
}

export function buildHigherTimeframeTrend(ohlcv: any[], timeframe: string): HigherTimeframeTrend {
  const normalized = String(timeframe || "1h").toLowerCase();
  const barsPerDay = normalized.endsWith("m")
    ? Math.max(1, Math.floor(1440 / Number(normalized.replace("m", ""))))
    : normalized.endsWith("h")
      ? Math.max(1, Math.floor(24 / Number(normalized.replace("h", ""))))
      : 1;
  const barsPer4h = Math.max(1, Math.round(barsPerDay / 6));
  const fourHourChangePct = windowChangePct(ohlcv, barsPer4h * 12);
  const dailyChangePct = windowChangePct(ohlcv, barsPerDay * 10);
  const strongUp = fourHourChangePct >= 1.5 && dailyChangePct >= 2;
  const strongDown = fourHourChangePct <= -1.5 && dailyChangePct <= -2;

  return {
    direction: strongUp ? "up" : strongDown ? "down" : "neutral",
    fourHourChangePct,
    dailyChangePct,
  };
}
