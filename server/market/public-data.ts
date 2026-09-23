import { normalizeDisplaySymbol, type OrderBook as RuntimeOrderBook } from "../../src/lib/tradingRuntime";
import { cachedPublicMarket } from "../utils";
import { okxBar, okxPublicGet, toOkxSwapInstId } from "../exchange/okx";
import { withAutoTradingDataRetry } from "../exchange/connectivity";

export async function fetchPublicTickerSnapshot(symbol: string) {
  const instId = toOkxSwapInstId(symbol);
  return cachedPublicMarket(`ticker:${instId}`, 3000, async () => {
    const [raw] = await okxPublicGet("/api/v5/market/ticker", { instId });
    const last = Number(raw?.last || 0);
    const open = Number(raw?.open24h || last);
    return {
      symbol: normalizeDisplaySymbol(symbol),
      timestamp: Number(raw?.ts || Date.now()),
      datetime: new Date(Number(raw?.ts || Date.now())).toISOString(),
      high: Number(raw?.high24h || last),
      low: Number(raw?.low24h || last),
      bid: Number(raw?.bidPx || 0),
      bidVolume: Number(raw?.bidSz || 0),
      ask: Number(raw?.askPx || 0),
      askVolume: Number(raw?.askSz || 0),
      open,
      close: last,
      last,
      change: last - open,
      percentage: open ? ((last - open) / open) * 100 : 0,
      baseVolume: Number(raw?.vol24h || 0),
      volume: Number(raw?.vol24h || 0),
      info: raw
    };
  });
}

export async function fetchPublicOrderBookSnapshot(symbol: string) {
  const instId = toOkxSwapInstId(symbol);
  return cachedPublicMarket(`orderbook:${instId}`, 3000, async () => {
    const [raw] = await okxPublicGet("/api/v5/market/books", { instId, sz: 20 });
    return {
      symbol: normalizeDisplaySymbol(symbol),
      timestamp: Number(raw?.ts || Date.now()),
      datetime: new Date(Number(raw?.ts || Date.now())).toISOString(),
      bids: (raw?.bids || []).map((row: string[]) => [Number(row[0]), Number(row[1])]),
      asks: (raw?.asks || []).map((row: string[]) => [Number(row[0]), Number(row[1])]),
      info: raw
    } as RuntimeOrderBook & { symbol: string; timestamp: number; datetime: string; info: any };
  });
}

export async function fetchPublicFundingSnapshot(symbol: string) {
  const instId = toOkxSwapInstId(symbol);
  return cachedPublicMarket(`funding:${instId}`, 60000, async () => {
    const [raw] = await okxPublicGet("/api/v5/public/funding-rate", { instId });
    return {
      symbol: normalizeDisplaySymbol(symbol),
      fundingRate: Number(raw?.fundingRate || 0),
      nextFundingRate: Number(raw?.nextFundingRate || 0),
      fundingTimestamp: Number(raw?.fundingTime || 0),
      nextFundingTime: Number(raw?.nextFundingTime || 0),
      timestamp: Date.now(),
      info: raw
    };
  });
}

export async function fetchPublicOhlcvSnapshot(symbol: string, timeframe = "1h", limit = 120) {
  const instId = toOkxSwapInstId(symbol);
  return cachedPublicMarket(`ohlcv:${instId}:${timeframe}:${limit}`, 60000, async () => {
    const rows = await okxPublicGet("/api/v5/market/candles", { instId, bar: okxBar(timeframe), limit });
    return rows
      .map((row: string[]) => [Number(row[0]), Number(row[1]), Number(row[2]), Number(row[3]), Number(row[4]), Number(row[5])])
      .sort((a: number[], b: number[]) => a[0] - b[0]);
  });
}

export async function fetchPublicMarketBundle(symbol: string, timeframe: string, limit = 120) {
  const [ticker, funding, orderBook, ohlcv] = await Promise.all([
    fetchPublicTickerSnapshot(symbol),
    fetchPublicFundingSnapshot(symbol),
    fetchPublicOrderBookSnapshot(symbol),
    fetchPublicOhlcvSnapshot(symbol, timeframe, limit),
  ]);
  return { ticker, funding, orderBook, ohlcv };
}

export async function fetchPublicMarketBundleWithAutoRetry(symbol: string, timeframe: string, limit = 120) {
  return withAutoTradingDataRetry(
    `OKX market data ${symbol} ${timeframe}`,
    () => fetchPublicMarketBundle(symbol, timeframe, limit)
  );
}
