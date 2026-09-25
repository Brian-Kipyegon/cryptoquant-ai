import { normalizeDisplaySymbol } from "../../src/lib/tradingRuntime";
import { OkxCredentials } from "../auth/credentials";
import { firstNumber, normalizeNumber } from "../utils";
import { getPrivateExchange } from "./okx";
import { markExchangeConnectivitySuccess, prepareExchange, runWithExchangeProxyFallback, withAutoTradingDataRetry } from "./connectivity";

export function normalizeOkxBalance(balance: any) {
  const account = balance?.info?.data?.[0] || {};
  const details = Array.isArray(account.details) ? account.details : [];
  const usdt = details.find((item: any) => String(item?.ccy || "").toUpperCase() === "USDT") || {};
  const totalUSDT = firstNumber(
    usdt.eq,
    usdt.cashBal,
    usdt.eqUsd,
    account.totalEq,
    account.adjEq,
    balance?.total?.USDT,
    balance?.USDT?.total
  );
  const freeUSDT = firstNumber(
    usdt.availBal,
    usdt.availEq,
    account.availEq,
    balance?.free?.USDT,
    balance?.USDT?.free
  );
  const usedUSDT = firstNumber(
    balance?.used?.USDT,
    balance?.USDT?.used,
    usdt.frozenBal,
    Math.max(totalUSDT - freeUSDT, 0)
  );

  return {
    ...balance,
    total: { ...(balance?.total || {}), USDT: totalUSDT },
    free: { ...(balance?.free || {}), USDT: freeUSDT },
    used: { ...(balance?.used || {}), USDT: usedUSDT },
    equityUSDT: totalUSDT,
    availableUSDT: freeUSDT,
    usedUSDT,
  };
}

export function normalizeOkxPosition(position: any) {
  const info = position?.info || {};
  const rawContracts = [position?.contracts, info.pos, info.availPos]
    .map(normalizeNumber)
    .find((value) => value !== null && value !== 0) ?? 0;
  const contracts = Math.abs(rawContracts);
  const posSide = String(info.posSide || position?.side || "").toLowerCase();
  const side = posSide === "short"
    ? "short"
    : posSide === "long"
      ? "long"
      : rawContracts < 0 ? "short" : "long";
  const entryPrice = firstNumber(position?.entryPrice, info.avgPx);
  const markPrice = firstNumber(position?.markPrice, info.markPx, entryPrice);
  const unrealizedPnl = firstNumber(position?.unrealizedPnl, info.upl, info.uplRatio);
  const leverage = firstNumber(position?.leverage, info.lever);
  const notionalUsd = Math.abs(firstNumber(position?.notionalUsd, position?.notional, info.notionalUsd, contracts * markPrice));

  return {
    ...position,
    symbol: normalizeDisplaySymbol(position?.symbol || info.instId || ""),
    side,
    contracts,
    entryPrice,
    markPrice,
    unrealizedPnl,
    leverage,
    notionalUsd,
  };
}

export function getAccountTotalUSDT(balance: any) {
  return firstNumber(
    balance?.equityUSDT,
    balance?.availableUSDT,
    balance?.total?.USDT,
    balance?.free?.USDT,
    balance?.USDT?.total,
    balance?.USDT?.free,
    typeof balance?.total === "number" ? balance?.total : undefined,
    typeof balance?.free === "number" ? balance?.free : undefined
  );
}

export function countActivePositions(positions: any[]) {
  return positions.filter(pos => Math.abs(firstNumber(pos.contracts, pos.info?.pos, pos.info?.availPos)) > 0).length;
}

export function toModeLabel(sandbox: boolean) {
  return sandbox ? "okx-demo" : "okx-live";
}


export async function fetchPrivateBalance(credentials: Required<OkxCredentials>, sandbox: boolean, autoRetry = false) {
  const exchange = getPrivateExchange(credentials.apiKey, credentials.secret, credentials.password, sandbox);
  await prepareExchange(exchange);
  const operation = () => runWithExchangeProxyFallback(exchange, () => exchange.fetchBalance());
  const balance = autoRetry
    ? await withAutoTradingDataRetry("OKX private balance", operation)
    : await operation();
  if (autoRetry) markExchangeConnectivitySuccess({ okxPrivate: true });
  return normalizeOkxBalance(balance);
}

export async function fetchPrivatePositions(credentials: Required<OkxCredentials>, sandbox: boolean, autoRetry = false) {
  const exchange = getPrivateExchange(credentials.apiKey, credentials.secret, credentials.password, sandbox);
  await prepareExchange(exchange);
  const operation = () => runWithExchangeProxyFallback<any[]>(exchange, () => exchange.fetchPositions(undefined, { instType: "SWAP" }));
  const positions = autoRetry
    ? await withAutoTradingDataRetry("OKX private positions", operation)
    : await operation();
  if (autoRetry) markExchangeConnectivitySuccess({ okxPrivate: true });
  return positions.map(normalizeOkxPosition).filter((p: any) => Math.abs(Number(p.contracts || 0)) > 0);
}
