import { estimateShadowExecution, type OrderBook as RuntimeOrderBook, type Ticker as RuntimeTicker } from "../../src/lib/tradingRuntime";
import { calculateShadowPnl, calculateShadowQtyEstimate, closeShadowOrderPosition, findOpenShadowOrder, persistShadowOrder } from "../persistence/trading-db";

export function syncShadowPositionFromCandidate(input: {
  symbol: string;
  strategyId: string;
  side: "buy" | "sell";
  timeframe: string;
  leverage: number;
  amount: number;
  amountType: string;
  regime?: string | null;
  macroGate?: any;
  orderBook?: RuntimeOrderBook | null;
  signal: any;
  shadowExecution: ReturnType<typeof estimateShadowExecution>;
  ticker: RuntimeTicker;
  ohlcv?: any[];
}) {
  const existing = findOpenShadowOrder(input.symbol, input.strategyId);
  if (existing) {
    if (existing.side === input.side.toUpperCase()) {
      const refreshed = persistShadowOrder({
        ...existing,
        theoreticalPrice: input.shadowExecution.theoreticalPrice,
        executablePrice: input.shadowExecution.executablePrice,
        spreadBps: input.shadowExecution.spreadBps,
        slippageBps: input.shadowExecution.slippageBps,
        latencyMs: input.shadowExecution.latencyMs,
        markPrice: input.ticker.last,
        unrealizedPnl: calculateShadowPnl(existing.side, existing.qty_estimate, existing.entry_price, input.ticker.last),
        lastEvaluatedAt: Date.now(),
        orderbook: input.orderBook,
        signal: input.signal,
      });
      return { action: "refreshed" as const, order: refreshed, closed: null };
    }

    const lastBar = Array.isArray(input.ohlcv) && input.ohlcv.length > 0 ? input.ohlcv[input.ohlcv.length - 1] : null;
    const closed = closeShadowOrderPosition(existing, {
      referencePrice: input.ticker.last || Number(lastBar?.[4] || existing.entry_price || 0),
      reason: "reverse_signal",
      bar: lastBar,
      closedAt: Number(lastBar?.[0] || Date.now()),
    });
    const opened = persistShadowOrder({
      symbol: input.symbol,
      side: input.side,
      strategyId: input.strategyId,
      theoreticalPrice: input.shadowExecution.theoreticalPrice,
      executablePrice: input.shadowExecution.executablePrice,
      spreadBps: input.shadowExecution.spreadBps,
      slippageBps: input.shadowExecution.slippageBps,
      latencyMs: input.shadowExecution.latencyMs,
      amount: input.amount,
      amountType: input.amountType,
      regime: input.regime,
      macroGate: input.macroGate,
      orderbook: input.orderBook,
      signal: input.signal,
      status: "open",
      timeframe: input.timeframe,
      leverage: input.leverage,
      tpPrice: input.signal?.tp_price,
      slPrice: input.signal?.sl_price,
      entryPrice: input.shadowExecution.executablePrice,
      markPrice: input.ticker.last || input.shadowExecution.executablePrice,
      qtyEstimate: calculateShadowQtyEstimate({
        amount: input.amount,
        amountType: input.amountType,
        leverage: input.leverage,
        entryPrice: input.shadowExecution.executablePrice,
      }),
      unrealizedPnl: 0,
      lastEvaluatedAt: Date.now(),
      isEstimated: 0,
      estimatedTimeframe: null,
      estimationNote: null,
    });
    return { action: "reversed" as const, order: opened, closed };
  }

  const opened = persistShadowOrder({
    symbol: input.symbol,
    side: input.side,
    strategyId: input.strategyId,
    theoreticalPrice: input.shadowExecution.theoreticalPrice,
    executablePrice: input.shadowExecution.executablePrice,
    spreadBps: input.shadowExecution.spreadBps,
    slippageBps: input.shadowExecution.slippageBps,
    latencyMs: input.shadowExecution.latencyMs,
    amount: input.amount,
    amountType: input.amountType,
    regime: input.regime,
    macroGate: input.macroGate,
    orderbook: input.orderBook,
    signal: input.signal,
    status: "open",
    timeframe: input.timeframe,
    leverage: input.leverage,
    tpPrice: input.signal?.tp_price,
    slPrice: input.signal?.sl_price,
    entryPrice: input.shadowExecution.executablePrice,
    markPrice: input.ticker.last || input.shadowExecution.executablePrice,
    qtyEstimate: calculateShadowQtyEstimate({
      amount: input.amount,
      amountType: input.amountType,
      leverage: input.leverage,
      entryPrice: input.shadowExecution.executablePrice,
    }),
    unrealizedPnl: 0,
    lastEvaluatedAt: Date.now(),
    isEstimated: 0,
    estimatedTimeframe: null,
    estimationNote: null,
  });
  return { action: "opened" as const, order: opened, closed: null };
}
