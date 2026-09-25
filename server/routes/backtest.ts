import express from "express";
import { buildStrictFactorAudit, buildValidationSlice, createWalkForwardWindows, groupWalkForwardRounds, normalizeBacktestSymbols, normalizeInitialEquity, normalizePositiveNumber, normalizeStrategyIds, summarizeWalkForwardRounds } from "../../src/lib/walkForwardBacktest";
import { classifyValidationStatus, normalizeMinTrainTrades, normalizeRiskPerTradePct } from "../../src/lib/backtestValidation";
import { calculateRobustSelectionScore, fetchBacktestOhlcv, median, runBacktestOnOhlcv, timeframeBarsPerDay } from "../backtest/engine";
import { toCcxtSymbol } from "../exchange/okx";

export function registerBacktestRoutes(app: express.Express) {
  app.post("/api/backtest", async (req, res) => {
    const {
      symbol,
      timeframe = "1h",
      period = 500,
      strategy = "trend-breakout",
      stopLoss = 2,
      takeProfit = 6,
      estimatedFeeRate = 0.05,
      initialEquity = 10000,
      riskPerTradePct = 0.5,
    } = req.body;
    try {
      const symbolParam = symbol || "BTC-USDT";
      const ccxtSymbol = toCcxtSymbol(symbolParam);
      const limit = Math.min(1000, Math.max(60, Number(period || 500)));
      const ohlcv = await fetchBacktestOhlcv(symbolParam, timeframe, limit);
      if (!Array.isArray(ohlcv) || ohlcv.length < 60) {
        return res.status(400).json({ error: "Not enough OHLCV data for backtest" });
      }
      res.json(runBacktestOnOhlcv(ohlcv, {
        symbol: ccxtSymbol,
        strategy,
        stopLoss: Number(stopLoss),
        takeProfit: Number(takeProfit),
        estimatedFeeRate: Number(estimatedFeeRate),
        timeframe,
        fundingRatePer8h: Number(req.body?.fundingRatePer8h || 0),
        initialEquity: normalizeInitialEquity(initialEquity),
        riskPerTradePct: normalizeRiskPerTradePct(riskPerTradePct),
        trendRegimeThreshold: 0.25,
        enableHigherTimeframeTrendFilter: true,
      }));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/backtest/walk-forward", async (req, res) => {
    const {
      symbol,
      symbols,
      timeframe = "1h",
      strategy = "trend-breakout",
      strategyIds,
      trainDays = 180,
      validationDays = 30,
      stepDays = 30,
      period = 6000,
      estimatedFeeRate = 0.05,
      stopLoss = 2,
      takeProfit = 6,
      initialEquity = 10000,
      minTrainTrades = 5,
      riskPerTradePct = 0.5,
    } = req.body || {};

    try {
      const targetSymbols = normalizeBacktestSymbols(symbols || symbol, "BTC-USDT", 3);
      const targetStrategies = normalizeStrategyIds(strategyIds || strategy);
      const normalizedInitialEquity = normalizeInitialEquity(initialEquity);
      const normalizedTrainDays = normalizePositiveNumber(trainDays, 180, 1, 3650);
      const normalizedValidationDays = normalizePositiveNumber(validationDays, 30, 1, 3650);
      const normalizedStepDays = normalizePositiveNumber(stepDays, 30, 1, 3650);
      const normalizedFeeRate = normalizePositiveNumber(estimatedFeeRate, 0.05, 0, 5);
      const baseStopLoss = normalizePositiveNumber(stopLoss, 2, 0.1, 80);
      const baseTakeProfit = normalizePositiveNumber(takeProfit, 6, 0.1, 200);
      const normalizedMinTrainTrades = normalizeMinTrainTrades(minTrainTrades);
      const normalizedRiskPerTradePct = normalizeRiskPerTradePct(riskPerTradePct);
      const fundingRatePer8h = Number(req.body?.fundingRatePer8h || 0);
      const barsPerDay = timeframeBarsPerDay(timeframe);
      const requestedTrainBars = Math.max(60, Math.round(normalizedTrainDays * barsPerDay));
      const requestedValidationBars = Math.max(30, Math.round(normalizedValidationDays * barsPerDay));
      const requestedPeriod = normalizePositiveNumber(period, 6000, 120, 10000);
      const fetchLimit = Math.min(10000, Math.max(requestedPeriod, requestedTrainBars + requestedValidationBars + 80));
      const parameterGrid = [
        { stopLoss: Number((baseStopLoss * 0.75).toFixed(4)), takeProfit: Number((baseTakeProfit * 0.67).toFixed(4)) },
        { stopLoss: baseStopLoss, takeProfit: baseTakeProfit },
        { stopLoss: Number((baseStopLoss * 1.25).toFixed(4)), takeProfit: Number((baseTakeProfit * 1.33).toFixed(4)) },
      ];
      const factorAudit = buildStrictFactorAudit();

      const allRounds: any[] = [];
      const bySymbol: Record<string, any> = {};

      for (const targetSymbol of targetSymbols) {
        const ccxtSymbol = toCcxtSymbol(targetSymbol);
        const ohlcv = await fetchBacktestOhlcv(targetSymbol, timeframe, fetchLimit);
        if (!Array.isArray(ohlcv) || ohlcv.length < 120) {
          bySymbol[ccxtSymbol] = {
            error: "Not enough OHLCV data for walk-forward",
            availableBars: Array.isArray(ohlcv) ? ohlcv.length : 0,
            requiredBars: requestedTrainBars + requestedValidationBars,
          };
          continue;
        }

        const windowPlan = createWalkForwardWindows(ohlcv, {
          timeframe,
          trainDays: normalizedTrainDays,
          validationDays: normalizedValidationDays,
          stepDays: normalizedStepDays,
          warmupBars: 80,
        });

        if (!windowPlan.windows.length) {
          bySymbol[ccxtSymbol] = {
            error: "Not enough OHLCV data for requested train/validation windows",
            availableBars: ohlcv.length,
            requiredBars: windowPlan.trainBars + windowPlan.validationBars,
            trainBars: windowPlan.trainBars,
            validationBars: windowPlan.validationBars,
          };
          continue;
        }

        bySymbol[ccxtSymbol] = {
          availableBars: ohlcv.length,
          trainBars: windowPlan.trainBars,
          validationBars: windowPlan.validationBars,
          stepBars: windowPlan.stepBars,
          byStrategy: {},
        };

        for (const strategyId of targetStrategies) {
          const rounds: any[] = [];
          for (const window of windowPlan.windows) {
            const trainSlice = ohlcv.slice(window.trainStart, window.trainEnd + 1);
            const { validationWarmup, tradeStartTime } = buildValidationSlice(ohlcv, window);

            const trainResults = parameterGrid.map(params => ({
              params,
              result: runBacktestOnOhlcv(trainSlice, {
                symbol: ccxtSymbol,
                strategy: strategyId,
                stopLoss: params.stopLoss,
                takeProfit: params.takeProfit,
                estimatedFeeRate: normalizedFeeRate,
                timeframe,
                fundingRatePer8h,
                initialEquity: normalizedInitialEquity,
                riskPerTradePct: normalizedRiskPerTradePct,
                trendRegimeThreshold: 0.25,
                enableHigherTimeframeTrendFilter: true,
              }),
            }));
            const trainResultsWithStability = trainResults.map(item => {
              const perturbations = [0.9, 1.1].flatMap(multiplier => [
                { stopLoss: item.params.stopLoss * multiplier, takeProfit: item.params.takeProfit },
                { stopLoss: item.params.stopLoss, takeProfit: item.params.takeProfit * multiplier },
              ]).map(params => runBacktestOnOhlcv(trainSlice, {
                symbol: ccxtSymbol,
                strategy: strategyId,
                stopLoss: params.stopLoss,
                takeProfit: params.takeProfit,
                estimatedFeeRate: normalizedFeeRate,
                timeframe,
                fundingRatePer8h,
                initialEquity: normalizedInitialEquity,
                riskPerTradePct: normalizedRiskPerTradePct,
                trendRegimeThreshold: 0.25,
                enableHigherTimeframeTrendFilter: true,
              }));
              const score = calculateRobustSelectionScore(item.result, perturbations);
              const worstPerturbReturn = Math.min(...perturbations.map(result => result.totalReturn));
              const trainTrades = Number(item.result.totalTrades || item.result.trades || 0);
              const insufficientTrades = trainTrades < normalizedMinTrainTrades;
              const failsRiskFloor = item.result.maxDrawdown > 25 || worstPerturbReturn < -8;
              return {
                ...item,
                trainPerturbations: perturbations,
                selectionScore: score,
                trainTrades,
                insufficientTrades,
                failsRiskFloor,
                selectedParamsRejectedReason: insufficientTrades
                  ? `train trades ${trainTrades} < min ${normalizedMinTrainTrades}`
                  : failsRiskFloor
                    ? "training risk floor failed"
                    : "",
                failsHardFloor: insufficientTrades || failsRiskFloor,
              };
            });
            const selected = trainResultsWithStability.sort((a, b) => {
              if (a.failsHardFloor !== b.failsHardFloor) return a.failsHardFloor ? 1 : -1;
              return b.selectionScore - a.selectionScore;
            })[0];

            const validation = runBacktestOnOhlcv(validationWarmup, {
              symbol: ccxtSymbol,
              strategy: strategyId,
              stopLoss: selected.params.stopLoss,
              takeProfit: selected.params.takeProfit,
              estimatedFeeRate: normalizedFeeRate,
              timeframe,
              fundingRatePer8h,
              initialEquity: normalizedInitialEquity,
              riskPerTradePct: normalizedRiskPerTradePct,
              trendRegimeThreshold: 0.25,
              enableHigherTimeframeTrendFilter: true,
              tradeStartTime,
            });

            const perturbations = [0.8, 1.2].flatMap(multiplier => [
              { stopLoss: selected.params.stopLoss * multiplier, takeProfit: selected.params.takeProfit },
              { stopLoss: selected.params.stopLoss, takeProfit: selected.params.takeProfit * multiplier },
            ]).map(params => runBacktestOnOhlcv(validationWarmup, {
              symbol: ccxtSymbol,
              strategy: strategyId,
              stopLoss: params.stopLoss,
              takeProfit: params.takeProfit,
              estimatedFeeRate: normalizedFeeRate,
              timeframe,
              fundingRatePer8h,
              initialEquity: normalizedInitialEquity,
              riskPerTradePct: normalizedRiskPerTradePct,
              trendRegimeThreshold: 0.25,
              enableHigherTimeframeTrendFilter: true,
              tradeStartTime,
            }));
            const perturbReturns = perturbations.map(item => Number(item.totalReturn || 0));
            const worstPerturbReturn = Math.min(...perturbReturns);
            const validationTrades = Number(validation.totalTrades || validation.trades || 0);
            const fragile = worstPerturbReturn < validation.totalReturn - Math.max(5, Math.abs(validation.totalReturn) * 0.5);
            const validationStatus = classifyValidationStatus({
              trainTrades: selected.trainTrades,
              validationTrades,
              minTrainTrades: normalizedMinTrainTrades,
              fragile,
            });
            const insufficientReason = validationStatus === "insufficient_trades"
              ? selected.selectedParamsRejectedReason
              : validationStatus === "no_validation_trades"
                ? "validation produced 0 trades"
                : "";
            const diagnostics = {
              ...(validation.diagnostics || {}),
              trainTrades: selected.trainTrades,
              validationTrades,
            };

            rounds.push({
              strategy: strategyId,
              symbol: ccxtSymbol,
              trainStart: window.trainStartTime,
              trainEnd: window.trainEndTime,
              validationStart: window.validationStartTime,
              validationEnd: window.validationEndTime,
              validationTradeStart: tradeStartTime,
              warmupStart: Number(ohlcv[window.warmupStart]?.[0] || window.validationStartTime),
              selectedParams: selected.params,
              train: {
                totalReturn: selected.result.totalReturn,
                maxDrawdown: selected.result.maxDrawdown,
                profitFactor: selected.result.profitFactor,
                winRate: selected.result.winRate,
                expectancy: selected.result.expectancy,
                totalTrades: selected.result.totalTrades,
                selectionScore: selected.selectionScore,
                failsHardFloor: selected.failsHardFloor,
                insufficientTrades: selected.insufficientTrades,
                selectedParamsRejectedReason: selected.selectedParamsRejectedReason,
              },
              validation,
              validationStatus,
              insufficientReason,
              selectedParamsRejectedReason: selected.selectedParamsRejectedReason,
              diagnostics,
              perturbation: {
                medianReturn: median(perturbReturns),
                worstReturn: worstPerturbReturn,
                fragile,
              },
              dataMode: "strict_price_only",
            });
          }

          bySymbol[ccxtSymbol].byStrategy[strategyId] = {
            rounds,
            summary: summarizeWalkForwardRounds(rounds),
          };
          allRounds.push(...rounds);
        }
      }

      if (!allRounds.length) {
        return res.status(400).json({
          error: "Not enough OHLCV data for requested walk-forward windows",
          walkForward: true,
          initialEquity: normalizedInitialEquity,
          timeframe,
          config: {
            trainDays: normalizedTrainDays,
            validationDays: normalizedValidationDays,
            stepDays: normalizedStepDays,
            requestedTrainBars,
            requestedValidationBars,
            fetchLimit,
            minTrainTrades: normalizedMinTrainTrades,
            riskPerTradePct: normalizedRiskPerTradePct,
          },
          strategies: targetStrategies,
          symbols: targetSymbols,
          bySymbol,
          factorAudit,
        });
      }

      res.json({
        walkForward: true,
        dataMode: "strict_price_only",
        initialEquity: normalizedInitialEquity,
        timeframe,
        config: {
          trainDays: normalizedTrainDays,
          validationDays: normalizedValidationDays,
          stepDays: normalizedStepDays,
          period: fetchLimit,
          estimatedFeeRate: normalizedFeeRate,
          minTrainTrades: normalizedMinTrainTrades,
          riskPerTradePct: normalizedRiskPerTradePct,
          parameterGrid,
          requestedTrainBars,
          requestedValidationBars,
        },
        strategies: targetStrategies,
        symbols: targetSymbols.map(item => toCcxtSymbol(item)),
        rounds: allRounds,
        byStrategy: groupWalkForwardRounds(allRounds),
        bySymbol,
        summary: summarizeWalkForwardRounds(allRounds),
        factorAudit,
        timeConsistency: {
          training: "Train windows only use older OHLCV bars.",
          validation: "Validation windows are strictly later than their training windows; no random split is used.",
          warmup: "Validation may include pre-validation warmup bars for indicators, but tradeStartTime blocks trades before validationStart.",
          signalExecution: "Signals use bar t-1 close and earlier history, then execute on bar t open.",
          nonPriceFactors: "Macro, on-chain, and news factors are disabled until point-in-time timestamps are available.",
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
