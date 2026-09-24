import { calculateRSI, calculateSMA, calculateStandardDeviation } from "../../src/lib/indicators";
import { evaluateMacroGate, runStrategyAnalysis as evaluateStrategy } from "../../src/lib/strategyEngine";
import { calculateOhlcvStartSince, nextOhlcvSince, normalizeOhlcvHistory } from "../../src/lib/ohlcvHistory";
import { buildHigherTimeframeTrend, calculateRiskSizedQuantity, categorizeNoEntryReason, createBacktestDiagnostics, normalizeRiskPerTradePct } from "../../src/lib/backtestValidation";
import { cachedPublicMarket } from "../utils";
import { getMarketDataProvider } from "../market/providers";
import { normalizeDisplaySymbol } from "../../src/lib/tradingRuntime";

export type BacktestRunOptions = {
  symbol: string;
  strategy: string;
  stopLoss: number;
  takeProfit: number;
  estimatedFeeRate: number;
  timeframe?: string;
  fundingRatePer8h?: number;
  initialEquity?: number;
  macroRiskScore?: number;
  tradeStartTime?: number;
  riskPerTradePct?: number;
  trendRegimeThreshold?: number;
  enableHigherTimeframeTrendFilter?: boolean;
};

export function symbolExecutionProfile(symbol: string) {
  const upper = String(symbol || "").toUpperCase();
  if (upper.includes("BTC")) return { spreadBps: 1.2, slippageBaseBps: 1.8, depthScore: 1 };
  if (upper.includes("ETH")) return { spreadBps: 1.6, slippageBaseBps: 2.2, depthScore: 0.85 };
  if (upper.includes("SOL")) return { spreadBps: 3.5, slippageBaseBps: 4.5, depthScore: 0.55 };
  return { spreadBps: 5, slippageBaseBps: 7, depthScore: 0.35 };
}

export function executionPenaltyModel(args: {
  symbol: string;
  side: "buy" | "sell";
  referencePrice: number;
  bar?: any;
  volatility?: number;
  reason?: string;
}) {
  const profile = symbolExecutionProfile(args.symbol);
  const referencePrice = Number(args.referencePrice || 0);
  const open = Number(args.bar?.[1] || referencePrice);
  const high = Number(args.bar?.[2] || referencePrice);
  const low = Number(args.bar?.[3] || referencePrice);
  const volume = Number(args.bar?.[5] || 0);
  const barVolatility = referencePrice > 0 ? Math.max(0, (high - low) / referencePrice) : 0;
  const volatility = Math.max(args.volatility || 0, barVolatility);
  const spreadPenaltyBps = profile.spreadBps / 2;
  const volumePenaltyBps = volume > 0 ? Math.min(10, 30000 / Math.sqrt(volume + 1)) * (1 - profile.depthScore) : 8;
  const volatilityPenaltyBps = Math.min(40, volatility * 10000 * 0.08);
  const latencyPenaltyBps = Math.min(20, volatility * 10000 * 0.035 + 0.8);
  const extremePenaltyBps = volatility > 0.06 ? (volatility - 0.06) * 10000 * 0.25 : 0;
  const gapPenaltyBps = args.reason === "stop_loss" && Math.abs(open - referencePrice) / referencePrice > 0.003
    ? Math.min(35, Math.abs(open - referencePrice) / referencePrice * 10000)
    : 0;
  const totalPenaltyBps = spreadPenaltyBps
    + profile.slippageBaseBps
    + volumePenaltyBps
    + volatilityPenaltyBps
    + latencyPenaltyBps
    + extremePenaltyBps
    + gapPenaltyBps;
  const direction = args.side === "buy" ? 1 : -1;
  const expectedFill = referencePrice * (1 + direction * totalPenaltyBps / 10000);
  const partialFillRatio = volatility > 0.08 ? 0.75 : volatility > 0.05 ? 0.9 : 1;
  const failureRisk = volatility > 0.10 ? "high" : volatility > 0.06 ? "elevated" : "normal";

  return {
    expectedFill,
    totalPenaltyBps,
    spreadPenaltyBps,
    slippagePenaltyBps: profile.slippageBaseBps + volumePenaltyBps + volatilityPenaltyBps,
    latencyPenaltyBps,
    extremePenaltyBps,
    gapPenaltyBps,
    makerTaker: args.reason === "take_profit" ? "maker_or_limit" : "taker",
    partialFillRatio,
    failureRisk,
    referencePrice,
  };
}

