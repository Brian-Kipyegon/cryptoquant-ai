import express from "express";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import { AUTO_TRADING_ALLOWED_SYMBOLS, AUTO_TRADING_ALLOWED_TIMEFRAMES, DEFAULT_AUTO_TRADING_RISK_CONFIG, normalizeDisplaySymbol, type AutoTradingRiskConfig } from "../../src/lib/tradingRuntime";
import { APP_STORE_FILE, DATA_DIR } from "../config";
import { AutoTradingConfig, AutoTradingCycleSummary, AutoTradingDecisionTrace, AutoTradingScanProfile, AutoTradingStore, OperatorSession, OrderLifecycleEvent, PersistentRiskState, SecurityEvent } from "../types";
import { getAdminPassword } from "../auth/session";
import { writeFileAtomic } from "../utils";

export function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createDefaultRiskState(): PersistentRiskState {
  return {
    date: todayKey(),
    dailyPnL: 0,
    consecutiveStopLosses: 0,
    macroGate: "ALLOW_FULL",
    macroScore: 0,
    newRiskBlocked: false,
    killSwitchActive: false,
    cooldownUntil: 0,
    updatedAt: Date.now(),
  };
}

export function createDefaultAutoTradingStore(): AutoTradingStore {
  return {
    state: "stopped",
    config: null,
    recentLogs: [],
    recentCycleSummaries: [],
    decisionTraces: [],
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
    engineStartedAt: null,
  };
}

export function sanitizeAutoTradingLogEntry(line: unknown) {
  if (typeof line !== "string") return "";
  const prefixMatch = line.match(/^(\[[^\]]+\]\s*)/);
  const prefix = prefixMatch?.[1] || "";
  const message = line.slice(prefix.length);
  const modeMatch = message.match(/\((DEMO|LIVE)\)/);

  if (message.includes("自动交易引擎已启动") && modeMatch) {
    return `${prefix}自动交易引擎已启动 (${modeMatch[1]})`;
  }

  if (message === "No auto-trading candidates passed the filters in this cycle") {
    return `${prefix}本轮没有候选信号通过筛选`;
  }

  if (message === "All candidates were filtered out before execution") {
    return `${prefix}所有候选信号都在执行前被过滤`;
  }

  if (message === "Manual auto-trading cycle requested") {
    return `${prefix}已触发手动自动交易扫描`;
  }

  if (message === "Auto-trading engine stopped") {
    return `${prefix}自动交易引擎已停止`;
  }

  if (message === "Stop requested; the current cycle will finish before shutdown") {
    return `${prefix}已请求停止，当前周期完成后关闭`;
  }

  const scanMatch = message.match(/^Scan started \((scheduled|manual), (.+)\)$/);
  if (scanMatch) {
    return `${prefix}开始扫描 (${scanMatch[1] === "manual" ? "手动" : "定时"}, ${scanMatch[2]})`;
  }

  const configMatch = message.match(/^Auto-trading config updated \((DEMO|LIVE), shadow=(on|off)\)$/);
  if (configMatch) {
    return `${prefix}自动交易配置已更新 (${configMatch[1]}, shadow=${configMatch[2]})`;
  }

  return line;
}

export const appStore = {
  sessions: [] as OperatorSession[],
  securityEvents: [] as SecurityEvent[],
  orderLifecycle: [] as OrderLifecycleEvent[],
  riskState: createDefaultRiskState(),
  autoTrading: createDefaultAutoTradingStore(),
};

export let adminPasswordHash = "";
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
export const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000;

