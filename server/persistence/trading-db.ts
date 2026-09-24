import fsp from "fs/promises";
import crypto from "crypto";
// @ts-ignore Node 24 ships node:sqlite; TypeScript typings may lag behind.
import { DatabaseSync } from "node:sqlite";
import { runStrategyAnalysis as evaluateStrategy } from "../../src/lib/strategyEngine";
import { buildMarketRuntimeContext, createDefaultMarketAnalysis, estimateShadowExecution, normalizeDisplaySymbol, normalizeTicker } from "../../src/lib/tradingRuntime";
import { AutoTradingConfig, ShadowExitReason, ShadowOrderRow, ShadowOrderStatus, ShadowSummary } from "../types";
import { DATA_DIR, TRADING_DB_FILE } from "../config";
import { appStore, getDefaultTimeframeForSymbol, pushAutoTradingLog } from "../stores/app-store";
import { currentMacroSnapshot } from "../trading/engine-helpers";
import { ensureFreshMacroData } from "../market/macro";
import { executionPenaltyModel, fetchBacktestOhlcv } from "../backtest/engine";
import { fetchPublicMarketBundle, fetchPublicMarketBundleWithAutoRetry } from "../market/public-data";
import { normalizeBooleanInt, normalizeNumber, safeJsonParse, stringifyJson } from "../utils";

export let tradingDb: any = null;


export function normalizeTimestamp(value: any) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

