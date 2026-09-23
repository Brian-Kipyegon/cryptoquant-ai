import { normalizeDisplaySymbol } from './tradingRuntime';

export type PortfolioReturnMode = 'live' | 'demo' | 'shadow';
export type PortfolioReturnRange = '7d' | '30d' | '90d' | 'all';
export type PortfolioReturnSource = 'exchange_bill' | 'local_trade' | 'shadow';

export type PortfolioReturnTradeInput = Record<string, unknown>;
export type PortfolioReturnShadowInput = Record<string, unknown>;
export type PortfolioReturnBillInput = Record<string, unknown>;

export type PortfolioReturnHistoryRow = {
  id: string;
  source: PortfolioReturnSource;
  mode: PortfolioReturnMode;
  symbol: string;
  side: string;
  strategyId: string | null;
  timeframe: string | null;
  status: string;
  openedAt: number | null;
  closedAt: number | null;
  timestamp: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  tradeRoiPct: number;
  accountReturnPct: number;
  fee: number;
  slippageBps: number | null;
  margin: number | null;
  notional: number | null;
  amount: number | null;
  amountType: string | null;
  leverage: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  markPrice: number | null;
  tpPrice: number | null;
  slPrice: number | null;
  regime: string | null;
  macroGate: string | null;
  entryReason: string | null;
  exitReason: string | null;
  holdMinutes: number | null;
  isEstimated: boolean;
  balanceChange: number | null;
  type: string | null;
  subType: string | null;
  ccy: string | null;
  localTradeId: string | null;
  signalJson: string | null;
  orderbookJson: string | null;
  rawJson: string | null;
};

export type PortfolioReturnCurvePoint = {
  timestamp: number;
  label: string;
  cumulativePnl: number;
  accountReturnPct: number;
  drawdownPct: number;
};

export type PortfolioReturnGroup = {
  key: string;
  trades: number;
  closedTrades: number;
  pnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  winRate: number;
  profitFactor: number;
  avgTradeRoiPct: number;
};

export type PortfolioReturnSummary = {
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  accountReturnPct: number;
  avgTradeRoiPct: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  closedTrades: number;
  openTrades: number;
  totalRows: number;
  grossProfit: number;
  grossLoss: number;
  fees: number;
  avgHoldMinutes: number;
};

export type PortfolioReturnSourceStatus = {
  state: 'fresh' | 'stale';
  message?: string;
  fetchedAt: number;
  staleSince?: number;
};

export type PortfolioReturnAnalytics = {
  mode: PortfolioReturnMode;
  range: PortfolioReturnRange;
  requestKey: string;
  generatedAt: number;
  capitalBase: number;
  capitalBaseSource: 'equity' | 'fallback' | 'none';
  sourceStatus?: PortfolioReturnSourceStatus;
  summary: PortfolioReturnSummary;
  equityCurve: PortfolioReturnCurvePoint[];
  bySymbol: PortfolioReturnGroup[];
  byStrategy: PortfolioReturnGroup[];
  history: PortfolioReturnHistoryRow[];
};