export function calculateRobustSelectionScore(result: any, perturbations: any[] = []) {
  const medianNetReturn = result.totalReturn || 0;
  const profitFactorScore = Math.min(3, result.profitFactor || 0);
  const expectancyScore = Math.max(-10, Math.min(10, result.expectancy || 0)) / 10;
  const perturbReturns = perturbations.map(item => item.totalReturn).filter(Number.isFinite);
  const worstPerturbReturn = perturbReturns.length ? Math.min(...perturbReturns) : medianNetReturn;
  const stabilityScore = medianNetReturn === 0
    ? 0
    : Math.max(-1, Math.min(1, 1 - Math.abs(medianNetReturn - worstPerturbReturn) / Math.max(1, Math.abs(medianNetReturn))));
  const maxDrawdownPenalty = Math.max(0, result.maxDrawdown || 0);

  return (medianNetReturn * 0.30)
    + (profitFactorScore * 10 * 0.20)
    + (expectancyScore * 10 * 0.20)
    + (stabilityScore * 10 * 0.20)
    - (maxDrawdownPenalty * 0.10);
}

export function timeframeBarsPerDay(timeframe: string) {
  const normalized = String(timeframe || "1h").toLowerCase();
  if (normalized.endsWith("m")) return Math.max(1, Math.floor(1440 / Number(normalized.replace("m", ""))));
  if (normalized.endsWith("h")) return Math.max(1, Math.floor(24 / Number(normalized.replace("h", ""))));
  if (normalized === "1d") return 1;
  return 24;
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function runBacktestOnOhlcv(ohlcv: any[], options: BacktestRunOptions) {
  const feeRate = Number(options.estimatedFeeRate) / 100;
  const initialEquity = options.initialEquity || 10000;
  const riskPerTradePct = normalizeRiskPerTradePct(options.riskPerTradePct);
  const macroGate = evaluateMacroGate({ macroRiskScore: options.macroRiskScore || 0 });
  let cash = initialEquity;
  let totalFees = 0;
  let totalExecutionCost = 0;
  let totalFunding = 0;
  let position: null | {
    side: "long" | "short";
    qty: number;
    entryPrice: number;
    entryEquity: number;
    entryRegime: string;
    entryReason: string;
    entryExecution: any;
    tpPrice?: number;
    slPrice?: number;
  } = null;
  let winTrades = 0;
  let closedTrades = 0;
  const trades: any[] = [];
  const equityCurve = [cash];
  const tradePnls: number[] = [];
  const noEntryReasonCounts: Record<string, number> = {};
  const exitReasonCounts: Record<string, number> = {};
  const regimePerformance: Record<string, { pnl: number; trades: number }> = {
    TREND_UP: { pnl: 0, trades: 0 },
    TREND_DOWN: { pnl: 0, trades: 0 },
    RANGE: { pnl: 0, trades: 0 },
    RISK_OFF: { pnl: 0, trades: 0 },
  };

  const average = (values: number[]) => values.length ? values.reduce((acc, val) => acc + val, 0) / values.length : 0;
  const stdev = (values: number[]) => {
    if (values.length < 2) return 0;
    const mean = average(values);
    return Math.sqrt(average(values.map(value => Math.pow(value - mean, 2))));
  };
  const barsPer8h = Math.max(1, Math.round(timeframeBarsPerDay(options.timeframe || "1h") / 3));
  const fundingPerBar = Number(options.fundingRatePer8h || 0) / barsPer8h;
  const applyFunding = (markPrice: number) => {
    if (!position || !Number.isFinite(markPrice) || markPrice <= 0 || fundingPerBar === 0) return;
    const notional = position.qty * markPrice;
    const signedFunding = position.side === "long"
      ? -notional * fundingPerBar
      : notional * fundingPerBar;
    cash += signedFunding;
    totalFunding += signedFunding;
  };
  const markEquity = (price: number) => {
    if (!position) return cash;
    const pnl = position.side === "long"
      ? position.qty * (price - position.entryPrice)
      : position.qty * (position.entryPrice - price);
    return cash + pnl;
  };
  const closePosition = (price: number, time: number, reason: string, bar?: any) => {
    if (!position) return;
    const exitSide = position.side === "long" ? "sell" : "buy";
    const execution = executionPenaltyModel({
      symbol: options.symbol,
      side: exitSide,
      referencePrice: price,
      bar,
      reason,
    });
    const fillPrice = execution.expectedFill;
    totalExecutionCost += Math.abs(fillPrice - price) * position.qty;
    const grossPnl = position.side === "long"
      ? position.qty * (fillPrice - position.entryPrice)
      : position.qty * (position.entryPrice - fillPrice);
    const closeFee = position.qty * fillPrice * feeRate;
    totalFees += closeFee;
    cash += grossPnl - closeFee;
    const tradePnl = cash - position.entryEquity;
    tradePnls.push(tradePnl);
    exitReasonCounts[reason] = (exitReasonCounts[reason] || 0) + 1;
    if (tradePnl > 0) winTrades += 1;
    closedTrades += 1;
    if (!regimePerformance[position.entryRegime]) regimePerformance[position.entryRegime] = { pnl: 0, trades: 0 };
    regimePerformance[position.entryRegime].pnl += tradePnl;
    regimePerformance[position.entryRegime].trades += 1;
    trades.push({
      type: "close",
      side: position.side,
      price: fillPrice,
      time,
      pnl: tradePnl,
      entryPrice: position.entryPrice,
      entryReason: position.entryReason,
      exitReason: reason,
      regime: position.entryRegime,
      execution,
    });
    position = null;
  };
  const openPosition = (side: "long" | "short", price: number, time: number, analysis: any, bar?: any) => {
    const execution = executionPenaltyModel({
      symbol: options.symbol,
      side: side === "long" ? "buy" : "sell",
      referencePrice: price,
      bar,
    });
    const fillPrice = execution.expectedFill;
    const entryEquity = cash;
    const sizing = calculateRiskSizedQuantity({
      equity: entryEquity,
      entryPrice: fillPrice,
      stopPrice: analysis.sl_price,
      riskPerTradePct,
      maxCash: cash,
      partialFillRatio: execution.partialFillRatio,
    });
    if (sizing.qty <= 0 || sizing.notional <= 0) {
      noEntryReasonCounts.risk_sizing_invalid = (noEntryReasonCounts.risk_sizing_invalid || 0) + 1;
      return;
    }
    const filledCash = sizing.notional;
    const openFee = filledCash * feeRate;
    totalFees += openFee;
    cash -= openFee;
    totalExecutionCost += Math.abs(fillPrice - price) * (filledCash / fillPrice);
    position = {
      side,
      qty: filledCash / fillPrice,
      entryPrice: fillPrice,
      entryEquity,
      entryRegime: analysis.regime || "UNKNOWN",
      entryReason: analysis.reasoning,
      entryExecution: execution,
      tpPrice: analysis.tp_price,
      slPrice: analysis.sl_price,
    };
    trades.push({
      type: "open",
      side,
      price: fillPrice,
      time,
      regime: analysis.regime,
      macroGate: analysis.macroGate?.state,
      reason: analysis.reasoning,
      tpPrice: analysis.tp_price,
      slPrice: analysis.sl_price,
      riskPerTradePct,
      riskBudget: sizing.riskBudget,
      stopDistance: sizing.stopDistance,
      notional: filledCash,
      cappedByCash: sizing.cappedByCash,
      execution,
    });
  };

  for (let i = 41; i < ohlcv.length; i++) {
    const current = ohlcv[i];
    const currentOpen = Number(current[1]);
    const currentHigh = Number(current[2]);
    const currentLow = Number(current[3]);
    const currentClose = Number(current[4]);
    if (![currentOpen, currentHigh, currentLow, currentClose].every(value => Number.isFinite(value) && value > 0)) continue;

    const history = ohlcv.slice(0, i);
    const previous = history[history.length - 1];
    const previous2 = history[history.length - 2];
    const signalPrice = Number(previous?.[4]);
    const previousPrice = Number(previous2?.[4]);
    if (!Number.isFinite(signalPrice) || !Number.isFinite(previousPrice) || signalPrice <= 0 || previousPrice <= 0) continue;

    const recent = history.slice(-24);
    const prices = history.map(candle => Number(candle[4])).filter(Number.isFinite);
    const highs = recent.map(candle => Number(candle[2])).filter(Number.isFinite);
    const lows = recent.map(candle => Number(candle[3])).filter(Number.isFinite);
    const pct = ((signalPrice - previousPrice) / previousPrice) * 100;
    const sma20 = calculateSMA(prices, 20);
    const higherTimeframeTrend = options.enableHigherTimeframeTrendFilter
      ? buildHigherTimeframeTrend(history, options.timeframe || "1h")
      : undefined;
    const analysis = evaluateStrategy({
      symbol: options.symbol,
      ticker: {
        last: signalPrice,
        high: Math.max(...highs, signalPrice),
        low: Math.min(...lows, signalPrice),
        percentage: pct,
        volume: Number(previous?.[5] || 0),
      },
      strategyId: options.strategy,
      prices,
      indicators: {
        rsi: calculateRSI(prices),
        sma20,
        stdDev: calculateStandardDeviation(prices, 20),
        isRealData: true,
      },
      market: {
        sentiment: 50 + Math.max(-20, Math.min(20, pct * 5)),
        volatility: (Math.max(...highs, signalPrice) - Math.min(...lows, signalPrice)) / signalPrice,
        fundingRate: 0,
        macroRiskScore: options.macroRiskScore || 0,
        macroGate,
        onChainData: {
          exchangeInflow: 0,
          whaleActivity: 50,
          activeAddresses: Number(previous?.[5] || 0),
          mvrvRatio: 1.8,
        },
      },
      risk: { estimatedFeeRate: options.estimatedFeeRate, stopLoss: options.stopLoss, takeProfit: options.takeProfit },
      allowSyntheticData: false,
      strategyOptions: {
        trendRegimeThreshold: options.trendRegimeThreshold,
        higherTimeframeTrend,
      },
    });

    if (position?.side === "long") {
      if (position.slPrice && currentLow <= position.slPrice) closePosition(Math.min(position.slPrice, currentOpen), current[0], "stop_loss", current);
      else if (position.tpPrice && currentHigh >= position.tpPrice) closePosition(Math.max(position.tpPrice, currentOpen), current[0], "take_profit", current);
      else if (analysis.signal === "SELL") closePosition(currentOpen, current[0], "opposite_signal", current);
    } else if (position?.side === "short") {
      if (position.slPrice && currentHigh >= position.slPrice) closePosition(Math.max(position.slPrice, currentOpen), current[0], "stop_loss", current);
      else if (position.tpPrice && currentLow <= position.tpPrice) closePosition(Math.min(position.tpPrice, currentOpen), current[0], "take_profit", current);
      else if (analysis.signal === "BUY") closePosition(currentOpen, current[0], "opposite_signal", current);
    }

    const afterTradeStart = !options.tradeStartTime || Number(current[0]) >= options.tradeStartTime;
    if (!position && cash > 0 && afterTradeStart) {
      if (analysis.signal === "BUY") openPosition("long", currentOpen, current[0], analysis, current);
      else if (analysis.signal === "SELL") openPosition("short", currentOpen, current[0], analysis, current);
      else {
        const reason = categorizeNoEntryReason(options.strategy, analysis.reasoning || "");
        noEntryReasonCounts[reason] = (noEntryReasonCounts[reason] || 0) + 1;
      }
    }

    applyFunding(currentClose);
    equityCurve.push(markEquity(currentClose));
  }

  const last = ohlcv[ohlcv.length - 1];
  const lastPrice = Number(last?.[4] || 0);
  if (position && lastPrice > 0) closePosition(lastPrice, Number(last[0]), "end", last);
  equityCurve[equityCurve.length - 1] = cash;

  const totalReturn = ((cash - initialEquity) / initialEquity) * 100;
  let maxEquity = initialEquity;
  let maxDD = 0;
  for (const equity of equityCurve) {
    if (equity > maxEquity) maxEquity = equity;
    const dd = maxEquity > 0 ? (maxEquity - equity) / maxEquity : 0;
    if (dd > maxDD) maxDD = dd;
  }

  const equityReturns = equityCurve.slice(1).map((equity, idx) => {
    const prev = equityCurve[idx] || equity;
    return prev > 0 ? (equity - prev) / prev : 0;
  }).filter(value => Number.isFinite(value));
  const meanReturn = average(equityReturns);
  const returnStd = stdev(equityReturns);
  const grossProfit = tradePnls.filter(pnl => pnl > 0).reduce((acc, pnl) => acc + pnl, 0);
  const grossLoss = Math.abs(tradePnls.filter(pnl => pnl < 0).reduce((acc, pnl) => acc + pnl, 0));
  const lossTrades = closedTrades - winTrades;
  const avgWin = winTrades > 0 ? grossProfit / winTrades : 0;
  const avgLoss = lossTrades > 0 ? grossLoss / lossTrades : 0;
  const diagnostics = createBacktestDiagnostics({
    noEntryReasonCounts,
    exitReasonCounts,
    winPnls: tradePnls.filter(pnl => pnl > 0),
    lossPnls: tradePnls.filter(pnl => pnl < 0),
    totalFees,
    totalExecutionCost,
    validationTrades: closedTrades,
  });

  return {
    strategy: options.strategy,
    symbol: options.symbol,
    initialEquity,
    totalReturn,
    winRate: closedTrades > 0 ? (winTrades / closedTrades) * 100 : 0,
    maxDrawdown: maxDD * 100,
    trades: closedTrades,
    totalTrades: closedTrades,
    finalBalance: cash,
    equityCurve,
    regimePerformance,
    sharpe: returnStd > 0 ? (meanReturn / returnStd) * Math.sqrt(365) : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? grossProfit : 0),
    plRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
    expectancy: tradePnls.length ? average(tradePnls) : 0,
    avgTradePnl: tradePnls.length ? average(tradePnls) : 0,
    feeRatio: (grossProfit + grossLoss) > 0 ? (totalFees / (grossProfit + grossLoss)) * 100 : 0,
    totalFees,
    totalExecutionCost,
    totalFunding,
    diagnostics,
    riskPerTradePct,
    executionPenaltyModel: {
      enabled: true,
      includes: ["spread", "slippage", "maker_taker", "funding", "partial_fill", "latency", "gap_stop", "extreme_volatility"],
      symbolProfile: symbolExecutionProfile(options.symbol),
      fundingRatePer8h: options.fundingRatePer8h || 0,
    },
    tradeLog: trades.slice(-100),
    openPosition: null,
    timeConsistency: {
      signalData: "bar t-1 close and earlier",
      execution: "bar t open",
      highLow: "only used after execution for stop/take-profit simulation",
      orderbook: "not used in historical OHLCV backtest",
      fundingOi: "neutral unless time-aligned data is supplied",
      fred: "not applied to historical bars without vintage/real-time data",
    },
  };
}