export function hashSecret(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function timingSafeEqualString(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function getRequestIp(req: express.Request) {
  const forwarded = req.headers["x-forwarded-for"];
  return Array.isArray(forwarded) ? forwarded[0] : String(forwarded || req.socket.remoteAddress || "");
}

export function addSecurityEvent(type: string, req?: express.Request, details?: any, username?: string) {
  appStore.securityEvents.unshift({
    id: `sec_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    type,
    username,
    path: req?.path,
    method: req?.method,
    ip: req ? getRequestIp(req) : undefined,
    userAgent: req ? String(req.headers["user-agent"] || "") : undefined,
    details,
    timestamp: Date.now(),
  });
  if (appStore.securityEvents.length > 1000) appStore.securityEvents.length = 1000;
  persistAppStore().catch(error => console.error("[OpsStore] Persist failed:", error));
}

export function addOrderLifecycle(event: Omit<OrderLifecycleEvent, "id" | "timestamp">) {
  appStore.orderLifecycle.unshift({
    ...event,
    id: `ordlife_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    timestamp: Date.now(),
  });
  if (appStore.orderLifecycle.length > 2000) appStore.orderLifecycle.length = 2000;
  persistAppStore().catch(error => console.error("[OpsStore] Persist failed:", error));
}

export function normalizeRiskStateDate() {
  const today = todayKey();
  if (appStore.riskState.date !== today) {
    appStore.riskState = {
      ...appStore.riskState,
      date: today,
      dailyPnL: 0,
      consecutiveStopLosses: 0,
      killSwitchActive: false,
      newRiskBlocked: false,
      lastKillSwitchReason: undefined,
      cooldownUntil: 0,
      updatedAt: Date.now(),
    };
  }
}

export function updatePersistentRiskState(patch: Partial<PersistentRiskState> & { event?: string; reason?: string }) {
  normalizeRiskStateDate();
  appStore.riskState = {
    ...appStore.riskState,
    ...patch,
    updatedAt: Date.now(),
  };
  if (patch.reason) appStore.riskState.lastKillSwitchReason = patch.reason;
  if (patch.event === "stop_loss") appStore.riskState.consecutiveStopLosses += 1;
  if (patch.event === "profit") appStore.riskState.consecutiveStopLosses = 0;
  const cooldownActive = appStore.riskState.cooldownUntil > Date.now();
  appStore.riskState.newRiskBlocked = Boolean(appStore.riskState.killSwitchActive || cooldownActive || appStore.riskState.macroGate === "BLOCK_NEW_RISK");
  persistAppStore().catch(error => console.error("[OpsStore] Persist failed:", error));
  return appStore.riskState;
}

export async function loadAppStore() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    let appStoreSanitized = false;
    if (fs.existsSync(APP_STORE_FILE)) {
      const raw = await fsp.readFile(APP_STORE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      const recentLogs = Array.isArray(parsed.autoTrading?.recentLogs)
        ? parsed.autoTrading.recentLogs
            .slice(0, 200)
            .map((entry: unknown) => sanitizeAutoTradingLogEntry(entry))
            .filter(Boolean)
        : [];
      appStoreSanitized = Array.isArray(parsed.autoTrading?.recentLogs)
        && recentLogs.some((entry: string, index: number) => entry !== parsed.autoTrading.recentLogs[index]);
      appStore.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      appStore.securityEvents = Array.isArray(parsed.securityEvents) ? parsed.securityEvents.slice(0, 1000) : [];
      appStore.orderLifecycle = Array.isArray(parsed.orderLifecycle) ? parsed.orderLifecycle.slice(0, 2000) : [];
      appStore.riskState = { ...createDefaultRiskState(), ...(parsed.riskState || {}) };
      appStore.autoTrading = {
        ...createDefaultAutoTradingStore(),
        ...(parsed.autoTrading || {}),
        recentLogs,
        recentCycleSummaries: Array.isArray(parsed.autoTrading?.recentCycleSummaries) ? parsed.autoTrading.recentCycleSummaries.slice(0, 50) : [],
        decisionTraces: Array.isArray(parsed.autoTrading?.decisionTraces) ? parsed.autoTrading.decisionTraces.slice(0, 500) : [],
      };
    }

    const password = await getAdminPassword();
    adminPasswordHash = hashSecret(password);
    const now = Date.now();
    appStore.sessions = appStore.sessions.filter(session => session.expiresAt > now);
    if (appStoreSanitized) {
      await persistAppStore();
    }
    console.log("[OpsStore] Local operations store loaded.");
  } catch (error) {
    console.warn("[OpsStore] Failed to load local operations store:", error);
  }
}

export async function persistAppStore() {
  await writeFileAtomic(APP_STORE_FILE, JSON.stringify(appStore, null, 2), { mode: 0o600 });
}

export const AUTO_TRADING_LOG_LIMIT = 200;
export const AUTO_TRADING_SUMMARY_LIMIT = 50;
export const AUTO_TRADING_TRACE_LIMIT = 500;
export const AUTO_TRADING_MIN_DELAY_MS = 60_000;
export const AUTO_TRADING_MAX_DELAY_MS = 15 * 60_000;
export const AUTO_TRADING_BASE_DELAY_MS = 5 * 60_000;
export const TP_MANAGER_INTERVAL_MS = 60_000;
export const TP_MANAGER_COOLDOWN_MS = 120_000;
export const TP_MANAGER_MAX_AMENDS = 5;
export const TP_MANAGER_MIN_PRICE_PCT = 0.002;
export const TP_MANAGER_MIN_R_MULTIPLIER = 0.25;

export function sanitizeAutoTradingRiskConfig(input: Partial<AutoTradingRiskConfig> | undefined): AutoTradingRiskConfig {
  return {
    ...DEFAULT_AUTO_TRADING_RISK_CONFIG,
    ...(input || {}),
  };
}

export const DEFAULT_AUTO_TRADING_SCAN_PROFILES: AutoTradingScanProfile[] = [
  { symbol: "BTC/USDT", timeframes: ["15m", "1h"] },
  { symbol: "ETH/USDT", timeframes: ["15m", "1h"] },
  { symbol: "SOL/USDT", timeframes: ["1h"] },
  { symbol: "DOGE/USDT", timeframes: ["1h"] },
];
export const AUTO_TRADING_SCAN_PROFILES_VERSION = 2;

export const DEFAULT_TIMEFRAME_BY_SYMBOL = new Map(
  DEFAULT_AUTO_TRADING_SCAN_PROFILES.map((profile) => [profile.symbol, profile.timeframes[0] || "1h"])
);

export function normalizeScanProfiles(input: any): AutoTradingScanProfile[] {
  const allowedSymbols = new Set<string>(AUTO_TRADING_ALLOWED_SYMBOLS as readonly string[]);
  const allowedTimeframes = new Set<string>(AUTO_TRADING_ALLOWED_TIMEFRAMES as readonly string[]);
  const sourceProfiles = shouldMigrateLegacyScanProfiles(input)
    ? DEFAULT_AUTO_TRADING_SCAN_PROFILES
    : Array.isArray(input?.scanProfiles)
    ? input.scanProfiles
    : DEFAULT_AUTO_TRADING_SCAN_PROFILES;

  const normalized = new Map<string, Set<string>>();
  for (const profile of sourceProfiles) {
    const symbol = normalizeDisplaySymbol(profile?.symbol || "");
    if (!allowedSymbols.has(symbol)) continue;
    const timeframes = Array.isArray(profile?.timeframes) ? profile.timeframes : [];
    const validTimeframes = timeframes
      .map((value) => String(value || "").trim())
      .filter((value) => allowedTimeframes.has(value));
    const nextTimeframes = validTimeframes.length
      ? validTimeframes
      : [DEFAULT_TIMEFRAME_BY_SYMBOL.get(symbol) || "1h"];
    if (!normalized.has(symbol)) normalized.set(symbol, new Set<string>());
    for (const timeframe of nextTimeframes) {
      normalized.get(symbol)!.add(timeframe);
    }
  }

  return Array.from(normalized.entries()).map(([symbol, timeframes]) => ({
    symbol,
    timeframes: Array.from(timeframes).sort((left, right) => left.localeCompare(right)),
  }));
}

export function shouldMigrateLegacyScanProfiles(input: any) {
  if (!input || Number(input.scanProfilesVersion || 0) >= AUTO_TRADING_SCAN_PROFILES_VERSION) return false;
  if (!Array.isArray(input.scanProfiles) || input.scanProfiles.length === 0) return true;

  const profiles = input.scanProfiles
    .map((profile: any) => ({
      symbol: normalizeDisplaySymbol(profile?.symbol || ""),
      timeframes: Array.isArray(profile?.timeframes)
        ? profile.timeframes.map((value: unknown) => String(value || "").trim()).filter(Boolean)
        : [],
    }))
    .filter((profile: AutoTradingScanProfile) => profile.symbol);
  const bySymbol = new Map(profiles.map((profile: AutoTradingScanProfile) => [profile.symbol, profile.timeframes]));
  const hasAllDefaultSymbols = DEFAULT_AUTO_TRADING_SCAN_PROFILES.every((profile) => bySymbol.has(profile.symbol));
  const everyProfileSingleOneHour = profiles.length > 0 && profiles.every((profile: AutoTradingScanProfile) => (
    profile.timeframes.length === 1 && profile.timeframes[0] === "1h"
  ));

  return !hasAllDefaultSymbols && everyProfileSingleOneHour;
}

export function getScanSymbols(config: AutoTradingConfig) {
  return config.scanProfiles.map((profile) => profile.symbol);
}

export function getDefaultTimeframeForSymbol(config: AutoTradingConfig | null | undefined, symbol: string) {
  const normalizedSymbol = normalizeDisplaySymbol(symbol);
  const matched = config?.scanProfiles.find((profile) => profile.symbol === normalizedSymbol);
  return matched?.timeframes[0] || DEFAULT_TIMEFRAME_BY_SYMBOL.get(normalizedSymbol) || "1h";
}

export function serializeAutoTradingConfig(config: AutoTradingConfig | null) {
  if (!config) return null;
  const scanProfiles = config.scanProfiles.map((profile) => ({
    symbol: profile.symbol,
    timeframes: [...profile.timeframes],
  }));
  const allTimeframes = Array.from(new Set(scanProfiles.flatMap((profile) => profile.timeframes)));
  return {
    ...config,
    scanProfilesVersion: AUTO_TRADING_SCAN_PROFILES_VERSION,
    scanProfiles,
    symbols: getScanSymbols(config),
    chartTimeframe: allTimeframes.length === 1 ? allTimeframes[0] : "multi",
  };
}

export function getCorrelationGroup(symbol: string) {
  const normalizedSymbol = normalizeDisplaySymbol(symbol);
  if (normalizedSymbol === "BTC/USDT" || normalizedSymbol === "ETH/USDT") return "majors";
  if (normalizedSymbol === "SOL/USDT") return "sol";
  if (normalizedSymbol === "DOGE/USDT") return "doge";
  return normalizedSymbol;
}

export function sanitizeAutoTradingConfig(input: Partial<AutoTradingConfig> | null | undefined): AutoTradingConfig | null {
  if (!input) return null;
  const normalizedScanProfiles = normalizeScanProfiles(input);
  const normalizedStrategies = Array.from(new Set((Array.isArray(input.strategyIds) ? input.strategyIds : [])
    .map(value => String(value || "").trim())
    .filter(Boolean)));
  if (normalizedScanProfiles.length === 0 || normalizedStrategies.length === 0) return null;
  return {
    sandbox: Boolean(input.sandbox),
    scanProfilesVersion: AUTO_TRADING_SCAN_PROFILES_VERSION,
    scanProfiles: normalizedScanProfiles,
    strategyIds: normalizedStrategies,
    riskConfigSnapshot: sanitizeAutoTradingRiskConfig(input.riskConfigSnapshot),
    shadowMode: input.shadowMode ?? input.riskConfigSnapshot?.shadowMode ?? DEFAULT_AUTO_TRADING_RISK_CONFIG.shadowMode,
  };
}

export function updateAutoTradingStore(patch: Partial<AutoTradingStore>) {
  appStore.autoTrading = {
    ...appStore.autoTrading,
    ...patch,
    recentLogs: patch.recentLogs ?? appStore.autoTrading.recentLogs,
    recentCycleSummaries: patch.recentCycleSummaries ?? appStore.autoTrading.recentCycleSummaries,
    decisionTraces: patch.decisionTraces ?? appStore.autoTrading.decisionTraces,
  };
  persistAppStore().catch(error => console.error("[AutoTrading] Persist failed:", error));
  return appStore.autoTrading;
}

export function pushAutoTradingLog(message: string) {
  const line = `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${message}`;
  const recentLogs = [line, ...appStore.autoTrading.recentLogs].slice(0, AUTO_TRADING_LOG_LIMIT);
  updateAutoTradingStore({ recentLogs });
  return line;
}

export function pushAutoTradingSummary(summary: AutoTradingCycleSummary) {
  const recentCycleSummaries = [summary, ...appStore.autoTrading.recentCycleSummaries].slice(0, AUTO_TRADING_SUMMARY_LIMIT);
  updateAutoTradingStore({
    recentCycleSummaries,
    lastRunAt: summary.completedAt,
    lastError: summary.error || null,
  });
  return summary;
}

export function pushAutoTradingTrace(trace: Omit<AutoTradingDecisionTrace, "id" | "createdAt">) {
  const entry: AutoTradingDecisionTrace = {
    ...trace,
    id: `trace_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    createdAt: Date.now(),
  };
  const decisionTraces = [entry, ...appStore.autoTrading.decisionTraces].slice(0, AUTO_TRADING_TRACE_LIMIT);
  updateAutoTradingStore({ decisionTraces });
  return entry;
}

// --- Local Trading Database ---
