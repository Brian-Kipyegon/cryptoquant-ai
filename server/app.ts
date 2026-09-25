import express from "express";
import path from "path";
import fsp from "fs/promises";
import { createServer as createViteServer } from "vite";
import { ROOT_DIR } from "./config";
import { loadAuditStore } from "./stores/audit-store";
import { loadAppStore } from "./stores/app-store";
import { initTradingDatabase } from "./persistence/trading-db";
import { loadCredentialStore } from "./auth/credentials";
import { requireOperator } from "./auth/session";
import { autoTradingEngine } from "./trading/auto-trading-engine";
import { takeProfitManager } from "./trading/take-profit-manager";
import { registerAuthRoutes } from "./routes/auth";
import { registerAuditRiskRoutes } from "./routes/audit-risk";
import { registerAutoTradingRoutes } from "./routes/auto-trading";
import { registerRecordRoutes } from "./routes/records";
import { registerAccountRoutes } from "./routes/account";
import { registerMarketRoutes } from "./routes/market";
import { registerBacktestRoutes } from "./routes/backtest";
import { registerAiRoutes } from "./routes/ai";
import { registerNotifyRoutes } from "./routes/notify";

export type CreateAppOptions = {
  /** Serve the built frontend (production) or Vite middleware (development). Disable for API-only tests. */
  serveFrontend?: boolean;
  /** Start the auto-trading engine and take-profit manager background loops. */
  startBackgroundJobs?: boolean;
};

/** Loads persisted state, registers all routes and returns the Express app without listening. */
export async function createApp(options: CreateAppOptions = {}) {
  const { serveFrontend = true, startBackgroundJobs = true } = options;
  console.log("[Server] Starting initialization...");
  await loadAuditStore();
  await loadAppStore();
  await initTradingDatabase();
  await loadCredentialStore();
  if (startBackgroundJobs) {
    autoTradingEngine.hydrate();
    takeProfitManager.start();
  }
  const app = express();

  app.use(express.json());
  app.use("/api", requireOperator);
  console.log("[Server] Middleware registered.");

  registerAuthRoutes(app);
  registerAuditRiskRoutes(app);
  registerAutoTradingRoutes(app);
  registerRecordRoutes(app);
  registerAccountRoutes(app);
  registerMarketRoutes(app);
  registerBacktestRoutes(app);
  registerAiRoutes(app);
  registerNotifyRoutes(app);

  if (!serveFrontend) return app;

  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(ROOT_DIR, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      root: ROOT_DIR,
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      try {
        const url = req.originalUrl;
        const templatePath = path.join(ROOT_DIR, "index.html");
        const template = await fsp.readFile(templatePath, "utf-8");
        const html = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (error: any) {
        vite.ssrFixStacktrace(error);
        next(error);
      }
    });
  }

  return app;
}
