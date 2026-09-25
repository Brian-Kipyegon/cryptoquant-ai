import ccxt from "ccxt";
import { normalizeDisplaySymbol, type OrderBook as RuntimeOrderBook } from "../../src/lib/tradingRuntime";
import { okxBar, okxPublicGet, toCcxtSymbol, toOkxSwapInstId } from "../exchange/okx";
import { applyExchangeProxy, prepareExchange, runWithExchangeProxyFallback } from "../exchange/connectivity";

export type MarketDataExchangeId = "binance" | "binanceus" | "okx";

export type MarketTicker = {
  symbol: string;
  timestamp: number;
  datetime: string;
  high: number;
  low: number;
  bid: number;
  bidVolume: number;
  ask: number;
  askVolume: number;
  open: number;
  close: number;
  last: number;
  change: number;
  percentage: number;
  baseVolume: number;
  quoteVolume: number;
  volume: number;
  info: any;
};

export type MarketOrderBook = RuntimeOrderBook & {
  symbol: string;
  timestamp: number;
  datetime: string;
  info: any;
};

export type MarketFunding = {
  symbol: string;
  fundingRate: number;
  nextFundingRate: number;
  fundingTimestamp: number;
  nextFundingTime: number;
  timestamp: number;
  /** False when the pair has no perpetual contract, so the rate is a neutral 0. */
  available: boolean;
  info: any;
};

export type SpotMarketInfo = {
  symbol: string;
  base: string;
  quote: string;
  active: boolean;
};

export interface MarketDataProvider {
  readonly id: MarketDataExchangeId;
  /** Human-readable venue name for logs and the dashboard. */
  readonly label: string;
  ticker(symbol: string): Promise<MarketTicker>;
  /** All tickers the venue offers, keyed by display symbol (e.g. "BTC/USDT"). */
  tickers(): Promise<Record<string, MarketTicker>>;
  orderBook(symbol: string, depth?: number): Promise<MarketOrderBook>;
  /** Most recent candles, oldest first. */
  ohlcv(symbol: string, timeframe: string, limit: number): Promise<number[][]>;
  /** One page of candles starting at `since`, oldest first (used for backtest history). */
  ohlcvPage(symbol: string, timeframe: string, since: number | undefined, limit: number): Promise<number[][]>;
  funding(symbol: string): Promise<MarketFunding>;
  spotMarkets(): Promise<SpotMarketInfo[]>;
  /** Cheap reachability check used by the auto-trading preflight. */
  ping(): Promise<void>;
}

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function sortCandles(rows: any[]): number[][] {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => [toNumber(row[0]), toNumber(row[1]), toNumber(row[2]), toNumber(row[3]), toNumber(row[4]), toNumber(row[5])])
    .filter((row) => row[0] > 0)
    .sort((a, b) => a[0] - b[0]);
}

/** Converts a ccxt unified ticker into the app's ticker shape. */
export function normalizeCcxtTicker(symbol: string, raw: any): MarketTicker {
  const last = toNumber(raw?.last ?? raw?.close);
  const open = toNumber(raw?.open, last);
  const timestamp = toNumber(raw?.timestamp, Date.now()) || Date.now();
  const baseVolume = toNumber(raw?.baseVolume);
  return {
    symbol: normalizeDisplaySymbol(symbol),
    timestamp,
    datetime: new Date(timestamp).toISOString(),
    high: toNumber(raw?.high, last),
    low: toNumber(raw?.low, last),
    bid: toNumber(raw?.bid),
    bidVolume: toNumber(raw?.bidVolume),
    ask: toNumber(raw?.ask),
    askVolume: toNumber(raw?.askVolume),
    open,
    close: last,
    last,
    change: toNumber(raw?.change, last - open),
    percentage: Number.isFinite(Number(raw?.percentage))
      ? Number(raw.percentage)
      : open ? ((last - open) / open) * 100 : 0,
    baseVolume,
    quoteVolume: toNumber(raw?.quoteVolume, baseVolume * last),
    volume: baseVolume,
    info: raw?.info ?? raw,
  };
}

