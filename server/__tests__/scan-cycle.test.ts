import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MarketDataProvider } from "../market/providers";

// Configure before the server modules are imported: they read env at load time.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cq-scan-test-"));
process.env.DATA_DIR = dataDir;
process.env.APP_SECRET = "test-app-secret-0123456789";
process.env.SHADOW_PAPER_EQUITY_USDT = "5000";
delete process.env.OKX_API_KEY;
delete process.env.OKX_DEMO_API_KEY;

// No network: macro data falls back to a neutral snapshot.
vi.mock("../market/macro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../market/macro")>()),
  ensureFreshMacroData: vi.fn(async () => null),
}));

const HOUR = 3_600_000;
const STALE = "STALE/USDT";
const BROKEN = "BROKEN/USDT";

function candles(symbol: string, now: number) {
  const seed = symbol.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const lastOpen = Math.floor(now / HOUR) * HOUR - (symbol === STALE ? 48 * HOUR : 0);
  return Array.from({ length: 120 }, (_, index) => {
    const price = 100 + Math.sin((index + seed) / 6) * 5 + index * 0.05;
    return [lastOpen - (119 - index) * HOUR, price, price * 1.01, price * 0.99, price * 1.002, 1000 + index];
  });
}

function fakeProvider(): MarketDataProvider & { requests: string[] } {
  const bases = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "DOT", "TRX", "LTC", "SUI", "STALE", "BROKEN", "USDC"];
  const requests: string[] = [];
  const ticker = (symbol: string) => ({
    symbol, timestamp: Date.now(), datetime: new Date().toISOString(), high: 105, low: 95, bid: 99.95, bidVolume: 1,
    ask: 100.05, askVolume: 1, open: 99, close: 100, last: 100, change: 1, percentage: 1, baseVolume: 1000, quoteVolume: 100000, volume: 1000, info: null,
  });
  return {
    id: "binance",
    label: "FakeBinance",
    requests,
    async ticker(symbol) { requests.push(`ticker:${symbol}`); if (symbol === BROKEN) throw new Error("boom"); return ticker(symbol); },
    async tickers() {
      // Volume falls with position, so the ranking is the list order.
      return Object.fromEntries(bases.map((base, index) => [`${base}/USDT`, { ...ticker(`${base}/USDT`), quoteVolume: 1e9 - index * 1e6 }]));
    },
    async orderBook(symbol) {
      return { symbol, timestamp: Date.now(), datetime: "", info: null,
        bids: [[99.9, 5], [99.8, 5]], asks: [[100.1, 5], [100.2, 5]] } as any;
    },
    async ohlcv(symbol, _timeframe, limit) { requests.push(`ohlcv:${symbol}`); return candles(symbol, Date.now()).slice(-limit); },
    async ohlcvPage(symbol) { return candles(symbol, Date.now()); },
    async funding(symbol) { return { symbol, fundingRate: 0.0001, nextFundingRate: 0, fundingTimestamp: 0, nextFundingTime: 0, timestamp: Date.now(), available: true, info: null }; },
    async spotMarkets() { return bases.map((base) => ({ symbol: `${base}/USDT`, base, quote: "USDT", active: true })); },
    async ping() {},
  };
}

let provider: ReturnType<typeof fakeProvider>;

beforeAll(async () => {
  const { initTradingDatabase } = await import("../persistence/trading-db");
  await initTradingDatabase();
  const { setMarketDataProvider } = await import("../market/providers");
  provider = fakeProvider();
  setMarketDataProvider(provider);
});

