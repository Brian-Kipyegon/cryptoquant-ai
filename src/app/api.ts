import type { AutoTradingRiskConfig, MarketAnalysisState, OrderBook, Ticker } from "../lib/tradingRuntime";
import type { UniverseConfig } from "../lib/universe";
export type {
  PortfolioReturnAnalytics,
  PortfolioReturnBillInput,
  PortfolioReturnCurvePoint,
  PortfolioReturnGroup,
  PortfolioReturnHistoryRow,
  PortfolioReturnMode,
  PortfolioReturnRange,
  PortfolioReturnSource,
  PortfolioReturnSourceStatus,
  PortfolioReturnSummary,
} from "../lib/portfolioReturns";

export type AppPage =
  | "dashboard"
  | "market"
  | "history"
  | "portfolio"
  | "backtest"
  | "reliability"
  | "audit"
  | "diagnostics"
  | "settings";

export type SessionUser = {
  username: string;
  role: string;
};

export type AuthSessionResponse = {
  authenticated: boolean;
  user?: SessionUser | null;
  expiresAt?: number;
};

export type ConfigStatus = {
  okx?: boolean;
  okxLive?: boolean;
  okxDemo?: boolean;
  ai?: boolean;
  aiProxy?: boolean;
  zhipu?: boolean;
  smtp?: boolean;
  auth?: {
    required: boolean;
    authenticated: boolean;
    user: SessionUser | null;
  };
};

export type AutoTradingScanProfile = {
  symbol: string;
  timeframes: string[];
};

export type AutoTradingConfig = {
  sandbox: boolean;
  scanProfilesVersion?: number;
  scanProfiles: AutoTradingScanProfile[];
  universe?: UniverseConfig;
  strategyIds: string[];
  riskConfigSnapshot: AutoTradingRiskConfig;
  shadowMode: boolean;
  symbols?: string[];
  chartTimeframe?: string;
};

export type AutoTradingStatus = {
  state: "stopped" | "starting" | "running" | "stopping" | "error";
  config: AutoTradingConfig | null;
  inFlight: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastError: string | null;
  recentCycleSummary: AutoTradingCycleSummary | null;
  engineStartedAt: number | null;
  exchangeConnectivity?: {
    checkedAt: number | null;
    lastCheckedAt: number | null;
    okxPublic: boolean | null;
    okxPrivate: boolean | null;
    marketData?: boolean | null;
    marketDataExchange?: string | null;
    error: string | null;
    lastError: string | null;
    nextRetryAt: number | null;
    consecutiveFailures: number;
    proxy: {
      configured: boolean;
      url: string | null;
      local: boolean;
      reachable: boolean | null;
      bypassed: boolean;
      reason?: string | null;
    };
  };
};

export type AutoTradingDecisionStage =
  | "market_data"
  | "strategy_signal"
  | "confidence_gate"
  | "macro_gate"
  | "persistent_risk"
  | "portfolio_limit"
  | "correlation_filter"
  | "timeframe_conflict"
  | "position_sizing"
  | "account_risk_check"
  | "shadow_mode"
  | "order_submit";

export type AutoTradingDecisionStep = {
  name: AutoTradingDecisionStage;
  status: "pass" | "fail" | "skip";
  reason?: string;
  metrics?: Record<string, unknown>;
  at: number;
};

export type AutoTradingTrace = {
  id: string;
  cycleId: string;
  trigger: "scheduled" | "manual";
  symbol: string;
  timeframe: string;
  strategyId: string;
  signal: string;
  confidence: number;
  requiredConfidence: number;
  shadowMode: boolean;
  macroGate: string;
  blockedAt: AutoTradingDecisionStage | null;
  blockedReason: string | null;
  steps: AutoTradingDecisionStep[];
  createdAt: number;
};

export type AutoTradingCycleSummary = {
  cycleId: string;
  trigger: "scheduled" | "manual";
  startedAt: number;
  completedAt: number;
  durationMs: number;
  scannedSymbols: number;
  scannedTargets: number;
  strategiesEvaluated: number;
  candidates: number;
  selected: number;
  ordersPlaced: number;
  shadowOrders: number;
  skippedReason?: string;
  macroGate: string;
  macroScore: number;
  error?: string | null;
};

export type RiskState = {
  date: string;
  dailyPnL: number;
  consecutiveStopLosses: number;
  macroGate: string;
  macroScore: number;
  newRiskBlocked: boolean;
  killSwitchActive: boolean;
  cooldownUntil: number;
  updatedAt: number;
  lastKillSwitchReason?: string;
};

export type OrderLifecycleEvent = {
  id: string;
  requestId: string;
  clientOrderId?: string;
  orderId?: string;
  symbol: string;
  side: string;
  amount?: number;
  amountType?: string;
  status: string;
  source?: string;
  strategyId?: string;
  sandbox?: boolean;
  operator?: string;
  details?: Record<string, unknown>;
  timestamp: number;
};

export type SecurityEvent = {
  id: string;
  type: string;
  username?: string;
  path?: string;
  method?: string;
  ip?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
  timestamp: number;
};

