import crypto from "crypto";
import { runStrategyAnalysis as evaluateStrategy } from "../../src/lib/strategyEngine";
import { buildMarketRuntimeContext, calculateRiskManagedAmount, createDefaultMarketAnalysis, estimateShadowExecution, normalizeTicker, type OrderBook as RuntimeOrderBook, type Ticker as RuntimeTicker } from "../../src/lib/tradingRuntime";
import { AUTO_TRADING_BASE_DELAY_MS, AUTO_TRADING_MAX_DELAY_MS, AUTO_TRADING_MIN_DELAY_MS, getCorrelationGroup, getDefaultTimeframeForSymbol, pushAutoTradingLog, pushAutoTradingTrace, updatePersistentRiskState } from "../stores/app-store";
import { AutoTradingConfig, AutoTradingCycleSummary, AutoTradingDecisionStage, AutoTradingDecisionStep, AutoTradingDecisionTrace } from "../types";
import { addToAudit, auditStore } from "../stores/audit-store";
import { countActivePositions, fetchPrivateBalance, fetchPrivatePositions, getAccountTotalUSDT, toModeLabel } from "../exchange/okx-account";
import { currentMacroSnapshot, resolveEngineCredentials } from "./engine-helpers";
import { ensureFreshMacroData } from "../market/macro";
import { fetchPublicMarketBundle, fetchPublicMarketBundleWithAutoRetry } from "../market/public-data";
import { maintainOpenShadowOrders, recordStrategySignal } from "../persistence/trading-db";
import { requestError } from "../http-errors";
import { submitOkxOrder } from "../execution/okx-orders";
import { syncShadowPositionFromCandidate } from "./shadow-sync";

export function nextAutoTradingDelay(scanIntervalMultiplier = 1, floorMs = AUTO_TRADING_MIN_DELAY_MS) {
  return Math.max(floorMs, Math.min(AUTO_TRADING_MAX_DELAY_MS, AUTO_TRADING_BASE_DELAY_MS * Math.max(1, scanIntervalMultiplier)));
}

