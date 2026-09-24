import net from "net";
import ccxt from "ccxt";
import { OKX_AUTO_DATA_REQUEST_TIMEOUT_MS, createReconnectSchedule, getDataRetryDelayMs, isExchangeConnectivityErrorDetails } from "../../src/lib/exchangeReconnect";
import { formatExchangeConnectivityError, isExchangeConnectivityFailure } from "./okx";
import { pushAutoTradingLog } from "../stores/app-store";

export const EXCHANGE_PROXY_URL = process.env.EXCHANGE_PROXY_URL || "";
export const EXCHANGE_PROXY_MATCH_TOKENS = (() => {
  const tokens = new Set<string>();
  if (EXCHANGE_PROXY_URL) tokens.add(EXCHANGE_PROXY_URL);
  try {
    if (EXCHANGE_PROXY_URL) {
      const parsed = new URL(EXCHANGE_PROXY_URL);
      if (parsed.host) tokens.add(parsed.host);
      if (parsed.hostname) tokens.add(parsed.hostname);
      if (parsed.port) tokens.add(parsed.port);
    }
  } catch {}
  return Array.from(tokens).filter(Boolean);
})();
export let exchangeProxyBypassed = false;
export let exchangeProxyAvailability: Promise<boolean> | null = null;

export type ExchangeProxyStatus = {
  configured: boolean;
  url: string | null;
  local: boolean;
  reachable: boolean | null;
  bypassed: boolean;
  reason?: string | null;
};

export type ExchangeConnectivityStatus = {
  checkedAt: number | null;
  lastCheckedAt: number | null;
  okxPublic: boolean | null;
  okxPrivate: boolean | null;
  /** Reachability of the market data venue (DATA_EXCHANGE). */
  marketData?: boolean | null;
  marketDataExchange?: string | null;
  error: string | null;
  lastError: string | null;
  nextRetryAt: number | null;
  consecutiveFailures: number;
  proxy: ExchangeProxyStatus;
};

export let lastExchangeConnectivityStatus: ExchangeConnectivityStatus | null = null;

export function redactProxyUrlForStatus(url: string) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return url;
  }
}

export function getExchangeProxyStatus(reachable: boolean | null = null, reason: string | null = null): ExchangeProxyStatus {
  return {
    configured: Boolean(EXCHANGE_PROXY_URL),
    url: redactProxyUrlForStatus(EXCHANGE_PROXY_URL),
    local: Boolean(EXCHANGE_PROXY_URL && isLocalProxyUrl()),
    reachable,
    bypassed: exchangeProxyBypassed,
    reason,
  };
}

export function getExchangeConnectivityStatus() {
  return lastExchangeConnectivityStatus || {
    checkedAt: null,
    lastCheckedAt: null,
    okxPublic: null,
    okxPrivate: null,
    marketData: null,
    marketDataExchange: null,
    error: null,
    lastError: null,
    nextRetryAt: null,
    consecutiveFailures: 0,
    proxy: getExchangeProxyStatus(),
  };
}

export function updateExchangeConnectivityStatus(patch: Partial<ExchangeConnectivityStatus>) {
  const previous = getExchangeConnectivityStatus();
  const checkedAt = patch.checkedAt ?? Date.now();
  lastExchangeConnectivityStatus = {
    ...previous,
    ...patch,
    checkedAt,
    lastCheckedAt: patch.lastCheckedAt ?? checkedAt,
    proxy: patch.proxy ?? previous.proxy ?? getExchangeProxyStatus(),
  };
  return lastExchangeConnectivityStatus;
}

export function markExchangeConnectivitySuccess(patch: Partial<Pick<ExchangeConnectivityStatus, "okxPublic" | "okxPrivate" | "marketData" | "marketDataExchange" | "proxy">> = {}) {
  return updateExchangeConnectivityStatus({
    ...patch,
    error: null,
    lastError: null,
    nextRetryAt: null,
    consecutiveFailures: 0,
  });
}

export function markExchangeConnectivityFailure(error: any, patch: Partial<Pick<ExchangeConnectivityStatus, "okxPublic" | "okxPrivate" | "marketData" | "marketDataExchange" | "proxy">> = {}) {
  const previous = getExchangeConnectivityStatus();
  const message = formatExchangeConnectivityError(error);
  const consecutiveFailures = Math.max(1, Number(previous.consecutiveFailures || 0) + 1);
  const schedule = createReconnectSchedule(consecutiveFailures);
  return updateExchangeConnectivityStatus({
    ...patch,
    error: message,
    lastError: message,
    consecutiveFailures,
    nextRetryAt: schedule.nextRetryAt,
  });
}

export function applyExchangeProxy(exchange: any) {
  if (!EXCHANGE_PROXY_URL || exchangeProxyBypassed) return;
  if (EXCHANGE_PROXY_URL.startsWith("socks")) {
    exchange.socksProxy = EXCHANGE_PROXY_URL;
    exchange.wsSocksProxy = EXCHANGE_PROXY_URL;
  } else if (EXCHANGE_PROXY_URL.startsWith("http://") || EXCHANGE_PROXY_URL.startsWith("https://")) {
    exchange.httpsProxy = EXCHANGE_PROXY_URL;
    exchange.wssProxy = EXCHANGE_PROXY_URL;
  } else {
    console.warn(`[Proxy] Unsupported EXCHANGE_PROXY_URL format: ${EXCHANGE_PROXY_URL}`);
  }
}

