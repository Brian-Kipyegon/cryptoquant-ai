import React from "react";
import clsx from "clsx";
import {
  FlaskConical,
  History,
  LayoutDashboard,
  Radar,
  ScrollText,
  Settings,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react";

import type { AppPage, AutoTradingConfig, MacroResponse, ResearchStat, RiskState } from "./api";
import { DEFAULT_UNIVERSE_CONFIG } from "../lib/universe";
import {
  AUTO_TRADING_ALLOWED_SYMBOLS,
  DEFAULT_AUTO_TRADING_RISK_CONFIG,
  normalizeDisplaySymbol,
  type AutoTradingRiskConfig,
  type MarketAnalysisState,
  type OrderBook,
  type Ticker,
} from "../lib/tradingRuntime";

export type CredentialsForm = {
  okxKey: string;
  okxSecret: string;
  okxPass: string;
  okxDemoKey: string;
  okxDemoSecret: string;
  okxDemoPass: string;
  aiUrl: string;
  aiKey: string;
  aiModel: string;
  aiSummaryModel: string;
  aiVisionModel: string;
};

export type ToastState = {
  kind: "success" | "error" | "info";
  message: string;
} | null;

export type AuditDrilldownMode = "regime" | "symbol";

export type AuditDrilldownState = {
  open: boolean;
  mode: AuditDrilldownMode;
  selectedKey: string | null;
};

export type ScanProfileDraft = {
  symbol: string;
  enabled: boolean;
  timeframes: string[];
};

export type RuntimeMarketState = {
  tickers: Record<string, Ticker>;
  ticker: Ticker | null;
  orderBook: OrderBook | null;
  funding: Record<string, unknown> | null;
  ohlcv: number[][];
  macro: MacroResponse | null;
  marketAnalysis: MarketAnalysisState;
};

export type BacktestForm = {
  symbol: string;
  symbols: string[];
  timeframe: string;
  strategy: string;
  strategyIds: string[];
  period: number;
  initialEquity: number;
  trainDays: number;
  validationDays: number;
  stepDays: number;
  stopLoss: number;
  takeProfit: number;
  estimatedFeeRate: number;
  minTrainTrades: number;
  riskPerTradePct: number;
};

export const TOKEN_KEYS = ["operator_token", "cq_admin_token"];
export const UI_PAGE_KEY = "cq_ui_page";
export const UI_SYMBOL_KEY = "cq_ui_symbol";
export const UI_TIMEFRAME_KEY = "cq_ui_chart_timeframe";

export const DEFAULT_SCAN_PROFILES: AutoTradingConfig["scanProfiles"] = [
  { symbol: "BTC/USDT", timeframes: ["15m", "1h"] },
  { symbol: "ETH/USDT", timeframes: ["15m", "1h"] },
  { symbol: "SOL/USDT", timeframes: ["1h"] },
  { symbol: "DOGE/USDT", timeframes: ["1h"] },
];

export const DEFAULT_STRATEGIES = ["trend-breakout", "mean-reversion"];

export const NAV_ITEMS: Array<{
  key: AppPage;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "market", label: "Market", icon: TrendingUp },
  { key: "history", label: "History", icon: History },
  { key: "portfolio", label: "Portfolio", icon: Wallet },
  { key: "backtest", label: "Backtest", icon: FlaskConical },
  { key: "reliability", label: "Reliability", icon: ShieldCheck },
  { key: "audit", label: "Audit", icon: ScrollText },
  { key: "diagnostics", label: "Diagnostics", icon: Radar },
  { key: "settings", label: "Settings", icon: Settings },
];

const STAGE_LABELS: Record<string, string> = {
  market_data: "Market data ready",
  strategy_signal: "Strategy signal",
  confidence_gate: "Confidence threshold",
  macro_gate: "Macro gate",
  persistent_risk: "Persistent risk",
  portfolio_limit: "Portfolio limit",
  correlation_filter: "Correlation filter",
  timeframe_conflict: "Timeframe conflict",
  position_sizing: "Position sizing",
  account_risk_check: "Account risk check",
  shadow_mode: "Shadow mode",
  order_submit: "Order submit",
};

const EXIT_REASON_LABELS: Record<string, string> = {
  take_profit: "Take profit",
  stop_loss: "Stop loss",
  reverse_signal: "Reverse signal",
};

export function readStoredToken() {
  if (typeof window === "undefined") return "";
  for (const key of TOKEN_KEYS) {
    const value = window.sessionStorage.getItem(key);
    if (value) return value;
  }
  return "";
}

export function persistToken(token: string) {
  if (typeof window === "undefined") return;
  for (const key of TOKEN_KEYS) {
    window.sessionStorage.setItem(key, token);
  }
}

export function clearToken() {
  if (typeof window === "undefined") return;
  for (const key of TOKEN_KEYS) {
    window.sessionStorage.removeItem(key);
  }
}

export function readUiPref<T extends string>(key: string, fallback: T) {
  if (typeof window === "undefined") return fallback;
  return (window.localStorage.getItem(key) as T) || fallback;
}

export function persistUiPref(key: string, value: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
}