export async function initTradingDatabase() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  tradingDb = new DatabaseSync(TRADING_DB_FILE);
  tradingDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      exchange_order_id TEXT,
      client_order_id TEXT,
      parent_id TEXT,
      request_id TEXT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      source TEXT,
      strategy_id TEXT,
      amount REAL,
      amount_type TEXT,
      price REAL,
      entry_price REAL,
      mark_price REAL,
      realized_pnl REAL,
      fee REAL,
      margin REAL,
      notional REAL,
      leverage REAL,
      order_type TEXT,
      tp_price REAL,
      sl_price REAL,
      initial_tp_price REAL,
      current_tp_price REAL,
      tp_amend_count INTEGER,
      tp_manager_status TEXT,
      last_tp_manager_reason TEXT,
      attached_tp_algo_id TEXT,
      attached_tp_algo_cl_ord_id TEXT,
      regime TEXT,
      regime_score REAL,
      macro_gate TEXT,
      macro_score REAL,
      entry_reason TEXT,
      feature_json TEXT,
      stop_distance REAL,
      exit_reason TEXT,
      rule_compliant INTEGER,
      ai_verdict TEXT,
      raw_json TEXT,
      opened_at INTEGER,
      closed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy_id);
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);

    CREATE TABLE IF NOT EXISTS strategy_signals (
      id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      signal TEXT NOT NULL,
      confidence REAL,
      reasoning TEXT,
      price REAL,
      tp_price REAL,
      sl_price REAL,
      mode TEXT,
      source TEXT,
      regime TEXT,
      regime_score REAL,
      macro_gate TEXT,
      macro_score REAL,
      feature_json TEXT,
      raw_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_strategy_signals_created_at ON strategy_signals(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_strategy_signals_strategy ON strategy_signals(strategy_id);

    CREATE TABLE IF NOT EXISTS shadow_orders (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      strategy_id TEXT,
      theoretical_price REAL,
      executable_price REAL,
      spread_bps REAL,
      slippage_bps REAL,
      latency_ms REAL,
      amount REAL,
      amount_type TEXT,
      regime TEXT,
      macro_gate TEXT,
      orderbook_json TEXT,
      signal_json TEXT,
      status TEXT,
      timeframe TEXT,
      leverage REAL,
      tp_price REAL,
      sl_price REAL,
      entry_price REAL,
      mark_price REAL,
      qty_estimate REAL,
      unrealized_pnl REAL,
      exit_price REAL,
      realized_pnl REAL,
      exit_reason TEXT,
      closed_at INTEGER,
      last_evaluated_at INTEGER,
      is_estimated INTEGER,
      estimated_timeframe TEXT,
      estimation_note TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_shadow_orders_created_at ON shadow_orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_shadow_orders_symbol ON shadow_orders(symbol);
  `);
  const ensureColumn = (table: string, column: string, definition: string) => {
    const columns = tradingDb!.prepare(`PRAGMA table_info(${table})`).all() as any[];
    if (!columns.some((item) => item.name === column)) {
      tradingDb!.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };
  [
    ["regime", "TEXT"],
    ["regime_score", "REAL"],
    ["macro_gate", "TEXT"],
    ["macro_score", "REAL"],
    ["entry_reason", "TEXT"],
    ["feature_json", "TEXT"],
    ["stop_distance", "REAL"],
    ["exit_reason", "TEXT"],
    ["rule_compliant", "INTEGER"],
    ["ai_verdict", "TEXT"],
    ["initial_tp_price", "REAL"],
    ["current_tp_price", "REAL"],
    ["tp_amend_count", "INTEGER"],
    ["tp_manager_status", "TEXT"],
    ["last_tp_manager_reason", "TEXT"],
    ["attached_tp_algo_id", "TEXT"],
    ["attached_tp_algo_cl_ord_id", "TEXT"],
  ].forEach(([column, definition]) => ensureColumn("trades", column, definition));
  [
    ["regime", "TEXT"],
    ["regime_score", "REAL"],
    ["macro_gate", "TEXT"],
    ["macro_score", "REAL"],
    ["feature_json", "TEXT"],
  ].forEach(([column, definition]) => ensureColumn("strategy_signals", column, definition));
  [
    ["status", "TEXT"],
    ["timeframe", "TEXT"],
    ["leverage", "REAL"],
    ["tp_price", "REAL"],
    ["sl_price", "REAL"],
    ["entry_price", "REAL"],
    ["mark_price", "REAL"],
    ["qty_estimate", "REAL"],
    ["unrealized_pnl", "REAL"],
    ["exit_price", "REAL"],
    ["realized_pnl", "REAL"],
    ["exit_reason", "TEXT"],
    ["closed_at", "INTEGER"],
    ["last_evaluated_at", "INTEGER"],
    ["is_estimated", "INTEGER"],
    ["estimated_timeframe", "TEXT"],
    ["estimation_note", "TEXT"],
  ].forEach(([column, definition]) => ensureColumn("shadow_orders", column, definition));
  tradingDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_shadow_orders_status ON shadow_orders(status);
    CREATE INDEX IF NOT EXISTS idx_shadow_orders_symbol_strategy_status ON shadow_orders(symbol, strategy_id, status);
  `);
  await hydrateLegacyShadowOrders();
  console.log(`[TradingDB] SQLite database ready at ${TRADING_DB_FILE}`);
}

export function recordTrade(row: any) {
  if (!tradingDb) return null;
  const now = Date.now();
  const id = String(row.id || row.clientOrderId || row.client_order_id || row.exchangeOrderId || row.exchange_order_id || `trade_${now}_${crypto.randomBytes(4).toString("hex")}`);
  const openedAt = normalizeTimestamp(row.openedAt || row.opened_at || row.timestamp || row.datetime || now);
  const closedAt = row.closedAt || row.closed_at || row.realizedPnl !== undefined || row.status === "closed"
    ? normalizeTimestamp(row.closedAt || row.closed_at || row.timestamp || row.datetime || now)
    : null;

  const payload = {
    id,
    exchange_order_id: row.exchangeOrderId || row.exchange_order_id || row.orderId || row.order_id || null,
    client_order_id: row.clientOrderId || row.client_order_id || null,
    parent_id: row.parentId || row.parent_id || null,
    request_id: row.requestId || row.request_id || null,
    symbol: String(row.symbol || "UNKNOWN"),
    side: String(row.side || "UNKNOWN").toUpperCase(),
    status: String(row.status || "open").toLowerCase(),
    mode: String(row.mode || (row.sandbox ? "okx-demo" : "okx-live")),
    source: row.source || null,
    strategy_id: row.strategyId || row.strategy_id || row.strategy || null,
    amount: normalizeNumber(row.amount ?? row.contracts),
    amount_type: row.amountType || row.amount_type || null,
    price: normalizeNumber(row.price),
    entry_price: normalizeNumber(row.entryPrice ?? row.entry_price),
    mark_price: normalizeNumber(row.markPrice ?? row.mark_price),
    realized_pnl: normalizeNumber(row.realizedPnl ?? row.realized_pnl),
    fee: normalizeNumber(row.fee?.cost ?? row.fee),
    margin: normalizeNumber(row.margin),
    notional: normalizeNumber(row.notional ?? row.notionalUsd),
    leverage: normalizeNumber(row.leverage),
    order_type: row.type || row.orderType || row.order_type || null,
    tp_price: normalizeNumber(row.tpPrice ?? row.tp_price ?? row.tp),
    sl_price: normalizeNumber(row.slPrice ?? row.sl_price ?? row.sl),
    initial_tp_price: normalizeNumber(row.initialTpPrice ?? row.initial_tp_price ?? row.tpPrice ?? row.tp_price ?? row.tp),
    current_tp_price: normalizeNumber(row.currentTpPrice ?? row.current_tp_price ?? row.tpPrice ?? row.tp_price ?? row.tp),
    tp_amend_count: normalizeNumber(row.tpAmendCount ?? row.tp_amend_count),
    tp_manager_status: row.tpManagerStatus || row.tp_manager_status || null,
    last_tp_manager_reason: row.lastTpManagerReason || row.last_tp_manager_reason || null,
    attached_tp_algo_id: row.attachedTpAlgoId || row.attached_tp_algo_id || null,
    attached_tp_algo_cl_ord_id: row.attachedTpAlgoClOrdId || row.attached_tp_algo_cl_ord_id || null,
    regime: row.regime || row.marketRegime || row.raw?.regime || null,
    regime_score: normalizeNumber(row.regimeScore ?? row.regime_score ?? row.raw?.regimeScore),
    macro_gate: row.macroGate?.state || row.macroGate || row.macro_gate || row.raw?.macroGate?.state || null,
    macro_score: normalizeNumber(row.macroScore ?? row.macro_score ?? row.raw?.macroGate?.score),
    entry_reason: row.entryReason || row.entry_reason || row.reasoning || row.raw?.reasoning || null,
    feature_json: typeof (row.features ?? row.featureJson ?? row.feature_json) === "string"
      ? (row.features ?? row.featureJson ?? row.feature_json)
      : JSON.stringify(row.features ?? row.featureJson ?? row.feature_json ?? null),
    stop_distance: normalizeNumber(row.stopDistance ?? row.stop_distance),
    exit_reason: row.exitReason || row.exit_reason || null,
    rule_compliant: row.ruleCompliant === undefined && row.rule_compliant === undefined ? null : (row.ruleCompliant ?? row.rule_compliant ? 1 : 0),
    ai_verdict: row.aiVerdict || row.ai_verdict || null,
    raw_json: JSON.stringify(row.raw ?? row),
    opened_at: openedAt,
    closed_at: closedAt,
    created_at: row.createdAt || row.created_at || openedAt || now,
    updated_at: now,
  };

  tradingDb.prepare(`
    INSERT INTO trades (
      id, exchange_order_id, client_order_id, parent_id, request_id, symbol, side, status, mode,
      source, strategy_id, amount, amount_type, price, entry_price, mark_price, realized_pnl,
      fee, margin, notional, leverage, order_type, tp_price, sl_price,
      initial_tp_price, current_tp_price, tp_amend_count, tp_manager_status, last_tp_manager_reason,
      attached_tp_algo_id, attached_tp_algo_cl_ord_id,
      regime, regime_score, macro_gate, macro_score, entry_reason, feature_json, stop_distance,
      exit_reason, rule_compliant, ai_verdict, raw_json, opened_at, closed_at, created_at, updated_at
    ) VALUES (
      @id, @exchange_order_id, @client_order_id, @parent_id, @request_id, @symbol, @side, @status, @mode,
      @source, @strategy_id, @amount, @amount_type, @price, @entry_price, @mark_price, @realized_pnl,
      @fee, @margin, @notional, @leverage, @order_type, @tp_price, @sl_price,
      @initial_tp_price, @current_tp_price, @tp_amend_count, @tp_manager_status, @last_tp_manager_reason,
      @attached_tp_algo_id, @attached_tp_algo_cl_ord_id,
      @regime, @regime_score, @macro_gate, @macro_score, @entry_reason, @feature_json, @stop_distance,
      @exit_reason, @rule_compliant, @ai_verdict, @raw_json, @opened_at, @closed_at, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      exchange_order_id = COALESCE(excluded.exchange_order_id, trades.exchange_order_id),
      client_order_id = COALESCE(excluded.client_order_id, trades.client_order_id),
      parent_id = COALESCE(excluded.parent_id, trades.parent_id),
      request_id = COALESCE(excluded.request_id, trades.request_id),
      symbol = excluded.symbol,
      side = excluded.side,
      status = excluded.status,
      mode = excluded.mode,
      source = COALESCE(excluded.source, trades.source),
      strategy_id = COALESCE(excluded.strategy_id, trades.strategy_id),
      amount = COALESCE(excluded.amount, trades.amount),
      amount_type = COALESCE(excluded.amount_type, trades.amount_type),
      price = COALESCE(excluded.price, trades.price),
      entry_price = COALESCE(excluded.entry_price, trades.entry_price),
      mark_price = COALESCE(excluded.mark_price, trades.mark_price),
      realized_pnl = COALESCE(excluded.realized_pnl, trades.realized_pnl),
      fee = COALESCE(excluded.fee, trades.fee),
      margin = COALESCE(excluded.margin, trades.margin),
      notional = COALESCE(excluded.notional, trades.notional),
      leverage = COALESCE(excluded.leverage, trades.leverage),
      order_type = COALESCE(excluded.order_type, trades.order_type),
      tp_price = COALESCE(excluded.tp_price, trades.tp_price),
      sl_price = COALESCE(excluded.sl_price, trades.sl_price),
      initial_tp_price = COALESCE(excluded.initial_tp_price, trades.initial_tp_price),
      current_tp_price = COALESCE(excluded.current_tp_price, trades.current_tp_price),
      tp_amend_count = COALESCE(excluded.tp_amend_count, trades.tp_amend_count),
      tp_manager_status = COALESCE(excluded.tp_manager_status, trades.tp_manager_status),
      last_tp_manager_reason = COALESCE(excluded.last_tp_manager_reason, trades.last_tp_manager_reason),
      attached_tp_algo_id = COALESCE(excluded.attached_tp_algo_id, trades.attached_tp_algo_id),
      attached_tp_algo_cl_ord_id = COALESCE(excluded.attached_tp_algo_cl_ord_id, trades.attached_tp_algo_cl_ord_id),
      regime = COALESCE(excluded.regime, trades.regime),
      regime_score = COALESCE(excluded.regime_score, trades.regime_score),
      macro_gate = COALESCE(excluded.macro_gate, trades.macro_gate),
      macro_score = COALESCE(excluded.macro_score, trades.macro_score),
      entry_reason = COALESCE(excluded.entry_reason, trades.entry_reason),
      feature_json = COALESCE(excluded.feature_json, trades.feature_json),
      stop_distance = COALESCE(excluded.stop_distance, trades.stop_distance),
      exit_reason = COALESCE(excluded.exit_reason, trades.exit_reason),
      rule_compliant = COALESCE(excluded.rule_compliant, trades.rule_compliant),
      ai_verdict = COALESCE(excluded.ai_verdict, trades.ai_verdict),
      raw_json = excluded.raw_json,
      closed_at = COALESCE(excluded.closed_at, trades.closed_at),
      updated_at = excluded.updated_at
  `).run(payload);

  return payload;
}

/** Days of strategy signal rows to keep (STRATEGY_SIGNAL_RETENTION_DAYS, default 14). */
export function getStrategySignalRetentionDays() {
  const days = Number(process.env.STRATEGY_SIGNAL_RETENTION_DAYS);
  return Number.isFinite(days) && days > 0 ? days : 14;
}

/** Deletes strategy signal rows older than the retention window. Returns rows removed. */
export function pruneStrategySignals(now = Date.now()) {
  if (!tradingDb) return 0;
  const cutoff = now - getStrategySignalRetentionDays() * 86_400_000;
  const result = tradingDb.prepare("DELETE FROM strategy_signals WHERE created_at < ?").run(cutoff);
  return Number(result?.changes || 0);
}

export function recordStrategySignal(row: any) {
  if (!tradingDb) return null;
  const now = Date.now();
  const payload = {
    id: String(row.id || `sig_${now}_${crypto.randomBytes(4).toString("hex")}`),
    strategy_id: String(row.strategyId || row.strategy_id || "unknown"),
    symbol: String(row.symbol || "UNKNOWN"),
    signal: String(row.signal || "HOLD").toUpperCase(),
    confidence: normalizeNumber(row.confidence),
    reasoning: row.reasoning || null,
    price: normalizeNumber(row.price),
    tp_price: normalizeNumber(row.tpPrice ?? row.tp_price),
    sl_price: normalizeNumber(row.slPrice ?? row.sl_price),
    mode: row.mode || null,
    source: row.source || null,
    regime: row.regime || row.raw?.regime || null,
    regime_score: normalizeNumber(row.regimeScore ?? row.regime_score ?? row.raw?.regimeScore),
    macro_gate: row.macroGate?.state || row.macroGate || row.macro_gate || row.raw?.macroGate?.state || null,
    macro_score: normalizeNumber(row.macroScore ?? row.macro_score ?? row.raw?.macroGate?.score),
    feature_json: typeof (row.features ?? row.featureJson ?? row.feature_json) === "string"
      ? (row.features ?? row.featureJson ?? row.feature_json)
      : JSON.stringify(row.features ?? row.featureJson ?? row.feature_json ?? row.raw?.features ?? null),
    raw_json: JSON.stringify(row.raw ?? row),
    created_at: row.createdAt || row.created_at || now,
  };

  tradingDb.prepare(`
    INSERT INTO strategy_signals (
      id, strategy_id, symbol, signal, confidence, reasoning, price, tp_price, sl_price,
      mode, source, regime, regime_score, macro_gate, macro_score, feature_json, raw_json, created_at
    ) VALUES (
      @id, @strategy_id, @symbol, @signal, @confidence, @reasoning, @price, @tp_price, @sl_price,
      @mode, @source, @regime, @regime_score, @macro_gate, @macro_score, @feature_json, @raw_json, @created_at
    )
  `).run(payload);

  return payload;
}

export function normalizeShadowStatus(value: any, fallback: ShadowOrderStatus = "open"): ShadowOrderStatus {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (normalized === "closed") return "closed";
  if (normalized === "estimated_skipped") return "estimated_skipped";
  return "open";
}

export function normalizeShadowExitReason(value: any): ShadowExitReason {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "take_profit") return "take_profit";
  if (normalized === "stop_loss") return "stop_loss";
  if (normalized === "reverse_signal") return "reverse_signal";
  return null;
}

