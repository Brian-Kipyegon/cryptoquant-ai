import crypto from "crypto";
import { normalizeDisplaySymbol } from "../../src/lib/tradingRuntime";
import { STRATEGY_VERSION, addToAudit, auditStore } from "../stores/audit-store";
import { addOrderLifecycle, pushAutoTradingLog } from "../stores/app-store";
import { buildOkxAttachAlgoOrds, fetchOkxTradeOrderRaw, formatToStepString, getPrivateExchange, normalizeOkxRawOrder, parseOkxErrorDetails, resolveOkxSwapMarket, retry, unwrapOkxApiRow } from "../exchange/okx";
import { fetchOkxExecutionTickerSnapshot } from "../market/public-data";
import { firstNumber, floorToStep } from "../utils";
import { prepareExchange, runWithExchangeProxyFallback } from "../exchange/connectivity";
import { recordTrade } from "../persistence/trading-db";
import { requestError } from "../http-errors";
import { resolveOkxCredentials } from "../auth/credentials";
import { takeProfitManager } from "../trading/take-profit-manager";
import { toModeLabel } from "../exchange/okx-account";

export async function submitOkxOrder(orderRequest: any, operator = "unknown") {
  const {
    symbol,
    side,
    amount,
    type = "market",
    price,
    leverage = 1,
    clientOrderId,
    tpPrice,
    slPrice,
    sandbox = false,
    strategyId,
    source,
    regime,
    regimeScore,
    macroGate,
    macroScore,
    entryReason,
    features,
    stopDistance,
    ruleCompliant,
    aiVerdict,
  } = orderRequest;
  const isSandbox = String(sandbox) === "true" || sandbox === true;
  const requestId = `ordreq_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const amountType = orderRequest.amountType || "coin";
  const targetSymbol = symbol || "BTC/USDT";
  const displaySymbol = normalizeDisplaySymbol(targetSymbol);
  const decisionContext = {
    regime,
    regimeScore,
    macroGate,
    macroScore,
    entryReason,
    features,
    stopDistance,
    ruleCompliant,
    aiVerdict,
  };
  let orderDiagnostics: Record<string, any> = {};

  addOrderLifecycle({
    requestId,
    clientOrderId,
    symbol: displaySymbol,
    side,
    amount,
    amountType,
    status: "accepted",
    source,
    strategyId,
    sandbox: isSandbox,
    operator,
    details: { type, leverage, tpPrice, slPrice, decisionContext },
  });
  recordTrade({
    id: clientOrderId || requestId,
    requestId,
    clientOrderId,
    symbol: displaySymbol,
    side,
    amount,
    amountType,
    status: "accepted",
    mode: toModeLabel(isSandbox),
    source,
    strategyId,
    ...decisionContext,
    leverage,
    orderType: type,
    tpPrice,
    slPrice,
    raw: { request: orderRequest, operator },
  });

  const credentials = resolveOkxCredentials(orderRequest, isSandbox);
  if (!credentials) {
    addOrderLifecycle({
      requestId,
      clientOrderId,
      symbol: displaySymbol,
      side,
      amount,
      amountType,
      status: "failed",
      source,
      strategyId,
      sandbox: isSandbox,
      operator,
      details: { reason: "missing_okx_credentials" },
    });
    recordTrade({
      id: clientOrderId || requestId,
      requestId,
      clientOrderId,
      symbol: displaySymbol,
      side,
      amount,
      amountType,
      status: "failed",
      mode: toModeLabel(isSandbox),
      source,
      strategyId,
      ...decisionContext,
      leverage,
      orderType: type,
      tpPrice,
      slPrice,
      raw: { error: "missing_okx_credentials" },
    });
    throw requestError(400, "Missing OKX credentials", { error: "Missing OKX credentials" });
  }

  try {
    const exchange = getPrivateExchange(credentials.apiKey, credentials.secret, credentials.password, isSandbox);
    await prepareExchange(exchange);
    const exchangeCall = <T,>(fn: () => Promise<T>) => runWithExchangeProxyFallback(exchange, fn);
    await exchangeCall(() => exchange.loadMarkets());
    const resolvedMarket = await resolveOkxSwapMarket(targetSymbol, exchange);
    const minContracts = Math.max(resolvedMarket.minSz, resolvedMarket.lotSz);
    const requestedAmountUsdt = amountType === "usdt" ? Number(amount || 0) : null;
    let effectiveAmountUsdt = requestedAmountUsdt;
    let minRequiredUsdt: number | null = null;
    let autoUpsizedToMinimum = false;
    let preciseAmount: number;
    let livePriceForSizing: number | null = null;

    try {
      const leverageResponse: any = await retry(() => exchangeCall(() => (exchange as any).privatePostAccountSetLeverage({
        instId: resolvedMarket.instId,
        lever: String(leverage),
        mgnMode: "isolated",
      })));
      const leverageRow = unwrapOkxApiRow(leverageResponse);
      const leverageCode = String(leverageRow?.sCode ?? "0");
      if (leverageCode !== "0") {
        throw new Error(leverageRow?.sMsg || leverageResponse?.msg || "Unknown leverage error");
      }
    } catch (levError: any) {
      throw requestError(500, `Failed to set leverage: ${levError.message}`, {
        error: `Failed to set leverage: ${levError.message}`,
        code: levError.constructor?.name || "Error",
        resolvedMarketId: resolvedMarket.resolvedMarketId,
        resolvedMarketSymbol: resolvedMarket.resolvedMarketSymbol,
      });
    }

    if (amountType === "usdt") {
      // Size with the execution venue's price, not the market data venue's.
      const ticker = await fetchOkxExecutionTickerSnapshot(displaySymbol);
      const livePrice = ticker.last || 0;
      if (livePrice === 0) throw requestError(500, "Could not fetch current price for amount calculation", {
        error: "Could not fetch current price for amount calculation",
        resolvedMarketId: resolvedMarket.resolvedMarketId,
        resolvedMarketSymbol: resolvedMarket.resolvedMarketSymbol,
      });
      livePriceForSizing = livePrice;
      minRequiredUsdt = (livePrice * resolvedMarket.ctVal * minContracts) / Math.max(1, leverage);
      effectiveAmountUsdt = requestedAmountUsdt;
      if (source === "auto" && Number.isFinite(effectiveAmountUsdt) && Number.isFinite(minRequiredUsdt) && effectiveAmountUsdt! < minRequiredUsdt!) {
        effectiveAmountUsdt = minRequiredUsdt;
        autoUpsizedToMinimum = true;
      }
      const rawSz = (Number(effectiveAmountUsdt || 0) * leverage) / (livePrice * resolvedMarket.ctVal);
      preciseAmount = floorToStep(rawSz, resolvedMarket.lotSz);
      if (source === "auto" && preciseAmount > 0 && preciseAmount < minContracts) {
        preciseAmount = minContracts;
        autoUpsizedToMinimum = true;
      }
      preciseAmount = Number(formatToStepString(preciseAmount, resolvedMarket.lotSz));
      if (preciseAmount <= 0 || preciseAmount < minContracts) {
        throw requestError(400, "Investment amount too small for minimum contract step", {
          error: "Investment amount too small for minimum contract step",
          requestedAmountUsdt,
          minRequiredUsdt,
          effectiveAmountUsdt,
          resolvedMarketId: resolvedMarket.resolvedMarketId,
          resolvedMarketSymbol: resolvedMarket.resolvedMarketSymbol,
        });
      }
      effectiveAmountUsdt = (preciseAmount * livePrice * resolvedMarket.ctVal) / Math.max(1, leverage);
    } else {
      const rawSz = Number(amount || 0) / resolvedMarket.ctVal;
      preciseAmount = Number(formatToStepString(floorToStep(rawSz, resolvedMarket.lotSz), resolvedMarket.lotSz));
    }

    if (preciseAmount < minContracts) {
      throw requestError(400, `Amount ${preciseAmount} is less than minimum required ${minContracts} for ${resolvedMarket.resolvedMarketId}`, {
        error: `Amount ${preciseAmount} is less than minimum required ${minContracts} for ${resolvedMarket.resolvedMarketId}`,
        requestedAmountUsdt,
        minRequiredUsdt,
        effectiveAmountUsdt,
        resolvedMarketId: resolvedMarket.resolvedMarketId,
        resolvedMarketSymbol: resolvedMarket.resolvedMarketSymbol,
      });
    }

    if (autoUpsizedToMinimum && source === "auto" && Number.isFinite(requestedAmountUsdt) && Number.isFinite(effectiveAmountUsdt)) {
      pushAutoTradingLog(`Auto order amount raised ${displaySymbol}: ${requestedAmountUsdt!.toFixed(2)} -> ${effectiveAmountUsdt!.toFixed(2)} USDT (minimum contract requirement)`);
    }

    orderDiagnostics = {
      requestedAmountUsdt,
      minRequiredUsdt,
      effectiveAmountUsdt,
      autoUpsizedToMinimum,
      contractSz: preciseAmount,
      ctVal: resolvedMarket.ctVal,
      lotSz: resolvedMarket.lotSz,
      minSz: resolvedMarket.minSz,
      resolvedMarketId: resolvedMarket.resolvedMarketId,
      resolvedMarketSymbol: resolvedMarket.resolvedMarketSymbol,
    };

    addOrderLifecycle({
      requestId,
      clientOrderId,
      symbol: displaySymbol,
      side,
      amount: preciseAmount,
      amountType,
      status: "prepared",
      source,
      strategyId,
      sandbox: isSandbox,
      operator,
      details: {
        requestedAmount: amount,
        ...orderDiagnostics,
        orderType: type,
        leverage,
      },
    });
    recordTrade({
      id: clientOrderId || requestId,
      requestId,
      clientOrderId,
      symbol: displaySymbol,
      side,
      amount: preciseAmount,
      amountType,
      status: "prepared",
      mode: toModeLabel(isSandbox),
      source,
      strategyId,
      ...decisionContext,
      leverage,
      orderType: type,
      tpPrice,
      slPrice,
      raw: {
        requestedAmount: amount,
        preciseAmount,
        ...orderDiagnostics,
      },
    });

    const orderPayload: Record<string, any> = {
      instId: resolvedMarket.instId,
      tdMode: "isolated",
      side,
      ordType: type === "limit" ? "limit" : "market",
      sz: formatToStepString(preciseAmount, resolvedMarket.lotSz),
    };
    if (clientOrderId) orderPayload.clOrdId = clientOrderId;
    if (type === "limit") {
      if (!Number.isFinite(Number(price))) {
        throw requestError(400, "Limit order price is required", { error: "Limit order price is required" });
      }
      orderPayload.px = String(price);
    }
    const attachAlgoOrds = buildOkxAttachAlgoOrds({ tpPrice, slPrice });
    if (attachAlgoOrds.length > 0) {
      orderPayload.attachAlgoOrds = attachAlgoOrds;
    }
    orderDiagnostics = {
      ...orderDiagnostics,
      orderPayload,
    };

    const submitResponse: any = await retry(() => exchangeCall(() => (exchange as any).privatePostTradeOrder(orderPayload)));
    const submitRow = unwrapOkxApiRow(submitResponse);
    const submitCode = String(submitRow?.sCode ?? "0");
    if (submitCode !== "0") {
      const okxDetails = parseOkxErrorDetails(submitResponse);
      throw requestError(400, submitRow?.sMsg || submitResponse?.msg || "OKX order rejected", {
        error: submitRow?.sMsg || submitResponse?.msg || "OKX order rejected",
        code: submitCode,
        ...orderDiagnostics,
        ...okxDetails,
      });
    }
    const orderInfo = attachAlgoOrds.length > 0
      ? { ...submitRow, attachAlgoOrds }
      : submitRow;
    const order = {
      id: String(submitRow?.ordId || "").trim() || undefined,
      clientOrderId: String(submitRow?.clOrdId || clientOrderId || "").trim() || undefined,
      symbol: displaySymbol,
      instId: resolvedMarket.instId,
      type,
      side,
      price: type === "limit" ? Number(price) : livePriceForSizing,
      average: type === "limit" ? Number(price) : livePriceForSizing,
      amount: preciseAmount,
      status: "open",
      info: orderInfo,
    };

    addOrderLifecycle({
      requestId,
      clientOrderId: order.clientOrderId || clientOrderId,
      orderId: order?.id,
      symbol: displaySymbol,
      side,
      amount: preciseAmount,
      amountType,
      status: "submitted",
      source,
      strategyId,
      sandbox: isSandbox,
      operator,
      details: {
        order,
        ...orderDiagnostics,
      },
    });
    recordTrade({
      id: clientOrderId || requestId,
      requestId,
      clientOrderId: order.clientOrderId || clientOrderId,
      exchangeOrderId: order?.id,
      symbol: displaySymbol,
      side,
      amount: preciseAmount,
      amountType,
      price: order?.price,
      status: "submitted",
      mode: toModeLabel(isSandbox),
      source,
      strategyId,
      ...decisionContext,
      leverage,
      orderType: type,
      tpPrice,
      slPrice,
      raw: {
        order,
        ...orderDiagnostics,
      },
    });

    if (order?.id || order?.clientOrderId) {
      try {
        const verifiedRaw: any = await fetchOkxTradeOrderRaw(exchange, exchangeCall, resolvedMarket.instId, {
          ordId: order.id,
          clOrdId: order.clientOrderId || clientOrderId,
        });
        const verifiedOrder = normalizeOkxRawOrder(verifiedRaw, resolvedMarket);
        addToAudit(auditStore.orderReceipts, {
          request: {
            requestId,
            symbol: displaySymbol,
            side,
            amount,
            type,
            leverage,
            clientOrderId,
            operator,
            decisionContext,
            ...orderDiagnostics,
          },
          response: order,
          verification: verifiedOrder,
          strategyVersion: STRATEGY_VERSION
        });
        addOrderLifecycle({
          requestId,
          clientOrderId: order.clientOrderId || clientOrderId,
          orderId: order.id,
          symbol: displaySymbol,
          side,
          amount: preciseAmount,
          amountType,
          status: "verified",
          source,
          strategyId,
          sandbox: isSandbox,
          operator,
          details: {
            status: verifiedOrder.status,
            filled: verifiedOrder.filled,
            remaining: verifiedOrder.remaining,
            ...orderDiagnostics,
          },
        });
        recordTrade({
          id: clientOrderId || requestId,
          requestId,
          clientOrderId: order.clientOrderId || clientOrderId,
          exchangeOrderId: order.id,
          symbol: displaySymbol,
          side,
          amount: preciseAmount,
          amountType,
          price: verifiedOrder.average || verifiedOrder.price || order.price,
          fee: verifiedOrder.fee,
          status: verifiedOrder.status || "verified",
          mode: toModeLabel(isSandbox),
          source,
          strategyId,
          ...decisionContext,
          leverage,
          orderType: type,
          tpPrice,
          slPrice,
          raw: {
            order,
            verifiedOrder,
            ...orderDiagnostics,
          },
        });
        addToAudit(auditStore.positionChanges, {
          symbol: displaySymbol,
          side,
          amount: effectiveAmountUsdt ?? amount,
          price: verifiedOrder.price || order.price,
          orderId: order.id,
          status: verifiedOrder.status,
          decisionContext,
        });
        takeProfitManager.register({
          tradeId: clientOrderId || requestId,
          requestId,
          clientOrderId: order.clientOrderId || clientOrderId,
          orderId: order.id,
          symbol: displaySymbol,
          side,
          sandbox: isSandbox,
          source,
          strategyId,
          tpPrice,
          slPrice,
          entryPrice: firstNumber(verifiedOrder.average, verifiedOrder.price, order.price),
          verifiedOrder,
          order,
        });
        return verifiedOrder;
      } catch {
        takeProfitManager.register({
          tradeId: clientOrderId || requestId,
          requestId,
          clientOrderId: order.clientOrderId || clientOrderId,
          orderId: order.id,
          symbol: displaySymbol,
          side,
          sandbox: isSandbox,
          source,
          strategyId,
          tpPrice,
          slPrice,
          entryPrice: firstNumber(order.average, order.price),
          order,
        });
        return order;
      }
    }

    return order;
  } catch (error: any) {
    const errMsg = error?.message || String(error || "Unknown Error");
    const errorPayload = error?.payload || {};
    const okxDetails = parseOkxErrorDetails(error);
    const failureDetails = {
      ...orderDiagnostics,
      ...errorPayload,
      ...okxDetails,
      error: errMsg,
      code: errorPayload.code || okxDetails.okxSCode || okxDetails.okxCode || error.constructor?.name || "Error",
      requestedAmountUsdt: errorPayload.requestedAmountUsdt ?? orderDiagnostics.requestedAmountUsdt ?? (amountType === "usdt" ? Number(amount || 0) : null),
      minRequiredUsdt: errorPayload.minRequiredUsdt ?? orderDiagnostics.minRequiredUsdt ?? null,
      effectiveAmountUsdt: errorPayload.effectiveAmountUsdt ?? orderDiagnostics.effectiveAmountUsdt ?? null,
      autoUpsizedToMinimum: errorPayload.autoUpsizedToMinimum ?? orderDiagnostics.autoUpsizedToMinimum ?? false,
      resolvedMarketId: errorPayload.resolvedMarketId ?? orderDiagnostics.resolvedMarketId ?? null,
      resolvedMarketSymbol: errorPayload.resolvedMarketSymbol ?? orderDiagnostics.resolvedMarketSymbol ?? null,
    };
    addOrderLifecycle({
      requestId,
      clientOrderId,
      symbol: displaySymbol,
      side,
      amount: failureDetails.contractSz ?? amount,
      amountType,
      status: "failed",
      source,
      strategyId,
      sandbox: isSandbox,
      operator,
      details: failureDetails,
    });
    recordTrade({
      id: clientOrderId || requestId,
      requestId,
      clientOrderId,
      symbol: displaySymbol,
      side,
      amount: failureDetails.contractSz ?? amount,
      amountType,
      status: "failed",
      mode: toModeLabel(isSandbox),
      source,
      strategyId,
      ...decisionContext,
      leverage,
      orderType: type,
      tpPrice,
      slPrice,
      raw: failureDetails,
    });
    if (error?.statusCode) throw error;
    throw requestError(500, errMsg, {
      ...failureDetails,
      note: "Execution failed after retries. Please check exchange status."
    });
  }
}
