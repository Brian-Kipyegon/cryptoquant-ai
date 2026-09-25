import express from "express";
import { AUTO_TRADING_LOG_LIMIT, AUTO_TRADING_SUMMARY_LIMIT, AUTO_TRADING_TRACE_LIMIT } from "../stores/app-store";
import { autoTradingEngine } from "../trading/auto-trading-engine";

export function registerAutoTradingRoutes(app: express.Express) {
  app.get("/api/auto-trading/status", (_req, res) => {
    res.json(autoTradingEngine.status());
  });

  app.get("/api/auto-trading/config", (_req, res) => {
    res.json({
      config: autoTradingEngine.config(),
      status: autoTradingEngine.status(),
    });
  });

  app.put("/api/auto-trading/config", async (req, res) => {
    try {
      const payload = await autoTradingEngine.updateConfig(req.body || {});
      res.json(payload);
    } catch (error: any) {
      res.status(error?.statusCode || 500).json(error?.payload || { error: error?.message || "Failed to update auto-trading config" });
    }
  });

  app.get("/api/auto-trading/logs", (req, res) => {
    const limit = Math.min(AUTO_TRADING_LOG_LIMIT, Math.max(1, Number(req.query.limit || 200)));
    res.json(autoTradingEngine.logs(limit));
  });

  app.get("/api/auto-trading/traces", (req, res) => {
    const limit = Math.min(AUTO_TRADING_TRACE_LIMIT, Math.max(1, Number(req.query.limit || 200)));
    res.json(autoTradingEngine.traces(limit));
  });

  app.get("/api/auto-trading/cycles", (req, res) => {
    const limit = Math.min(AUTO_TRADING_SUMMARY_LIMIT, Math.max(1, Number(req.query.limit || 50)));
    res.json(autoTradingEngine.cycles(limit));
  });

  app.post("/api/auto-trading/start", async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" && Object.keys(req.body).length > 0 ? req.body : undefined;
      const status = await autoTradingEngine.start(body);
      res.json(status);
    } catch (error: any) {
      res.status(error?.statusCode || 500).json(error?.payload || { error: error?.message || "Failed to start auto-trading engine" });
    }
  });

  app.post("/api/auto-trading/stop", async (_req, res) => {
    try {
      const status = await autoTradingEngine.stop();
      res.json(status);
    } catch (error: any) {
      res.status(error?.statusCode || 500).json(error?.payload || { error: error?.message || "Failed to stop auto-trading engine" });
    }
  });

  app.post("/api/auto-trading/run-once", async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" && Object.keys(req.body).length > 0 ? req.body : undefined;
      const status = await autoTradingEngine.runOnce(body);
      res.json(status);
    } catch (error: any) {
      res.status(error?.statusCode || 500).json(error?.payload || { error: error?.message || "Failed to run auto-trading cycle" });
    }
  });
}