export type BuildPortfolioReturnAnalyticsInput = {
  mode: PortfolioReturnMode;
  range?: PortfolioReturnRange;
  limit?: number;
  trades?: PortfolioReturnTradeInput[];
  bills?: PortfolioReturnBillInput[];
  shadowOrders?: PortfolioReturnShadowInput[];
  capitalBase?: number | null;
  generatedAt?: number;
  requestKey?: string;
  sourceStatus?: PortfolioReturnSourceStatus;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function asNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function hasNumberLike(...values: unknown[]) {
  return values.some((value) => {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string' && value.trim()) return Number.isFinite(Number(value));
    return false;
  });
}

function asString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pct(numerator: number, denominator: number | null | undefined) {
  const base = Number(denominator || 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  return (numerator / base) * 100;
}

function rangeStart(range: PortfolioReturnRange, now: number) {
  if (range === '7d') return now - 7 * DAY_MS;
  if (range === '30d') return now - 30 * DAY_MS;
  if (range === '90d') return now - 90 * DAY_MS;
  return 0;
}

function formatCurveLabel(timestamp: number) {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

function parseJson(value: unknown): any {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function deriveTimeframe(row: Record<string, unknown>) {
  const direct = asString(row.timeframe, row.estimated_timeframe);
  if (direct) return direct;
  const feature = parseJson(row.feature_json);
  const raw = parseJson(row.raw_json);
  return asString(feature?.timeframe, raw?.timeframe, raw?.features?.timeframe);
}

function deriveTradeCapital(row: {
  margin: number | null;
  notional: number | null;
  amount: number | null;
  amountType: string | null;
  leverage: number | null;
  entryPrice: number | null;
  qtyEstimate?: number | null;
}) {
  if (row.margin && row.margin > 0) return row.margin;
  const leverage = row.leverage && row.leverage > 0 ? row.leverage : null;
  if (row.notional && row.notional > 0 && leverage) return row.notional / leverage;
  if (row.notional && row.notional > 0) return row.notional;
  if (row.amount && row.amount > 0 && String(row.amountType || '').toLowerCase() !== 'coin') return row.amount;
  if (row.qtyEstimate && row.qtyEstimate > 0 && row.entryPrice && row.entryPrice > 0) {
    const notional = row.qtyEstimate * row.entryPrice;
    return leverage ? notional / leverage : notional;
  }
  if (row.amount && row.amount > 0) return row.amount;
  return null;
}

function normalizeMode(value: unknown) {
  const mode = String(value || '').toLowerCase();
  if (mode.includes('demo') || mode.includes('sandbox') || mode.includes('paper') || mode.includes('sim')) return 'demo';
  if (mode.includes('live') || mode.includes('real')) return 'live';
  return null;
}

function normalizeBillMode(row: Record<string, unknown>, fallback: PortfolioReturnMode) {
  if (row.sandbox === true || row.simulated === true) return 'demo';
  if (row.sandbox === false || row.simulated === false) return 'live';
  const explicit = normalizeMode(row.mode ?? row.accountMode ?? row.account_mode ?? row.sandbox ?? row.simulated);
  return explicit || fallback;
}

function isAutoTrade(row: Record<string, unknown>) {
  const source = String(row.source || '').toLowerCase();
  return source === 'auto' || Boolean(asString(row.strategy_id, row.strategyId, row.strategy));
}

function normalizeSymbol(value: unknown) {
  return normalizeDisplaySymbol(asString(value) || '');
}

function timestampDistance(left: number | null, right: number | null) {
  if (!left || !right) return Number.MAX_SAFE_INTEGER;
  return Math.abs(left - right);
}

function findBillEnrichment(
  bill: { symbol: string; timestamp: number },
  trades: PortfolioReturnTradeInput[],
  selectedMode: PortfolioReturnMode
) {
  const candidates = trades
    .filter((row) => isAutoTrade(row))
    .filter((row) => (normalizeMode(row.mode) || 'live') === selectedMode)
    .filter((row) => normalizeSymbol(row.symbol) === bill.symbol)
    .map((row) => {
      const openedAt = asNumber(row.opened_at, row.openedAt, row.created_at, row.createdAt);
      const closedAt = asNumber(row.closed_at, row.closedAt);
      const createdAt = asNumber(row.created_at, row.createdAt, openedAt, closedAt);
      const matchTime = closedAt || createdAt || openedAt || null;
      return { row, score: timestampDistance(matchTime, bill.timestamp) };
    })
    .sort((a, b) => a.score - b.score);

  return candidates[0]?.row || null;
}

function normalizeTradeRow(row: PortfolioReturnTradeInput, capitalBase: number): PortfolioReturnHistoryRow | null {
  if (!isAutoTrade(row)) return null;
  const status = String(row.status || 'open').toLowerCase();
  const openedAt = asNumber(row.opened_at, row.openedAt, row.created_at, row.createdAt);
  const closedAt = asNumber(row.closed_at, row.closedAt);
  const createdAt = asNumber(row.created_at, row.createdAt, openedAt, closedAt, Date.now()) || Date.now();
  const timestamp = closedAt || createdAt;
  const hasRealizedPnl = hasNumberLike(row.realized_pnl, row.realizedPnl);
  const hasUnrealizedPnl = hasNumberLike(row.unrealized_pnl, row.unrealizedPnl);
  if (!hasRealizedPnl && !hasUnrealizedPnl) return null;
  const realizedPnl = hasRealizedPnl ? asNumber(row.realized_pnl, row.realizedPnl) || 0 : 0;
  const unrealizedPnl = hasUnrealizedPnl ? asNumber(row.unrealized_pnl, row.unrealizedPnl) || 0 : 0;
  const fee = asNumber(row.fee, row.estimated_fee, row.estimatedFee) || 0;
  const entryPrice = asNumber(row.entry_price, row.entryPrice, row.price);
  const exitPrice = asNumber(row.exit_price, row.exitPrice);
  const markPrice = asNumber(row.mark_price, row.markPrice);
  const margin = asNumber(row.margin);
  const notional = asNumber(row.notional, row.notionalUsd);
  const amount = asNumber(row.amount, row.contracts);
  const amountType = asString(row.amount_type, row.amountType);
  const leverage = asNumber(row.leverage);
  const tradeCapital = deriveTradeCapital({ margin, notional, amount, amountType, leverage, entryPrice });
  const holdMinutes = openedAt && closedAt ? Math.max(0, (closedAt - openedAt) / 60_000) : null;

  return {
    id: String(row.id || row.client_order_id || row.clientOrderId || `${createdAt}_${asString(row.symbol) || 'trade'}`),
    source: 'local_trade',
    mode: normalizeMode(row.mode) || 'live',
    symbol: normalizeSymbol(row.symbol),
    side: String(asString(row.side) || 'UNKNOWN').toUpperCase(),
    strategyId: asString(row.strategy_id, row.strategyId, row.strategy),
    timeframe: deriveTimeframe(row),
    status,
    openedAt,
    closedAt,
    timestamp,
    realizedPnl,
    unrealizedPnl,
    totalPnl: realizedPnl + unrealizedPnl,
    tradeRoiPct: pct(realizedPnl + unrealizedPnl, tradeCapital),
    accountReturnPct: pct(realizedPnl + unrealizedPnl, capitalBase),
    fee,
    slippageBps: null,
    margin,
    notional,
    amount,
    amountType,
    leverage,
    entryPrice,
    exitPrice,
    markPrice,
    tpPrice: asNumber(row.tp_price, row.tpPrice, row.take_profit_price, row.takeProfitPrice, row.current_tp_price),
    slPrice: asNumber(row.sl_price, row.slPrice, row.stop_loss_price, row.stopLossPrice),
    regime: asString(row.regime),
    macroGate: asString(row.macro_gate, row.macroGate),
    entryReason: asString(row.entry_reason, row.entryReason),
    exitReason: asString(row.exit_reason, row.exitReason),
    holdMinutes,
    isEstimated: false,
    balanceChange: null,
    type: null,
    subType: null,
    ccy: null,
    localTradeId: String(row.id || row.client_order_id || row.clientOrderId || '') || null,
    signalJson: null,
    orderbookJson: null,
    rawJson: asString(row.raw_json, row.rawJson),
  };
}

function normalizeBillRow(
  row: PortfolioReturnBillInput,
  capitalBase: number,
  selectedMode: PortfolioReturnMode,
  trades: PortfolioReturnTradeInput[]
): PortfolioReturnHistoryRow | null {
  const mode = normalizeBillMode(row, selectedMode);
  if (mode !== selectedMode) return null;

  const timestamp = asNumber(row.timestamp, row.ts, row.uTime, row.cTime);
  if (!timestamp || timestamp <= 0) return null;

  const realizedPnl = asNumber(row.pnl, row.realizedPnl, row.realized_pnl) || 0;
  const fee = asNumber(row.fee) || 0;
  const balanceChange = asNumber(row.balanceChange, row.balance_change, row.balChg);
  if (realizedPnl === 0 && fee === 0 && Number(balanceChange || 0) === 0) return null;

  const symbol = normalizeSymbol(row.symbol ?? row.instId ?? row.inst_id);
  const enrichment = findBillEnrichment({ symbol, timestamp }, trades, selectedMode);
  const openedAt = asNumber(enrichment?.opened_at, enrichment?.openedAt, enrichment?.created_at, enrichment?.createdAt);
  const closedAt = asNumber(enrichment?.closed_at, enrichment?.closedAt);
  const entryPrice = asNumber(enrichment?.entry_price, enrichment?.entryPrice, enrichment?.price);
  const exitPrice = asNumber(enrichment?.exit_price, enrichment?.exitPrice);
  const markPrice = asNumber(enrichment?.mark_price, enrichment?.markPrice);
  const margin = asNumber(enrichment?.margin);
  const notional = asNumber(enrichment?.notional, enrichment?.notionalUsd);
  const amount = asNumber(enrichment?.amount, enrichment?.contracts);
  const amountType = asString(enrichment?.amount_type, enrichment?.amountType);
  const leverage = asNumber(enrichment?.leverage);
  const tradeCapital = deriveTradeCapital({ margin, notional, amount, amountType, leverage, entryPrice });
  const holdEnd = closedAt || timestamp;
  const holdMinutes = openedAt && holdEnd ? Math.max(0, (holdEnd - openedAt) / 60_000) : null;
  const localTradeId = asString(enrichment?.id, enrichment?.client_order_id, enrichment?.clientOrderId);
  const rawJson = asString(row.rawJson, row.raw_json) || JSON.stringify(row);

  return {
    id: String(row.id || row.billId || row.bill_id || row.ordId || `${timestamp}_${asString(row.type) || ''}_${asString(row.subType) || ''}`),
    source: 'exchange_bill',
    mode,
    symbol,
    side: String(asString(enrichment?.side, row.side, row.posSide) || 'BILL').toUpperCase(),
    strategyId: asString(enrichment?.strategy_id, enrichment?.strategyId, enrichment?.strategy),
    timeframe: enrichment ? deriveTimeframe(enrichment) : null,
    status: 'settled',
    openedAt,
    closedAt: closedAt || timestamp,
    timestamp,
    realizedPnl,
    unrealizedPnl: 0,
    totalPnl: realizedPnl,
    tradeRoiPct: pct(realizedPnl, tradeCapital),
    accountReturnPct: pct(realizedPnl, capitalBase),
    fee,
    slippageBps: null,
    margin,
    notional,
    amount,
    amountType,
    leverage,
    entryPrice,
    exitPrice,
    markPrice,
    tpPrice: asNumber(enrichment?.tp_price, enrichment?.tpPrice, enrichment?.take_profit_price, enrichment?.takeProfitPrice, enrichment?.current_tp_price),
    slPrice: asNumber(enrichment?.sl_price, enrichment?.slPrice, enrichment?.stop_loss_price, enrichment?.stopLossPrice),
    regime: asString(enrichment?.regime),
    macroGate: asString(enrichment?.macro_gate, enrichment?.macroGate),
    entryReason: asString(enrichment?.entry_reason, enrichment?.entryReason),
    exitReason: asString(enrichment?.exit_reason, enrichment?.exitReason),
    holdMinutes,
    isEstimated: false,
    balanceChange,
    type: asString(row.type),
    subType: asString(row.subType, row.sub_type),
    ccy: asString(row.ccy),
    localTradeId,
    signalJson: null,
    orderbookJson: null,
    rawJson,
  };
}

function normalizeShadowRow(row: PortfolioReturnShadowInput, capitalBase: number): PortfolioReturnHistoryRow {
  const status = String(row.status || 'open').toLowerCase();
  const openedAt = asNumber(row.created_at, row.createdAt);
  const closedAt = asNumber(row.closed_at, row.closedAt);
  const evaluatedAt = asNumber(row.last_evaluated_at, row.lastEvaluatedAt);
  const timestamp = closedAt || evaluatedAt || openedAt || Date.now();
  const entryPrice = asNumber(row.entry_price, row.entryPrice, row.executable_price, row.executablePrice);
  const exitPrice = asNumber(row.exit_price, row.exitPrice);
  const markPrice = asNumber(row.mark_price, row.markPrice);
  const amount = asNumber(row.amount);
  const amountType = asString(row.amount_type, row.amountType);
  const leverage = asNumber(row.leverage);
  const qtyEstimate = asNumber(row.qty_estimate, row.qtyEstimate);
  const notional = qtyEstimate && entryPrice ? qtyEstimate * entryPrice : null;
  const margin = deriveTradeCapital({ margin: null, notional, amount, amountType, leverage, entryPrice, qtyEstimate });
  const realizedPnl = status === 'closed' ? asNumber(row.realized_pnl, row.realizedPnl) || 0 : 0;
  const unrealizedPnl = status === 'open' ? asNumber(row.unrealized_pnl, row.unrealizedPnl) || 0 : 0;
  const totalPnl = realizedPnl + unrealizedPnl;
  const holdEnd = closedAt || evaluatedAt || null;
  const holdMinutes = openedAt && holdEnd ? Math.max(0, (holdEnd - openedAt) / 60_000) : null;

  return {
    id: String(row.id || `${timestamp}_${asString(row.symbol) || 'shadow'}`),
    source: 'shadow',
    mode: 'shadow',
    symbol: normalizeSymbol(row.symbol),
    side: String(asString(row.side) || 'UNKNOWN').toUpperCase(),
    strategyId: asString(row.strategy_id, row.strategyId),
    timeframe: asString(row.timeframe, row.estimated_timeframe, row.estimatedTimeframe),
    status,
    openedAt,
    closedAt,
    timestamp,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    tradeRoiPct: pct(totalPnl, margin),
    accountReturnPct: pct(totalPnl, capitalBase),
    fee: 0,
    slippageBps: asNumber(row.slippage_bps, row.slippageBps),
    margin,
    notional,
    amount,
    amountType,
    leverage,
    entryPrice,
    exitPrice,
    markPrice,
    tpPrice: asNumber(row.tp_price, row.tpPrice),
    slPrice: asNumber(row.sl_price, row.slPrice),
    regime: asString(row.regime),
    macroGate: asString(row.macro_gate, row.macroGate),
    entryReason: null,
    exitReason: asString(row.exit_reason, row.exitReason),
    holdMinutes,
    isEstimated: Boolean(Number(row.is_estimated || 0)),
    balanceChange: null,
    type: null,
    subType: null,
    ccy: null,
    localTradeId: null,
    signalJson: asString(row.signal_json, row.signalJson),
    orderbookJson: asString(row.orderbook_json, row.orderbookJson),
    rawJson: null,
  };
}

function initialCapitalBase(input: BuildPortfolioReturnAnalyticsInput) {
  const base = asNumber(input.capitalBase);
  if (base && base > 0) return { value: base, source: 'equity' as const };
  return { value: 0, source: 'none' as const };
}

function deriveFallbackCapital(history: PortfolioReturnHistoryRow[]) {
  const bases = history
    .map((row) => row.margin || (row.notional && row.leverage ? row.notional / row.leverage : row.notional) || row.amount || 0)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!bases.length) return 0;
  return bases.reduce((sum, value) => sum + value, 0);
}

function applyAccountReturn(history: PortfolioReturnHistoryRow[], capitalBase: number) {
  return history.map((row) => ({
    ...row,
    accountReturnPct: pct(row.totalPnl, capitalBase),
  }));
}

function buildCurve(history: PortfolioReturnHistoryRow[], capitalBase: number) {
  let cumulativePnl = 0;
  let peak = 0;
  return history
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((row) => {
      cumulativePnl += row.totalPnl;
      peak = Math.max(peak, cumulativePnl);
      const drawdownValue = Math.min(0, cumulativePnl - peak);
      return {
        timestamp: row.timestamp,
        label: formatCurveLabel(row.timestamp),
        cumulativePnl,
        accountReturnPct: pct(cumulativePnl, capitalBase),
        drawdownPct: pct(drawdownValue, capitalBase),
      };
    });
}

function profitFactor(rows: PortfolioReturnHistoryRow[]) {
  const grossProfit = rows.filter((row) => row.totalPnl > 0).reduce((sum, row) => sum + row.totalPnl, 0);
  const grossLoss = Math.abs(rows.filter((row) => row.totalPnl < 0).reduce((sum, row) => sum + row.totalPnl, 0));
  if (grossProfit > 0 && grossLoss === 0) return grossProfit;
  return grossLoss > 0 ? grossProfit / grossLoss : 0;
}

function isClosedReturnRow(row: PortfolioReturnHistoryRow) {
  if (row.status === 'closed') return true;
  if (row.status === 'settled') return row.realizedPnl !== 0 || row.totalPnl !== 0;
  return row.realizedPnl !== 0;
}

function groupRows(rows: PortfolioReturnHistoryRow[], keyForRow: (row: PortfolioReturnHistoryRow) => string | null) {
  const groups = new Map<string, PortfolioReturnHistoryRow[]>();
  for (const row of rows) {
    const key = keyForRow(row) || 'Uncategorized';
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return Array.from(groups.entries())
    .map(([key, groupRows]) => {
      const closedRows = groupRows.filter(isClosedReturnRow);
      const wins = closedRows.filter((row) => row.realizedPnl > 0 || row.totalPnl > 0).length;
      const roiRows = groupRows.filter((row) => row.tradeRoiPct !== 0);
      return {
        key,
        trades: groupRows.length,
        closedTrades: closedRows.length,
        pnl: groupRows.reduce((sum, row) => sum + row.totalPnl, 0),
        realizedPnl: groupRows.reduce((sum, row) => sum + row.realizedPnl, 0),
        unrealizedPnl: groupRows.reduce((sum, row) => sum + row.unrealizedPnl, 0),
        winRate: closedRows.length ? (wins / closedRows.length) * 100 : 0,
        profitFactor: profitFactor(groupRows),
        avgTradeRoiPct: roiRows.length ? roiRows.reduce((sum, row) => sum + row.tradeRoiPct, 0) / roiRows.length : 0,
      };
    })
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
}

export function buildPortfolioReturnAnalytics(input: BuildPortfolioReturnAnalyticsInput): PortfolioReturnAnalytics {
  const generatedAt = input.generatedAt || Date.now();
  const range = input.range || '30d';
  const limit = Math.min(1000, Math.max(1, Number(input.limit || 200)));
  const startAt = rangeStart(range, generatedAt);
  const capital = initialCapitalBase(input);
  const selectedMode = input.mode;
  const tradeRows = (input.trades || [])
    .map((row) => normalizeTradeRow(row, capital.value))
    .filter((row): row is PortfolioReturnHistoryRow => Boolean(row))
    .filter((row) => row.mode === selectedMode);
  const billRows = (input.bills || [])
    .map((row) => normalizeBillRow(row, capital.value, selectedMode, input.trades || []))
    .filter((row): row is PortfolioReturnHistoryRow => Boolean(row));
  const hasBillInput = selectedMode !== 'shadow' && Array.isArray(input.bills);
  const rawRows = selectedMode === 'shadow'
    ? (input.shadowOrders || []).map((row) => normalizeShadowRow(row, capital.value))
    : hasBillInput
      ? billRows
      : tradeRows;

  const inRangeRows = rawRows
    .filter((row) => startAt <= 0 || row.timestamp >= startAt)
    .sort((a, b) => b.timestamp - a.timestamp);
  const fallbackBase = capital.value > 0 ? capital.value : deriveFallbackCapital(inRangeRows);
  const capitalBase = fallbackBase > 0 ? fallbackBase : 0;
  const capitalBaseSource = capital.value > 0 ? capital.source : capitalBase > 0 ? 'fallback' as const : 'none' as const;
  const history = applyAccountReturn(inRangeRows, capitalBase).slice(0, limit);
  const closedRows = history.filter(isClosedReturnRow);
  const openRows = history.filter((row) => row.status !== 'closed' && row.status !== 'settled' && row.unrealizedPnl !== 0);
  const totalPnl = history.reduce((sum, row) => sum + row.totalPnl, 0);
  const realizedPnl = history.reduce((sum, row) => sum + row.realizedPnl, 0);
  const unrealizedPnl = history.reduce((sum, row) => sum + row.unrealizedPnl, 0);
  const grossProfit = history.filter((row) => row.totalPnl > 0).reduce((sum, row) => sum + row.totalPnl, 0);
  const grossLoss = Math.abs(history.filter((row) => row.totalPnl < 0).reduce((sum, row) => sum + row.totalPnl, 0));
  const roiRows = history.filter((row) => row.tradeRoiPct !== 0);
  const holdRows = closedRows.filter((row) => row.holdMinutes !== null);
  const wins = closedRows.filter((row) => row.realizedPnl > 0 || row.totalPnl > 0).length;
  const equityCurve = buildCurve(history, capitalBase);
  const maxDrawdownPct = equityCurve.reduce((min, point) => Math.min(min, point.drawdownPct), 0);

  return {
    mode: selectedMode,
    range,
    requestKey: input.requestKey || `${selectedMode}:${range}:${limit}`,
    generatedAt,
    capitalBase,
    capitalBaseSource,
    sourceStatus: input.sourceStatus || { state: 'fresh', fetchedAt: generatedAt },
    summary: {
      totalPnl,
      realizedPnl,
      unrealizedPnl,
      accountReturnPct: pct(totalPnl, capitalBase),
      avgTradeRoiPct: roiRows.length ? roiRows.reduce((sum, row) => sum + row.tradeRoiPct, 0) / roiRows.length : 0,
      winRate: closedRows.length ? (wins / closedRows.length) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? grossProfit : 0,
      maxDrawdownPct,
      closedTrades: closedRows.length,
      openTrades: openRows.length,
      totalRows: history.length,
      grossProfit,
      grossLoss,
      fees: history.reduce((sum, row) => sum + row.fee, 0),
      avgHoldMinutes: holdRows.length ? holdRows.reduce((sum, row) => sum + Number(row.holdMinutes || 0), 0) / holdRows.length : 0,
    },
    equityCurve,
    bySymbol: groupRows(history, (row) => row.symbol),
    byStrategy: groupRows(history, (row) => row.strategyId),
    history,
  };
}