afterAll(async () => {
  const { setMarketDataProvider } = await import("../market/providers");
  setMarketDataProvider(null);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("auto-trading scan cycle (shadow mode, no OKX account)", () => {
  it("scans manual profiles plus the universe on the market data provider", async () => {
    const { sanitizeAutoTradingConfig, appStore } = await import("../stores/app-store");
    const { runAutoTradingCycle } = await import("../trading/auto-trading-cycle");
    const { tradingDb } = await import("../persistence/trading-db");

    const config = sanitizeAutoTradingConfig({
      strategyIds: ["trend-breakout", "mean-reversion"],
      scanProfiles: [{ symbol: "BTC/USDT", timeframes: ["1h"] }],
      scanProfilesVersion: 2,
      shadowMode: true,
      universe: { enabled: true, size: 14, timeframes: ["1h"], minQuoteVolume: 0 },
    } as any)!;
    expect(config).not.toBeNull();

    const { summary } = await runAutoTradingCycle(config, "manual");

    // 14 universe pairs (USDC is excluded as a stablecoin); BTC/USDT 1h is both a
    // profile and a universe target, so it's scanned once. STALE and BROKEN fail.
    expect(summary.error).toBeNull();
    expect(summary.scannedTargets).toBe(12);
    expect(summary.strategiesEvaluated).toBe(24);
    expect(provider.requests.filter((request) => request === "ohlcv:BTC/USDT")).toHaveLength(1);

    const logs = appStore.autoTrading.recentLogs.join("\n");
    expect(logs).toContain("Scanning 14 targets (14 universe pairs) on FakeBinance");
    expect(logs).toMatch(/STALE\/USDT 1h: Stale candles/);
    expect(logs).toContain("Market data failed for BROKEN/USDT 1h");

    const marketDataFailures = appStore.autoTrading.decisionTraces
      .filter((trace: any) => trace.blockedAt === "market_data")
      .map((trace: any) => trace.symbol)
      .sort();
    expect(marketDataFailures).toEqual([BROKEN, STALE]);

    // Every signal on the manual profile is recorded; universe pairs only record BUY/SELL.
    const rows = tradingDb.prepare("SELECT symbol, signal FROM strategy_signals").all() as Array<{ symbol: string; signal: string }>;
    expect(rows.filter((row) => row.symbol === "BTC/USDT")).toHaveLength(2);
    expect(rows.filter((row) => row.symbol !== "BTC/USDT").every((row) => row.signal === "BUY" || row.signal === "SELL")).toBe(true);
  });

  it("refuses live mode without an OKX account", async () => {
    const { sanitizeAutoTradingConfig } = await import("../stores/app-store");
    const { runAutoTradingCycle } = await import("../trading/auto-trading-cycle");
    const config = sanitizeAutoTradingConfig({
      strategyIds: ["trend-breakout"],
      scanProfiles: [{ symbol: "BTC/USDT", timeframes: ["1h"] }],
      scanProfilesVersion: 2,
      shadowMode: false,
    } as any)!;
    await expect(runAutoTradingCycle(config, "manual")).rejects.toThrow(/Missing OKX credentials/);
  });
});

describe("scan helpers", () => {
  it("builds deduplicated targets with profiles first", async () => {
    const { buildScanTargets } = await import("../trading/scan-targets");
    const targets = buildScanTargets(
      [{ symbol: "BTC/USDT", timeframes: ["15m", "1h"] }],
      ["BTC/USDT", "ETH/USDT"],
      ["1h", "4h"],
    );
    expect(targets.map((target) => `${target.source}:${target.symbol}:${target.timeframe}`)).toEqual([
      "profile:BTC/USDT:15m", "profile:BTC/USDT:1h", "universe:BTC/USDT:4h", "universe:ETH/USDT:1h", "universe:ETH/USDT:4h",
    ]);
  });

  it("limits concurrency, keeps order and captures errors", async () => {
    const { mapWithConcurrency } = await import("../trading/scan-targets");
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      if (value === 4) throw new Error("four");
      return value * 10;
    });
    expect(peak).toBe(2);
    expect(results.map((result) => (result.ok ? result.value : result.error.message))).toEqual([10, 20, 30, "four", 50, 60]);
  });

  it("flags stale candles and tickers", async () => {
    const { checkMarketDataFreshness } = await import("../trading/scan-targets");
    const now = 10 * 24 * HOUR;
    const fresh = [[now - 30 * 60_000, 1, 1, 1, 1, 1]];
    expect(checkMarketDataFreshness({ ohlcv: fresh, ticker: { timestamp: now } }, "1h", now)).toBeNull();
    expect(checkMarketDataFreshness({ ohlcv: [[now - 3 * HOUR, 1, 1, 1, 1, 1]] }, "1h", now)).toMatch(/Stale candles/);
    expect(checkMarketDataFreshness({ ohlcv: [[now - 3 * HOUR, 1, 1, 1, 1, 1]] }, "4h", now)).toBeNull();
    expect(checkMarketDataFreshness({ ohlcv: fresh, ticker: { timestamp: now - 10 * 60_000 } }, "1h", now)).toMatch(/Stale ticker/);
    expect(checkMarketDataFreshness({ ohlcv: [] }, "1h", now)).toBe("No candles returned");
  });

  it("uses the configured paper equity", async () => {
    const { getShadowPaperEquity } = await import("../trading/scan-targets");
    expect(getShadowPaperEquity()).toBe(5000);
  });
});
