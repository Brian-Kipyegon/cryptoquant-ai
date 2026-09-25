import { timeframeToMs } from "../persistence/trading-db";
import type { AutoTradingScanProfile } from "../types";

export type ScanTarget = {
  symbol: string;
  timeframe: string;
  source: "profile" | "universe";
};

/** Manual profile targets first, then universe pairs, without duplicates. */
export function buildScanTargets(
  profiles: AutoTradingScanProfile[],
  universeSymbols: string[],
  universeTimeframes: string[],
): ScanTarget[] {
  const seen = new Set<string>();
  const targets: ScanTarget[] = [];
  const add = (symbol: string, timeframe: string, source: ScanTarget["source"]) => {
    const key = `${symbol}|${timeframe}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ symbol, timeframe, source });
  };
  for (const profile of profiles) {
    for (const timeframe of profile.timeframes) add(profile.symbol, timeframe, "profile");
  }
  for (const symbol of universeSymbols) {
    for (const timeframe of universeTimeframes) add(symbol, timeframe, "universe");
  }
  return targets;
}

export type Settled<T> = { ok: boolean; value?: T; error?: any };

/** Runs `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<Settled<R>[]> {
  const results: Settled<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { ok: true, value: await fn(items[index]) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** How long a ticker can lag before the snapshot counts as stale. */
export const MAX_TICKER_AGE_MS = 5 * 60 * 1000;

/**
 * Returns a reason when market data is too old to trade on, otherwise null.
 * The newest candle is the one still forming, so it should have opened within
 * the last timeframe; two timeframes plus a minute of slack allows for venue lag.
 */
export function checkMarketDataFreshness(
  bundle: { ticker?: { timestamp?: number } | null; ohlcv?: number[][] | null },
  timeframe: string,
  now = Date.now(),
): string | null {
  const candles = Array.isArray(bundle.ohlcv) ? bundle.ohlcv : [];
  const newestOpen = candles.length ? Number(candles[candles.length - 1][0]) : 0;
  if (!newestOpen) return "No candles returned";
  const maxCandleAge = timeframeToMs(timeframe) * 2 + 60_000;
  const candleAge = now - newestOpen;
  if (candleAge > maxCandleAge) {
    return `Stale candles: newest ${timeframe} candle opened ${Math.round(candleAge / 60_000)} min ago`;
  }
  const tickerTime = Number(bundle.ticker?.timestamp || 0);
  if (tickerTime && now - tickerTime > MAX_TICKER_AGE_MS) {
    return `Stale ticker: last update ${Math.round((now - tickerTime) / 60_000)} min ago`;
  }
  return null;
}

/** Account size used for position sizing in shadow mode when no OKX account is connected. */
export function getShadowPaperEquity() {
  const value = Number(process.env.SHADOW_PAPER_EQUITY_USDT);
  return Number.isFinite(value) && value > 0 ? value : 10_000;
}