export function timeframeToMs(timeframe: string) {
  const normalized = String(timeframe || "1h").trim().toLowerCase();
  if (normalized.endsWith("m")) return Math.max(60_000, Number(normalized.slice(0, -1)) * 60_000);
  if (normalized.endsWith("h")) return Math.max(3_600_000, Number(normalized.slice(0, -1)) * 3_600_000);
  if (normalized === "1d") return 86_400_000;
  if (normalized === "1w") return 7 * 86_400_000;
  return 3_600_000;
}

export function calculateShadowQtyEstimate(input: {
  amount?: number | null;
  amountType?: string | null;
  leverage?: number | null;
  entryPrice?: number | null;
}) {
  const amount = Number(input.amount || 0);
  const entryPrice = Number(input.entryPrice || 0);
  const leverage = Math.max(1, Number(input.leverage || 1));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (String(input.amountType || "usdt").toLowerCase() === "coin") return amount;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  return (amount * leverage) / entryPrice;
}

export function calculateShadowPnl(side: string, qtyEstimate: number | null, entryPrice: number | null, markPrice: number | null) {
  const qty = Number(qtyEstimate || 0);
  const entry = Number(entryPrice || 0);
  const mark = Number(markPrice || 0);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  if (!Number.isFinite(entry) || entry <= 0) return 0;
  if (!Number.isFinite(mark) || mark <= 0) return 0;
  return String(side || "").toUpperCase() === "BUY"
    ? qty * (mark - entry)
    : qty * (entry - mark);
}

