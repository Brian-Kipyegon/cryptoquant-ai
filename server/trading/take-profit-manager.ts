import crypto from "crypto";
import { normalizeDisplaySymbol } from "../../src/lib/tradingRuntime";
import { ManagedTakeProfitOrder, OrderLifecycleEvent, TakeProfitManagerSource } from "../types";
import { TP_MANAGER_COOLDOWN_MS, TP_MANAGER_INTERVAL_MS, TP_MANAGER_MAX_AMENDS, addOrderLifecycle, appStore, pushAutoTradingLog, sanitizeAutoTradingConfig } from "../stores/app-store";
import { TakeProfitConsensusResult, computeTakeProfitMinDelta, currentMacroSnapshot, evaluateTakeProfitConsensus, extractAttachedTpIdentifiers, normalizeManagedOrderSide, resolveEngineCredentials } from "./engine-helpers";
import { ensureFreshMacroData } from "../market/macro";
import { fetchOkxTradeOrderRaw, getPrivateExchange, normalizeOkxRawOrder, resolveOkxSwapMarket, retry, toOkxSwapInstId } from "../exchange/okx";
import { firstNumber, normalizeNumber } from "../utils";
import { normalizeOkxPosition } from "../exchange/okx-account";
import { prepareExchange, runWithExchangeProxyFallback } from "../exchange/connectivity";
import { updateTradeTakeProfitMetadata } from "../persistence/trading-db";