// ---------------------------------------------------------------------------
// OKX (USDT-margined perpetual swaps, as before)
// ---------------------------------------------------------------------------

function normalizeOkxTicker(symbol: string, raw: any): MarketTicker {
  const last = toNumber(raw?.last);
  const open = toNumber(raw?.open24h, last);
  const timestamp = toNumber(raw?.ts, Date.now()) || Date.now();
  const baseVolume = toNumber(raw?.vol24h);
  return {
    symbol: normalizeDisplaySymbol(symbol),
    timestamp,
    datetime: new Date(timestamp).toISOString(),
    high: toNumber(raw?.high24h, last),
    low: toNumber(raw?.low24h, last),
    bid: toNumber(raw?.bidPx),
    bidVolume: toNumber(raw?.bidSz),
    ask: toNumber(raw?.askPx),
    askVolume: toNumber(raw?.askSz),
    open,
    close: last,
    last,
    change: last - open,
    percentage: open ? ((last - open) / open) * 100 : 0,
    baseVolume,
    quoteVolume: toNumber(raw?.volCcy24h) * last || baseVolume * last,
    volume: baseVolume,
    info: raw,
  };
}

export class OkxMarketDataProvider implements MarketDataProvider {
  readonly id = "okx" as const;
  readonly label = "OKX";

  async ticker(symbol: string) {
    const [raw] = await okxPublicGet("/api/v5/market/ticker", { instId: toOkxSwapInstId(symbol) });
    return normalizeOkxTicker(symbol, raw);
  }

  async tickers() {
    const rows = await okxPublicGet("/api/v5/market/tickers", { instType: "SWAP" });
    const out: Record<string, MarketTicker> = {};
    for (const raw of rows) {
      if (!String(raw?.instId || "").endsWith("-USDT-SWAP")) continue;
      const symbol = normalizeDisplaySymbol(raw.instId);
      out[symbol] = normalizeOkxTicker(symbol, raw);
    }
    return out;
  }

  async orderBook(symbol: string, depth = 20) {
    const [raw] = await okxPublicGet("/api/v5/market/books", { instId: toOkxSwapInstId(symbol), sz: depth });
    const timestamp = toNumber(raw?.ts, Date.now()) || Date.now();
    return {
      symbol: normalizeDisplaySymbol(symbol),
      timestamp,
      datetime: new Date(timestamp).toISOString(),
      bids: (raw?.bids || []).map((row: string[]) => [Number(row[0]), Number(row[1])]),
      asks: (raw?.asks || []).map((row: string[]) => [Number(row[0]), Number(row[1])]),
      info: raw,
    } as MarketOrderBook;
  }

  async ohlcv(symbol: string, timeframe: string, limit: number) {
    const rows = await okxPublicGet("/api/v5/market/candles", { instId: toOkxSwapInstId(symbol), bar: okxBar(timeframe), limit });
    return sortCandles(rows);
  }

  private historyClient: any = null;

  async ohlcvPage(symbol: string, timeframe: string, since: number | undefined, limit: number) {
    if (!this.historyClient) {
      this.historyClient = new (ccxt as any).okx({ enableRateLimit: true, timeout: 20000, options: { defaultType: "swap" } });
      applyExchangeProxy(this.historyClient);
    }
    const client = this.historyClient;
    await prepareExchange(client);
    const rows = await runWithExchangeProxyFallback<any>(client, () => client.fetchOHLCV(toCcxtSymbol(symbol), timeframe, since, limit));
    return sortCandles(rows);
  }

  async funding(symbol: string) {
    const [raw] = await okxPublicGet("/api/v5/public/funding-rate", { instId: toOkxSwapInstId(symbol) });
    return {
      symbol: normalizeDisplaySymbol(symbol),
      fundingRate: toNumber(raw?.fundingRate),
      nextFundingRate: toNumber(raw?.nextFundingRate),
      fundingTimestamp: toNumber(raw?.fundingTime),
      nextFundingTime: toNumber(raw?.nextFundingTime),
      timestamp: Date.now(),
      available: Boolean(raw),
      info: raw,
    };
  }

