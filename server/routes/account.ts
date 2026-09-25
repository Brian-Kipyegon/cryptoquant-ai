import express from "express";
import { firstNumber } from "../utils";
import { getPrivateExchange, normalizeOkxHistoryOrder, resolveOkxSwapMarket, retry, unwrapOkxApiRows } from "../exchange/okx";
import { normalizeOkxBalance, normalizeOkxPosition } from "../exchange/okx-account";
import { prepareExchange, runWithExchangeProxyFallback } from "../exchange/connectivity";
import { resolveOkxCredentials } from "../auth/credentials";
import { submitOkxOrder } from "../execution/okx-orders";
import { todayKey, updatePersistentRiskState } from "../stores/app-store";

export function registerAccountRoutes(app: express.Express) {
  // API Routes
  app.post("/api/okx/balance", async (req, res) => {
    const { sandbox = false } = req.body;
    
    const isSandbox = String(sandbox) === 'true' || sandbox === true;
    const credentials = resolveOkxCredentials(req.body, isSandbox);

    console.log(`[OKX Balance Request] Mode: ${isSandbox ? 'DEMO' : 'REAL'}`);
    console.log(`- API Key: ${credentials?.apiKey ? credentials.apiKey.substring(0, 5) + '...' : 'MISSING'}`);

    if (!credentials) {
      return res.status(400).json({ error: "Missing OKX credentials" });
    }

    try {
       const exchange = getPrivateExchange(credentials.apiKey, credentials.secret, credentials.password, isSandbox);
       await prepareExchange(exchange);
       const balance = normalizeOkxBalance(await runWithExchangeProxyFallback(exchange, () => exchange.fetchBalance()));
       
       // Ensure we have a consistent structure for the frontend
       // OKX V5 balance is already well-mapped by CCXT, but we can log details
       if (balance.info && balance.info.data && balance.info.data[0]) {
         const details = balance.info.data[0].details || [];
         console.log(`[OKX Balance] Details count: ${details.length}`);
       }
       
       res.json(balance);
     } catch (error: any) {
      const errMsg = error?.message || String(error || "Unknown Error");
      console.error(`[OKX Balance Error] Mode: ${isSandbox ? 'DEMO' : 'REAL'}`, errMsg);
      if (error.stack) console.error('[OKX Balance Error Stack]', error.stack);
      const isEnvError = errMsg.includes('50101') || errMsg.includes('APIKey does not match');
      const hint = isEnvError ? " (check that the account mode matches the API key; demo and live trading need separate credentials)" : "";
      res.status(500).json({ error: `okx ${errMsg}${hint}` });
    }
  });


  app.post("/api/okx/positions", async (req, res) => {
    const { sandbox = false } = req.body;
    const isSandbox = String(sandbox) === 'true' || sandbox === true;
    const credentials = resolveOkxCredentials(req.body, isSandbox);

    if (!credentials) {
      return res.status(400).json({ error: "Missing OKX credentials" });
    }

    try {
      const exchange = getPrivateExchange(credentials.apiKey, credentials.secret, credentials.password, isSandbox);
      await prepareExchange(exchange);
      console.log(`[OKX Positions Request] Mode: ${isSandbox ? 'DEMO' : 'REAL'}`);
      
      // For OKX, we might want to fetch positions for swap specifically if needed
      const positions = await runWithExchangeProxyFallback<any[]>(exchange, () => exchange.fetchPositions(undefined, { instType: "SWAP" }));
      
      const activePositions = positions
        .map(normalizeOkxPosition)
        .filter((p: any) => Math.abs(Number(p.contracts || 0)) > 0);
      
      console.log(`[OKX Positions] Found ${activePositions.length} active positions`);
      res.json(activePositions);
    } catch (error: any) {
      const errMsg = error?.message || String(error || "Unknown Error");
      console.error(`[OKX Positions Error] Mode: ${isSandbox ? 'DEMO' : 'REAL'}`, errMsg);
      res.status(500).json({ error: errMsg });
    }
  });

  app.post("/api/okx/history", async (req, res) => {
    const { symbol, sandbox = false } = req.body;
    const isSandbox = String(sandbox) === 'true' || sandbox === true;
    const credentials = resolveOkxCredentials(req.body, isSandbox);

    if (!credentials) {
      return res.status(400).json({ error: "Missing OKX credentials" });
    }

    try {
      const exchange = getPrivateExchange(credentials.apiKey, credentials.secret, credentials.password, isSandbox);
      await prepareExchange(exchange);
      const targetSymbol = symbol || "BTC/USDT";
      const exchangeCall = <T,>(fn: () => Promise<T>) => runWithExchangeProxyFallback(exchange, fn);
      await exchangeCall(() => exchange.loadMarkets());
      const resolvedMarket = await resolveOkxSwapMarket(targetSymbol, exchange);
      console.log(
        `[OKX History Request] Symbol: ${targetSymbol}, Resolved: ${resolvedMarket.instId}, Mode: ${isSandbox ? 'DEMO' : 'REAL'}`
      );
      
      try {
        const instId = resolvedMarket.instId;
        const instType = "SWAP";

        const [openOrdersResponse, historyOrdersResponse, archivedOrdersResponse] = await Promise.all([
          retry(() => exchangeCall(() => (exchange as any).privateGetTradeOrdersPending({ instType, instId, limit: "100" }))),
          retry(() => exchangeCall(() => (exchange as any).privateGetTradeOrdersHistory({ instType, instId, limit: "100" }))).catch(() => ({ code: "0", data: [] })),
          retry(() => exchangeCall(() => (exchange as any).privateGetTradeOrdersHistoryArchive({ instType, instId, limit: "100" }))).catch(() => ({ code: "0", data: [] })),
        ]);

        const allOrders = [
          ...unwrapOkxApiRows(openOrdersResponse),
          ...unwrapOkxApiRows(historyOrdersResponse),
          ...unwrapOkxApiRows(archivedOrdersResponse),
        ].map((row: any) => normalizeOkxHistoryOrder(row, resolvedMarket));

        const uniqueOrders = Array.from(new Map(allOrders.map((item: any) => [item.id || item.clientOrderId, item])).values())
          .filter((item: any) => item?.id || item?.clientOrderId);
        uniqueOrders.sort((a, b) => b.timestamp - a.timestamp);

        res.json(uniqueOrders);
      } catch (e) {
        console.warn("[OKX History] Primary fetch failed, trying fallback:", e);
        const fallbackResponse = await retry(() => exchangeCall(() => (exchange as any).privateGetTradeOrdersPending({
          instType: "SWAP",
          instId: resolvedMarket.instId,
          limit: "100",
        })));
        const orders = unwrapOkxApiRows(fallbackResponse).map((row: any) => normalizeOkxHistoryOrder(row, resolvedMarket));
        res.json(orders);
      }
    } catch (error: any) {
      const errMsg = error?.message || String(error || "Unknown Error");
      console.error(`[OKX History Error] Symbol: ${symbol || 'BTC/USDT'}, Mode: ${isSandbox ? 'DEMO' : 'REAL'}`, errMsg);
      res.status(500).json({ error: errMsg });
    }
  });

  app.post("/api/okx/realized-pnl", async (req, res) => {
    const { sandbox = false } = req.body;
    const isSandbox = String(sandbox) === 'true' || sandbox === true;
    const credentials = resolveOkxCredentials(req.body, isSandbox);

    if (!credentials) {
      return res.status(400).json({ error: "Missing OKX credentials" });
    }

    try {
      const exchange = getPrivateExchange(credentials.apiKey, credentials.secret, credentials.password, isSandbox);
      await prepareExchange(exchange);
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayStartMs = dayStart.getTime();
      const response = await runWithExchangeProxyFallback<any>(exchange, () => (exchange as any).privateGetAccountBills({
        ccy: "USDT",
        limit: "100",
      }));
      const rawRows = Array.isArray(response?.data) ? response.data : [];
      const rows = rawRows.map((row: any) => {
        const timestamp = firstNumber(row.ts, row.uTime, row.cTime);
        const pnl = firstNumber(row.pnl);
        return {
          id: row.billId || row.ordId || `${timestamp}_${row.type || ""}_${row.subType || ""}`,
          timestamp,
          pnl,
          fee: firstNumber(row.fee),
          balanceChange: firstNumber(row.balChg),
          type: row.type,
          subType: row.subType,
          ccy: row.ccy,
          symbol: row.instId,
        };
      }).filter((row: any) => Number.isFinite(row.timestamp) && row.timestamp > 0);

      const realizedRows = rows
        .filter((row: any) => row.pnl !== 0)
        .sort((a: any, b: any) => b.timestamp - a.timestamp);
      const riskCountRows = realizedRows.filter((row: any) => {
        const type = String(row.type || "");
        const subType = String(row.subType || "");
        // Funding-fee bills are realized balance changes, but they are not losing trades.
        return type !== "8" && subType !== "173" && subType !== "174";
      });
      const dailyPnL = realizedRows
        .filter((row: any) => row.timestamp >= dayStartMs)
        .reduce((acc: number, row: any) => acc + row.pnl, 0);
      let consecutiveLosses = 0;
      for (const row of riskCountRows) {
        if (row.pnl < 0) consecutiveLosses += 1;
        else if (row.pnl > 0) break;
      }
      const riskState = updatePersistentRiskState({
        dailyPnL,
        consecutiveStopLosses: consecutiveLosses,
      });

      res.json({
        date: todayKey(dayStart),
        dailyPnL,
        consecutiveLosses,
        riskState,
        rows: realizedRows.slice(0, 100),
      });
    } catch (error: any) {
      const errMsg = error?.message || String(error || "Unknown Error");
      console.error(`[OKX Realized PnL Error] Mode: ${isSandbox ? 'DEMO' : 'REAL'}`, errMsg);
      res.status(500).json({ error: errMsg });
    }
  });

  app.post("/api/okx/order", async (req, res) => {
    try {
      const result = await submitOkxOrder(req.body || {}, (req as any).operator?.username || "unknown");
      return res.json(result);
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json(error?.payload || {
        error: error?.message || "Execution failed after retries. Please check exchange status."
      });
    }
  });
}