export class TakeProfitManager {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private managed = new Map<string, ManagedTakeProfitOrder>();

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TP_MANAGER_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  register(input: {
    tradeId: string;
    requestId: string;
    clientOrderId?: string;
    orderId?: string;
    symbol: string;
    side: string;
    sandbox: boolean;
    source?: string;
    strategyId?: string;
    tpPrice?: number | null;
    slPrice?: number | null;
    entryPrice?: number | null;
    verifiedOrder?: any;
    order?: any;
  }) {
    const side = normalizeManagedOrderSide(input.side);
    const initialTpPrice = normalizeNumber(input.tpPrice);
    const slPrice = normalizeNumber(input.slPrice);
    if (!side || !initialTpPrice || !slPrice) return;

    const source: TakeProfitManagerSource = input.source === "auto" ? "auto" : "manual";
    const activeConfig = sanitizeAutoTradingConfig(appStore.autoTrading.config);
    const normalizedSymbol = normalizeDisplaySymbol(input.symbol);
    if (!activeConfig) {
      updateTradeTakeProfitMetadata({
        id: input.tradeId,
        tpPrice: initialTpPrice,
        slPrice,
        initialTpPrice,
        currentTpPrice: initialTpPrice,
        tpAmendCount: 0,
        tpManagerStatus: "skipped",
        lastTpManagerReason: "Auto-trading config unavailable",
      });
      addOrderLifecycle({
        requestId: input.requestId,
        clientOrderId: input.clientOrderId,
        orderId: input.orderId,
        symbol: normalizedSymbol,
        side,
        status: "tp_skipped",
        source,
        strategyId: input.strategyId,
        sandbox: input.sandbox,
        operator: "tp-manager",
        details: { reason: "Auto-trading config unavailable" },
      });
      pushAutoTradingLog(`TP manager skipped ${normalizedSymbol}: auto-trading config unavailable`);
      return;
    }
    const profileExists = Boolean(activeConfig?.scanProfiles.some((profile) => profile.symbol === normalizedSymbol));
    if (!profileExists) {
      updateTradeTakeProfitMetadata({
        id: input.tradeId,
        tpPrice: initialTpPrice,
        slPrice,
        initialTpPrice,
        currentTpPrice: initialTpPrice,
        tpAmendCount: 0,
        tpManagerStatus: "skipped",
        lastTpManagerReason: `${normalizedSymbol} is not in active scan profiles`,
      });
      addOrderLifecycle({
        requestId: input.requestId,
        clientOrderId: input.clientOrderId,
        orderId: input.orderId,
        symbol: normalizedSymbol,
        side,
        status: "tp_skipped",
        source,
        strategyId: input.strategyId,
        sandbox: input.sandbox,
        operator: "tp-manager",
        details: { reason: `${normalizedSymbol} is not in active scan profiles` },
      });
      pushAutoTradingLog(`TP manager skipped ${normalizedSymbol}: symbol not in active scan profiles`);
      return;
    }

    const attached = extractAttachedTpIdentifiers(input.verifiedOrder || input.order);
    const managedOrder: ManagedTakeProfitOrder = {
      id: `tpmgr_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      tradeId: input.tradeId,
      requestId: input.requestId,
      clientOrderId: input.clientOrderId,
      orderId: input.orderId,
      symbol: normalizedSymbol,
      side,
      sandbox: input.sandbox,
      source,
      strategyId: input.strategyId,
      entryPrice: firstNumber(input.entryPrice, input.verifiedOrder?.average, input.verifiedOrder?.price, input.order?.average, input.order?.price),
      initialTpPrice,
      currentTpPrice: initialTpPrice,
      slPrice,
      tpAmendCount: 0,
      tpManagerStatus: attached.attachedTpAlgoId || attached.attachedTpAlgoClOrdId ? "active" : "pending_lookup",
      attachedTpAlgoId: attached.attachedTpAlgoId,
      attachedTpAlgoClOrdId: attached.attachedTpAlgoClOrdId,
      lastCheckedAt: null,
      lastAmendedAt: null,
      lastTpManagerReason: null,
      createdAt: Date.now(),
    };

    this.managed.set(managedOrder.tradeId, managedOrder);
    updateTradeTakeProfitMetadata({
      id: managedOrder.tradeId,
      tpPrice: managedOrder.currentTpPrice,
      slPrice: managedOrder.slPrice,
      initialTpPrice: managedOrder.initialTpPrice,
      currentTpPrice: managedOrder.currentTpPrice,
      tpAmendCount: managedOrder.tpAmendCount,
      tpManagerStatus: managedOrder.tpManagerStatus,
      lastTpManagerReason: null,
      attachedTpAlgoId: managedOrder.attachedTpAlgoId,
      attachedTpAlgoClOrdId: managedOrder.attachedTpAlgoClOrdId,
    });
    addOrderLifecycle({
      requestId: managedOrder.requestId,
      clientOrderId: managedOrder.clientOrderId,
      orderId: managedOrder.orderId,
      symbol: managedOrder.symbol,
      side: managedOrder.side,
      status: "tp_managed",
      source: managedOrder.source,
      strategyId: managedOrder.strategyId,
      sandbox: managedOrder.sandbox,
      operator: "tp-manager",
      details: {
        initialTpPrice: managedOrder.initialTpPrice,
        slPrice: managedOrder.slPrice,
        attachedTpAlgoId: managedOrder.attachedTpAlgoId,
        attachedTpAlgoClOrdId: managedOrder.attachedTpAlgoClOrdId,
      },
    });
    pushAutoTradingLog(`TP manager took over ${managedOrder.symbol} (${managedOrder.source})`);
  }

  private note(managedOrder: ManagedTakeProfitOrder, status: OrderLifecycleEvent["status"], reason: string, details: Record<string, any> = {}, force = false) {
    const nextManagerStatus = status === "tp_closed" ? "closed" : managedOrder.tpManagerStatus;
    const changed = managedOrder.lastTpManagerReason !== reason || managedOrder.tpManagerStatus !== nextManagerStatus;
    managedOrder.lastTpManagerReason = reason;
    managedOrder.tpManagerStatus = nextManagerStatus;
    if (!force && !changed) return;
    updateTradeTakeProfitMetadata({
      id: managedOrder.tradeId,
      tpPrice: managedOrder.currentTpPrice,
      slPrice: managedOrder.slPrice,
      initialTpPrice: managedOrder.initialTpPrice,
      currentTpPrice: managedOrder.currentTpPrice,
      tpAmendCount: managedOrder.tpAmendCount,
      tpManagerStatus: managedOrder.tpManagerStatus,
      lastTpManagerReason: managedOrder.lastTpManagerReason,
      attachedTpAlgoId: managedOrder.attachedTpAlgoId,
      attachedTpAlgoClOrdId: managedOrder.attachedTpAlgoClOrdId,
    });
    addOrderLifecycle({
      requestId: managedOrder.requestId,
      clientOrderId: managedOrder.clientOrderId,
      orderId: managedOrder.orderId,
      symbol: managedOrder.symbol,
      side: managedOrder.side,
      status,
      source: managedOrder.source,
      strategyId: managedOrder.strategyId,
      sandbox: managedOrder.sandbox,
      operator: "tp-manager",
      details: {
        currentTpPrice: managedOrder.currentTpPrice,
        slPrice: managedOrder.slPrice,
        tpAmendCount: managedOrder.tpAmendCount,
        tpManagerStatus: managedOrder.tpManagerStatus,
        reason,
        ...details,
      },
    });
    pushAutoTradingLog(reason);
  }

  private async refreshAttachedIdentifiers(managedOrder: ManagedTakeProfitOrder, exchange: any, exchangeCall: <T>(fn: () => Promise<T>) => Promise<T>) {
    if ((managedOrder.attachedTpAlgoId || managedOrder.attachedTpAlgoClOrdId) || !managedOrder.orderId) return;
    try {
      const resolvedMarket = await resolveOkxSwapMarket(managedOrder.symbol, exchange);
      const refreshedRaw = await fetchOkxTradeOrderRaw(exchange, exchangeCall, resolvedMarket.instId, {
        ordId: managedOrder.orderId,
        clOrdId: managedOrder.clientOrderId,
      });
      const refreshed = normalizeOkxRawOrder(refreshedRaw, resolvedMarket);
      const attached = extractAttachedTpIdentifiers(refreshed);
      if (attached.attachedTpAlgoId || attached.attachedTpAlgoClOrdId) {
        managedOrder.attachedTpAlgoId = attached.attachedTpAlgoId;
        managedOrder.attachedTpAlgoClOrdId = attached.attachedTpAlgoClOrdId;
        managedOrder.tpManagerStatus = "active";
        updateTradeTakeProfitMetadata({
          id: managedOrder.tradeId,
          attachedTpAlgoId: managedOrder.attachedTpAlgoId,
          attachedTpAlgoClOrdId: managedOrder.attachedTpAlgoClOrdId,
          tpManagerStatus: managedOrder.tpManagerStatus,
        });
      }
    } catch {
      managedOrder.tpManagerStatus = "pending_lookup";
    }
  }

  private async amendTakeProfit(managedOrder: ManagedTakeProfitOrder, newTpPrice: number, exchange: any, exchangeCall: <T>(fn: () => Promise<T>) => Promise<T>) {
    const attachPayload: Record<string, any> = {
      newTpTriggerPx: String(newTpPrice),
      newTpOrdPx: "-1",
      newTpTriggerPxType: "last",
    };
    if (managedOrder.attachedTpAlgoId) attachPayload.attachAlgoId = managedOrder.attachedTpAlgoId;
    if (managedOrder.attachedTpAlgoClOrdId) attachPayload.attachAlgoClOrdId = managedOrder.attachedTpAlgoClOrdId;
    if (!attachPayload.attachAlgoId && !attachPayload.attachAlgoClOrdId) {
      throw new Error("Attached TP algo identifier is unavailable");
    }

    const request: Record<string, any> = {
      instId: toOkxSwapInstId(managedOrder.symbol),
      reqId: `tpamend_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      cxlOnFail: false,
      attachAlgoOrds: [attachPayload],
    };
    if (managedOrder.orderId) request.ordId = managedOrder.orderId;
    else if (managedOrder.clientOrderId) request.clOrdId = managedOrder.clientOrderId;
    else throw new Error("Main order identifier is unavailable");

    return retry(() => exchangeCall(() => (exchange as any).privatePostTradeAmendOrder(request)));
  }