export const exchangeProxyReady = new WeakMap<object, Promise<void>>();

export function clearExchangeProxy(exchange: any) {
  if (!exchange) return;
  for (const key of ["httpProxy", "httpsProxy", "socksProxy", "wsProxy", "wssProxy", "wsSocksProxy"]) {
    if (key in exchange) {
      exchange[key] = undefined;
    }
  }
}

export function isLocalProxyUrl() {
  try {
    const parsed = new URL(EXCHANGE_PROXY_URL);
    return ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export async function canConnectToProxy(host: string, port: number, timeoutMs = 800) {
  return await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

export function isProxyConnectivityError(error: any) {
  if (!EXCHANGE_PROXY_URL || exchangeProxyBypassed) return false;
  const details = [
    error?.message,
    error?.cause?.message,
    error?.stack,
    error?.cause?.stack,
  ].filter(Boolean).join(" ");
  if (!details) return false;
  if (isExchangeConnectivityErrorDetails(details)) return true;
  return EXCHANGE_PROXY_MATCH_TOKENS.some(token => details.includes(token));
}

export function disableExchangeProxy(error?: any) {
  if (!EXCHANGE_PROXY_URL || exchangeProxyBypassed) return;
  exchangeProxyBypassed = true;
  exchangeProxyAvailability = Promise.resolve(false);
  clearExchangeProxy(publicExchange);
  for (const exchange of privateExchanges.values()) {
    clearExchangeProxy(exchange);
  }
  const message = error?.cause?.message || error?.message || String(error || "unknown proxy error");
  console.warn(`[Proxy] ${EXCHANGE_PROXY_URL} unavailable, falling back to direct OKX requests. ${message}`);
}

export function restoreExchangeProxy(reason?: string) {
  if (!EXCHANGE_PROXY_URL || !exchangeProxyBypassed) return;
  exchangeProxyBypassed = false;
  exchangeProxyAvailability = null;
  applyExchangeProxy(publicExchange);
  for (const exchange of privateExchanges.values()) {
    applyExchangeProxy(exchange);
  }
  console.warn(
    `[Proxy] ${redactProxyUrlForStatus(EXCHANGE_PROXY_URL)} restored${reason ? `: ${reason}` : ""}`
  );
}

export async function ensureExchangeProxyAvailable() {
  if (!EXCHANGE_PROXY_URL || exchangeProxyBypassed) return false;
  if (!isLocalProxyUrl()) return true;
  if (!exchangeProxyAvailability) {
    exchangeProxyAvailability = (async () => {
      try {
        const parsed = new URL(EXCHANGE_PROXY_URL);
        const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
        const reachable = await canConnectToProxy(parsed.hostname, port);
        if (!reachable) {
          disableExchangeProxy(`Proxy listener ${parsed.host} is not reachable`);
          return false;
        }
        return true;
      } catch {
        return true;
      }
    })();
  }
  return await exchangeProxyAvailability;
}

export async function prepareExchange(exchange: any) {
  if (!EXCHANGE_PROXY_URL || exchangeProxyBypassed || typeof exchange.loadProxyModules !== "function") return;
  if (!(await ensureExchangeProxyAvailable())) {
    clearExchangeProxy(exchange);
    return;
  }
  if (!exchangeProxyReady.has(exchange)) {
    exchangeProxyReady.set(exchange, exchange.loadProxyModules().then(() => {
      console.log(`[Proxy] Exchange traffic routed through ${EXCHANGE_PROXY_URL}`);
    }));
  }
  await exchangeProxyReady.get(exchange);
}

export async function runWithExchangeProxyFallback<T>(exchange: any, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (!isProxyConnectivityError(error)) throw error;
    disableExchangeProxy(error);
    clearExchangeProxy(exchange);
    return await operation();
  }
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function restoreLocalExchangeProxyIfReachable(reason: string) {
  if (!EXCHANGE_PROXY_URL || !exchangeProxyBypassed || !isLocalProxyUrl()) return;
  try {
    const parsed = new URL(EXCHANGE_PROXY_URL);
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    const reachable = await canConnectToProxy(parsed.hostname, port);
    if (reachable) {
      restoreExchangeProxy(reason);
    }
  } catch {}
}

export async function withAutoTradingDataRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    try {
      await restoreLocalExchangeProxyIfReachable(`retrying ${label}`);
      return await operation();
    } catch (error: any) {
      lastError = error;
      if (!isExchangeConnectivityFailure(error) || attempt >= 3) throw error;
      const delayMs = getDataRetryDelayMs(attempt);
      pushAutoTradingLog(`${label} connection failed, retrying in ${Math.round(delayMs / 1000)}s: ${error?.message || String(error)}`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}


export const publicExchange = new (ccxt as any).okx({
  enableRateLimit: true,
  timeout: OKX_AUTO_DATA_REQUEST_TIMEOUT_MS,
  options: {
    defaultType: "swap",
    fetchMarkets: { types: ["swap", "spot"] },
  },
});
applyExchangeProxy(publicExchange);
export const privateExchanges = new Map<string, any>();