export async function fetchBacktestOhlcv(symbol: string, timeframe: string, limit: number) {
  const provider = getMarketDataProvider();
  const displaySymbol = normalizeDisplaySymbol(symbol);
  const targetLimit = Math.min(10000, Math.max(60, Math.floor(Number(limit) || 60)));
  const pageLimit = Math.min(300, targetLimit);
  const cacheKey = `${provider.id}:backtest-ohlcv:${displaySymbol}:${timeframe}:${targetLimit}`;

  return cachedPublicMarket(cacheKey, 60000, async () => {
    const batches: any[][] = [];
    let since = calculateOhlcvStartSince({ timeframe, limit: targetLimit });
    const maxPages = Math.ceil(targetLimit / pageLimit) + 8;

    for (let page = 0; page < maxPages; page += 1) {
      const batch = await provider.ohlcvPage(displaySymbol, timeframe, since, pageLimit);
      if (!Array.isArray(batch) || batch.length === 0) break;

      batches.push(batch);
      const normalized = normalizeOhlcvHistory(batches, targetLimit);
      if (normalized.length >= targetLimit) return normalized;

      const nextSince = nextOhlcvSince(batch, since);
      if (!nextSince || nextSince > Date.now()) break;
      since = nextSince;
    }

    return normalizeOhlcvHistory(batches, targetLimit);
  });
}
