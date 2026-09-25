import { describe, expect, it } from "vitest";
import { DEFAULT_UNIVERSE_CONFIG, isExcludedBase, sanitizeUniverseConfig, selectUniverse, type UniverseMarket } from "./universe";

const market = (symbol: string, active = true): UniverseMarket => {
  const [base, quote] = symbol.split("/");
  return { symbol, base, quote, active };
};

describe("selectUniverse", () => {
  const markets = [
    market("BTC/USDT"), market("ETH/USDT"), market("SOL/USDT"), market("DOGE/USDT"),
    market("USDC/USDT"), market("WBTC/USDT"), market("BTCUP/USDT"), market("ETH3L/USDT"),
    market("EUR/USDT"), market("BTC/FDUSD"), market("DEAD/USDT", false), market("TINY/USDT"),
  ];
  const tickers = {
    "BTC/USDT": { last: 60000, quoteVolume: 2_000_000_000 },
    "ETH/USDT": { last: 3000, quoteVolume: 1_000_000_000 },
    "SOL/USDT": { last: 150, baseVolume: 1_000_000 }, // quote volume derived: 150M
    "DOGE/USDT": { last: 0.1, quoteVolume: 120_000_000 },
    "USDC/USDT": { last: 1, quoteVolume: 5_000_000_000 },
    "WBTC/USDT": { last: 60000, quoteVolume: 90_000_000 },
    "BTCUP/USDT": { last: 10, quoteVolume: 90_000_000 },
    "ETH3L/USDT": { last: 10, quoteVolume: 90_000_000 },
    "EUR/USDT": { last: 1.1, quoteVolume: 90_000_000 },
    "BTC/FDUSD": { last: 60000, quoteVolume: 900_000_000 },
    "DEAD/USDT": { last: 1, quoteVolume: 900_000_000 },
    "TINY/USDT": { last: 1, quoteVolume: 1_000 },
  };

  it("ranks liquid USDT pairs and drops pegged, wrapped, leveraged, inactive and thin ones", () => {
    const universe = selectUniverse(markets, tickers, { size: 10, minQuoteVolume: 5_000_000 });
    expect(universe.map((entry) => entry.symbol)).toEqual(["BTC/USDT", "ETH/USDT", "SOL/USDT", "DOGE/USDT"]);
    expect(universe[2].quoteVolume).toBe(150_000_000);
  });

  it("breaks volume ties alphabetically so the order is stable", () => {
    const tie = selectUniverse(
      [market("BBB/USDT"), market("AAA/USDT")],
      { "BBB/USDT": { last: 1, quoteVolume: 10 }, "AAA/USDT": { last: 1, quoteVolume: 10 } },
      { size: 2, minQuoteVolume: 0 }
    );
    expect(tie.map((entry) => entry.symbol)).toEqual(["AAA/USDT", "BBB/USDT"]);
  });

  it("limits to the requested size and to allowed symbols", () => {
    expect(selectUniverse(markets, tickers, { size: 2, minQuoteVolume: 0 }).map((entry) => entry.symbol))
      .toEqual(["BTC/USDT", "ETH/USDT"]);
    const allowed = new Set(["SOL/USDT", "DOGE/USDT"]);
    expect(selectUniverse(markets, tickers, { size: 10, minQuoteVolume: 0 }, allowed).map((entry) => entry.symbol))
      .toEqual(["SOL/USDT", "DOGE/USDT"]);
  });

  it("skips pairs without a usable price", () => {
    const universe = selectUniverse([market("BTC/USDT"), market("NEW/USDT")], { "NEW/USDT": { last: 0, quoteVolume: 1e9 } }, { size: 5, minQuoteVolume: 0 });
    expect(universe).toEqual([]);
  });
});

describe("universe helpers", () => {
  it("recognizes excluded bases", () => {
    for (const base of ["USDT", "FDUSD", "EUR", "WBTC", "BTCUP", "ETHDOWN", "SOL3S"]) expect(isExcludedBase(base)).toBe(true);
    for (const base of ["BTC", "JUP", "SUPER", "1000SATS", "A2Z"]) expect(isExcludedBase(base)).toBe(false);
  });

  it("sanitizes settings and clamps the size", () => {
    expect(sanitizeUniverseConfig(undefined)).toEqual(DEFAULT_UNIVERSE_CONFIG);
    expect(sanitizeUniverseConfig({ enabled: false, size: 5000, timeframes: ["4h", "1m", "1h", "4h"], minQuoteVolume: -1 }))
      .toEqual({ enabled: false, size: 300, timeframes: ["1h", "4h"], minQuoteVolume: DEFAULT_UNIVERSE_CONFIG.minQuoteVolume });
    expect(sanitizeUniverseConfig({ size: 0 }).size).toBe(1);
  });
});