export async function runAutoTradingCycle(config: AutoTradingConfig, trigger: "scheduled" | "manual") {
  const startedAt = Date.now();
  const cycleId = `cycle_${startedAt}_${crypto.randomBytes(4).toString("hex")}`;
  const credentials = resolveEngineCredentials(config.sandbox);
  if (!credentials) {
    throw requestError(400, `Missing OKX credentials for ${config.sandbox ? "demo" : "live"} mode`, {
      error: `Missing OKX credentials for ${config.sandbox ? "demo" : "live"} mode`
    });
  }

  await ensureFreshMacroData();
  const { macroData, macroRiskScore, macroGate } = currentMacroSnapshot();
  const cycleDelayMs = nextAutoTradingDelay(macroGate.scanIntervalMultiplier);
  const summary: AutoTradingCycleSummary = {
    cycleId,
    trigger,
    startedAt,
    completedAt: startedAt,
    durationMs: 0,
    scannedSymbols: 0,
    scannedTargets: 0,
    strategiesEvaluated: 0,
    candidates: 0,
    selected: 0,
    ordersPlaced: 0,
    shadowOrders: 0,
    macroGate: macroGate.state,
    macroScore: macroRiskScore,
    error: null,
  };

  const buildStep = (
    name: AutoTradingDecisionStage,
    status: AutoTradingDecisionStep["status"],
    reason?: string,
    metrics?: Record<string, any>
  ): AutoTradingDecisionStep => ({
    name,
    status,
    reason,
    metrics,
    at: Date.now(),
  });

  type TraceDraft = Omit<AutoTradingDecisionTrace, "id" | "createdAt" | "blockedAt" | "blockedReason">;

  const createTraceDraft = (input: Partial<TraceDraft> & Pick<TraceDraft, "symbol" | "strategyId" | "steps">): TraceDraft => ({
    cycleId,
    trigger,
    symbol: input.symbol,
    timeframe: input.timeframe || getDefaultTimeframeForSymbol(config, input.symbol),
    strategyId: input.strategyId,
    signal: String(input.signal || "HOLD").toUpperCase(),
    confidence: Number(input.confidence || 0),
    requiredConfidence: Number(input.requiredConfidence || 0),
    shadowMode: input.shadowMode ?? config.shadowMode,
    macroGate: input.macroGate || macroGate.state,
    steps: input.steps,
  });

  const finalizeTrace = (
    trace: TraceDraft,
    blockedAt: AutoTradingDecisionStage | null,
    blockedReason: string | null
  ) => pushAutoTradingTrace({
    ...trace,
    blockedAt,
    blockedReason,
  });

  const normalizedRiskState = macroGate.state === "BLOCK_NEW_RISK"
    ? updatePersistentRiskState({
        macroGate,
        macroScore: macroRiskScore,
        newRiskBlocked: true,
        killSwitchActive: true,
        cooldownUntil: Date.now() + cycleDelayMs,
        reason: macroGate.reason,
      })
    : updatePersistentRiskState({
        macroGate,
        macroScore: macroRiskScore,
      });

  await maintainOpenShadowOrders(config);

  if (macroGate.state === "BLOCK_NEW_RISK") {
    const message = `Macro gate blocked new risk: ${macroGate.reason}`;
    pushAutoTradingLog(`Block: ${message}`);
    addToAudit(auditStore.riskEvents, {
      event: "macro_block",
      reason: macroGate.reason,
      macroGate,
      macroScore: macroRiskScore,
      killSwitchActive: true,
      cooldownUntil: normalizedRiskState.cooldownUntil
    });
    finalizeTrace(createTraceDraft({
      symbol: "*",
      strategyId: "*",
      signal: "HOLD",
      confidence: 0,
      requiredConfidence: 0,
      macroGate: macroGate.state,
      steps: [
        buildStep("macro_gate", "fail", message, {
          reason: macroGate.reason,
          score: macroRiskScore,
          cooldownUntil: normalizedRiskState.cooldownUntil,
        }),
      ],
    }), "macro_gate", message);
    summary.skippedReason = message;
    summary.completedAt = Date.now();
    summary.durationMs = summary.completedAt - startedAt;
    return { summary, nextDelayMs: cycleDelayMs };
  }

  if (normalizedRiskState.newRiskBlocked && Number(normalizedRiskState.cooldownUntil || 0) > Date.now()) {
    const message = normalizedRiskState.lastKillSwitchReason || "Persistent risk cooldown active";
    pushAutoTradingLog(`Cooldown: ${message}`);
    finalizeTrace(createTraceDraft({
      symbol: "*",
      strategyId: "*",
      signal: "HOLD",
      confidence: 0,
      requiredConfidence: 0,
      macroGate: normalizedRiskState.macroGate,
      steps: [
        buildStep("persistent_risk", "fail", message, {
          cooldownUntil: normalizedRiskState.cooldownUntil,
          dailyPnL: normalizedRiskState.dailyPnL,
          consecutiveStopLosses: normalizedRiskState.consecutiveStopLosses,
        }),
      ],
    }), "persistent_risk", message);
    summary.skippedReason = message;
    summary.completedAt = Date.now();
    summary.durationMs = summary.completedAt - startedAt;
    return { summary, nextDelayMs: cycleDelayMs };
  }

  const [balance, positions] = await Promise.all([
    fetchPrivateBalance(credentials, config.sandbox, true),
    fetchPrivatePositions(credentials, config.sandbox, true),
  ]);
  const balanceTotal = getAccountTotalUSDT(balance);
  const activePositionCount = countActivePositions(positions);
  const maxConcurrentPositions = macroGate.state === "ALLOW_REDUCED" ? 1 : 2;
  const remainingSlots = Math.max(0, maxConcurrentPositions - activePositionCount);
  if (remainingSlots <= 0) {
    const message = `Portfolio limit reached: ${activePositionCount} active positions, max ${maxConcurrentPositions}`;
    pushAutoTradingLog(`Blocked: ${message}`);
    finalizeTrace(createTraceDraft({
      symbol: "*",
      strategyId: "*",
      signal: "HOLD",
      confidence: 0,
      requiredConfidence: 0,
      steps: [
        buildStep("portfolio_limit", "fail", message, {
          activePositionCount,
          maxConcurrentPositions,
        }),
      ],
    }), "portfolio_limit", message);
    summary.skippedReason = message;
    summary.completedAt = Date.now();
    summary.durationMs = summary.completedAt - startedAt;
    return { summary, nextDelayMs: cycleDelayMs };
  }

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

  const candidates: Array<{
    symbol: string;
    timeframe: string;
    strategyId: string;
    ticker: RuntimeTicker;
    orderBook: RuntimeOrderBook | null;
    analysis: any;
    requiredConfidence: number;
    sizeMultiplier: number;
    trace: TraceDraft;
  }> = [];

  pushAutoTradingLog(`寮€濮嬫壂鎻?(${trigger === "manual" ? "鎵嬪姩" : "瀹氭椂"}, ${macroGate.state})`);

  const scannedSymbolSet = new Set<string>();
  for (const profile of config.scanProfiles) {
    for (const timeframe of profile.timeframes) {
      const scanSymbol = profile.symbol;
      let marketBundle: Awaited<ReturnType<typeof fetchPublicMarketBundle>> | null = null;
      try {
        marketBundle = await fetchPublicMarketBundleWithAutoRetry(scanSymbol, timeframe, 120);
      } catch (error: any) {
        const message = error?.message || String(error);
        pushAutoTradingLog(`Market data failed for ${scanSymbol} ${timeframe}: ${message}`);
        finalizeTrace(createTraceDraft({
          symbol: scanSymbol,
          timeframe,
          strategyId: "*",
          signal: "UNKNOWN",
          confidence: 0,
          requiredConfidence: 0,
          steps: [
            buildStep("market_data", "fail", message, { timeframe }),
          ],
        }), "market_data", message);
        continue;
      }

      const scanTicker = normalizeTicker(scanSymbol, marketBundle.ticker);
      if (!scanTicker) {
        const message = `Ticker unavailable for ${scanSymbol} ${timeframe}`;
        pushAutoTradingLog(message);
        finalizeTrace(createTraceDraft({
          symbol: scanSymbol,
          timeframe,
          strategyId: "*",
          signal: "UNKNOWN",
          confidence: 0,
          requiredConfidence: 0,
          steps: [
            buildStep("market_data", "fail", message, { timeframe }),
          ],
        }), "market_data", message);
        continue;
      }

      summary.scannedTargets += 1;
      scannedSymbolSet.add(scanSymbol);
      const runtimeContext = buildMarketRuntimeContext(
        scanSymbol,
        scanTicker,
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
        summary.strategiesEvaluated += 1;
        const analysis = evaluateStrategy({
          symbol: scanSymbol,
          ticker: scanTicker,
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

        recordStrategySignal({
          strategyId,
          symbol: scanSymbol,
          signal: analysis.signal,
          confidence: analysis.confidence,
          reasoning: analysis.reasoning,
          price: scanTicker.last,
          tpPrice: analysis.tp_price,
          slPrice: analysis.sl_price,
          regime: analysis.regime,
          regimeScore: analysis.regimeScore,
          macroGate: analysis.macroGate || macroGate,
          macroScore: analysis.macroGate?.score ?? macroRiskScore,
          mode: toModeLabel(config.sandbox),
          source: trigger === "manual" ? "manual-auto-scan" : "engine-auto-scan",
          raw: {
            ...analysis,
            timeframe,
          },
        });

        const requiredConfidence = config.riskConfigSnapshot.autoTradeThreshold + (analysis?.macroGate?.entryThresholdAdjustment || 0);
        const trace = createTraceDraft({
          symbol: scanSymbol,
          timeframe,
          strategyId,
          signal: analysis.signal,
          confidence: Number(analysis.confidence || 0),
          requiredConfidence,
          macroGate: analysis?.macroGate?.state || macroGate.state,
          steps: [
            buildStep("market_data", "pass", "Market data ready", {
              last: scanTicker.last,
              fundingRate: runtimeContext.fundingRate?.fundingRate ?? 0,
              hasOrderBook: Boolean(marketBundle.orderBook),
              timeframe,
            }),
          ],
        });

        if (analysis.signal !== "BUY" && analysis.signal !== "SELL") {
          const reason = `Signal rejected: ${analysis.signal}`;
          trace.steps.push(buildStep("strategy_signal", "fail", reason, {
            signal: analysis.signal,
            confidence: analysis.confidence,
            timeframe,
          }));
          finalizeTrace(trace, "strategy_signal", reason);
          continue;
        }

        trace.steps.push(buildStep("strategy_signal", "pass", `Actionable signal: ${analysis.signal}`, {
          signal: analysis.signal,
          confidence: analysis.confidence,
          timeframe,
        }));

        if (analysis.confidence < requiredConfidence) {
          const reason = `Confidence ${analysis.confidence} < ${requiredConfidence}`;
          trace.steps.push(buildStep("confidence_gate", "fail", reason, {
            confidence: analysis.confidence,
            requiredConfidence,
            threshold: config.riskConfigSnapshot.autoTradeThreshold,
            entryThresholdAdjustment: analysis?.macroGate?.entryThresholdAdjustment || 0,
            timeframe,
          }));
          finalizeTrace(trace, "confidence_gate", reason);
          continue;
        }

        trace.steps.push(buildStep("confidence_gate", "pass", "Confidence gate passed", {
          confidence: analysis.confidence,
          requiredConfidence,
          timeframe,
        }));
        trace.steps.push(buildStep("macro_gate", "pass", `Macro gate ${analysis?.macroGate?.state || macroGate.state}`, {
          state: analysis?.macroGate?.state || macroGate.state,
          score: analysis?.macroGate?.score ?? macroRiskScore,
          positionSizeMultiplier: analysis?.macroGate?.positionSizeMultiplier ?? macroGate.positionSizeMultiplier,
          timeframe,
        }));

        const sizeMultiplier = analysis.macroGate?.positionSizeMultiplier ?? macroGate.positionSizeMultiplier;
        candidates.push({
          symbol: scanSymbol,
          timeframe,
          strategyId,
          ticker: scanTicker,
          orderBook: marketBundle.orderBook,
          analysis,
          requiredConfidence,
          sizeMultiplier,
          trace,
        });
        pushAutoTradingLog(`Candidate ${strategyId} ${scanSymbol} ${timeframe} ${analysis.signal} (${analysis.confidence}% / ${requiredConfidence}%)`);
      }
    }
  }
  summary.scannedSymbols = scannedSymbolSet.size;

  summary.candidates = candidates.length;
  if (candidates.length === 0) {
    pushAutoTradingLog("本轮没有候选信号通过筛选");
    summary.completedAt = Date.now();
    summary.durationMs = summary.completedAt - startedAt;
    return { summary, nextDelayMs: cycleDelayMs };
  }

  const selected: typeof candidates = [];
  const candidatesBySymbol = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    if (!candidatesBySymbol.has(candidate.symbol)) candidatesBySymbol.set(candidate.symbol, []);
    candidatesBySymbol.get(candidate.symbol)!.push(candidate);
  }

  const symbolWinners: typeof candidates = [];
  for (const [symbol, symbolCandidates] of candidatesBySymbol.entries()) {
    const directionSet = new Set(symbolCandidates.map((item) => String(item.analysis.signal || "").toUpperCase()));
    if (directionSet.has("BUY") && directionSet.has("SELL")) {
      const conflictDetail = symbolCandidates
        .map((item) => `${item.timeframe}=${String(item.analysis.signal || "").toUpperCase()}`)
        .join(", ");
      const reason = `${symbol} timeframe conflict: ${conflictDetail}`;
      pushAutoTradingLog(reason);
      for (const candidate of symbolCandidates) {
        candidate.trace.steps.push(buildStep("timeframe_conflict", "fail", reason, {
          symbol,
          timeframe: candidate.timeframe,
          signal: candidate.analysis.signal,
          conflictDetail,
        }));
        finalizeTrace(candidate.trace, "timeframe_conflict", reason);
      }
      continue;
    }

    const rankedBySymbol = [...symbolCandidates].sort((a, b) => {
      const scoreA = a.analysis.confidence + Math.abs(a.analysis.regimeScore || 0) * 10;
      const scoreB = b.analysis.confidence + Math.abs(b.analysis.regimeScore || 0) * 10;
      return scoreB - scoreA;
    });
    const winner = rankedBySymbol[0];
    symbolWinners.push(winner);
    for (const skippedCandidate of rankedBySymbol.slice(1)) {
      const reason = `Higher-ranked timeframe selected for ${symbol}`;
      skippedCandidate.trace.steps.push(buildStep("correlation_filter", "fail", reason, {
        selectedTimeframe: winner.timeframe,
        selectedStrategyId: winner.strategyId,
        selectedConfidence: winner.analysis.confidence,
      }));
      finalizeTrace(skippedCandidate.trace, "correlation_filter", reason);
    }
  }

  const sortedCandidates = [...symbolWinners].sort((a, b) => {
    const scoreA = a.analysis.confidence + Math.abs(a.analysis.regimeScore || 0) * 10;
    const scoreB = b.analysis.confidence + Math.abs(b.analysis.regimeScore || 0) * 10;
    return scoreB - scoreA;
  });

  for (const candidate of sortedCandidates) {
    if (selected.length >= remainingSlots) {
      const reason = `No remaining portfolio slots (${remainingSlots})`;
      candidate.trace.steps.push(buildStep("portfolio_limit", "fail", reason, {
        remainingSlots,
        activePositionCount,
      }));
      finalizeTrace(candidate.trace, "portfolio_limit", reason);
      continue;
    }

    const sameDirectionCorrelated = selected.some(item =>
      getCorrelationGroup(item.symbol) === getCorrelationGroup(candidate.symbol)
      && item.analysis.signal === candidate.analysis.signal
    );
    if (sameDirectionCorrelated) {
      const previousMultiplier = candidate.sizeMultiplier;
      candidate.sizeMultiplier *= 0.5;
      candidate.trace.steps.push(buildStep("correlation_filter", "pass", "Size reduced due to same-direction correlated exposure", {
        previousMultiplier,
        adjustedMultiplier: candidate.sizeMultiplier,
      }));
      pushAutoTradingLog(`Correlation adjustment applied to ${candidate.symbol}`);
    } else {
      candidate.trace.steps.push(buildStep("correlation_filter", "pass", "Passed correlation filter"));
    }

    candidate.trace.steps.push(buildStep("portfolio_limit", "pass", "Portfolio slot reserved", {
      remainingSlots,
      selectedCount: selected.length + 1,
    }));
    selected.push(candidate);
  }

  summary.selected = selected.length;
  if (selected.length === 0) {
    pushAutoTradingLog("所有候选信号都在执行前被过滤");
    summary.completedAt = Date.now();
    summary.durationMs = summary.completedAt - startedAt;
    return { summary, nextDelayMs: cycleDelayMs };
  }

  for (const candidate of selected) {
    const side = candidate.analysis.signal.toLowerCase() as "buy" | "sell";
    if (balanceTotal <= 0) {
      const reason = "Account balance unavailable for auto-trading";
      candidate.trace.steps.push(buildStep("account_risk_check", "fail", reason, {
        balanceTotal,
      }));
      finalizeTrace(candidate.trace, "account_risk_check", reason);
      pushAutoTradingLog(reason);
      break;
    }

    candidate.trace.steps.push(buildStep("account_risk_check", "pass", "Balance available", {
      balanceTotal,
      side,
    }));

    const sizing = calculateRiskManagedAmount({
      balanceTotal,
      currentPrice: candidate.ticker.last || 0,
      stopLossPrice: candidate.analysis.sl_price,
      riskConfig: config.riskConfigSnapshot,
      sizeMultiplier: candidate.sizeMultiplier,
    });
    const amount = Number((sizing.amount || 0).toFixed(2));
    if (!Number.isFinite(amount) || amount <= 0) {
      const reason = `Position sizing returned ${amount}`;
      candidate.trace.steps.push(buildStep("position_sizing", "fail", reason, {
        amount,
        stopDistancePct: sizing.stopDistancePct,
        sizeMultiplier: candidate.sizeMultiplier,
      }));
      finalizeTrace(candidate.trace, "position_sizing", reason);
      pushAutoTradingLog(`Position sizing blocked ${candidate.symbol}`);
      continue;
    }

    candidate.trace.steps.push(buildStep("position_sizing", "pass", "Position size computed", {
      amount,
      stopDistancePct: sizing.stopDistancePct,
      sizeMultiplier: candidate.sizeMultiplier,
    }));

    if (config.shadowMode) {
      const shadowExecution = estimateShadowExecution(side, candidate.ticker, candidate.orderBook, 0);
      const shadowResult = syncShadowPositionFromCandidate({
        symbol: candidate.symbol,
        strategyId: candidate.strategyId,
        side,
        timeframe: candidate.timeframe,
        leverage: config.riskConfigSnapshot.leverage,
        amount,
        amountType: "usdt",
        regime: candidate.analysis.regime,
        macroGate: candidate.analysis.macroGate || macroGate,
        orderBook: candidate.orderBook,
        signal: candidate.analysis,
        shadowExecution,
        ticker: candidate.ticker,
      });
      if (shadowResult.action === "opened" || shadowResult.action === "reversed") {
        summary.shadowOrders += 1;
      }
      const reason = shadowResult.action === "refreshed"
        ? "Shadow mode enabled; existing shadow position refreshed"
        : "Shadow mode enabled; live order skipped";
      candidate.trace.steps.push(buildStep("shadow_mode", "fail", reason, {
        theoreticalPrice: shadowExecution.theoreticalPrice,
        executablePrice: shadowExecution.executablePrice,
        spreadBps: shadowExecution.spreadBps,
        slippageBps: shadowExecution.slippageBps,
        shadowAction: shadowResult.action,
        realizedPnl: shadowResult.closed?.realized_pnl ?? null,
      }));
      finalizeTrace(candidate.trace, "shadow_mode", reason);
      if (shadowResult.action === "opened") {
        pushAutoTradingLog(`褰卞瓙鎸佷粨宸插紑浠?${candidate.symbol} ${side.toUpperCase()} ${candidate.strategyId}`);
      } else if (shadowResult.action === "reversed") {
        pushAutoTradingLog(`褰卞瓙鎸佷粨宸插弽鎵?${candidate.symbol} ${candidate.strategyId}锛屼笂绗旂泩浜?${Number(shadowResult.closed?.realized_pnl || 0).toFixed(2)} USDT`);
      } else {
        pushAutoTradingLog(`褰卞瓙鎸佷粨宸插埛鏂?${candidate.symbol} ${candidate.strategyId}`);
      }
      continue;
    }

    candidate.trace.steps.push(buildStep("shadow_mode", "skip", "Live execution enabled"));

    try {
      const result = await submitOkxOrder({
        symbol: candidate.symbol,
        side,
        amount,
        amountType: "usdt",
        type: "market",
        leverage: config.riskConfigSnapshot.leverage,
        tpPrice: candidate.analysis.tp_price,
        slPrice: candidate.analysis.sl_price,
        sandbox: config.sandbox,
        strategyId: candidate.strategyId,
        source: "auto",
        regime: candidate.analysis.regime,
        regimeScore: candidate.analysis.regimeScore,
        macroGate: candidate.analysis.macroGate || macroGate,
        macroScore: candidate.analysis.macroGate?.score ?? macroRiskScore,
        entryReason: candidate.analysis.reasoning,
        features: {
          timeframe: candidate.timeframe,
          requiredConfidence: candidate.requiredConfidence,
          positionSizeMultiplier: candidate.sizeMultiplier,
          macroGate: candidate.analysis.macroGate || macroGate,
          regime: candidate.analysis.regime,
          regimeScore: candidate.analysis.regimeScore,
          confidence: candidate.analysis.confidence,
        },
        stopDistance: sizing.stopDistancePct,
        ruleCompliant: true,
        aiVerdict: "none",
      }, "auto-engine");
      summary.ordersPlaced += 1;
      const orderId = result?.id || result?.clientOrderId || "submitted";
      candidate.trace.steps.push(buildStep("order_submit", "pass", "Live order submitted", {
        orderId,
      }));
      finalizeTrace(candidate.trace, null, null);
      pushAutoTradingLog(`Live order submitted ${candidate.symbol} ${side.toUpperCase()} (${orderId})`);
    } catch (error: any) {
      const message = error?.message || String(error);
      candidate.trace.steps.push(buildStep("order_submit", "fail", message));
      finalizeTrace(candidate.trace, "order_submit", message);
      pushAutoTradingLog(`Live order failed ${candidate.symbol}: ${message}`);
    }
  }

  summary.completedAt = Date.now();
  summary.durationMs = summary.completedAt - startedAt;
  return { summary, nextDelayMs: cycleDelayMs };
}
