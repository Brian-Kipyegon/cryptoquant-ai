import { describe, expect, it } from "vitest";

import {
  buildHigherTimeframeTrend,
  calculateRiskSizedQuantity,
  categorizeNoEntryReason,
  classifyValidationStatus,
  createBacktestDiagnostics,
  normalizeMinTrainTrades,
  normalizeRiskPerTradePct,
} from "./backtestValidation";

function makeTrendOhlcv(length: number, startPrice: number, step: number) {
  return Array.from({ length }, (_, index) => {
    const close = startPrice + index * step;
    return [1_700_000_000_000 + index * 60 * 60 * 1000, close, close + 1, close - 1, close, 1000];
  });
}

describe("backtestValidation helpers", () => {
  it("classifies low-trade train slices as insufficient instead of stable", () => {
    expect(classifyValidationStatus({
      trainTrades: 4,
      validationTrades: 12,
      minTrainTrades: 5,
      fragile: false,
    })).toBe("insufficient_trades");
    expect(classifyValidationStatus({
      trainTrades: 8,
      validationTrades: 0,
      minTrainTrades: 5,
      fragile: false,
    })).toBe("no_validation_trades");
  });

  it("normalizes configurable validation controls", () => {
    expect(normalizeMinTrainTrades("5")).toBe(5);
    expect(normalizeMinTrainTrades(-1)).toBe(0);
    expect(normalizeRiskPerTradePct("0.5")).toBe(0.5);
    expect(normalizeRiskPerTradePct(10)).toBe(2);
  });

  it("sizes a trade by account risk budget instead of full notional", () => {
    const sizing = calculateRiskSizedQuantity({
      equity: 10000,
      entryPrice: 100,
      stopPrice: 98,
      riskPerTradePct: 0.5,
      maxCash: 10000,
    });

    expect(sizing.riskBudget).toBe(50);
    expect(sizing.qty).toBeCloseTo(25);
    expect(sizing.notional).toBeCloseTo(2500);
  });

  it("summarizes exit and cost diagnostics", () => {
    const diagnostics = createBacktestDiagnostics({
      noEntryReasonCounts: { trend_filters_not_aligned: 3, risk_off_blocked: 1 },
      exitReasonCounts: { stop_loss: 2, take_profit: 1, opposite_signal: 1 },
      winPnls: [20, 10],
      lossPnls: [-5],
      totalFees: 3,
      totalExecutionCost: 2,
      trainTrades: 3,
      validationTrades: 4,
    });

    expect(diagnostics.noEntryReasons[0]).toEqual({ reason: "trend_filters_not_aligned", count: 3 });
    expect(diagnostics.stopLossCount).toBe(2);
    expect(diagnostics.avgWin).toBe(15);
    expect(diagnostics.avgLoss).toBe(5);
    expect(diagnostics.feeSlippageToGrossProfitPct).toBeCloseTo((5 / 30) * 100);
  });

  it("detects obvious high-timeframe trends for mean-reversion filtering", () => {
    expect(buildHigherTimeframeTrend(makeTrendOhlcv(600, 100, 0.1), "1h").direction).toBe("up");
    expect(buildHigherTimeframeTrend(makeTrendOhlcv(600, 200, -0.1), "1h").direction).toBe("down");
  });

  it.each([
    ["trend-breakout", "[Risk Kill Switch] RISK_OFF environment; the trend strategy may not open new positions.", "risk_off_blocked"],
    ["trend-breakout", "[Macro Gate] Macro risk light is cautious; new trend longs are blocked.", "macro_gate_blocked"],
    ["trend-breakout", "[Trend Breakout] Current regime=RANGE; the trend strategy is waiting for a clear direction.", "trend_regime_not_ready"],
    ["trend-breakout", "[Trend Breakout] Current volatility does not cover round-trip fees; waiting for a stronger breakout.", "trend_filters_not_aligned"],
    ["mean-reversion", "[Mean Reversion] Current regime=TREND_UP; mean reversion entries are blocked in a trending market.", "mean_reversion_wrong_regime"],
    ["mean-reversion", "[Mean Reversion] Volatility is expanding; mean reversion paused to avoid trading against a trend move.", "volatility_expansion_blocked"],
    ["mean-reversion", "[Mean Reversion] Bollinger band, RSI and order book have not lined up for a mean-reversion entry.", "mean_reversion_not_extreme"],
    ["mean-reversion", "higher timeframe uptrend blocks short", "higher_timeframe_trend_blocked"],
    ["regime", "[Regime Engine] Current market regime RANGE; no execution strategy configured.", "other_hold"],
  ])("categorizes %s hold reason: %s", (strategy, reasoning, expected) => {
    expect(categorizeNoEntryReason(strategy, reasoning)).toBe(expected);
  });
});
