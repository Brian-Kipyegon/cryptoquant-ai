import path from "path";
import { type AutoTradingRiskConfig } from "../src/lib/tradingRuntime";

export type OperatorSession = {
  tokenHash: string;
  username: string;
  role: "admin";
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
};

export type SecurityEvent = {
  id: string;
  type: string;
  username?: string;
  path?: string;
  method?: string;
  ip?: string;
  userAgent?: string;
  details?: any;
  timestamp: number;
};

export type OrderLifecycleEvent = {
  id: string;
  requestId: string;
  clientOrderId?: string;
  orderId?: string;
  symbol?: string;
  side?: string;
  amount?: number;
  amountType?: string;
  status:
    | "accepted"
    | "prepared"
    | "submitted"
    | "verified"
    | "failed"
    | "tp_managed"
    | "tp_amended"
    | "tp_skipped"
    | "tp_failed"
    | "tp_closed";
  source?: string;
  strategyId?: string;
  sandbox?: boolean;
  operator?: string;
  details?: any;
  timestamp: number;
};

export type PersistentRiskState = {
  date: string;
  dailyPnL: number;
  consecutiveStopLosses: number;
  macroGate: string;
  macroScore: number;
  newRiskBlocked: boolean;
  killSwitchActive: boolean;
  lastKillSwitchReason?: string;
  cooldownUntil: number;
  updatedAt: number;
};

export type AutoTradingEngineState = "stopped" | "starting" | "running" | "stopping" | "error";

export type AutoTradingScanProfile = {
  symbol: string;
  timeframes: string[];
};

export type AutoTradingConfig = {
  sandbox: boolean;
  scanProfilesVersion: number;
  scanProfiles: AutoTradingScanProfile[];
  strategyIds: string[];
  riskConfigSnapshot: AutoTradingRiskConfig;
  shadowMode: boolean;
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
  metrics?: Record<string, any>;
  at: number;
};

export type AutoTradingDecisionTrace = {
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

export type AutoTradingStore = {
  state: AutoTradingEngineState;
  config: AutoTradingConfig | null;
  recentLogs: string[];
  recentCycleSummaries: AutoTradingCycleSummary[];
  decisionTraces: AutoTradingDecisionTrace[];
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastError: string | null;
  engineStartedAt: number | null;
};

export type ShadowOrderStatus = "open" | "closed" | "estimated_skipped";

export type ShadowExitReason = "take_profit" | "stop_loss" | "reverse_signal" | null;

export type ShadowOrderRow = {
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
  status: ShadowOrderStatus;
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
  exit_reason: ShadowExitReason;
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

export type TakeProfitManagerSource = "auto" | "manual";

export type TakeProfitManagerStatus = "active" | "pending_lookup" | "closed" | "skipped";

export type ManagedTakeProfitOrder = {
  id: string;
  tradeId: string;
  requestId: string;
  clientOrderId?: string;
  orderId?: string;
  symbol: string;
  side: "buy" | "sell";
  sandbox: boolean;
  source: TakeProfitManagerSource;
  strategyId?: string;
  entryPrice: number;
  initialTpPrice: number;
  currentTpPrice: number;
  slPrice: number;
  tpAmendCount: number;
  tpManagerStatus: TakeProfitManagerStatus;
  attachedTpAlgoId?: string | null;
  attachedTpAlgoClOrdId?: string | null;
  lastCheckedAt: number | null;
  lastAmendedAt: number | null;
  lastTpManagerReason: string | null;
  createdAt: number;
};