  private async tick() {
    if (this.inFlight || this.managed.size === 0) return;
    this.inFlight = true;
    try {
      await ensureFreshMacroData();
      const macroSnapshot = currentMacroSnapshot();
      const consensusCache = new Map<string, Promise<TakeProfitConsensusResult>>();
      const positionCache = new Map<string, Promise<any[]>>();

      for (const managedOrder of [...this.managed.values()]) {
        const credentials = resolveEngineCredentials(managedOrder.sandbox);
        if (!credentials) {
          managedOrder.tpManagerStatus = "skipped";
          this.note(
            managedOrder,
            "tp_skipped",
            `TP manager skipped ${managedOrder.symbol}: missing ${managedOrder.sandbox ? "demo" : "live"} credentials`
          );
          this.managed.delete(managedOrder.tradeId);
          continue;
        }

        const config = sanitizeAutoTradingConfig(appStore.autoTrading.config);
        if (!config) {
          this.note(managedOrder, "tp_skipped", `TP manager skipped ${managedOrder.symbol}: auto-trading config unavailable`);
          continue;
        }

        const profile = config.scanProfiles.find((item) => item.symbol === managedOrder.symbol);
        if (!profile) {
          managedOrder.tpManagerStatus = "skipped";
          this.note(managedOrder, "tp_skipped", `TP manager skipped ${managedOrder.symbol}: symbol removed from active scan profiles`);
          this.managed.delete(managedOrder.tradeId);
          continue;
        }

        const exchange = getPrivateExchange(credentials.apiKey, credentials.secret, credentials.password, managedOrder.sandbox);
        await prepareExchange(exchange);
        const exchangeCall = <T,>(fn: () => Promise<T>) => runWithExchangeProxyFallback(exchange, fn);
        const positionKey = String(managedOrder.sandbox);
        if (!positionCache.has(positionKey)) {
          positionCache.set(positionKey, exchangeCall(() => exchange.fetchPositions(undefined, { instType: "SWAP" }))
            .then((positions: any[]) => positions.map(normalizeOkxPosition)));
        }
        const positions = (await positionCache.get(positionKey)!).filter((item: any) => item.symbol === managedOrder.symbol);
        const matchingPosition = positions.find((item: any) => {
          const positionSide = normalizeManagedOrderSide(item.side);
          return positionSide === managedOrder.side && Math.abs(Number(item.contracts || 0)) > 0;
        });

        if (!matchingPosition) {
          this.note(managedOrder, "tp_closed", `TP manager released ${managedOrder.symbol}: position no longer open`);
          this.managed.delete(managedOrder.tradeId);
          continue;
        }

        const positionEntryPrice = firstNumber(matchingPosition.entryPrice, managedOrder.entryPrice);
        const currentPrice = firstNumber(matchingPosition.markPrice, managedOrder.currentTpPrice, managedOrder.initialTpPrice);
        if (positionEntryPrice > 0) managedOrder.entryPrice = positionEntryPrice;
        managedOrder.lastCheckedAt = Date.now();

        if (managedOrder.tpAmendCount >= TP_MANAGER_MAX_AMENDS) {
          managedOrder.tpManagerStatus = "skipped";
          this.note(
            managedOrder,
            "tp_skipped",
            `TP manager skipped ${managedOrder.symbol}: amend limit ${TP_MANAGER_MAX_AMENDS} reached`
          );
          this.managed.delete(managedOrder.tradeId);
          continue;
        }

        if (managedOrder.lastAmendedAt && Date.now() - managedOrder.lastAmendedAt < TP_MANAGER_COOLDOWN_MS) {
          continue;
        }

        if (!managedOrder.attachedTpAlgoId && !managedOrder.attachedTpAlgoClOrdId) {
          await this.refreshAttachedIdentifiers(managedOrder, exchange, exchangeCall);
          if (!managedOrder.attachedTpAlgoId && !managedOrder.attachedTpAlgoClOrdId) {
            this.note(
              managedOrder,
              "tp_skipped",
              `TP manager skipped ${managedOrder.symbol}: attached TP identifier unavailable`
            );
            continue;
          }
        }

        const consensusKey = `${managedOrder.symbol}:${managedOrder.source}`;
        if (!consensusCache.has(consensusKey)) {
          consensusCache.set(consensusKey, evaluateTakeProfitConsensus(config, managedOrder.symbol, macroSnapshot));
        }
        const consensus = await consensusCache.get(consensusKey)!;
        if (consensus.status === "error") {
          this.note(managedOrder, "tp_failed", `TP manager failed ${managedOrder.symbol}: ${consensus.reason}`);
          continue;
        }
        if (consensus.status === "timeframe_conflict") {
          this.note(managedOrder, "tp_skipped", `TP manager skipped ${managedOrder.symbol}: ${consensus.reason}`);
          continue;
        }
        if (consensus.status === "no_signal") {
          this.note(managedOrder, "tp_skipped", `TP manager skipped ${managedOrder.symbol}: ${consensus.reason}`);
          continue;
        }

        if (consensus.candidate.side !== managedOrder.side) {
          this.note(
            managedOrder,
            "tp_skipped",
            `TP manager skipped ${managedOrder.symbol}: latest consensus turned ${consensus.candidate.side.toUpperCase()}`
          );
          continue;
        }

        const nextTpPrice = normalizeNumber(consensus.candidate.analysis?.tp_price);
        if (!nextTpPrice || nextTpPrice <= 0) {
          this.note(managedOrder, "tp_skipped", `TP manager skipped ${managedOrder.symbol}: strategy did not provide a valid TP`);
          continue;
        }

        const favorableMove = managedOrder.side === "buy"
          ? nextTpPrice > managedOrder.currentTpPrice
          : nextTpPrice < managedOrder.currentTpPrice;
        if (!favorableMove) {
          this.note(
            managedOrder,
            "tp_skipped",
            `TP manager skipped ${managedOrder.symbol}: new TP ${nextTpPrice} is not better than current ${managedOrder.currentTpPrice}`
          );
          continue;
        }

        const minDelta = computeTakeProfitMinDelta(currentPrice, managedOrder.entryPrice, managedOrder.slPrice);
        if (Math.abs(nextTpPrice - managedOrder.currentTpPrice) < minDelta) {
          this.note(
            managedOrder,
            "tp_skipped",
            `TP manager skipped ${managedOrder.symbol}: TP delta below threshold`,
            {
              nextTpPrice,
              currentTpPrice: managedOrder.currentTpPrice,
              minDelta,
            }
          );
          continue;
        }

        try {
          await this.amendTakeProfit(managedOrder, nextTpPrice, exchange, exchangeCall);
          managedOrder.currentTpPrice = nextTpPrice;
          managedOrder.tpAmendCount += 1;
          managedOrder.lastAmendedAt = Date.now();
          managedOrder.tpManagerStatus = "active";
          managedOrder.lastTpManagerReason = `TP amended to ${nextTpPrice}`;
          updateTradeTakeProfitMetadata({
            id: managedOrder.tradeId,
            tpPrice: managedOrder.currentTpPrice,
            slPrice: managedOrder.slPrice,
            initialTpPrice: managedOrder.initialTpPrice,
            currentTpPrice: managedOrder.currentTpPrice,
            tpAmendCount: managedOrder.tpAmendCount,
            tpManagerStatus: managedOrder.tpManagerStatus,
            lastTpManagerReason: managedOrder.lastTpManagerReason,
            attachedTpAlgoId: managedOrder.attachedTpAlgoId,
            attachedTpAlgoClOrdId: managedOrder.attachedTpAlgoClOrdId,
          });
          addOrderLifecycle({
            requestId: managedOrder.requestId,
            clientOrderId: managedOrder.clientOrderId,
            orderId: managedOrder.orderId,
            symbol: managedOrder.symbol,
            side: managedOrder.side,
            status: "tp_amended",
            source: managedOrder.source,
            strategyId: managedOrder.strategyId,
            sandbox: managedOrder.sandbox,
            operator: "tp-manager",
            details: {
              currentTpPrice: managedOrder.currentTpPrice,
              initialTpPrice: managedOrder.initialTpPrice,
              tpAmendCount: managedOrder.tpAmendCount,
              timeframe: consensus.candidate.timeframe,
              strategyId: consensus.candidate.strategyId,
              confidence: consensus.candidate.analysis?.confidence,
            },
          });
          pushAutoTradingLog(`TP amended ${managedOrder.symbol} -> ${nextTpPrice} (${consensus.candidate.timeframe}/${consensus.candidate.strategyId})`);
        } catch (error: any) {
          const message = error?.message || String(error || "Unknown amend error");
          this.note(managedOrder, "tp_failed", `TP manager failed ${managedOrder.symbol}: ${message}`, {
            nextTpPrice,
            currentTpPrice: managedOrder.currentTpPrice,
          }, true);
        }
      }
    } catch (error: any) {
      const message = error?.message || String(error || "Unknown TP manager error");
      pushAutoTradingLog(`TP manager cycle failed: ${message}`);
    } finally {
      this.inFlight = false;
    }
  }
}


export const takeProfitManager = new TakeProfitManager();
