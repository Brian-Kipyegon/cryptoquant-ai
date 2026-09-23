import { type PortfolioReturnBillInput, type PortfolioReturnMode, type PortfolioReturnRange } from "../../src/lib/portfolioReturns";
import { PORTFOLIO_RETURNS_CACHE_TTL_MS, PORTFOLIO_RETURNS_STALE_MAX_AGE_MS, createPortfolioReturnStaleStatus, isFreshPortfolioReturnCache, isUsableStalePortfolioReturnCache, withPortfolioReturnSourceStatus, type PortfolioReturnCacheEntry } from "../../src/lib/portfolioReturnStability";
import { OkxCredentials, resolveOkxCredentials } from "../auth/credentials";
import { fetchPrivateBalance, getAccountTotalUSDT } from "../exchange/okx-account";
import { firstNumber } from "../utils";
import { getPrivateExchange } from "../exchange/okx";
import { prepareExchange, runWithExchangeProxyFallback } from "../exchange/connectivity";

export function normalizePortfolioReturnMode(value: any): PortfolioReturnMode {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "demo" || normalized === "paper" || normalized === "sim") return "demo";
  if (normalized === "shadow") return "shadow";
  return "live";
}

export function normalizePortfolioReturnRange(value: any): PortfolioReturnRange {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "7d" || normalized === "30d" || normalized === "90d" || normalized === "all") {
    return normalized as PortfolioReturnRange;
  }
  return "30d";
}

export const portfolioReturnCache = new Map<string, PortfolioReturnCacheEntry>();

export function portfolioCredentialError(mode: PortfolioReturnMode) {
  return mode === "demo"
    ? "OKX demo credentials are missing, so real bill returns cannot be read. Configure the OKX demo API in Settings first."
    : "OKX live credentials are missing, so real bill returns cannot be read. Configure the OKX live API in Settings first.";
}

export function normalizeOkxPortfolioBill(row: any, mode: PortfolioReturnMode): PortfolioReturnBillInput {
  const timestamp = firstNumber(row.ts, row.uTime, row.cTime);
  return {
    ...row,
    id: row.billId || row.ordId || `${timestamp}_${row.type || ""}_${row.subType || ""}`,
    mode,
    timestamp,
    pnl: firstNumber(row.pnl),
    fee: firstNumber(row.fee),
    balanceChange: firstNumber(row.balChg),
    type: row.type,
    subType: row.subType,
    ccy: row.ccy,
    symbol: row.instId,
    rawJson: JSON.stringify(row),
  };
}

export async function fetchPortfolioAccountBills(
  credentials: Required<OkxCredentials>,
  sandbox: boolean,
  mode: PortfolioReturnMode,
  limit: number
) {
  const exchange = getPrivateExchange(credentials.apiKey, credentials.secret, credentials.password, sandbox);
  await prepareExchange(exchange);
  const response = await runWithExchangeProxyFallback<any>(exchange, () => (exchange as any).privateGetAccountBills({
    ccy: "USDT",
    limit: String(Math.min(100, Math.max(1, limit))),
  }));
  const rawRows = Array.isArray(response?.data) ? response.data : [];
  return rawRows
    .map((row: any) => normalizeOkxPortfolioBill(row, mode))
    .filter((row: any) => Number.isFinite(Number(row.timestamp)) && Number(row.timestamp) > 0);
}

export async function fetchPortfolioExchangeReturns(mode: PortfolioReturnMode, limit: number) {
  const sandbox = mode === "demo";
  const credentials = resolveOkxCredentials({}, sandbox);
  if (!credentials) {
    const error = new Error(portfolioCredentialError(mode)) as Error & { status?: number };
    error.status = 400;
    throw error;
  }

  const [balance, bills] = await Promise.all([
    fetchPrivateBalance(credentials, sandbox),
    fetchPortfolioAccountBills(credentials, sandbox, mode, limit),
  ]);
  const capitalBase = getAccountTotalUSDT(balance);
  return {
    capitalBase: capitalBase > 0 ? capitalBase : null,
    bills,
  };
}

export function formatPortfolioReturnSourceError(error: any) {
  return error?.message || String(error || "Failed to read OKX bills");
}

export function getFreshPortfolioReturnCachedResponse(requestKey: string, now: number) {
  const cached = portfolioReturnCache.get(requestKey);
  if (!isFreshPortfolioReturnCache(cached, now, PORTFOLIO_RETURNS_CACHE_TTL_MS)) return null;
  return withPortfolioReturnSourceStatus(cached!.analytics, {
    state: "fresh",
    fetchedAt: cached!.analytics.sourceStatus?.fetchedAt || cached!.analytics.generatedAt,
  });
}

export function getStalePortfolioReturnCachedResponse(requestKey: string, error: any, now: number) {
  const cached = portfolioReturnCache.get(requestKey);
  if (!isUsableStalePortfolioReturnCache(cached, now, PORTFOLIO_RETURNS_STALE_MAX_AGE_MS)) return null;
  const message = `OKX bill refresh failed; showing the last successful snapshot: ${formatPortfolioReturnSourceError(error)}`;
  return withPortfolioReturnSourceStatus(
    cached!.analytics,
    createPortfolioReturnStaleStatus(cached!.analytics, message, now)
  );
}
