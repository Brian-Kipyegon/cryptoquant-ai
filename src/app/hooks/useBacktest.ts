import React from "react";

import { postJson, type WalkForwardBacktestResponse } from "../api";
import { DEFAULT_STRATEGIES, type BacktestForm } from "../utils";
import { AUTO_TRADING_ALLOWED_SYMBOLS } from "../../lib/tradingRuntime";

export function useBacktest({
  token,
  onToast,
}: {
  token: string;
  onToast: (toast: { kind: "success" | "error" | "info"; message: string }) => void;
}) {
  const [backtestForm, setBacktestForm] = React.useState<BacktestForm>({
    symbol: AUTO_TRADING_ALLOWED_SYMBOLS[0],
    symbols: [AUTO_TRADING_ALLOWED_SYMBOLS[0]],
    timeframe: "1h",
    strategy: DEFAULT_STRATEGIES[0],
    strategyIds: DEFAULT_STRATEGIES,
    period: 6000,
    initialEquity: 10000,
    trainDays: 180,
    validationDays: 30,
    stepDays: 30,
    stopLoss: 2,
    takeProfit: 6,
    estimatedFeeRate: 0.05,
    minTrainTrades: 5,
    riskPerTradePct: 0.5,
  });
  const [backtestResult, setBacktestResult] = React.useState<WalkForwardBacktestResponse | null>(null);
  const [backtestLoading, setBacktestLoading] = React.useState(false);
  const [backtestError, setBacktestError] = React.useState("");

  const handleRunBacktest = React.useCallback(async () => {
    setBacktestLoading(true);
    setBacktestError("");
    setBacktestResult(null);
    try {
      const result = await postJson<WalkForwardBacktestResponse>("/api/backtest/walk-forward", backtestForm, { token });
      setBacktestResult(result);
    } catch (error: any) {
      const payload = error?.payload && typeof error.payload === "object" ? error.payload : null;
      const details = payload?.bySymbol ? ` ${JSON.stringify(payload.bySymbol)}` : "";
      const message = `${error?.message || "Backtest failed"}${details}`.slice(0, 1200);
      setBacktestError(message);
      onToast({ kind: "error", message: error?.message || "Backtest failed" });
    } finally {
      setBacktestLoading(false);
    }
  }, [backtestForm, onToast, token]);

  return { backtestForm, setBacktestForm, backtestResult, backtestLoading, backtestError, handleRunBacktest };
}
