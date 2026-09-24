import crypto from "crypto";
import { AUTO_TRADING_LOG_LIMIT, AUTO_TRADING_MIN_DELAY_MS, AUTO_TRADING_SUMMARY_LIMIT, AUTO_TRADING_TRACE_LIMIT, appStore, pushAutoTradingLog, pushAutoTradingSummary, sanitizeAutoTradingConfig, serializeAutoTradingConfig, updateAutoTradingStore } from "../stores/app-store";
import { AutoTradingConfig, AutoTradingCycleSummary } from "../types";
import { assertAutoTradingExchangeReady, isExchangeConnectivityFailure, retry } from "../exchange/okx";
import { getExchangeConnectivityStatus, getExchangeProxyStatus, markExchangeConnectivityFailure } from "../exchange/connectivity";
import { hasMeaningfulAutoTradingConfigInput } from "../persistence/trading-db";
import { requestError } from "../http-errors";
import { resolveEngineCredentials } from "./engine-helpers";
import { runAutoTradingCycle } from "./auto-trading-cycle";
import { getMarketDataProvider } from "../market/providers";
import { assertMarketDataReady } from "../market/public-data";

export class AutoTradingEngine {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private stopRequested = false;

  hydrate() {
    const config = sanitizeAutoTradingConfig(appStore.autoTrading.config);
    updateAutoTradingStore({
      state: "stopped",
      config,
      nextRunAt: null,
      lastError: appStore.autoTrading.lastError || null,
      engineStartedAt: null,
      recentLogs: appStore.autoTrading.recentLogs.slice(0, AUTO_TRADING_LOG_LIMIT),
      recentCycleSummaries: appStore.autoTrading.recentCycleSummaries.slice(0, AUTO_TRADING_SUMMARY_LIMIT),
      decisionTraces: appStore.autoTrading.decisionTraces.slice(0, AUTO_TRADING_TRACE_LIMIT),
    });
  }

  status() {
    const config = this.ensureStoredConfig();
    return {
      state: appStore.autoTrading.state,
      config: serializeAutoTradingConfig(config),
      inFlight: this.inFlight,
      lastRunAt: appStore.autoTrading.lastRunAt,
      nextRunAt: appStore.autoTrading.nextRunAt,
      lastError: appStore.autoTrading.lastError,
      recentCycleSummary: appStore.autoTrading.recentCycleSummaries[0] || null,
      engineStartedAt: appStore.autoTrading.engineStartedAt,
      exchangeConnectivity: getExchangeConnectivityStatus(),
    };
  }

  config() {
    return serializeAutoTradingConfig(this.ensureStoredConfig());
  }

  private ensureStoredConfig() {
    const config = sanitizeAutoTradingConfig(appStore.autoTrading.config);
    if (config && JSON.stringify(config) !== JSON.stringify(appStore.autoTrading.config)) {
      updateAutoTradingStore({ config });
    }
    return config;
  }

  logs(limit = 200) {
    return appStore.autoTrading.recentLogs.slice(0, Math.min(AUTO_TRADING_LOG_LIMIT, Math.max(1, limit)));
  }

  traces(limit = 200) {
    return appStore.autoTrading.decisionTraces.slice(0, Math.min(AUTO_TRADING_TRACE_LIMIT, Math.max(1, limit)));
  }

  cycles(limit = 50) {
    return appStore.autoTrading.recentCycleSummaries.slice(0, Math.min(AUTO_TRADING_SUMMARY_LIMIT, Math.max(1, limit)));
  }

  async updateConfig(input: Partial<AutoTradingConfig>) {
    const config = sanitizeAutoTradingConfig(input);
    if (!config) throw requestError(400, "Invalid auto-trading config", { error: "Invalid auto-trading config" });
    updateAutoTradingStore({ config });
    pushAutoTradingLog(`Auto-trading config updated (${config.sandbox ? "DEMO" : "LIVE"}, shadow=${config.shadowMode ? "on" : "off"})`);
    return {
      config: serializeAutoTradingConfig(config),
      status: this.status(),
    };
  }

  async start(input?: Partial<AutoTradingConfig>) {
    const config = sanitizeAutoTradingConfig(
      hasMeaningfulAutoTradingConfigInput(input) ? input : appStore.autoTrading.config
    );
    if (!config) throw requestError(400, "Invalid auto-trading config", { error: "Invalid auto-trading config" });
    const credentials = resolveEngineCredentials(config.sandbox);
    // Shadow mode can run on market data alone (paper balance); live mode needs an OKX account.
    if (!credentials && !config.shadowMode) {
      throw requestError(400, `Missing OKX credentials for ${config.sandbox ? "demo" : "live"} mode`, {
        error: `Missing OKX credentials for ${config.sandbox ? "demo" : "live"} mode`
      });
    }
    if (credentials) await assertAutoTradingExchangeReady(credentials, config.sandbox);
    if (!credentials || getMarketDataProvider().id !== "okx") await assertMarketDataReady();

    this.stopRequested = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    updateAutoTradingStore({
      state: "starting",
      config,
      lastError: null,
      engineStartedAt: Date.now(),
      nextRunAt: Date.now(),
    });
    pushAutoTradingLog(`Auto-trading engine started (${config.sandbox ? "DEMO" : "LIVE"})`);
    this.schedule(0);
    return this.status();
  }

