import fs from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MarketDataProvider } from "../market/providers";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cq-market-test-"));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = "test-password";
process.env.APP_SECRET = "test-app-secret-0123456789";

const HOUR = 3_600_000;
const ohlcvPage = vi.fn(async (_symbol: string, _timeframe: string, since: number | undefined, limit: number) => {
  // Hourly candles from `since` up to now, `limit` per page.
  const start = Math.floor((since ?? Date.now() - limit * HOUR) / HOUR) * HOUR;
  const rows: number[][] = [];
  for (let time = start; time <= Date.now() && rows.length < limit; time += HOUR) rows.push([time, 1, 2, 0.5, 1.5, 10]);
  return rows;
});

const provider: MarketDataProvider = {
  id: "binance",
  label: "FakeBinance",
  async ticker(symbol) { return { symbol, last: 42, quoteVolume: 1 } as any; },
  async tickers() {
    return {
      "BTC/USDT": { symbol: "BTC/USDT", last: 60000, quoteVolume: 9e9 } as any,
      "PEPE/USDT": { symbol: "PEPE/USDT", last: 0.00001, quoteVolume: 8e8 } as any,
      "ZZZ/USDT": { symbol: "ZZZ/USDT", last: 1, quoteVolume: 10 } as any,
    };
  },
  async orderBook(symbol) { return { symbol, bids: [[1, 1]], asks: [[2, 1]] } as any; },
  async ohlcv(_symbol, _timeframe, limit) { return Array.from({ length: limit }, (_, index) => [index, 1, 1, 1, 1, 1]); },
  ohlcvPage,
  async funding(symbol) { return { symbol, fundingRate: 0.0001, available: true } as any; },
  async spotMarkets() {
    return ["BTC", "PEPE", "ZZZ"].map((base) => ({ symbol: `${base}/USDT`, base, quote: "USDT", active: true }));
  },
  async ping() {},
};

let server: Server;
let baseUrl = "";
let token = "";

async function get(pathname: string, auth = false) {
  const res = await fetch(`${baseUrl}${pathname}`, { headers: auth ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

beforeAll(async () => {
  const { setMarketDataProvider } = await import("../market/providers");
  setMarketDataProvider(provider);
  const { createApp } = await import("../app");
  const app = await createApp({ serveFrontend: false, startBackgroundJobs: false });
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "test-password" }),
  });
  token = (await login.json()).token;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const { setMarketDataProvider } = await import("../market/providers");
  setMarketDataProvider(null);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("market routes", () => {
  it("serves public market data from the provider, with /api/okx aliases", async () => {
    const ticker = await get("/api/market/ticker/eth-usdt");
    expect(ticker.status).toBe(200);
    expect(ticker.json).toMatchObject({ symbol: "ETH/USDT", last: 42 });

    const alias = await get(`/api/okx/ohlcv/${encodeURIComponent("SOL/USDT")}?t=1h&limit=30`);
    expect(alias.status).toBe(200);
    expect(alias.json).toHaveLength(30);

    expect((await get("/api/market/orderbook/BTC-USDT")).json.asks).toEqual([[2, 1]]);
    expect((await get("/api/market/funding/BTC-USDT")).json.fundingRate).toBe(0.0001);
    expect((await get("/api/market/source")).json).toEqual({ id: "binance", label: "FakeBinance" });
  });

  it("returns tickers for scan profiles plus the universe", async () => {
    const tickers = await get("/api/market/tickers");
    expect(tickers.status).toBe(200);
    // Default profiles are BTC/ETH/SOL/DOGE (only BTC has a ticker here); the
    // universe adds PEPE, while ZZZ is below the minimum volume.
    expect(Object.keys(tickers.json).sort()).toEqual(["BTC/USDT", "PEPE/USDT"]);
  });

  it("requires a login for the universe and reports the selection", async () => {
    expect((await get("/api/market/universe")).status).toBe(401);
    const universe = await get("/api/market/universe", true);
    expect(universe.status).toBe(200);
    expect(universe.json).toMatchObject({ exchange: "FakeBinance", enabled: true, stale: false, executionFilter: null });
    expect(universe.json.entries.map((entry: any) => entry.symbol)).toEqual(["BTC/USDT", "PEPE/USDT"]);
  });
});

describe("backtest history", () => {
  it("pages candles through the market data provider", async () => {
    const { fetchBacktestOhlcv } = await import("../backtest/engine");
    ohlcvPage.mockClear();
    const candles = await fetchBacktestOhlcv("BTC-USDT", "1h", 700);
    expect(candles.length).toBeGreaterThanOrEqual(600);
    expect(ohlcvPage.mock.calls.length).toBeGreaterThan(1);
    expect(ohlcvPage.mock.calls[0][0]).toBe("BTC/USDT");
    const times = candles.map((row: any) => Number(row[0]));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
