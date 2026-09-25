import { evaluateMacroGate, runStrategyAnalysis as evaluateStrategy } from "../../src/lib/strategyEngine";
import { buildMarketRuntimeContext, createDefaultMarketAnalysis, deriveMacroRiskScoreFromIndicators, normalizeDisplaySymbol, normalizeTicker, type Ticker as RuntimeTicker } from "../../src/lib/tradingRuntime";
import { AutoTradingConfig } from "../types";
import { TP_MANAGER_MIN_PRICE_PCT, TP_MANAGER_MIN_R_MULTIPLIER } from "../stores/app-store";
import { cachedMacroData } from "../market/macro";
import { fetchPublicMarketBundle, fetchPublicMarketBundleWithAutoRetry } from "../market/public-data";
import { resolveOkxCredentials } from "../auth/credentials";

export function resolveEngineCredentials(sandbox: boolean) {
  return resolveOkxCredentials({}, sandbox);
}

export function currentMacroSnapshot() {
  const macroData = cachedMacroData || {
    dxy: 0,
    m2: 0,
    m2Change3mPct: 0,
    dxyChange30dPct: 0,
    btcCorrelation: 0,
    dxySource: "unavailable" as const,
    macroRiskScore: 0,
  };
  const macroRiskScore = deriveMacroRiskScoreFromIndicators({
    macroRiskScore: (macroData as any).macroRiskScore,
    globalLiquidity: (macroData as any).m2 ? ((macroData as any).m2 / 20000) * 100 : undefined,
    dxyCorrelation: (macroData as any).btcCorrelation
  });
  const macroGate = (macroData as any).macroGate || evaluateMacroGate({ macroRiskScore });
  return {
    macroData,
    macroRiskScore,
    macroGate,
  };
}

export function normalizeManagedOrderSide(side: string | undefined | null): "buy" | "sell" | null {
  const normalized = String(side || "").trim().toLowerCase();
  if (normalized === "buy" || normalized === "long") return "buy";
  if (normalized === "sell" || normalized === "short") return "sell";
  return null;
}

export function extractAttachedTpIdentifiers(orderLike: any) {
  const info = orderLike?.info || orderLike?.verifiedOrder?.info || orderLike?.order?.info || {};
  const attached = Array.isArray(info?.attachAlgoOrds)
    ? info.attachAlgoOrds.find((item: any) => item?.attachAlgoId || item?.attachAlgoClOrdId || item?.tpTriggerPx || item?.newTpTriggerPx)
    : null;
  const linkedAlgo = info?.linkedAlgoOrd || {};
  const attachAlgoId = String(
    attached?.attachAlgoId
    || attached?.algoId
    || orderLike?.attachAlgoId
    || info?.attachAlgoId
    || linkedAlgo?.algoId
    || ""
  ).trim() || null;
  const attachAlgoClOrdId = String(
    attached?.attachAlgoClOrdId
    || attached?.algoClOrdId
    || orderLike?.attachAlgoClOrdId
    || info?.attachAlgoClOrdId
    || ""
  ).trim() || null;
  return {
    attachedTpAlgoId: attachAlgoId,
    attachedTpAlgoClOrdId: attachAlgoClOrdId,
  };
}

export function buildBaseMarketAnalysisFromMacro(snapshot = currentMacroSnapshot()) {
  const { macroData, macroRiskScore, macroGate } = snapshot;
  const baseMarketAnalysis = createDefaultMarketAnalysis();
  baseMarketAnalysis.macroIndicators = {
    dxyCorrelation: (macroData as any).btcCorrelation ?? baseMarketAnalysis.macroIndicators.dxyCorrelation,
    usdtPremium: baseMarketAnalysis.macroIndicators.usdtPremium,
    globalLiquidity: (macroData as any).m2 ? ((macroData as any).m2 / 20000) * 100 : baseMarketAnalysis.macroIndicators.globalLiquidity,
    macroRiskScore,
    macroGate,
  };
  if ((macroData as any).dxy !== undefined) baseMarketAnalysis.onChainData.dxy = (macroData as any).dxy;
  if ((macroData as any).m2 !== undefined) baseMarketAnalysis.onChainData.m2 = (macroData as any).m2;
  return {
    baseMarketAnalysis,
    macroData,
    macroRiskScore,
    macroGate,
  };
}

export type TakeProfitConsensusCandidate = {
  symbol: string;
  timeframe: string;
  strategyId: string;
  side: "buy" | "sell";
  analysis: any;
  requiredConfidence: number;
  score: number;
  ticker: RuntimeTicker;
};

export type TakeProfitConsensusResult =
  | { status: "actionable"; candidate: TakeProfitConsensusCandidate }
  | { status: "no_signal"; reason: string }
  | { status: "timeframe_conflict"; reason: string }
  | { status: "error"; reason: string };

