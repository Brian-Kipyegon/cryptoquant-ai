import express from "express";
import { buildPortfolioReturnAnalytics, type PortfolioReturnBillInput } from "../../src/lib/portfolioReturns";
import { PORTFOLIO_RETURNS_TIMEOUT_MS, createPortfolioReturnRequestKey, withTimeout } from "../../src/lib/portfolioReturnStability";
import { buildFallbackMacroData, ensureFreshMacroData } from "../market/macro";
import { buildShadowSummary, listShadowOrders, recordShadowOrder, recordStrategySignal, recordTrade, tradingDb } from "../persistence/trading-db";
import { fetchPortfolioExchangeReturns, formatPortfolioReturnSourceError, getFreshPortfolioReturnCachedResponse, getStalePortfolioReturnCachedResponse, normalizePortfolioReturnMode, normalizePortfolioReturnRange, portfolioReturnCache } from "../portfolio/returns";

export function registerRecordRoutes(app: express.Express) {
  app.get("/api/trades", (req, res) => {
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 200)));
    const rows = tradingDb.prepare("SELECT * FROM trades ORDER BY created_at DESC LIMIT ?").all(limit);
    res.json(rows);
  });

  app.post("/api/trades/record", (req, res) => {
    try {
      const record = recordTrade(req.body || {});
      res.json({ ok: true, trade: record });
    } catch (error: any) {
      console.error("[TradingDB] Failed to record trade:", error);
      res.status(500).json({ error: error.message || "Failed to record trade" });
    }
  });

  app.get("/api/strategy/signals", (req, res) => {
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 200)));
    const rows = tradingDb.prepare("SELECT * FROM strategy_signals ORDER BY created_at DESC LIMIT ?").all(limit);
    res.json(rows);
  });

  app.post("/api/strategy/signals/record", (req, res) => {
    try {
      const record = recordStrategySignal(req.body || {});
      res.json({ ok: true, signal: record });
    } catch (error: any) {
      console.error("[TradingDB] Failed to record strategy signal:", error);
      res.status(500).json({ error: error.message || "Failed to record strategy signal" });
    }
  });

  app.get("/api/shadow/orders", (req, res) => {
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 200)));
    const status = String(req.query.status || "all").toLowerCase();
    const rows = listShadowOrders(status === "open" || status === "closed" ? status : "all", limit);
    res.json(rows);
  });

  app.get("/api/shadow/summary", (_req, res) => {
    res.json(buildShadowSummary());
  });

  app.get("/api/portfolio/returns", async (req, res) => {
    try {
      const mode = normalizePortfolioReturnMode(req.query.mode);
      const range = normalizePortfolioReturnRange(req.query.range);
      const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 200)));
      const requestKey = createPortfolioReturnRequestKey(mode, range, limit);
      const trades = mode === "shadow"
        ? []
        : tradingDb.prepare(`
            SELECT *
            FROM trades
            WHERE (source = 'auto' OR strategy_id IS NOT NULL)
              AND mode = ?
            ORDER BY created_at DESC
            LIMIT 2000
          `).all(mode === "demo" ? "okx-demo" : "okx-live") as any[];
      const shadowOrders = mode === "shadow"
        ? tradingDb.prepare("SELECT * FROM shadow_orders ORDER BY created_at DESC LIMIT 2000").all() as any[]
        : [];

      if (mode !== "shadow") {
        const now = Date.now();
        const freshCached = getFreshPortfolioReturnCachedResponse(requestKey, now);
        if (freshCached) {
          return res.json(freshCached);
        }

        try {
          const exchangeReturns = await withTimeout(
            fetchPortfolioExchangeReturns(mode, limit),
            PORTFOLIO_RETURNS_TIMEOUT_MS,
            `OKX ${mode === "demo" ? "模拟盘" : "实盘"}账单读取超时`
          );
          const fetchedAt = Date.now();
          const analytics = buildPortfolioReturnAnalytics({
            mode,
            range,
            limit,
            trades,
            bills: exchangeReturns.bills,
            shadowOrders,
            capitalBase: exchangeReturns.capitalBase,
            requestKey,
            sourceStatus: {
              state: "fresh",
              fetchedAt,
            },
            generatedAt: fetchedAt,
          });
          portfolioReturnCache.set(requestKey, { analytics, storedAt: fetchedAt });
          return res.json(analytics);
        } catch (sourceError: any) {
          const staleCached = getStalePortfolioReturnCachedResponse(requestKey, sourceError, Date.now());
          if (staleCached) {
            console.warn("[PortfolioReturns] Returning stale cached analytics:", formatPortfolioReturnSourceError(sourceError));
            return res.json(staleCached);
          }
          throw sourceError;
        }
      }

      res.json(buildPortfolioReturnAnalytics({
        mode,
        range,
        limit,
        trades,
        bills: undefined as PortfolioReturnBillInput[] | undefined,
        shadowOrders,
        capitalBase: null,
        requestKey,
        sourceStatus: {
          state: "fresh",
          fetchedAt: Date.now(),
        },
      }));
    } catch (error: any) {
      console.error("[PortfolioReturns] Failed to build return analytics:", error);
      res.status(error?.status || 503).json({ error: error?.message || "Failed to build portfolio returns" });
    }
  });

  app.post("/api/shadow/orders/record", (req, res) => {
    try {
      const record = recordShadowOrder(req.body || {});
      res.json({ ok: true, shadowOrder: record });
    } catch (error: any) {
      console.error("[TradingDB] Failed to record shadow order:", error);
      res.status(500).json({ error: error.message || "Failed to record shadow order" });
    }
  });

  app.get("/api/research/weekly", (_req, res) => {
    const trades = tradingDb.prepare("SELECT * FROM trades ORDER BY created_at DESC LIMIT 2000").all() as any[];
    const shadowOrders = tradingDb.prepare("SELECT * FROM shadow_orders ORDER BY created_at DESC LIMIT 2000").all() as any[];
    const closedTrades = trades.filter(row => row.realized_pnl !== null && row.realized_pnl !== undefined);
    const groupStats = (keyFn: (row: any) => string) => {
      const groups = new Map<string, any[]>();
      for (const row of closedTrades) {
        const key = keyFn(row) || "UNKNOWN";
        groups.set(key, [...(groups.get(key) || []), row]);
      }
      return Object.fromEntries(Array.from(groups.entries()).map(([key, rows]) => {
        const pnls = rows.map(row => Number(row.realized_pnl || 0));
        const wins = pnls.filter(pnl => pnl > 0);
        const losses = pnls.filter(pnl => pnl < 0);
        const grossProfit = wins.reduce((acc, value) => acc + value, 0);
        const grossLoss = Math.abs(losses.reduce((acc, value) => acc + value, 0));
        return [key, {
          trades: rows.length,
          pnl: pnls.reduce((acc, value) => acc + value, 0),
          winRate: rows.length ? (wins.length / rows.length) * 100 : 0,
          profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit,
          expectancy: rows.length ? pnls.reduce((acc, value) => acc + value, 0) / rows.length : 0,
        }];
      }));
    };

    const shadowSlippage = shadowOrders.map(row => {
      const theoretical = Number(row.theoretical_price || 0);
      const executable = Number(row.executable_price || 0);
      const side = String(row.side || "").toUpperCase();
      if (theoretical <= 0 || executable <= 0) return 0;
      const signed = side === "BUY" ? executable - theoretical : theoretical - executable;
      return (signed / theoretical) * 10000;
    }).filter(Number.isFinite);

    res.json({
      generatedAt: Date.now(),
      totals: {
        trades: closedTrades.length,
        shadowOrders: shadowOrders.length,
        shadowAvgSlippageBps: shadowSlippage.length ? shadowSlippage.reduce((acc, value) => acc + value, 0) / shadowSlippage.length : 0,
        shadowWorstSlippageBps: shadowSlippage.length ? Math.max(...shadowSlippage) : 0,
      },
      byRegime: groupStats(row => row.regime),
      bySymbol: groupStats(row => row.symbol),
      byMacroGate: groupStats(row => row.macro_gate),
      byStopDistance: groupStats(row => {
        const distance = Number(row.stop_distance || 0);
        if (distance <= 0) return "UNKNOWN";
        if (distance < 0.01) return "<1%";
        if (distance < 0.02) return "1-2%";
        if (distance < 0.04) return "2-4%";
        return ">4%";
      }),
      byEntryReason: groupStats(row => String(row.entry_reason || "UNKNOWN").slice(0, 80)),
      aiVeto: groupStats(row => row.ai_verdict || "none"),
      recentShadowOrders: shadowOrders.slice(0, 50),
    });
  });

  app.get("/api/macro", async (_req, res) => {
    try {
      const macro = await ensureFreshMacroData();
      res.json(macro || buildFallbackMacroData());
    } catch (error: any) {
      console.error("[Macro API Error]", error?.message || error);
      res.json(buildFallbackMacroData());
    }
  });
}