export type ShadowOrder = {
  id: string;
  symbol: string;
  side: string;
  strategy_id: string | null;
  theoretical_price: number | null;
  executable_price: number | null;
  spread_bps: number | null;
  slippage_bps: number | null;
  latency_ms: number | null;
  amount: number | null;
  amount_type: string | null;
  regime: string | null;
  macro_gate: string | null;
  orderbook_json: string | null;
  signal_json: string | null;
  status: "open" | "closed" | "estimated_skipped";
  timeframe: string | null;
  leverage: number | null;
  tp_price: number | null;
  sl_price: number | null;
  entry_price: number | null;
  mark_price: number | null;
  qty_estimate: number | null;
  unrealized_pnl: number | null;
  exit_price: number | null;
  realized_pnl: number | null;
  exit_reason: "take_profit" | "stop_loss" | "reverse_signal" | null;
  closed_at: number | null;
  last_evaluated_at: number | null;
  is_estimated: number;
  estimated_timeframe: string | null;
  estimation_note: string | null;
  created_at: number;
};

export type ShadowSummary = {
  openCount: number;
  closedCount: number;
  realizedPnl: number;
  unrealizedPnl: number;
  winRate: number;
  avgHoldMinutes: number;
  estimatedCount: number;
};

export type ResearchStat = {
  trades: number;
  pnl: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
};

export type ResearchWeekly = {
  generatedAt: number;
  totals: {
    trades: number;
    shadowOrders: number;
    shadowAvgSlippageBps: number;
    shadowWorstSlippageBps: number;
  };
  byRegime: Record<string, ResearchStat>;
  bySymbol: Record<string, ResearchStat>;
  byMacroGate: Record<string, ResearchStat>;
  byStopDistance: Record<string, ResearchStat>;
  byEntryReason: Record<string, ResearchStat>;
  aiVeto: Record<string, ResearchStat>;
  recentShadowOrders: ShadowOrder[];
};

export type AuditSummary = {
  version: string;
  counts: {
    aiSnapshots: number;
    orderReceipts: number;
    riskEvents: number;
    positionChanges: number;
    orderLifecycle: number;
    securityEvents: number;
  };
};

export type TradeRow = {
  id: string;
  symbol?: string | null;
  strategy_id?: string | null;
  timeframe?: string | null;
  side?: string | null;
  regime?: string | null;
  entry_reason?: string | null;
  entry_price?: number | null;
  exit_price?: number | null;
  stop_loss_price?: number | null;
  take_profit_price?: number | null;
  initial_tp_price?: number | null;
  current_tp_price?: number | null;
  tp_amend_count?: number | null;
  tp_manager_status?: string | null;
  last_tp_manager_reason?: string | null;
  attached_tp_algo_id?: string | null;
  attached_tp_algo_cl_ord_id?: string | null;
  realized_pnl?: number | null;
  estimated_fee?: number | null;
  amount?: number | null;
  amount_type?: string | null;
  exit_reason?: string | null;
  created_at?: number;
  closed_at?: number | null;
  [key: string]: unknown;
};

export type BalanceResponse = {
  free?: Record<string, number>;
  total?: Record<string, number>;
  used?: Record<string, number>;
  availableUSDT?: number;
  equityUSDT?: number;
  info?: {
    data?: Array<{
      totalEq?: string;
      adjEq?: string;
      availEq?: string;
      details?: Array<{
        ccy?: string;
        eq?: string;
        cashBal?: string;
        availBal?: string;
        availEq?: string;
        eqUsd?: string;
      }>;
    }>;
  };
  [key: string]: any;
};

export type PositionRow = {
  symbol: string;
  side: string;
  contracts: number;
  leverage?: number;
  entryPrice?: number;
  markPrice?: number;
  liquidationPrice?: number;
  pnl?: number;
  percentage?: number;
  info?: Record<string, unknown>;
  [key: string]: any;
};

export type HistoryOrderRow = {
  id: string;
  clientOrderId?: string;
  timestamp: number;
  datetime: string;
  symbol: string;
  type: string;
  side: string;
  price: number;
  amount: number;
  cost?: number;
  average?: number;
  filled?: number;
  remaining?: number;
  status: string;
  fee?: { currency?: string; cost?: number };
};

export type RealizedPnlResponse = {
  date: string;
  dailyPnL: number;
  consecutiveLosses: number;
  riskState: RiskState;
  rows: Array<{
    id: string;
    timestamp: number;
    pnl: number;
    fee: number;
    balanceChange: number;
    type: string;
    subType: string;
    ccy: string;
    symbol: string;
  }>;
};

export type MacroResponse = {
  dxy: number;
  m2: number;
  m2Change3mPct: number;
  dxyChange30dPct: number;
  btcCorrelation: number;
  dxySource: "live" | "stale" | "unavailable";
  macroRiskScore: number;
  macroGate: {
    state: string;
    regime: string;
    score: number;
    reason: string;
    positionSizeMultiplier: number;
    confidencePenalty: number;
    entryThresholdAdjustment: number;
    scanIntervalMultiplier: number;
  };
  timestamp: number;
};