export async function evaluateTakeProfitConsensus(
  config: AutoTradingConfig,
  symbol: string,
  snapshot = currentMacroSnapshot()
): Promise<TakeProfitConsensusResult> {
  const normalizedSymbol = normalizeDisplaySymbol(symbol);
  const profile = config.scanProfiles.find((item) => item.symbol === normalizedSymbol);
  if (!profile) {
    return { status: "no_signal", reason: `${normalizedSymbol} is not in active scan profiles` };
  }

  const { baseMarketAnalysis, macroRiskScore, macroGate } = buildBaseMarketAnalysisFromMacro(snapshot);
  const candidates: TakeProfitConsensusCandidate[] = [];
  let lastRejectedReason = `No actionable signal for ${normalizedSymbol}`;
  let marketFailureReason: string | null = null;

  for (const timeframe of profile.timeframes) {
    let marketBundle: Awaited<ReturnType<typeof fetchPublicMarketBundle>> | null = null;
    try {
      marketBundle = await fetchPublicMarketBundleWithAutoRetry(normalizedSymbol, timeframe, 120);
    } catch (error: any) {
      marketFailureReason = error?.message || String(error || "Failed to fetch market data");
      continue;
    }

    const ticker = normalizeTicker(normalizedSymbol, marketBundle.ticker);
    if (!ticker) {
      marketFailureReason = `Ticker unavailable for ${normalizedSymbol} ${timeframe}`;
      continue;
    }

    const runtimeContext = buildMarketRuntimeContext(
      normalizedSymbol,
      ticker,
      marketBundle.funding,
      marketBundle.orderBook,
      Array.isArray(marketBundle.ohlcv) ? marketBundle.ohlcv : [],
      {
        ...baseMarketAnalysis,
        correlations: baseMarketAnalysis.correlations.map(item => ({ ...item })),
        trends: baseMarketAnalysis.trends.map(item => ({ ...item })),
      },
      timeframe
    );

    for (const strategyId of config.strategyIds) {
      const analysis = evaluateStrategy({
        symbol: normalizedSymbol,
        ticker,
        strategyId,
        prices: runtimeContext.prices,
        indicators: runtimeContext.marketAnalysis.realIndicators,
        market: {
          sentiment: runtimeContext.marketAnalysis.sentiment,
          volatility: runtimeContext.marketAnalysis.volatility,
          fundingRate: runtimeContext.fundingRate?.fundingRate ?? 0,
          macroRiskScore,
          macroGate,
          onChainData: runtimeContext.marketAnalysis.onChainData,
        },
        risk: {
          estimatedFeeRate: config.riskConfigSnapshot.estimatedFeeRate,
          stopLoss: config.riskConfigSnapshot.stopLoss,
          takeProfit: config.riskConfigSnapshot.takeProfit,
        },
        allowSyntheticData: false,
      });

      const normalizedSide = normalizeManagedOrderSide(analysis.signal);
      if (!normalizedSide) {
        lastRejectedReason = `Signal rejected: ${analysis.signal}`;
        continue;
      }

      const requiredConfidence = config.riskConfigSnapshot.autoTradeThreshold + (analysis?.macroGate?.entryThresholdAdjustment || 0);
      if (Number(analysis.confidence || 0) < requiredConfidence) {
        lastRejectedReason = `Confidence ${analysis.confidence} < ${requiredConfidence}`;
        continue;
      }

      candidates.push({
        symbol: normalizedSymbol,
        timeframe,
        strategyId,
        side: normalizedSide,
        analysis,
        requiredConfidence,
        score: Number(analysis.confidence || 0) + Math.abs(Number(analysis.regimeScore || 0)) * 10,
        ticker,
      });
    }
  }

  if (!candidates.length) {
    if (marketFailureReason) return { status: "error", reason: marketFailureReason };
    return { status: "no_signal", reason: lastRejectedReason };
  }

  const directions = new Set(candidates.map((item) => item.side));
  if (directions.size > 1) {
    const conflictDetail = candidates
      .map((item) => `${item.timeframe}=${item.side.toUpperCase()}`)
      .join(", ");
    return {
      status: "timeframe_conflict",
      reason: `${normalizedSymbol} timeframe conflict: ${conflictDetail}`,
    };
  }

  const winner = [...candidates].sort((left, right) => right.score - left.score)[0];
  return { status: "actionable", candidate: winner };
}

export function computeTakeProfitMinDelta(currentPrice: number, entryPrice: number, slPrice: number) {
  const currentPriceDelta = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice * TP_MANAGER_MIN_PRICE_PCT : 0;
  const riskDistance = Number.isFinite(entryPrice) && Number.isFinite(slPrice) && entryPrice > 0 && slPrice > 0
    ? Math.abs(entryPrice - slPrice) * TP_MANAGER_MIN_R_MULTIPLIER
    : 0;
  return Math.max(currentPriceDelta, riskDistance);
}
