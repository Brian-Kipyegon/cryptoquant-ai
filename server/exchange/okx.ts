import crypto from "crypto";
import ccxt from "ccxt";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { normalizeDisplaySymbol } from "../../src/lib/tradingRuntime";
import { OKX_AUTO_DATA_REQUEST_TIMEOUT_MS, isExchangeConnectivityErrorDetails } from "../../src/lib/exchangeReconnect";
import { EXCHANGE_PROXY_URL, applyExchangeProxy, canConnectToProxy, disableExchangeProxy, ensureExchangeProxyAvailable, exchangeProxyBypassed, getExchangeConnectivityStatus, getExchangeProxyStatus, isLocalProxyUrl, isProxyConnectivityError, markExchangeConnectivityFailure, markExchangeConnectivitySuccess, privateExchanges, redactProxyUrlForStatus, restoreExchangeProxy, withAutoTradingDataRetry } from "./connectivity";
import { OkxCredentials } from "../auth/credentials";
import { fetchPrivateBalance } from "./okx-account";
import { firstNumber } from "../utils";
import { pushAutoTradingLog, updateAutoTradingStore } from "../stores/app-store";
import { requestError } from "../http-errors";

export function getPrivateExchange(apiKey: string, secret: string, password: string, sandbox: boolean) {
  const key = `${apiKey}_${secret}_${password}_${sandbox}`;
  if (!privateExchanges.has(key)) {
    const exchange = new (ccxt as any).okx({
      apiKey,
      secret,
      password,
      enableRateLimit: true,
      timeout: OKX_AUTO_DATA_REQUEST_TIMEOUT_MS,
      options: {
        defaultType: "swap",
        fetchMarkets: { types: ["swap", "spot"] },
      },
    });
    applyExchangeProxy(exchange);
    if (sandbox) {
      try {
        exchange.setSandboxMode(true);
      } catch (e) {}
      exchange.headers = { ...(exchange.headers || {}), 'x-simulated-trading': '1' };
      exchange.options.defaultHeaders = { ...(exchange.options.defaultHeaders || {}), 'x-simulated-trading': '1' };
    }
    privateExchanges.set(key, exchange);
  }
  return privateExchanges.get(key)!;
}

// --- Utility: Retry Wrapper ---
export async function retry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries <= 0) throw error;
    // Don't retry on certain errors (e.g. Insufficient Funds)
    if (error.message.includes('Insufficient funds') || error.message.includes('Invalid order')) {
      throw error;
    }
    console.warn(`Operation failed, retrying... (${retries} left). Error: ${error.message}`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return retry(fn, retries - 1, delay * 2);
  }
}

