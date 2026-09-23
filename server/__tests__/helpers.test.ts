import { describe, expect, it } from "vitest";
import { ceilToStep, normalizeOkxOrderStatus, okxBar, toCcxtLikeSwapSymbol, toCcxtSymbol, toOkxSwapInstId } from "../exchange/okx";
import { calculateShadowPnl, timeframeToMs } from "../persistence/trading-db";
import { floorToStep, normalizeNumber } from "../utils";
import { nextAutoTradingDelay } from "../trading/auto-trading-cycle";
import { AUTO_TRADING_MAX_DELAY_MS, AUTO_TRADING_MIN_DELAY_MS } from "../stores/app-store";

describe("symbol conversion", () => {
  it("converts display symbols to CCXT swap symbols", () => {
    expect(toCcxtSymbol("BTC/USDT")).toBe("BTC/USDT:USDT");
    expect(toCcxtSymbol("eth-usdt")).toBe("ETH/USDT:USDT");
    expect(toCcxtSymbol("SOL-USDT-SWAP")).toBe("SOL/USDT:USDT");
    expect(toCcxtSymbol("DOGE/USDT:USDT")).toBe("DOGE/USDT:USDT");
    expect(toCcxtSymbol("")).toBe("BTC/USDT:USDT");
  });

  it("converts to and from OKX swap instrument ids", () => {
    expect(toOkxSwapInstId("BTC/USDT")).toBe("BTC-USDT-SWAP");
    expect(toOkxSwapInstId("eth/usdt:usdt")).toBe("ETH-USDT-SWAP");
    expect(toOkxSwapInstId("SOL-USDT-SWAP")).toBe("SOL-USDT-SWAP");
    expect(toCcxtLikeSwapSymbol("SOL-USDT-SWAP")).toBe("SOL/USDT:USDT");
  });
});

describe("OKX helpers", () => {
  it("maps timeframes to OKX bars", () => {
    expect(okxBar("15m")).toBe("15m");
    expect(okxBar("4h")).toBe("4H");
    expect(okxBar("1d")).toBe("1D");
    expect(okxBar("unknown")).toBe("1H");
  });

  it("normalizes order states", () => {
    expect(normalizeOkxOrderStatus("filled")).toBe("closed");
    expect(normalizeOkxOrderStatus("mmp_canceled")).toBe("canceled");
    expect(normalizeOkxOrderStatus("partially_filled")).toBe("open");
    expect(normalizeOkxOrderStatus(null)).toBe("unknown");
  });
});

describe("numeric helpers", () => {
  it("rounds to exchange steps", () => {
    expect(floorToStep(1.2345, 0.01)).toBe(1.23);
    expect(ceilToStep(1.2301, 0.01)).toBe(1.24);
    expect(floorToStep(-1, 0.01)).toBe(0);
    expect(floorToStep(5, 0)).toBe(5);
  });

  it("parses numbers defensively", () => {
    expect(normalizeNumber("1.5")).toBe(1.5);
    expect(normalizeNumber(undefined)).toBeNull();
    expect(normalizeNumber("abc")).toBeNull();
  });

  it("converts timeframes to milliseconds", () => {
    expect(timeframeToMs("15m")).toBe(900_000);
    expect(timeframeToMs("4h")).toBe(14_400_000);
    expect(timeframeToMs("1d")).toBe(86_400_000);
    expect(timeframeToMs("garbage")).toBe(3_600_000);
  });
});

describe("shadow trading", () => {
  it("computes PnL by side and ignores invalid inputs", () => {
    expect(calculateShadowPnl("buy", 2, 100, 110)).toBe(20);
    expect(calculateShadowPnl("SELL", 2, 100, 110)).toBe(-20);
    expect(calculateShadowPnl("buy", 0, 100, 110)).toBe(0);
    expect(calculateShadowPnl("buy", 1, null, 110)).toBe(0);
  });

  it("keeps the scan delay within bounds", () => {
    expect(nextAutoTradingDelay(1)).toBe(5 * 60_000);
    expect(nextAutoTradingDelay(100)).toBe(AUTO_TRADING_MAX_DELAY_MS);
    expect(nextAutoTradingDelay(0, AUTO_TRADING_MIN_DELAY_MS)).toBe(5 * 60_000);
  });
});
