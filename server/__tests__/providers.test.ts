import { describe, expect, it, vi } from "vitest";
import { BinanceMarketDataProvider, normalizeCcxtTicker, resolveMarketDataExchangeId } from "../market/providers";

function fakeClients(overrides: { spot?: Record<string, any>; futures?: Record<string, any> | null } = {}) {
  const spot = {
    fetchTicker: vi.fn(async (symbol: string) => ({
      symbol, timestamp: 1_700_000_000_000, last: 100, open: 80, high: 110, low: 75,
      bid: 99.9, ask: 100.1, baseVolume: 50, quoteVolume: 5000, percentage: 25, info: { raw: true },
    })),
    fetchTickers: vi.fn(async () => ({
      "BTC/USDT": { last: 60000, open: 59000, baseVolume: 10, quoteVolume: 600000 },
      "ETH/USDT": { last: 3000, open: 3100, baseVolume: 100 },
      "BTC/USDT:USDT": { last: 60010 },
    })),
    fetchOrderBook: vi.fn(async () => ({
      timestamp: 1_700_000_000_000,
      bids: [[99, 1, 5], [98, 2, 6]],
      asks: [[101, 1, 7], [102, 3, 8]],
    })),
    fetchOHLCV: vi.fn(async () => [[3000, 1, 2, 0.5, 1.5, 10], [1000, 1, 2, 0.5, 1.5, 10], [2000, 1, 2, 0.5, 1.5, 10]]),
    loadMarkets: vi.fn(async () => ({
      "BTC/USDT": { symbol: "BTC/USDT", base: "BTC", quote: "USDT", spot: true, active: true },
      "OLD/USDT": { symbol: "OLD/USDT", base: "OLD", quote: "USDT", spot: true, active: false },
      "BTC/USDT:USDT": { symbol: "BTC/USDT:USDT", base: "BTC", quote: "USDT", spot: false, swap: true },
    })),
    fetchTime: vi.fn(async () => Date.now()),
    ...overrides.spot,
  };
  const futures = overrides.futures === null ? null : {
    fetchFundingRates: vi.fn(async () => ({
      "BTC/USDT:USDT": { fundingRate: 0.0001, fundingTimestamp: 1, nextFundingTimestamp: 2, info: {} },
      "ETH/USDT:USDT": { fundingRate: -0.0002, fundingTimestamp: 3, nextFundingTimestamp: 4, info: {} },
      "BTC/USD:BTC": { fundingRate: 0.5 },
    })),
    ...overrides.futures,
  };
  return { spot, futures };
}

describe("Binance market data provider", () => {
  it("normalizes a spot ticker from any symbol format", async () => {
    const clients = fakeClients();
    const provider = new BinanceMarketDataProvider("binance", clients);
    const ticker = await provider.ticker("btc-usdt-swap");
    expect(clients.spot.fetchTicker).toHaveBeenCalledWith("BTC/USDT");
    expect(ticker).toMatchObject({
      symbol: "BTC/USDT", last: 100, open: 80, close: 100, change: 20, percentage: 25,
      baseVolume: 50, quoteVolume: 5000, volume: 50, bid: 99.9, ask: 100.1,
    });
    expect(ticker.datetime).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("returns spot tickers keyed by display symbol and skips derivatives", async () => {
    const provider = new BinanceMarketDataProvider("binance", fakeClients());
    const tickers = await provider.tickers();
    expect(Object.keys(tickers).sort()).toEqual(["BTC/USDT", "ETH/USDT"]);
    expect(tickers["ETH/USDT"].quoteVolume).toBe(300000); // derived from base volume x last
  });

  it("trims order book rows to price and size", async () => {
    const provider = new BinanceMarketDataProvider("binance", fakeClients());
    const book = await provider.orderBook("ETH/USDT", 20);
    expect(book.bids).toEqual([[99, 1], [98, 2]]);
    expect(book.asks).toEqual([[101, 1], [102, 3]]);
  });

  it("returns candles oldest first", async () => {
    const provider = new BinanceMarketDataProvider("binance", fakeClients());
    const candles = await provider.ohlcv("BTC/USDT", "1h", 3);
    expect(candles.map((row) => row[0])).toEqual([1000, 2000, 3000]);
  });

  it("fetches all funding rates once and serves each pair from the cache", async () => {
    const clients = fakeClients();
    const provider = new BinanceMarketDataProvider("binance", clients);
    const [btc, eth, sol] = await Promise.all([
      provider.funding("BTC/USDT"),
      provider.funding("ETH/USDT"),
      provider.funding("SOL/USDT"),
    ]);
    expect(clients.futures!.fetchFundingRates).toHaveBeenCalledTimes(1);
    expect(btc).toMatchObject({ fundingRate: 0.0001, available: true, nextFundingTime: 2 });
    expect(eth.fundingRate).toBe(-0.0002);
    expect(sol).toMatchObject({ fundingRate: 0, available: false });
  });

  it("treats a futures outage as neutral funding instead of failing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clients = fakeClients({ futures: { fetchFundingRates: vi.fn(async () => { throw new Error("fapi down"); }) } });
    const provider = new BinanceMarketDataProvider("binance", clients);
    await expect(provider.funding("BTC/USDT")).resolves.toMatchObject({ fundingRate: 0, available: false });
    warn.mockRestore();
  });

  it("has no funding context on Binance.US", async () => {
    const provider = new BinanceMarketDataProvider("binanceus", fakeClients({ futures: null }));
    expect(provider.label).toBe("Binance.US");
    await expect(provider.funding("BTC/USDT")).resolves.toMatchObject({ available: false });
  });

  it("lists spot markets only", async () => {
    const provider = new BinanceMarketDataProvider("binance", fakeClients());
    const markets = await provider.spotMarkets();
    expect(markets.map((market) => market.symbol).sort()).toEqual(["BTC/USDT", "OLD/USDT"]);
    expect(markets.find((market) => market.symbol === "OLD/USDT")?.active).toBe(false);
  });
});

describe("market data helpers", () => {
  it("resolves DATA_EXCHANGE with binance as the default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveMarketDataExchangeId(undefined)).toBe("binance");
    expect(resolveMarketDataExchangeId("OKX")).toBe("okx");
    expect(resolveMarketDataExchangeId("binanceus")).toBe("binanceus");
    expect(resolveMarketDataExchangeId("kraken")).toBe("binance");
    warn.mockRestore();
  });

  it("derives percentage and change when ccxt omits them", () => {
    const ticker = normalizeCcxtTicker("SOL/USDT", { last: 110, open: 100, baseVolume: 2 });
    expect(ticker).toMatchObject({ change: 10, percentage: 10, quoteVolume: 220 });
  });
});
