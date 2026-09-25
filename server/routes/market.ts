import express from "express";
import { normalizeDisplaySymbol } from "../../src/lib/tradingRuntime";
import { DEFAULT_UNIVERSE_CONFIG } from "../../src/lib/universe";
import {
  fetchPublicFundingSnapshot,
  fetchPublicOhlcvSnapshot,
  fetchPublicOrderBookSnapshot,
  fetchPublicTickers,
  fetchPublicTickerSnapshot,
} from "../market/public-data";
import { getMarketDataProvider } from "../market/providers";
import { getUniverseSnapshot } from "../market/universe";
import { DEFAULT_AUTO_TRADING_SCAN_PROFILES, appStore, sanitizeAutoTradingConfig } from "../stores/app-store";

/** Universe settings from the saved auto-trading config, or the defaults. */
function currentUniverseSettings() {
  const config = sanitizeAutoTradingConfig(appStore.autoTrading.config);
  return {
    universe: config?.universe ?? DEFAULT_UNIVERSE_CONFIG,
    profileSymbols: (config?.scanProfiles ?? DEFAULT_AUTO_TRADING_SCAN_PROFILES).map((profile) => profile.symbol),
    requireOkxExecution: config ? !config.shadowMode : false,
  };
}

function symbolParam(req: express.Request) {
  return normalizeDisplaySymbol(req.params.symbol || "BTC/USDT");
}

export function registerMarketRoutes(app: express.Express) {
  // Market data comes from the DATA_EXCHANGE provider (Binance by default).
  // The /api/okx/* paths are kept as aliases for existing clients.
  const route = (suffix: string) => [`/api/market${suffix}`, `/api/okx${suffix}`];

  app.get("/api/market/source", (_req, res) => {
    const provider = getMarketDataProvider();
    res.json({ id: provider.id, label: provider.label });
  });

  app.get("/api/market/universe", async (req, res) => {
    try {
      const { universe, profileSymbols, requireOkxExecution } = currentUniverseSettings();
      const snapshot = await getUniverseSnapshot(universe, {
        requireOkxExecution,
        force: req.query.refresh === "1",
      });
      res.json({ ...snapshot, enabled: universe.enabled, settings: universe, profileSymbols });
    } catch (error: any) {
      console.error("[Universe Error]", error?.message || error);
      res.status(502).json({ error: error?.message || "Universe unavailable" });
    }
  });

  app.get(route("/ticker/:symbol"), async (req, res) => {
    try {
      res.json(await fetchPublicTickerSnapshot(symbolParam(req)));
    } catch (error: any) {
      console.error("[Ticker Error]", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get(route("/orderbook/:symbol"), async (req, res) => {
    try {
      res.json(await fetchPublicOrderBookSnapshot(symbolParam(req)));
    } catch (error: any) {
      console.error("[Orderbook Error]", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Tickers for the pairs the dashboard can show: scan profiles plus the universe.
  app.get(route("/tickers"), async (_req, res) => {
    try {
      const { universe, profileSymbols, requireOkxExecution } = currentUniverseSettings();
      const wanted = new Set(profileSymbols);
      if (universe.enabled) {
        try {
          const snapshot = await getUniverseSnapshot(universe, { requireOkxExecution });
          snapshot.entries.forEach((entry) => wanted.add(entry.symbol));
        } catch (error: any) {
          console.warn("[Tickers] Universe unavailable, returning scan profile tickers only:", error?.message || error);
        }
      }
      const all = await fetchPublicTickers();
      res.json(Object.fromEntries([...wanted].filter((symbol) => all[symbol]).map((symbol) => [symbol, all[symbol]])));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get(route("/ohlcv/:symbol"), async (req, res) => {
    try {
      const timeframe = (req.query.t as string) || "1h";
      const limit = Math.min(300, Math.max(24, Number(req.query.limit || 120)));
      res.json(await fetchPublicOhlcvSnapshot(symbolParam(req), timeframe, limit));
    } catch (error: any) {
      console.error("[OHLCV Error]", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get(route("/funding/:symbol"), async (req, res) => {
    try {
      res.json(await fetchPublicFundingSnapshot(symbolParam(req)));
    } catch (error: any) {
      const message = error?.message || "Funding rate fetch failed";
      console.error("[Funding Error]", message);
      res.status(500).json({ error: message });
    }
  });
}