export function parseJsonSafely(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function formatDateTime(value?: number | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { hour12: false });
}

export function formatDateOnly(value?: number | null) {
  if (!value) return "";
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatPrice(value?: number | null, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatUsd(value?: number | null, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${formatPrice(value, digits)} USDT`;
}

export function formatPct(value?: number | null, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(digits)}%`;
}

export function stageLabel(stage?: string | null) {
  if (!stage) return "Passed";
  return STAGE_LABELS[stage] || stage;
}

export function exitReasonLabel(reason?: string | null) {
  if (!reason) return "—";
  return EXIT_REASON_LABELS[reason] || reason;
}

export function riskStatusLabel(riskState: RiskState | null) {
  if (!riskState) return "Loading";
  if (riskState.killSwitchActive) return "Kill Switch";
  if (riskState.newRiskBlocked) return "Paused after losses";
  return "Running";
}

export function mergeConfig(
  config: AutoTradingConfig | null,
  patch: Omit<Partial<AutoTradingConfig>, "riskConfigSnapshot"> & {
    riskConfigSnapshot?: Partial<AutoTradingRiskConfig>;
  }
): AutoTradingConfig {
  const base = config || {
    sandbox: false,
    scanProfilesVersion: 2,
    scanProfiles: DEFAULT_SCAN_PROFILES,
    universe: DEFAULT_UNIVERSE_CONFIG,
    strategyIds: DEFAULT_STRATEGIES,
    riskConfigSnapshot: DEFAULT_AUTO_TRADING_RISK_CONFIG,
    shadowMode: DEFAULT_AUTO_TRADING_RISK_CONFIG.shadowMode,
  };

  return {
    ...base,
    ...patch,
    scanProfilesVersion: patch.scanProfilesVersion ?? base.scanProfilesVersion ?? 2,
    scanProfiles: patch.scanProfiles ?? base.scanProfiles,
    universe: patch.universe ?? base.universe,
    strategyIds: patch.strategyIds ?? base.strategyIds,
    riskConfigSnapshot: {
      ...base.riskConfigSnapshot,
      ...(patch.riskConfigSnapshot || {}),
    },
    shadowMode: patch.shadowMode ?? base.shadowMode,
  };
}

/** Header symbol choices: pairs with tickers (most liquid first), the defaults, and the current selection. */
export function abbreviateCycleId(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "—";
  if (text.length <= 20) return text;
  return `${text.slice(0, 8)}...${text.slice(-8)}`;
}

export function buildSymbolOptions(tickers: Record<string, unknown> | null | undefined, selected: string) {
  const ranked = Object.entries(tickers || {})
    .sort(([, left], [, right]) => Number((right as any)?.quoteVolume || 0) - Number((left as any)?.quoteVolume || 0))
    .map(([symbol]) => symbol);
  return Array.from(new Set([...ranked, ...AUTO_TRADING_ALLOWED_SYMBOLS, selected].filter(Boolean)));
}

export function profilesToDraft(config: AutoTradingConfig | null): ScanProfileDraft[] {
  const active = new Map(
    (config?.scanProfiles || DEFAULT_SCAN_PROFILES).map((profile) => [
      normalizeDisplaySymbol(profile.symbol),
      [...profile.timeframes],
    ])
  );

  return AUTO_TRADING_ALLOWED_SYMBOLS.map((symbol) => {
    const timeframes = active.get(symbol) || [];
    return {
      symbol,
      enabled: active.has(symbol),
      timeframes: timeframes.length ? timeframes : ["1h"],
    };
  });
}

export function draftToProfiles(draft: ScanProfileDraft[]) {
  return draft
    .filter((row) => row.enabled)
    .map((row) => ({
      symbol: row.symbol,
      timeframes: row.timeframes.length ? [...row.timeframes].sort() : ["1h"],
    }));
}

export function groupTotals(source: Record<string, ResearchStat>, selectedKey: string | null) {
  const entries = Object.entries(source);
  const filtered = selectedKey ? entries.filter(([key]) => key === selectedKey) : entries;
  const totals = filtered.reduce(
    (acc, [, stat]) => {
      acc.trades += Number(stat.trades || 0);
      acc.pnl += Number(stat.pnl || 0);
      acc.weightedWin += Number(stat.winRate || 0) * Number(stat.trades || 0);
      acc.weightedPf += Number(stat.profitFactor || 0) * Number(stat.trades || 0);
      acc.weightedExpectancy += Number(stat.expectancy || 0) * Number(stat.trades || 0);
      return acc;
    },
    { trades: 0, pnl: 0, weightedWin: 0, weightedPf: 0, weightedExpectancy: 0 }
  );

  return {
    trades: totals.trades,
    pnl: totals.pnl,
    winRate: totals.trades ? totals.weightedWin / totals.trades : 0,
    profitFactor: totals.trades ? totals.weightedPf / totals.trades : 0,
    expectancy: totals.trades ? totals.weightedExpectancy / totals.trades : 0,
  };
}

export function cardClassName(extra?: string) {
  return clsx(
    "rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.25)] backdrop-blur",
    extra
  );
}
