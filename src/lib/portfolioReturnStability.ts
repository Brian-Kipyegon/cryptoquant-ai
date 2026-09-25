import type {
  PortfolioReturnAnalytics,
  PortfolioReturnMode,
  PortfolioReturnRange,
  PortfolioReturnSourceStatus,
} from './portfolioReturns';

export const PORTFOLIO_RETURNS_CACHE_TTL_MS = 20_000;
export const PORTFOLIO_RETURNS_STALE_MAX_AGE_MS = 10 * 60_000;
export const PORTFOLIO_RETURNS_TIMEOUT_MS = 12_000;

export type PortfolioReturnCacheEntry = {
  analytics: PortfolioReturnAnalytics;
  storedAt: number;
};

export function createPortfolioReturnRequestKey(
  mode: PortfolioReturnMode,
  range: PortfolioReturnRange,
  limit: number
) {
  return `${mode}:${range}:${Math.max(1, Math.floor(limit || 1))}`;
}

export function isFreshPortfolioReturnCache(
  entry: PortfolioReturnCacheEntry | undefined,
  now: number,
  ttlMs = PORTFOLIO_RETURNS_CACHE_TTL_MS
) {
  return Boolean(entry && now - entry.storedAt <= ttlMs);
}

export function isUsableStalePortfolioReturnCache(
  entry: PortfolioReturnCacheEntry | undefined,
  now: number,
  maxAgeMs = PORTFOLIO_RETURNS_STALE_MAX_AGE_MS
) {
  return Boolean(entry && now - entry.storedAt <= maxAgeMs);
}

export function withPortfolioReturnSourceStatus(
  analytics: PortfolioReturnAnalytics,
  sourceStatus: PortfolioReturnSourceStatus
): PortfolioReturnAnalytics {
  return {
    ...analytics,
    sourceStatus,
  };
}

export function createPortfolioReturnStaleStatus(
  cached: PortfolioReturnAnalytics,
  message: string,
  now: number
): PortfolioReturnSourceStatus {
  return {
    state: 'stale',
    message,
    fetchedAt: cached.sourceStatus?.fetchedAt || cached.generatedAt,
    staleSince: now,
  };
}

export function isCurrentPortfolioReturnRequest(
  sequence: number,
  latestSequence: number,
  expectedRequestKey: string,
  responseRequestKey?: string
) {
  return sequence === latestSequence && (!responseRequestKey || responseRequestKey === expectedRequestKey);
}

export function portfolioReturnErrorMessage(error: unknown, fallback = 'Failed to load return analytics') {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}