  async spotMarkets() {
    const rows = await okxPublicGet("/api/v5/public/instruments", { instType: "SWAP" });
    return rows
      .filter((raw: any) => raw?.settleCcy === "USDT" && raw?.ctType === "linear")
      .map((raw: any) => {
        const symbol = normalizeDisplaySymbol(raw.instId);
        const [base, quote] = symbol.split("/");
        return { symbol, base, quote, active: raw.state === "live" };
      });
  }

  async ping() {
    await okxPublicGet("/api/v5/public/time", {});
  }
}

// ---------------------------------------------------------------------------
// Binance (spot market data; USD-M perpetual funding as context only)
// ---------------------------------------------------------------------------

export type BinanceClients = {
  spot: any;
  futures: any | null;
};

export function createBinanceClients(variant: "binance" | "binanceus"): BinanceClients {
  const spot = new (ccxt as any)[variant]({
    enableRateLimit: true,
    timeout: 10000,
    options: { defaultType: "spot", fetchMarkets: { types: ["spot"] } },
  });
  applyExchangeProxy(spot);
  // Binance.US has no perpetual futures, so funding context is unavailable there.
  let futures: any = null;
  if (variant === "binance") {
    futures = new (ccxt as any).binanceusdm({ enableRateLimit: true, timeout: 10000 });
    applyExchangeProxy(futures);
  }
  return { spot, futures };
}

const FUNDING_CACHE_TTL_MS = 60_000;

export class BinanceMarketDataProvider implements MarketDataProvider {
  readonly id: "binance" | "binanceus";
  readonly label: string;
  private fundingCache: { expiresAt: number; rates: Record<string, any> } | null = null;
  private fundingInFlight: Promise<Record<string, any>> | null = null;

  constructor(variant: "binance" | "binanceus" = "binance", private readonly clients: BinanceClients = createBinanceClients(variant)) {
    this.id = variant;
    this.label = variant === "binanceus" ? "Binance.US" : "Binance";
  }

  // ccxt responses are untyped; callers normalize them into the app's shapes.
  private async call(client: any, operation: () => Promise<any>): Promise<any> {
    await prepareExchange(client);
    return runWithExchangeProxyFallback<any>(client, operation);
  }

  private spotSymbol(symbol: string) {
    return normalizeDisplaySymbol(symbol);
  }

  async ticker(symbol: string) {
    const spotSymbol = this.spotSymbol(symbol);
    const raw = await this.call(this.clients.spot, () => this.clients.spot.fetchTicker(spotSymbol));
    return normalizeCcxtTicker(spotSymbol, raw);
  }

  async tickers() {
    const raw = await this.call(this.clients.spot, () => this.clients.spot.fetchTickers());
    const out: Record<string, MarketTicker> = {};
    for (const [symbol, ticker] of Object.entries<any>(raw || {})) {
      if (!symbol.includes("/") || symbol.includes(":")) continue;
      out[symbol] = normalizeCcxtTicker(symbol, ticker);
    }
    return out;
  }

  async orderBook(symbol: string, depth = 20) {
    const spotSymbol = this.spotSymbol(symbol);
    const raw = await this.call(this.clients.spot, () => this.clients.spot.fetchOrderBook(spotSymbol, depth));
    const timestamp = toNumber(raw?.timestamp, Date.now()) || Date.now();
    return {
      symbol: spotSymbol,
      timestamp,
      datetime: new Date(timestamp).toISOString(),
      bids: (raw?.bids || []).slice(0, depth).map((row: any[]) => [Number(row[0]), Number(row[1])]),
      asks: (raw?.asks || []).slice(0, depth).map((row: any[]) => [Number(row[0]), Number(row[1])]),
      info: raw?.info ?? null,
    } as MarketOrderBook;
  }

  async ohlcv(symbol: string, timeframe: string, limit: number) {
    return this.ohlcvPage(symbol, timeframe, undefined, limit);
  }