export function getShadowOrderById(id: string) {
  if (!tradingDb || !id) return null;
  return tradingDb.prepare("SELECT * FROM shadow_orders WHERE id = ?").get(id) as ShadowOrderRow | null;
}

export function listShadowOrders(status: "open" | "closed" | "all" = "all", limit = 200) {
  if (!tradingDb) return [] as ShadowOrderRow[];
  const boundedLimit = Math.min(1000, Math.max(1, limit));
  if (status === "all") {
    return tradingDb.prepare("SELECT * FROM shadow_orders ORDER BY created_at DESC LIMIT ?").all(boundedLimit) as ShadowOrderRow[];
  }
  return tradingDb.prepare("SELECT * FROM shadow_orders WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, boundedLimit) as ShadowOrderRow[];
}

export function loadOpenShadowOrders(limit = 1000) {
  return listShadowOrders("open", limit);
}

export function findOpenShadowOrder(symbol: string, strategyId?: string | null) {
  if (!tradingDb) return null;
  const normalizedSymbol = normalizeDisplaySymbol(symbol);
  const normalizedStrategyId = strategyId ? String(strategyId) : "";
  return tradingDb.prepare(`
    SELECT *
    FROM shadow_orders
    WHERE symbol = ?
      AND COALESCE(strategy_id, '') = ?
      AND status = 'open'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(normalizedSymbol, normalizedStrategyId) as ShadowOrderRow | null;
}

export function normalizeShadowOrderRow(row: any, existing?: Partial<ShadowOrderRow> | null): ShadowOrderRow {
  const now = Date.now();
  const existingSignal = safeJsonParse<any>(existing?.signal_json, null);
  const incomingSignal = row.signal ?? safeJsonParse<any>(row.signal_json, null);
  const signalPayload = incomingSignal ?? existingSignal ?? null;
  const orderbookPayload = row.orderbook ?? row.orderBook ?? safeJsonParse<any>(row.orderbook_json, null) ?? safeJsonParse<any>(existing?.orderbook_json, null);
  const side = String(row.side ?? existing?.side ?? "UNKNOWN").toUpperCase();
  const executablePrice = normalizeNumber(row.executablePrice ?? row.executable_price ?? existing?.executable_price);
  const entryPrice = normalizeNumber(row.entryPrice ?? row.entry_price ?? existing?.entry_price ?? executablePrice);
  const amount = normalizeNumber(row.amount ?? existing?.amount);
  const amountType = row.amountType ?? row.amount_type ?? existing?.amount_type ?? "usdt";
  const leverage = normalizeNumber(row.leverage ?? signalPayload?.leverage ?? existing?.leverage ?? 1) ?? 1;
  const qtyEstimate = normalizeNumber(row.qtyEstimate ?? row.qty_estimate ?? existing?.qty_estimate)
    ?? calculateShadowQtyEstimate({ amount, amountType, leverage, entryPrice });
  const markPrice = normalizeNumber(row.markPrice ?? row.mark_price ?? existing?.mark_price ?? entryPrice);
  const exitPrice = normalizeNumber(row.exitPrice ?? row.exit_price ?? existing?.exit_price);
  const realizedPnlInput = normalizeNumber(row.realizedPnl ?? row.realized_pnl ?? existing?.realized_pnl);
  const unrealizedPnlInput = normalizeNumber(row.unrealizedPnl ?? row.unrealized_pnl ?? existing?.unrealized_pnl);
  const status = normalizeShadowStatus(row.status ?? existing?.status ?? "open");
  const closedAt = row.closedAt ?? row.closed_at ?? existing?.closed_at ?? null;
  const realizedPnl = realizedPnlInput ?? (status === "closed"
    ? calculateShadowPnl(side, qtyEstimate, entryPrice, exitPrice)
    : null);
  const unrealizedPnl = unrealizedPnlInput ?? (status === "open"
    ? calculateShadowPnl(side, qtyEstimate, entryPrice, markPrice)
    : 0);

  return {
    id: String(row.id || existing?.id || `shadow_${now}_${crypto.randomBytes(4).toString("hex")}`),
    symbol: normalizeDisplaySymbol(String(row.symbol || existing?.symbol || "UNKNOWN")),
    side,
    strategy_id: row.strategyId || row.strategy_id || existing?.strategy_id || null,
    theoretical_price: normalizeNumber(row.theoreticalPrice ?? row.theoretical_price ?? existing?.theoretical_price),
    executable_price: executablePrice,
    spread_bps: normalizeNumber(row.spreadBps ?? row.spread_bps ?? existing?.spread_bps),
    slippage_bps: normalizeNumber(row.slippageBps ?? row.slippage_bps ?? existing?.slippage_bps),
    latency_ms: normalizeNumber(row.latencyMs ?? row.latency_ms ?? existing?.latency_ms),
    amount,
    amount_type: amountType,
    regime: row.regime || signalPayload?.regime || existing?.regime || null,
    macro_gate: row.macroGate?.state || row.macroGate || signalPayload?.macroGate?.state || signalPayload?.macroGate || existing?.macro_gate || null,
    orderbook_json: stringifyJson(orderbookPayload),
    signal_json: stringifyJson(signalPayload ?? row.raw ?? safeJsonParse(existing?.signal_json, null)),
    status,
    timeframe: row.timeframe || existing?.timeframe || null,
    leverage,
    tp_price: normalizeNumber(row.tpPrice ?? row.tp_price ?? signalPayload?.tp_price ?? existing?.tp_price),
    sl_price: normalizeNumber(row.slPrice ?? row.sl_price ?? signalPayload?.sl_price ?? existing?.sl_price),
    entry_price: entryPrice,
    mark_price: status === "closed" ? (exitPrice ?? markPrice) : markPrice,
    qty_estimate: qtyEstimate,
    unrealized_pnl: status === "closed" ? 0 : unrealizedPnl,
    exit_price: exitPrice,
    realized_pnl: realizedPnl,
    exit_reason: normalizeShadowExitReason(row.exitReason ?? row.exit_reason ?? existing?.exit_reason),
    closed_at: closedAt ? normalizeTimestamp(closedAt) : null,
    last_evaluated_at: normalizeTimestamp(row.lastEvaluatedAt ?? row.last_evaluated_at ?? existing?.last_evaluated_at ?? row.createdAt ?? row.created_at ?? existing?.created_at ?? now),
    is_estimated: normalizeBooleanInt(row.isEstimated ?? row.is_estimated ?? existing?.is_estimated, 0),
    estimated_timeframe: row.estimatedTimeframe || row.estimated_timeframe || existing?.estimated_timeframe || null,
    estimation_note: row.estimationNote || row.estimation_note || existing?.estimation_note || null,
    created_at: normalizeTimestamp(row.createdAt ?? row.created_at ?? existing?.created_at ?? now),
  };
}

export function hasMeaningfulAutoTradingConfigInput(input: Partial<AutoTradingConfig> | null | undefined) {
  return Boolean(input && typeof input === "object" && Object.keys(input).length > 0);
}

export function persistShadowOrder(row: any) {
  if (!tradingDb) return null;
  const existing = row.id ? getShadowOrderById(String(row.id)) : null;
  const payload = normalizeShadowOrderRow(row, existing);
  tradingDb.prepare(`
    INSERT INTO shadow_orders (
      id, symbol, side, strategy_id, theoretical_price, executable_price, spread_bps,
      slippage_bps, latency_ms, amount, amount_type, regime, macro_gate,
      orderbook_json, signal_json, status, timeframe, leverage, tp_price, sl_price,
      entry_price, mark_price, qty_estimate, unrealized_pnl, exit_price, realized_pnl,
      exit_reason, closed_at, last_evaluated_at, is_estimated, estimated_timeframe, estimation_note, created_at
    ) VALUES (
      @id, @symbol, @side, @strategy_id, @theoretical_price, @executable_price, @spread_bps,
      @slippage_bps, @latency_ms, @amount, @amount_type, @regime, @macro_gate,
      @orderbook_json, @signal_json, @status, @timeframe, @leverage, @tp_price, @sl_price,
      @entry_price, @mark_price, @qty_estimate, @unrealized_pnl, @exit_price, @realized_pnl,
      @exit_reason, @closed_at, @last_evaluated_at, @is_estimated, @estimated_timeframe, @estimation_note, @created_at
    )
    ON CONFLICT(id) DO UPDATE SET
      symbol = excluded.symbol,
      side = excluded.side,
      strategy_id = excluded.strategy_id,
      theoretical_price = excluded.theoretical_price,
      executable_price = excluded.executable_price,
      spread_bps = excluded.spread_bps,
      slippage_bps = excluded.slippage_bps,
      latency_ms = excluded.latency_ms,
      amount = excluded.amount,
      amount_type = excluded.amount_type,
      regime = excluded.regime,
      macro_gate = excluded.macro_gate,
      orderbook_json = excluded.orderbook_json,
      signal_json = excluded.signal_json,
      status = excluded.status,
      timeframe = excluded.timeframe,
      leverage = excluded.leverage,
      tp_price = excluded.tp_price,
      sl_price = excluded.sl_price,
      entry_price = excluded.entry_price,
      mark_price = excluded.mark_price,
      qty_estimate = excluded.qty_estimate,
      unrealized_pnl = excluded.unrealized_pnl,
      exit_price = excluded.exit_price,
      realized_pnl = excluded.realized_pnl,
      exit_reason = excluded.exit_reason,
      closed_at = excluded.closed_at,
      last_evaluated_at = excluded.last_evaluated_at,
      is_estimated = excluded.is_estimated,
      estimated_timeframe = excluded.estimated_timeframe,
      estimation_note = excluded.estimation_note
  `).run(payload);
  return payload;
}

export function updateTradeTakeProfitMetadata(row: {
  id: string;
  tpPrice?: number | null;
  slPrice?: number | null;
  initialTpPrice?: number | null;
  currentTpPrice?: number | null;
  tpAmendCount?: number | null;
  tpManagerStatus?: string | null;
  lastTpManagerReason?: string | null;
  attachedTpAlgoId?: string | null;
  attachedTpAlgoClOrdId?: string | null;
}) {
  if (!tradingDb || !row?.id) return;
  const payload = {
    id: String(row.id),
    tp_price: normalizeNumber(row.tpPrice),
    sl_price: normalizeNumber(row.slPrice),
    initial_tp_price: normalizeNumber(row.initialTpPrice),
    current_tp_price: normalizeNumber(row.currentTpPrice),
    tp_amend_count: normalizeNumber(row.tpAmendCount),
    tp_manager_status: row.tpManagerStatus || null,
    last_tp_manager_reason: row.lastTpManagerReason || null,
    attached_tp_algo_id: row.attachedTpAlgoId || null,
    attached_tp_algo_cl_ord_id: row.attachedTpAlgoClOrdId || null,
    updated_at: Date.now(),
  };

  tradingDb.prepare(`
    UPDATE trades
    SET
      tp_price = COALESCE(@tp_price, tp_price),
      sl_price = COALESCE(@sl_price, sl_price),
      initial_tp_price = COALESCE(@initial_tp_price, initial_tp_price),
      current_tp_price = COALESCE(@current_tp_price, current_tp_price),
      tp_amend_count = COALESCE(@tp_amend_count, tp_amend_count),
      tp_manager_status = COALESCE(@tp_manager_status, tp_manager_status),
      last_tp_manager_reason = COALESCE(@last_tp_manager_reason, last_tp_manager_reason),
      attached_tp_algo_id = COALESCE(@attached_tp_algo_id, attached_tp_algo_id),
      attached_tp_algo_cl_ord_id = COALESCE(@attached_tp_algo_cl_ord_id, attached_tp_algo_cl_ord_id),
      updated_at = @updated_at
    WHERE id = @id
  `).run(payload);
}

export function recordShadowOrder(row: any) {
  return persistShadowOrder({
    ...row,
    status: row.status || "open",
  });
}

export function updateShadowOrderMark(order: ShadowOrderRow, markPrice: number, evaluatedAt = Date.now()) {
  return persistShadowOrder({
    ...order,
    markPrice,
    unrealizedPnl: calculateShadowPnl(order.side, order.qty_estimate, order.entry_price, markPrice),
    lastEvaluatedAt: evaluatedAt,
  });
}

export function closeShadowOrderPosition(
  order: ShadowOrderRow,
  input: {
    referencePrice: number;
    reason: Exclude<ShadowExitReason, null>;
    bar?: any;
    closedAt?: number;
    isEstimated?: boolean;
    estimatedTimeframe?: string | null;
    estimationNote?: string | null;
  }
) {
  const closeSide = String(order.side || "").toUpperCase() === "BUY" ? "sell" : "buy";
  const execution = executionPenaltyModel({
    symbol: order.symbol,
    side: closeSide,
    referencePrice: input.referencePrice,
    bar: input.bar,
    reason: input.reason,
  });
  const exitPrice = execution.expectedFill;
  return persistShadowOrder({
    ...order,
    status: "closed",
    markPrice: exitPrice,
    exitPrice,
    realizedPnl: calculateShadowPnl(order.side, order.qty_estimate, order.entry_price, exitPrice),
    unrealizedPnl: 0,
    exitReason: input.reason,
    closedAt: input.closedAt || Date.now(),
    lastEvaluatedAt: input.closedAt || Date.now(),
    isEstimated: input.isEstimated ?? order.is_estimated,
    estimatedTimeframe: input.estimatedTimeframe ?? order.estimated_timeframe,
    estimationNote: input.estimationNote ?? order.estimation_note,
  });
}

export function determineShadowExitFromOhlcv(order: ShadowOrderRow, ohlcv: any[]) {
  if (!Array.isArray(ohlcv) || ohlcv.length === 0) return null;
  const startAt = Number(order.last_evaluated_at || order.created_at || 0);
  const side = String(order.side || "").toUpperCase();
  for (const bar of ohlcv) {
    const barTs = Number(bar?.[0] || 0);
    if (!Number.isFinite(barTs) || barTs <= startAt) continue;
    const open = Number(bar?.[1] || 0);
    const high = Number(bar?.[2] || 0);
    const low = Number(bar?.[3] || 0);
    if (side === "BUY") {
      if (Number(order.sl_price || 0) > 0 && low <= Number(order.sl_price)) {
        return { reason: "stop_loss" as const, referencePrice: Math.min(Number(order.sl_price), open || Number(order.sl_price)), bar, closedAt: barTs };
      }
      if (Number(order.tp_price || 0) > 0 && high >= Number(order.tp_price)) {
        return { reason: "take_profit" as const, referencePrice: Math.max(Number(order.tp_price), open || Number(order.tp_price)), bar, closedAt: barTs };
      }
    } else if (side === "SELL") {
      if (Number(order.sl_price || 0) > 0 && high >= Number(order.sl_price)) {
        return { reason: "stop_loss" as const, referencePrice: Math.max(Number(order.sl_price), open || Number(order.sl_price)), bar, closedAt: barTs };
      }
      if (Number(order.tp_price || 0) > 0 && low <= Number(order.tp_price)) {
        return { reason: "take_profit" as const, referencePrice: Math.min(Number(order.tp_price), open || Number(order.tp_price)), bar, closedAt: barTs };
      }
    }
  }
  return null;
}

export async function maintainOpenShadowOrders(config: AutoTradingConfig) {
  const openOrders = loadOpenShadowOrders();
  if (!openOrders.length) return;

  await ensureFreshMacroData();
  const grouped = new Map<string, ShadowOrderRow[]>();
  for (const order of openOrders) {
    const timeframe = order.timeframe || getDefaultTimeframeForSymbol(config, order.symbol);
    const key = `${order.symbol}::${timeframe}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(order);
  }

  const baseMarketAnalysis = createDefaultMarketAnalysis();
  const { macroData, macroRiskScore, macroGate } = currentMacroSnapshot();
  baseMarketAnalysis.macroIndicators = {
    dxyCorrelation: (macroData as any).btcCorrelation ?? baseMarketAnalysis.macroIndicators.dxyCorrelation,
    usdtPremium: baseMarketAnalysis.macroIndicators.usdtPremium,
    globalLiquidity: (macroData as any).m2 ? ((macroData as any).m2 / 20000) * 100 : baseMarketAnalysis.macroIndicators.globalLiquidity,
    macroRiskScore,
    macroGate,
  };
  if ((macroData as any).dxy !== undefined) baseMarketAnalysis.onChainData.dxy = (macroData as any).dxy;
  if ((macroData as any).m2 !== undefined) baseMarketAnalysis.onChainData.m2 = (macroData as any).m2;

  for (const [key, orders] of grouped.entries()) {
    const [symbol, timeframe] = key.split("::");
    let marketBundle: Awaited<ReturnType<typeof fetchPublicMarketBundle>>;
    try {
      marketBundle = await fetchPublicMarketBundleWithAutoRetry(symbol, timeframe, 180);
    } catch (error: any) {
      pushAutoTradingLog(`Shadow position maintenance failed ${symbol}: ${error?.message || String(error)}`);
      continue;
    }

    const scanTicker = normalizeTicker(symbol, marketBundle.ticker);
    if (!scanTicker) continue;

    const runtimeContext = buildMarketRuntimeContext(
      symbol,
      scanTicker,
      marketBundle.funding,
      marketBundle.orderBook,
      Array.isArray(marketBundle.ohlcv) ? marketBundle.ohlcv : [],
      {
        ...baseMarketAnalysis,
        correlations: baseMarketAnalysis.correlations.map(item => ({ ...item })),
        trends: baseMarketAnalysis.trends.map(item => ({ ...item })),
      },
      timeframe
    );

    const actionableSignals = new Map<string, { analysis: any; requiredConfidence: number }>();
    const strategyIds = Array.from(new Set(orders.map(order => order.strategy_id).filter(Boolean) as string[]));
    for (const strategyId of strategyIds) {
      const analysis = evaluateStrategy({
        symbol,
        ticker: scanTicker,
        strategyId,
        prices: runtimeContext.prices,
        indicators: runtimeContext.marketAnalysis.realIndicators,
        market: {
          sentiment: runtimeContext.marketAnalysis.sentiment,
          volatility: runtimeContext.marketAnalysis.volatility,
          fundingRate: runtimeContext.fundingRate?.fundingRate ?? 0,
          macroRiskScore,
          macroGate,
          onChainData: runtimeContext.marketAnalysis.onChainData,
        },
        risk: {
          estimatedFeeRate: config.riskConfigSnapshot.estimatedFeeRate,
          stopLoss: config.riskConfigSnapshot.stopLoss,
          takeProfit: config.riskConfigSnapshot.takeProfit,
        },
        allowSyntheticData: false,
      });
      const requiredConfidence = config.riskConfigSnapshot.autoTradeThreshold + (analysis?.macroGate?.entryThresholdAdjustment || 0);
      if ((analysis.signal === "BUY" || analysis.signal === "SELL") && Number(analysis.confidence || 0) >= requiredConfidence) {
        actionableSignals.set(strategyId, { analysis, requiredConfidence });
      }
    }

    const lastBar = Array.isArray(marketBundle.ohlcv) && marketBundle.ohlcv.length > 0
      ? marketBundle.ohlcv[marketBundle.ohlcv.length - 1]
      : null;
    const evaluatedAt = Number(lastBar?.[0] || Date.now());

    for (const order of orders) {
      const exitHit = determineShadowExitFromOhlcv(order, marketBundle.ohlcv);
      if (exitHit) {
        const closed = closeShadowOrderPosition(order, exitHit);
        pushAutoTradingLog(`Shadow position closed ${closed.symbol} ${closed.strategy_id || "--"} ${closed.exit_reason || "take_profit"} ${Number(closed.realized_pnl || 0).toFixed(2)} USDT`);
        continue;
      }

      const actionable = order.strategy_id ? actionableSignals.get(order.strategy_id) : undefined;
      if (actionable && actionable.analysis.signal !== order.side) {
        const closed = closeShadowOrderPosition(order, {
          referencePrice: scanTicker.last || Number(lastBar?.[4] || order.entry_price || 0),
          reason: "reverse_signal",
          bar: lastBar,
          closedAt: evaluatedAt,
        });
        pushAutoTradingLog(`Shadow position closed on reverse signal ${closed.symbol} ${closed.strategy_id || "--"} ${order.side} -> ${actionable.analysis.signal}`);
        continue;
      }

      const shadowExecution = actionable
        ? estimateShadowExecution(String(order.side || "BUY").toLowerCase() as "buy" | "sell", scanTicker, marketBundle.orderBook, 0)
        : null;

      persistShadowOrder({
        ...order,
        theoreticalPrice: shadowExecution?.theoreticalPrice ?? order.theoretical_price,
        executablePrice: shadowExecution?.executablePrice ?? order.executable_price,
        spreadBps: shadowExecution?.spreadBps ?? order.spread_bps,
        slippageBps: shadowExecution?.slippageBps ?? order.slippage_bps,
        latencyMs: shadowExecution?.latencyMs ?? order.latency_ms,
        markPrice: scanTicker.last,
        unrealizedPnl: calculateShadowPnl(order.side, order.qty_estimate, order.entry_price, scanTicker.last),
        lastEvaluatedAt: evaluatedAt,
        orderbook: actionable ? marketBundle.orderBook : undefined,
        signal: actionable ? actionable.analysis : undefined,
      });
    }
  }
}

export async function hydrateLegacyShadowOrders() {
  if (!tradingDb) return;
  const legacyRows = tradingDb.prepare(`
    SELECT *
    FROM shadow_orders
    WHERE status IS NULL OR TRIM(COALESCE(status, '')) = ''
    ORDER BY created_at ASC
  `).all() as ShadowOrderRow[];
  if (!legacyRows.length) return;

  const ohlcvCache = new Map<string, any[]>();

  for (const row of legacyRows) {
    const signal = safeJsonParse<any>(row.signal_json, null);
    const timeframe = row.timeframe || getDefaultTimeframeForSymbol(appStore.autoTrading.config, row.symbol);
    const normalized = normalizeShadowOrderRow({
      ...row,
      timeframe,
      estimatedTimeframe: timeframe,
      isEstimated: 1,
    }, row);
    const entryPrice = normalized.entry_price;
    const qtyEstimate = normalized.qty_estimate;
    const tpPrice = normalized.tp_price;
    const slPrice = normalized.sl_price;

    if (!entryPrice || !qtyEstimate || (!tpPrice && !slPrice)) {
      persistShadowOrder({
        ...normalized,
        status: "estimated_skipped",
        timeframe,
        estimatedTimeframe: timeframe,
        isEstimated: 1,
        estimationNote: "Missing entry/tp/sl or other key fields; cannot replay an estimate",
      });
      continue;
    }

    try {
      const cacheKey = `${normalized.symbol}::${timeframe}`;
      let ohlcv = ohlcvCache.get(cacheKey);
      if (!ohlcv) {
        const elapsedBars = Math.ceil((Date.now() - normalized.created_at) / timeframeToMs(timeframe)) + 20;
        ohlcv = await fetchBacktestOhlcv(normalized.symbol, timeframe, Math.min(5000, Math.max(120, elapsedBars))) as any[];
        ohlcvCache.set(cacheKey, ohlcv);
      }

      const exitHit = determineShadowExitFromOhlcv({
        ...normalized,
        last_evaluated_at: normalized.created_at,
      }, ohlcv);

      if (exitHit) {
        closeShadowOrderPosition({
          ...normalized,
          timeframe,
          estimated_timeframe: timeframe,
          is_estimated: 1,
        }, {
          ...exitHit,
          isEstimated: true,
          estimatedTimeframe: timeframe,
          estimationNote: "Historical shadow order estimated by replaying on the current system timeframe",
        });
        continue;
      }

      const lastBar = Array.isArray(ohlcv) && ohlcv.length > 0 ? ohlcv[ohlcv.length - 1] : null;
      const markPrice = Number(lastBar?.[4] || entryPrice);
      persistShadowOrder({
        ...normalized,
        status: "open",
        timeframe,
        markPrice,
        unrealizedPnl: calculateShadowPnl(normalized.side, qtyEstimate, entryPrice, markPrice),
        lastEvaluatedAt: Number(lastBar?.[0] || Date.now()),
        isEstimated: 1,
        estimatedTimeframe: timeframe,
        estimationNote: "Historical shadow order estimated by replaying on the current system timeframe",
        signal: signal,
      });
    } catch (error: any) {
      persistShadowOrder({
        ...normalized,
        status: "estimated_skipped",
        timeframe,
        estimatedTimeframe: timeframe,
        isEstimated: 1,
        estimationNote: `Historical estimate failed: ${error?.message || String(error)}`,
      });
    }
  }
}

export function buildShadowSummary() {
  const rows = listShadowOrders("all", 1000);
  const openOrders = rows.filter(row => row.status === "open");
  const closedOrders = rows.filter(row => row.status === "closed");
  const estimatedCount = rows.filter(row => Number(row.is_estimated || 0) === 1).length;
  const realizedPnl = closedOrders.reduce((sum, row) => sum + Number(row.realized_pnl || 0), 0);
  const unrealizedPnl = openOrders.reduce((sum, row) => sum + Number(row.unrealized_pnl || 0), 0);
  const wins = closedOrders.filter(row => Number(row.realized_pnl || 0) > 0).length;
  const totalHoldMinutes = closedOrders.reduce((sum, row) => {
    if (!row.closed_at || !row.created_at) return sum;
    return sum + Math.max(0, (Number(row.closed_at) - Number(row.created_at)) / 60_000);
  }, 0);
  return {
    openCount: openOrders.length,
    closedCount: closedOrders.length,
    realizedPnl,
    unrealizedPnl,
    winRate: closedOrders.length ? (wins / closedOrders.length) * 100 : 0,
    avgHoldMinutes: closedOrders.length ? totalHoldMinutes / closedOrders.length : 0,
    estimatedCount,
  } satisfies ShadowSummary;
}