// --- Utility: Symbol Converter ---
export function toCcxtSymbol(symbol: string): string {
  if (!symbol) return "BTC/USDT:USDT";
  let s = String(symbol).toUpperCase();
  // If it's already a CCXT unified symbol for swap (contains :)
  if (s.includes(':')) return s;
  if (s.endsWith("-SWAP")) {
    // Convert OKX native ID (e.g. BTC-USDT-SWAP) to CCXT unified symbol (e.g. BTC/USDT:USDT)
    const base = s.replace("-SWAP", "");
    const parts = base.split("-");
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}:USDT`;
    }
    return base.replace("-", "/") + ":USDT";
  }
  // This app trades USDT-margined perpetual swaps by default.
  const unified = s.replace("-", "/");
  const [base, quote = "USDT"] = unified.split("/");
  return `${base}/${quote}:${quote}`;
}

export function toOkxSwapInstId(symbol: string): string {
  if (!symbol) return "BTC-USDT-SWAP";
  const upper = String(symbol).toUpperCase();
  if (upper.endsWith("-SWAP")) return upper;
  const clean = upper.includes(":") ? upper.split(":")[0] : upper;
  return `${clean.replace("/", "-")}-SWAP`;
}

export function toCcxtLikeSwapSymbol(instId: string): string {
  const [base, quote] = String(instId || "BTC-USDT-SWAP").replace("-SWAP", "").split("-");
  return `${base}/${quote}:USDT`;
}

export type OkxResolvedSwapMarket = {
  requestedSymbol: string;
  displaySymbol: string;
  instId: string;
  resolvedMarketId: string;
  resolvedMarketSymbol: string;
  base: string;
  quote: string;
  settleCcy: string;
  ctVal: number;
  lotSz: number;
  minSz: number;
  tickSz: number;
  leverageCap: number | null;
  state: string;
};

export const okxSwapMarketCache = new Map<string, { expiresAt: number; value: OkxResolvedSwapMarket }>();
export const OKX_SWAP_MARKET_CACHE_TTL_MS = 5 * 60 * 1000;

export function ceilToStep(value: number, step: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(step) || step <= 0) return value;
  const decimals = Math.max(0, (String(step).split(".")[1] || "").length);
  return Number((Math.ceil(value / step) * step).toFixed(decimals));
}

export function formatToStepString(value: number, step: number) {
  const decimals = Math.max(0, (String(step).split(".")[1] || "").length);
  return Number(value).toFixed(decimals);
}

export function findLoadedOkxSwapMarket(exchange: any, instId: string, displaySymbol: string) {
  const markets = Object.values(exchange?.markets || {}) as any[];
  return markets.find((market) => {
    const marketDisplaySymbol = normalizeDisplaySymbol(String(market?.symbol || market?.id || ""));
    const marketInstId = String(market?.id || market?.info?.instId || "").toUpperCase();
    const settle = String(market?.settle || market?.info?.settleCcy || "").toUpperCase();
    return (
      marketInstId === instId.toUpperCase() ||
      (
        marketDisplaySymbol === displaySymbol &&
        (market?.swap || market?.type === "swap" || marketInstId.endsWith("-SWAP")) &&
        (!settle || settle === "USDT")
      )
    );
  }) || null;
}

export async function resolveOkxSwapMarket(symbol: string, exchange?: any): Promise<OkxResolvedSwapMarket> {
  const requestedSymbol = String(symbol || "BTC/USDT");
  const displaySymbol = normalizeDisplaySymbol(requestedSymbol);
  const instId = toOkxSwapInstId(displaySymbol);
  const cached = okxSwapMarketCache.get(instId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const loadedMarket = findLoadedOkxSwapMarket(exchange, instId, displaySymbol);
  const [base = "BTC", quote = "USDT"] = displaySymbol.split("/");
  const rawMarket = loadedMarket
    ? loadedMarket.info || {}
    : (await okxPublicGet("/api/v5/public/instruments", { instType: "SWAP", instId }))[0];

  if (!rawMarket) {
    throw requestError(400, `Resolved OKX swap instrument ${instId} not found`, {
      error: `Resolved OKX swap instrument ${instId} not found`,
      requestedSymbol,
      displaySymbol,
      instId,
    });
  }

  const resolved: OkxResolvedSwapMarket = {
    requestedSymbol,
    displaySymbol,
    instId: String(rawMarket.instId || loadedMarket?.id || instId),
    resolvedMarketId: String(rawMarket.instId || loadedMarket?.id || instId),
    resolvedMarketSymbol: normalizeDisplaySymbol(String(loadedMarket?.symbol || rawMarket.instId || displaySymbol)),
    base: String(rawMarket.baseCcy || base || "BTC").toUpperCase(),
    quote: String(rawMarket.quoteCcy || quote || "USDT").toUpperCase(),
    settleCcy: String(rawMarket.settleCcy || loadedMarket?.settle || "USDT").toUpperCase(),
    ctVal: firstNumber(rawMarket.ctVal, loadedMarket?.contractSize, 1),
    lotSz: firstNumber(rawMarket.lotSz, loadedMarket?.info?.lotSz, loadedMarket?.limits?.amount?.min, 0.01),
    minSz: firstNumber(rawMarket.minSz, loadedMarket?.limits?.amount?.min, rawMarket.lotSz, 0.01),
    tickSz: firstNumber(rawMarket.tickSz, loadedMarket?.precision?.price, 0.1),
    leverageCap: firstNumber(rawMarket.lever, null),
    state: String(rawMarket.state || "live"),
  };
  okxSwapMarketCache.set(instId, {
    value: resolved,
    expiresAt: Date.now() + OKX_SWAP_MARKET_CACHE_TTL_MS,
  });
  return resolved;
}

export function normalizeOkxOrderStatus(state: string | undefined | null) {
  const normalized = String(state || "").toLowerCase();
  if (normalized === "filled") return "closed";
  if (normalized === "canceled" || normalized === "cancelled" || normalized === "mmp_canceled") return "canceled";
  if (normalized === "partially_filled" || normalized === "live" || normalized === "effective") return "open";
  return normalized || "unknown";
}

export function normalizeOkxRawOrder(rawOrder: any, resolvedMarket: OkxResolvedSwapMarket) {
  const amount = firstNumber(rawOrder?.sz);
  const filled = firstNumber(rawOrder?.accFillSz, rawOrder?.fillSz);
  const price = firstNumber(rawOrder?.px, rawOrder?.avgPx);
  const average = firstNumber(rawOrder?.avgPx, rawOrder?.fillPx, price);
  const remaining = Number.isFinite(amount) && Number.isFinite(filled)
    ? Math.max(0, amount - filled)
    : undefined;
  const feeCost = firstNumber(rawOrder?.fee);
  return {
    id: String(rawOrder?.ordId || rawOrder?.algoId || rawOrder?.clOrdId || "").trim() || undefined,
    clientOrderId: String(rawOrder?.clOrdId || "").trim() || undefined,
    symbol: resolvedMarket.displaySymbol,
    instId: resolvedMarket.instId,
    type: rawOrder?.ordType || "market",
    side: rawOrder?.side,
    price,
    average,
    amount,
    filled,
    remaining,
    status: normalizeOkxOrderStatus(rawOrder?.state),
    fee: feeCost !== null ? {
      currency: rawOrder?.feeCcy || resolvedMarket.settleCcy,
      cost: Math.abs(feeCost),
    } : undefined,
    info: rawOrder,
  };
}

export function normalizeOkxHistoryOrder(rawOrder: any, resolvedMarket: OkxResolvedSwapMarket) {
  const normalized = normalizeOkxRawOrder(rawOrder, resolvedMarket);
  const timestamp = firstNumber(rawOrder?.uTime, rawOrder?.cTime, rawOrder?.fillTime, Date.now());
  const lastTradeTimestamp = firstNumber(rawOrder?.fillTime, rawOrder?.uTime, rawOrder?.cTime);
  const average = firstNumber(normalized.average, normalized.price);
  const filled = firstNumber(normalized.filled);
  const cost = average > 0 && filled > 0 ? average * filled : undefined;
  return {
    ...normalized,
    timestamp,
    datetime: new Date(timestamp).toISOString(),
    lastTradeTimestamp: lastTradeTimestamp > 0 ? lastTradeTimestamp : undefined,
    cost,
  };
}

export function unwrapOkxApiRow(response: any) {
  const code = String(response?.code ?? "0");
  if (code !== "0") {
    throw requestError(502, response?.msg || "OKX request failed", {
      error: response?.msg || "OKX request failed",
      code,
      response,
    });
  }
  return Array.isArray(response?.data) ? response.data[0] || null : null;
}

export function unwrapOkxApiRows(response: any) {
  const code = String(response?.code ?? "0");
  if (code !== "0") {
    throw requestError(502, response?.msg || "OKX request failed", {
      error: response?.msg || "OKX request failed",
      code,
      response,
    });
  }
  return Array.isArray(response?.data) ? response.data : [];
}

export async function fetchOkxTradeOrderRaw(
  exchange: any,
  exchangeCall: <T>(fn: () => Promise<T>) => Promise<T>,
  instId: string,
  identifiers: { ordId?: string | null; clOrdId?: string | null }
) {
  const request: Record<string, any> = { instId };
  if (identifiers.ordId) request.ordId = identifiers.ordId;
  else if (identifiers.clOrdId) request.clOrdId = identifiers.clOrdId;
  else throw new Error("Main order identifier is unavailable");
  return unwrapOkxApiRow(await retry(() => exchangeCall(() => (exchange as any).privateGetTradeOrder(request))));
}

export function buildOkxAttachAlgoOrds(options: { tpPrice?: any; slPrice?: any }) {
  const attachAlgo: Record<string, any> = {};
  if (options.tpPrice !== undefined && options.tpPrice !== null && String(options.tpPrice).trim() !== "") {
    attachAlgo.tpTriggerPx = String(options.tpPrice);
    attachAlgo.tpOrdPx = "-1";
    attachAlgo.tpTriggerPxType = "last";
  }
  if (options.slPrice !== undefined && options.slPrice !== null && String(options.slPrice).trim() !== "") {
    attachAlgo.slTriggerPx = String(options.slPrice);
    attachAlgo.slOrdPx = "-1";
    attachAlgo.slTriggerPxType = "last";
  }
  if (!attachAlgo.tpTriggerPx && !attachAlgo.slTriggerPx) return [];
  attachAlgo.attachAlgoClOrdId = `tp${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`.slice(0, 32);
  return [attachAlgo];
}

export function parseOkxErrorDetails(errorOrResponse: any) {
  const candidates = [
    errorOrResponse?.response?.data,
    errorOrResponse?.response,
    errorOrResponse?.payload?.response,
    errorOrResponse,
  ];
  const message = String(errorOrResponse?.message || errorOrResponse?.msg || "");
  const jsonStart = message.indexOf("{");
  const jsonEnd = message.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      candidates.push(JSON.parse(message.slice(jsonStart, jsonEnd + 1)));
    } catch {}
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = Array.isArray(candidate?.data) ? candidate.data[0] : candidate?.data;
    const okxCode = candidate?.code !== undefined ? String(candidate.code) : undefined;
    const okxMsg = candidate?.msg !== undefined ? String(candidate.msg) : undefined;
    const okxSCode = row?.sCode !== undefined ? String(row.sCode) : undefined;
    const okxSMsg = row?.sMsg !== undefined ? String(row.sMsg) : undefined;
    if (okxCode || okxMsg || okxSCode || okxSMsg) {
      return {
        okxCode,
        okxMsg,
        okxSCode,
        okxSMsg,
        okxResponse: candidate,
      };
    }
  }

  return {
    okxCode: undefined,
    okxMsg: undefined,
    okxSCode: undefined,
    okxSMsg: undefined,
    okxResponse: undefined,
  };
}

export function okxBar(timeframe: string) {
  const normalized = String(timeframe || "1h").toLowerCase();
  if (normalized === "1d") return "1D";
  if (normalized === "1w") return "1W";
  if (normalized === "4h") return "4H";
  if (normalized === "15m") return "15m";
  return "1H";
}

export async function okxPublicGet(pathname: string, params: Record<string, any>) {
  const request = async (useProxy: boolean) => axios.get(`https://www.okx.com${pathname}`, {
    params,
    timeout: 10000,
    headers: { "User-Agent": "CryptoQuantAI/1.0" },
    ...(useProxy && EXCHANGE_PROXY_URL.startsWith("http")
      ? { httpsAgent: new HttpsProxyAgent(EXCHANGE_PROXY_URL), proxy: false }
      : {}),
  });

  let response;
  try {
    const useProxy = Boolean(
      EXCHANGE_PROXY_URL &&
      !exchangeProxyBypassed &&
      EXCHANGE_PROXY_URL.startsWith("http") &&
      await ensureExchangeProxyAvailable()
    );
    response = await request(useProxy);
  } catch (error: any) {
    if (!isProxyConnectivityError(error)) throw error;
    disableExchangeProxy(error);
    response = await request(false);
  }

  if (response.data?.code && response.data.code !== "0") {
    throw new Error(response.data?.msg || JSON.stringify(response.data));
  }
  return response.data?.data || [];
}