export type BacktestResponse = {
  symbol?: string;
  timeframe?: string;
  totalReturn?: number;
  profitFactor?: number;
  winRate?: number;
  expectancy?: number;
  maxDrawdown?: number;
  totalTrades?: number;
  equityCurve?: Array<{ timestamp: number; equity: number }>;
  trades?: Array<Record<string, unknown>> | number;
  [key: string]: any;
};

export type FactorAuditItem = {
  factor: "price" | "macro" | "onchain" | "news";
  label: string;
  status: "enabled" | "disabled" | "unavailable" | "latest_revision_blocked";
  usedInBacktest: boolean;
  requiredTimestamp?: string;
  message: string;
};

export type StrategyWalkForwardSummary = {
  rounds: number;
  validRounds: number;
  insufficientTradeRounds: number;
  noValidationTradeRounds: number;
  medianReturn: number;
  worstReturn: number;
  medianProfitFactor: number;
  medianWinRate: number;
  worstMaxDrawdown: number;
  medianExpectancy: number;
  totalTrades: number;
  medianPerturbedReturn: number;
  worstPerturbedReturn: number;
  fragileRounds: number;
};

export type WalkForwardValidationStatus = "stable" | "fragile" | "insufficient_trades" | "no_validation_trades";

export type BacktestDiagnostics = {
  noEntryReasons: Array<{ reason: string; count: number }>;
  stopLossCount: number;
  takeProfitCount: number;
  oppositeSignalCount: number;
  endExitCount: number;
  avgWin: number;
  avgLoss: number;
  grossProfit: number;
  grossLoss: number;
  totalFees: number;
  totalExecutionCost: number;
  feeSlippageToGrossProfitPct: number;
  trainTrades?: number;
  validationTrades?: number;
};

export type WalkForwardRound = {
  strategy: string;
  symbol: string;
  trainStart: number;
  trainEnd: number;
  validationStart: number;
  validationEnd: number;
  validationTradeStart: number;
  warmupStart: number;
  selectedParams: { stopLoss: number; takeProfit: number };
  train: {
    totalReturn: number;
    maxDrawdown: number;
    profitFactor: number;
    winRate: number;
    expectancy: number;
    totalTrades: number;
    selectionScore: number;
    failsHardFloor: boolean;
    insufficientTrades?: boolean;
    selectedParamsRejectedReason?: string;
  };
  validation: BacktestResponse & {
    initialEquity: number;
    finalBalance: number;
    totalTrades: number;
  };
  perturbation: {
    medianReturn: number;
    worstReturn: number;
    fragile: boolean;
  };
  validationStatus: WalkForwardValidationStatus;
  insufficientReason?: string;
  selectedParamsRejectedReason?: string;
  diagnostics?: BacktestDiagnostics;
  dataMode: "strict_price_only";
};

export type WalkForwardBacktestResponse = {
  walkForward: true;
  dataMode: "strict_price_only";
  initialEquity: number;
  timeframe: string;
  config: {
    trainDays: number;
    validationDays: number;
    stepDays: number;
    period: number;
    estimatedFeeRate: number;
    minTrainTrades: number;
    riskPerTradePct: number;
    parameterGrid: Array<{ stopLoss: number; takeProfit: number }>;
    requestedTrainBars: number;
    requestedValidationBars: number;
  };
  strategies: string[];
  symbols: string[];
  rounds: WalkForwardRound[];
  byStrategy: Record<string, {
    rounds: WalkForwardRound[];
    summary: StrategyWalkForwardSummary;
    bySymbol: Record<string, StrategyWalkForwardSummary>;
  }>;
  bySymbol: Record<string, unknown>;
  summary: StrategyWalkForwardSummary;
  factorAudit: FactorAuditItem[];
  timeConsistency: Record<string, string>;
};

export type RuntimeMarketSnapshot = {
  ticker: Ticker | null;
  funding: Record<string, any> | null;
  orderBook: OrderBook | null;
  marketAnalysis: MarketAnalysisState;
};

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

type ApiOptions = RequestInit & {
  token?: string | null;
};

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function buildHeaders(options: ApiOptions) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  return headers;
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: buildHeaders(options),
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : (payload as any)?.error || response.statusText || "Request failed";
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export async function postJson<T>(path: string, body: unknown, options: ApiOptions = {}) {
  return apiFetch<T>(path, {
    ...options,
    method: "POST",
    headers: { ...JSON_HEADERS, ...(options.headers || {}) },
    body: JSON.stringify(body),
  });
}

export async function putJson<T>(path: string, body: unknown, options: ApiOptions = {}) {
  return apiFetch<T>(path, {
    ...options,
    method: "PUT",
    headers: { ...JSON_HEADERS, ...(options.headers || {}) },
    body: JSON.stringify(body),
  });
}

export const APP_TOKEN_KEY = "operator_token";