  async ohlcvPage(symbol: string, timeframe: string, since: number | undefined, limit: number) {
    const spotSymbol = this.spotSymbol(symbol);
    const rows = await this.call(this.clients.spot, () => this.clients.spot.fetchOHLCV(spotSymbol, timeframe, since, limit));
    return sortCandles(rows);
  }

  /** All USD-M perpetual funding rates in one request, keyed by spot display symbol. */
  private async fundingRates(): Promise<Record<string, any>> {
    if (!this.clients.futures) return {};
    const now = Date.now();
    if (this.fundingCache && this.fundingCache.expiresAt > now) return this.fundingCache.rates;
    if (!this.fundingInFlight) {
      const futures = this.clients.futures;
      this.fundingInFlight = this.call(futures, () => futures.fetchFundingRates())
        .then((raw: any) => {
          const rates: Record<string, any> = {};
          for (const [symbol, rate] of Object.entries<any>(raw || {})) {
            if (!symbol.endsWith(":USDT")) continue;
            rates[normalizeDisplaySymbol(symbol)] = rate;
          }
          this.fundingCache = { expiresAt: Date.now() + FUNDING_CACHE_TTL_MS, rates };
          return rates;
        })
        .finally(() => {
          this.fundingInFlight = null;
        });
    }
    return this.fundingInFlight;
  }

  async funding(symbol: string) {
    const spotSymbol = this.spotSymbol(symbol);
    let rate: any = null;
    try {
      rate = (await this.fundingRates())[spotSymbol] || null;
    } catch (error: any) {
      // Funding is context only; a futures outage must not block spot market data.
      console.warn(`[MarketData] ${this.label} funding rates unavailable: ${error?.message || error}`);
    }
    return {
      symbol: spotSymbol,
      fundingRate: toNumber(rate?.fundingRate),
      nextFundingRate: toNumber(rate?.nextFundingRate),
      fundingTimestamp: toNumber(rate?.fundingTimestamp),
      nextFundingTime: toNumber(rate?.nextFundingTimestamp),
      timestamp: Date.now(),
      available: Boolean(rate),
      info: rate?.info ?? null,
    };
  }

  async spotMarkets() {
    const markets = await this.call(this.clients.spot, () => this.clients.spot.loadMarkets());
    return Object.values<any>(markets || {})
      .filter((market) => market?.spot)
      .map((market) => ({
        symbol: String(market.symbol),
        base: String(market.base),
        quote: String(market.quote),
        active: market.active !== false,
      }));
  }

  async ping() {
    await this.call(this.clients.spot, () => this.clients.spot.fetchTime());
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function resolveMarketDataExchangeId(value = process.env.DATA_EXCHANGE): MarketDataExchangeId {
  const normalized = String(value || "binance").trim().toLowerCase();
  if (normalized === "okx" || normalized === "binanceus") return normalized;
  if (normalized && normalized !== "binance") {
    console.warn(`[MarketData] Unknown DATA_EXCHANGE "${value}", using binance.`);
  }
  return "binance";
}

let activeProvider: MarketDataProvider | null = null;
let okxProvider: OkxMarketDataProvider | null = null;

/** The market data source used for scanning, charts and backtests (DATA_EXCHANGE, default binance). */
export function getMarketDataProvider(): MarketDataProvider {
  if (!activeProvider) {
    const id = resolveMarketDataExchangeId();
    activeProvider = id === "okx" ? getOkxMarketDataProvider() : new BinanceMarketDataProvider(id);
  }
  return activeProvider;
}

/** OKX market data, used where prices must come from the execution venue (order sizing). */
export function getOkxMarketDataProvider(): OkxMarketDataProvider {
  if (!okxProvider) okxProvider = new OkxMarketDataProvider();
  return okxProvider;
}

/** Test hook: replace the active provider. Pass null to go back to DATA_EXCHANGE. */
export function setMarketDataProvider(provider: MarketDataProvider | null) {
  activeProvider = provider;
}