export async function probeOkxPublicApiForAutoTrading() {
  const requestOptions: any = {
    timeout: 8000,
    headers: { "User-Agent": "CryptoQuantAI/1.0" },
  };

  if (EXCHANGE_PROXY_URL && !exchangeProxyBypassed && EXCHANGE_PROXY_URL.startsWith("http")) {
    requestOptions.httpsAgent = new HttpsProxyAgent(EXCHANGE_PROXY_URL);
    requestOptions.proxy = false;
  }

  const response = await axios.get("https://www.okx.com/api/v5/public/time", requestOptions);
  if (response.data?.code && String(response.data.code) !== "0") {
    throw new Error(response.data?.msg || "OKX public API returned an error");
  }
  return true;
}

export function formatExchangeConnectivityError(error: any) {
  return error?.cause?.message || error?.message || String(error || "OKX connectivity check failed");
}

export function isExchangeConnectivityFailure(error: any) {
  const details = [
    error?.message,
    error?.cause?.message,
    error?.stack,
    error?.cause?.stack,
  ].filter(Boolean).join(" ");
  return isExchangeConnectivityErrorDetails(details);
}

export function buildAutoTradingPreflightPayload(message: string, code: string) {
  return {
    error: message,
    code,
    exchangeConnectivity: getExchangeConnectivityStatus(),
  };
}

