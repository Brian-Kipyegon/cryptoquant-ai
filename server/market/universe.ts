import { selectUniverse, type UniverseConfig, type UniverseEntry } from "../../src/lib/universe";
import { cachedPublicMarket } from "../utils";
import { getMarketDataProvider, getOkxMarketDataProvider } from "./providers";
import { fetchPublicTickers } from "./public-data";

export const UNIVERSE_REFRESH_MS = 60 * 60 * 1000;
/** After a failed refresh, keep serving the stale snapshot for this long before retrying. */
const FAILED_REFRESH_RETRY_MS = 5 * 60 * 1000;
const MARKETS_CACHE_MS = 6 * 60 * 60 * 1000;

export type UniverseSnapshot = {
  exchange: string;
  refreshedAt: number;
  entries: UniverseEntry[];
  /** Set when the pairs are limited to what the execution venue can trade. */
  executionFilter: string | null;
  /** Set when the latest refresh failed and an older snapshot is being served. */
  stale: boolean;
  error: string | null;
};

type SnapshotKey = string;
const snapshots = new Map<SnapshotKey, UniverseSnapshot>();
const inFlight = new Map<SnapshotKey, Promise<UniverseSnapshot>>();
const lastFailureAt = new Map<SnapshotKey, number>();

async function spotMarkets() {
  const provider = getMarketDataProvider();
  return cachedPublicMarket(`${provider.id}:spot-markets`, MARKETS_CACHE_MS, () => provider.spotMarkets());
}

/** Pairs OKX can execute as USDT perpetual swaps (live orders still go to OKX). */
async function okxExecutableSymbols() {
  const symbols = await cachedPublicMarket("okx:swap-markets", MARKETS_CACHE_MS, async () => {
    const markets = await getOkxMarketDataProvider().spotMarkets();
    return markets.filter((market) => market.active).map((market) => market.symbol);
  });
  return new Set(symbols);
}

export type UniverseOptions = {
  /** Limit to pairs OKX can execute. Used for live (non-shadow) trading. */
  requireOkxExecution?: boolean;
  /** Ignore the cache and refresh now. */
  force?: boolean;
};

async function buildSnapshot(config: UniverseConfig, options: UniverseOptions): Promise<UniverseSnapshot> {
  const provider = getMarketDataProvider();
  const filterToOkx = Boolean(options.requireOkxExecution) && provider.id !== "okx";
  const [markets, tickers, allowed] = await Promise.all([
    spotMarkets(),
    fetchPublicTickers(),
    filterToOkx ? okxExecutableSymbols() : Promise.resolve(null),
  ]);
  return {
    exchange: provider.label,
    refreshedAt: Date.now(),
    entries: selectUniverse(markets, tickers, config, allowed),
    executionFilter: filterToOkx ? "OKX USDT swaps" : null,
    stale: false,
    error: null,
  };
}

/**
 * The most liquid pairs on the market data venue, refreshed hourly.
 * If a refresh fails the previous snapshot is served (marked stale); with no
 * previous snapshot the error propagates.
 */
export async function getUniverseSnapshot(config: UniverseConfig, options: UniverseOptions = {}): Promise<UniverseSnapshot> {
  const provider = getMarketDataProvider();
  const key = [provider.id, config.size, config.minQuoteVolume, options.requireOkxExecution ? "okx" : "any"].join(":");
  const existing = snapshots.get(key);
  if (!options.force && existing) {
    const fresh = !existing.stale && Date.now() - existing.refreshedAt < UNIVERSE_REFRESH_MS;
    const backingOff = existing.stale && Date.now() - (lastFailureAt.get(key) || 0) < FAILED_REFRESH_RETRY_MS;
    if (fresh || backingOff) return existing;
  }

  if (!inFlight.has(key)) {
    inFlight.set(key, buildSnapshot(config, options)
      .then((snapshot) => {
        snapshots.set(key, snapshot);
        lastFailureAt.delete(key);
        return snapshot;
      })
      .catch((error: any) => {
        lastFailureAt.set(key, Date.now());
        const previous = snapshots.get(key);
        if (!previous) throw error;
        const stale = { ...previous, stale: true, error: error?.message || String(error) };
        snapshots.set(key, stale);
        return stale;
      })
      .finally(() => inFlight.delete(key)));
  }
  return inFlight.get(key)!;
}

/** Test hook. */
export function clearUniverseCache() {
  snapshots.clear();
  inFlight.clear();
  lastFailureAt.clear();
}
