import React from "react";

import { apiFetch, type MacroResponse } from "../api";
import { usePollingTask } from "./usePollingTask";
import {
  buildMarketRuntimeContext,
  createDefaultMarketAnalysis,
  formatOhlcvTime,
  normalizeTicker,
  type OrderBook,
  type Ticker,
} from "../../lib/tradingRuntime";
import type { RuntimeMarketState } from "../utils";

export function useMarketData({
  enabled,
  page,
  selectedSymbol,
  chartTimeframe,
}: {
  enabled: boolean;
  page: string;
  selectedSymbol: string;
  chartTimeframe: "15m" | "1h";
}) {
  const [runtimeMarket, setRuntimeMarket] = React.useState<RuntimeMarketState>({
    tickers: {},
    ticker: null,
    orderBook: null,
    funding: null,
    ohlcv: [],
    macro: null,
    marketAnalysis: createDefaultMarketAnalysis(),
  });

  const refreshSelectedMarket = React.useCallback(
    async (signal?: AbortSignal) => {
      const [tickersResult, tickerResult, orderBookResult, fundingResult, ohlcvResult, macroResult] =
        await Promise.allSettled([
        apiFetch<Record<string, Ticker>>("/api/market/tickers", { signal }),
        apiFetch<any>(`/api/market/ticker/${encodeURIComponent(selectedSymbol)}`, { signal }),
        apiFetch<OrderBook>(`/api/market/orderbook/${encodeURIComponent(selectedSymbol)}`, { signal }),
        apiFetch<Record<string, unknown>>(`/api/market/funding/${encodeURIComponent(selectedSymbol)}`, { signal }),
        apiFetch<number[][]>(`/api/market/ohlcv/${encodeURIComponent(selectedSymbol)}?t=${chartTimeframe}&limit=120`, {
          signal,
        }),
        apiFetch<MacroResponse>("/api/macro", { signal }),
      ]);

      setRuntimeMarket((current) => {
        const tickers = tickersResult.status === "fulfilled" ? tickersResult.value : current.tickers;
        const tickerPayload = tickerResult.status === "fulfilled" ? tickerResult.value : current.ticker;
        const orderBook = orderBookResult.status === "fulfilled" ? orderBookResult.value : current.orderBook;
        const funding = fundingResult.status === "fulfilled" ? fundingResult.value : current.funding;
        const ohlcv = ohlcvResult.status === "fulfilled" ? ohlcvResult.value : current.ohlcv;
        const macro = macroResult.status === "fulfilled" ? macroResult.value : current.macro;
        const normalizedTicker = normalizeTicker(selectedSymbol, tickerPayload) || current.ticker;
        const context = buildMarketRuntimeContext(
          selectedSymbol,
          normalizedTicker || tickerPayload,
          funding,
          orderBook,
          ohlcv,
          current.marketAnalysis,
          chartTimeframe,
          {
            ticker: current.ticker,
            fundingRate: current.funding,
            orderBook: current.orderBook,
          }
        );
        return {
          tickers,
          ticker: normalizedTicker,
          orderBook,
          funding,
          ohlcv,
          macro,
          marketAnalysis: {
            ...context.marketAnalysis,
            onChainData: {
              ...context.marketAnalysis.onChainData,
              dxy: macro?.dxy ?? current.marketAnalysis.onChainData.dxy,
              m2: macro?.m2 ?? current.marketAnalysis.onChainData.m2,
              dxySource: macro?.dxySource ?? current.marketAnalysis.onChainData.dxySource,
            },
            macroIndicators: {
              ...context.marketAnalysis.macroIndicators,
              dxyCorrelation: macro?.dxyChange30dPct ?? current.marketAnalysis.macroIndicators.dxyCorrelation,
              globalLiquidity: macro?.m2 ?? current.marketAnalysis.macroIndicators.globalLiquidity,
              macroRiskScore: macro?.macroRiskScore ?? current.marketAnalysis.macroIndicators.macroRiskScore,
              macroGate: macro?.macroGate ?? current.marketAnalysis.macroIndicators.macroGate,
            },
          },
        };
      });
    },
    [chartTimeframe, selectedSymbol]
  );

  usePollingTask(
    React.useCallback(async (signal) => {
      await refreshSelectedMarket(signal);
    }, [refreshSelectedMarket]),
    enabled && (page === "dashboard" || page === "market"),
    [page, selectedSymbol, chartTimeframe],
    8_000,
    30_000
  );

  const chartData = React.useMemo(
    () =>
      runtimeMarket.ohlcv.map((row) => ({
        time: formatOhlcvTime(row[0], chartTimeframe),
        price: row[4],
        volume: row[5],
      })),
    [chartTimeframe, runtimeMarket.ohlcv]
  );

  return { runtimeMarket, chartData, refreshSelectedMarket };
}