export function failAutoTradingPreflight(message: string, code: string) {
  updateAutoTradingStore({
    state: "stopped",
    nextRunAt: null,
    lastError: message,
  });
  pushAutoTradingLog(`Auto-trading preflight failed: ${message}`);
  throw requestError(503, message, buildAutoTradingPreflightPayload(message, code));
}

export async function assertAutoTradingExchangeReady(credentials?: Required<OkxCredentials>, sandbox = false) {
  let proxyReachable: boolean | null = null;
  let proxyReason: string | null = null;

  if (EXCHANGE_PROXY_URL && isLocalProxyUrl()) {
    try {
      const parsed = new URL(EXCHANGE_PROXY_URL);
      const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
      proxyReachable = await canConnectToProxy(parsed.hostname, port);
      if (!proxyReachable) {
        proxyReason = `Proxy listener ${parsed.host} is not reachable`;
        markExchangeConnectivityFailure(proxyReason, {
          okxPublic: false,
          okxPrivate: false,
          proxy: getExchangeProxyStatus(false, proxyReason),
        });
        failAutoTradingPreflight(
          `EXCHANGE_PROXY_URL points to ${redactProxyUrlForStatus(EXCHANGE_PROXY_URL)}, but that local proxy is not reachable. Start the proxy and try again, or clear EXCHANGE_PROXY_URL and restart this server.`,
          "EXCHANGE_PROXY_UNREACHABLE"
        );
      }
      restoreExchangeProxy("local proxy is reachable during auto-trading preflight");
    } catch (error: any) {
      if (error?.statusCode) throw error;
      proxyReason = `Invalid EXCHANGE_PROXY_URL: ${formatExchangeConnectivityError(error)}`;
      markExchangeConnectivityFailure(proxyReason, {
        okxPublic: false,
        okxPrivate: false,
        proxy: getExchangeProxyStatus(false, proxyReason),
      });
      failAutoTradingPreflight(proxyReason, "EXCHANGE_PROXY_INVALID");
    }
  } else if (EXCHANGE_PROXY_URL && exchangeProxyBypassed) {
    restoreExchangeProxy("retrying configured proxy during auto-trading preflight");
  }

  try {
    await withAutoTradingDataRetry("OKX public API preflight", () => probeOkxPublicApiForAutoTrading());
    markExchangeConnectivitySuccess({
      okxPublic: true,
      proxy: getExchangeProxyStatus(proxyReachable, proxyReason),
    });
  } catch (error: any) {
    const reason = formatExchangeConnectivityError(error);
    markExchangeConnectivityFailure(error, {
      okxPublic: false,
      okxPrivate: false,
      proxy: getExchangeProxyStatus(proxyReachable, proxyReason),
    });
    failAutoTradingPreflight(
      `OKX public API is not reachable before auto-trading start: ${reason}`,
      "OKX_PUBLIC_UNREACHABLE"
    );
  }

  if (!credentials) return;

  try {
    await fetchPrivateBalance(credentials, sandbox, true);
    markExchangeConnectivitySuccess({
      okxPublic: true,
      okxPrivate: true,
      proxy: getExchangeProxyStatus(proxyReachable, proxyReason),
    });
  } catch (error: any) {
    const reason = formatExchangeConnectivityError(error);
    markExchangeConnectivityFailure(error, {
      okxPublic: true,
      okxPrivate: false,
      proxy: getExchangeProxyStatus(proxyReachable, proxyReason),
    });
    failAutoTradingPreflight(
      `OKX private account API is not reachable before auto-trading start: ${reason}`,
      "OKX_PRIVATE_UNREACHABLE"
    );
  }
}

// --- Audit & Monitoring Store ---