  async stop() {
    this.stopRequested = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.inFlight) {
      updateAutoTradingStore({
        state: "stopping",
        nextRunAt: null,
      });
      pushAutoTradingLog("Stop requested; the current cycle will finish before shutdown");
      return this.status();
    }

    updateAutoTradingStore({
      state: "stopped",
      nextRunAt: null,
      engineStartedAt: appStore.autoTrading.engineStartedAt,
    });
    pushAutoTradingLog("Auto-trading engine stopped");
    return this.status();
  }

  async runOnce(input?: Partial<AutoTradingConfig>) {
    const providedConfig = hasMeaningfulAutoTradingConfigInput(input) ? input : undefined;
    const config = sanitizeAutoTradingConfig(providedConfig || appStore.autoTrading.config);
    if (!config) throw requestError(400, "Auto-trading config is not initialized", { error: "Auto-trading config is not initialized" });
    if (this.inFlight) throw requestError(409, "Auto-trading cycle already in progress", { error: "Auto-trading cycle already in progress" });
    const credentials = resolveEngineCredentials(config.sandbox);
    // Shadow mode can run on market data alone (paper balance); live mode needs an OKX account.
    if (!credentials && !config.shadowMode) {
      throw requestError(400, `Missing OKX credentials for ${config.sandbox ? "demo" : "live"} mode`, {
        error: `Missing OKX credentials for ${config.sandbox ? "demo" : "live"} mode`
      });
    }
    if (credentials) await assertAutoTradingExchangeReady(credentials, config.sandbox);
    if (!credentials || getMarketDataProvider().id !== "okx") await assertMarketDataReady();

    if (providedConfig) {
      updateAutoTradingStore({ config });
    }
    pushAutoTradingLog("Manual auto-trading cycle requested");
    await this.executeCycle(config, "manual", Boolean(appStore.autoTrading.config && appStore.autoTrading.state !== "stopped"));
    return this.status();
  }

  private schedule(delayMs: number) {
    if (this.stopRequested) return;
    if (this.timer) clearTimeout(this.timer);
    const boundedDelay = Math.max(0, delayMs);
    updateAutoTradingStore({
      nextRunAt: Date.now() + boundedDelay,
      state: boundedDelay === 0 ? "starting" : appStore.autoTrading.state,
    });
    this.timer = setTimeout(() => {
      const config = sanitizeAutoTradingConfig(appStore.autoTrading.config);
      if (!config) {
        updateAutoTradingStore({ state: "stopped", nextRunAt: null });
        return;
      }
      void this.executeCycle(config, "scheduled", true);
    }, boundedDelay);
  }

  private async executeCycle(config: AutoTradingConfig, trigger: "scheduled" | "manual", keepAlive: boolean) {
    if (this.inFlight) return this.status();
    this.inFlight = true;
    updateAutoTradingStore({
      state: this.stopRequested ? "stopping" : "running",
      config,
      nextRunAt: null,
      lastError: null,
    });

    try {
      const { summary, nextDelayMs } = await runAutoTradingCycle(config, trigger);
      pushAutoTradingSummary(summary);
      if (keepAlive && !this.stopRequested) {
        updateAutoTradingStore({ state: "running" });
        this.schedule(nextDelayMs);
      } else {
        updateAutoTradingStore({
          state: "stopped",
          nextRunAt: null,
        });
      }
      return this.status();
    } catch (error: any) {
      const message = error?.message || String(error);
      pushAutoTradingLog(`Auto-trading cycle failed: ${message}`);
      const fallbackSummary: AutoTradingCycleSummary = {
        cycleId: `cycle_error_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
        trigger,
        startedAt: Date.now(),
        completedAt: Date.now(),
        durationMs: 0,
        scannedSymbols: 0,
        scannedTargets: 0,
        strategiesEvaluated: 0,
        candidates: 0,
        selected: 0,
        ordersPlaced: 0,
        shadowOrders: 0,
        skippedReason: "cycle_error",
        macroGate: appStore.riskState.macroGate,
        macroScore: appStore.riskState.macroScore,
        error: message,
      };
      pushAutoTradingSummary(fallbackSummary);
      if (keepAlive && !this.stopRequested) {
        if (isExchangeConnectivityFailure(error)) {
          const connectivity = markExchangeConnectivityFailure(error, {
            okxPrivate: false,
            proxy: getExchangeProxyStatus(),
          });
          const retryDelayMs = Math.max(0, Number(connectivity.nextRetryAt || 0) - Date.now());
          pushAutoTradingLog(`OKX connection unavailable; auto-trading will retry in ${Math.max(1, Math.round(retryDelayMs / 1000))}s.`);
          updateAutoTradingStore({
            state: "error",
            nextRunAt: connectivity.nextRetryAt,
            lastError: message,
          });
          this.schedule(retryDelayMs);
          return this.status();
        }
        updateAutoTradingStore({
          state: "error",
          lastError: message,
        });
        this.schedule(AUTO_TRADING_MIN_DELAY_MS);
      } else {
        updateAutoTradingStore({
          state: "stopped",
          nextRunAt: null,
          lastError: message,
        });
      }
      throw error;
    } finally {
      this.inFlight = false;
      if (this.stopRequested) {
        updateAutoTradingStore({
          state: "stopped",
          nextRunAt: null,
        });
        this.stopRequested = false;
      }
    }
  }
}

export const autoTradingEngine = new AutoTradingEngine();
