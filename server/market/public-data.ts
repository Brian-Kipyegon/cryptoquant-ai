import { normalizeDisplaySymbol } from "../../src/lib/tradingRuntime";
import { cachedPublicMarket } from "../utils";
import { withAutoTradingDataRetry } from "../exchange/connectivity";
import { getMarketDataProvider, getOkxMarketDataProvider } from "./providers";

// Market data for scanning, charts and shadow execution comes from the active
// provider (DATA_EXCHANGE, Binance by default). Cache keys include the provider
// id so data from different venues never mixes.

export async function fetchPublicTickerSnapshot(symbol: string) {
  const provider = getMarketDataProvider();
  const displaySymbol = normalizeDisplaySymbol(symbol);
  return cachedPublicMarket(`${provider.id}:ticker:${displaySymbol}`, 3000, () => provider.ticker(displaySymbol));
}

/** Every ticker the data venue offers, keyed by display symbol. One request. */
export async function fetchPublicTickers() {
  const provider = getMarketDataProvider();
  return cachedPublicMarket(`${provider.id}:tickers`, 10000, () => provider.tickers());
}

export async function fetchPublicOrderBookSnapshot(symbol: string) {
  const provider = getMarketDataProvider();
  const displaySymbol = normalizeDisplaySymbol(symbol);
  return cachedPublicMarket(`${provider.id}:orderbook:${displaySymbol}`, 3000, () => provider.orderBook(displaySymbol, 20));
}

export async function fetchPublicFundingSnapshot(symbol: string) {
  const provider = getMarketDataProvider();
  const displaySymbol = normalizeDisplaySymbol(symbol);
  return cachedPublicMarket(`${provider.id}:funding:${displaySymbol}`, 60000, () => provider.funding(displaySymbol));
}

export async function fetchPublicOhlcvSnapshot(symbol: string, timeframe = "1h", limit = 120) {
  const provider = getMarketDataProvider();
  const displaySymbol = normalizeDisplaySymbol(symbol);
  return cachedPublicMarket(`${provider.id}:ohlcv:${displaySymbol}:${timeframe}:${limit}`, 60000, () => provider.ohlcv(displaySymbol, timeframe, limit));
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
    `${getMarketDataProvider().label} market data ${symbol} ${timeframe}`,
    () => fetchPublicMarketBundle(symbol, timeframe, limit)
  );
}

/** OKX ticker, for sizing orders that execute on OKX regardless of the data venue. */
export async function fetchOkxExecutionTickerSnapshot(symbol: string) {
  const provider = getOkxMarketDataProvider();
  const displaySymbol = normalizeDisplaySymbol(symbol);
  return cachedPublicMarket(`okx:ticker:${displaySymbol}`, 3000, () => provider.ticker(displaySymbol));
}
