export type FactorAuditStatus = "enabled" | "disabled" | "unavailable" | "latest_revision_blocked";

export type FactorAuditItem = {
  factor: "price" | "macro" | "onchain" | "news";
  label: string;
  status: FactorAuditStatus;
  usedInBacktest: boolean;
  requiredTimestamp?: string;
  message: string;
};

export type WalkForwardWindow = {
  index: number;
  trainStart: number;
  trainEnd: number;
  validationStart: number;
  validationEnd: number;
  warmupStart: number;
  warmupBars: number;
  trainStartTime: number;
  trainEndTime: number;
  validationStartTime: number;
  validationEndTime: number;
};

export type WalkForwardRoundLike = {
  strategy?: string;
  symbol?: string;
  validationStatus?: "stable" | "fragile" | "insufficient_trades" | "no_validation_trades";
  validation?: {
    totalReturn?: number;
    maxDrawdown?: number;
    profitFactor?: number;
    winRate?: number;
    expectancy?: number;
    totalTrades?: number;
    trades?: number;
  };
  perturbation?: {
    medianReturn?: number;
    worstReturn?: number;
    fragile?: boolean;
  };
};

export function normalizePositiveNumber(value: unknown, fallback: number, min = 0, max = Number.POSITIVE_INFINITY) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

export function normalizeInitialEquity(value: unknown, fallback = 10000) {
  return normalizePositiveNumber(value, fallback, 1, 1_000_000_000);
}

export function backtestTimeframeBarsPerDay(timeframe: string) {
  const normalized = String(timeframe || "1h").toLowerCase();
  if (normalized.endsWith("m")) return Math.max(1, Math.floor(1440 / Number(normalized.replace("m", ""))));
  if (normalized.endsWith("h")) return Math.max(1, Math.floor(24 / Number(normalized.replace("h", ""))));
  if (normalized === "1d") return 1;
  return 24;
}

export function median(values: number[]) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return 0;
  const sorted = [...finite].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function normalizeStrategyIds(input: unknown, fallback: string[] = ["trend-breakout", "mean-reversion"]) {
  const raw = Array.isArray(input) ? input : typeof input === "string" && input ? [input] : fallback;
  const allowed = new Set(["trend-breakout", "mean-reversion"]);
  const normalized = Array.from(new Set(raw.map(item => String(item || "").trim()).filter(item => allowed.has(item))));
  return normalized.length ? normalized : fallback;
}

export function normalizeBacktestSymbols(input: unknown, fallbackSymbol = "BTC-USDT", limit = 3) {
  const raw = Array.isArray(input) ? input : typeof input === "string" && input ? [input] : [fallbackSymbol];
  const normalized = Array.from(new Set(raw.map(item => String(item || "").trim()).filter(Boolean)));
  return normalized.length ? normalized.slice(0, limit) : [fallbackSymbol];
}

export function createWalkForwardWindows(
  ohlcv: any[],
  config: {
    timeframe: string;
    trainDays: number;
    validationDays: number;
    stepDays: number;
    warmupBars?: number;
  }
) {
  const barsPerDay = backtestTimeframeBarsPerDay(config.timeframe);
  const trainBars = Math.max(60, Math.round(normalizePositiveNumber(config.trainDays, 180, 1, 3650) * barsPerDay));
  const validationBars = Math.max(30, Math.round(normalizePositiveNumber(config.validationDays, 30, 1, 3650) * barsPerDay));
  const stepBars = Math.max(1, Math.round(normalizePositiveNumber(config.stepDays, 30, 1, 3650) * barsPerDay));
  const warmupBars = Math.max(0, Math.round(normalizePositiveNumber(config.warmupBars, 80, 0, 1000)));
  const windows: WalkForwardWindow[] = [];

  if (!Array.isArray(ohlcv) || ohlcv.length < trainBars + validationBars) {
    return { windows, trainBars, validationBars, stepBars, warmupBars, barsPerDay };
  }

  for (let start = 0; start + trainBars + validationBars <= ohlcv.length; start += stepBars) {
    const trainStart = start;
    const trainEnd = start + trainBars - 1;
    const validationStart = trainEnd + 1;
    const validationEnd = validationStart + validationBars - 1;
    const warmupStart = Math.max(trainStart, validationStart - warmupBars);
    windows.push({
      index: windows.length,
      trainStart,
      trainEnd,
      validationStart,
      validationEnd,
      warmupStart,
      warmupBars: validationStart - warmupStart,
      trainStartTime: Number(ohlcv[trainStart]?.[0] || 0),
      trainEndTime: Number(ohlcv[trainEnd]?.[0] || 0),
      validationStartTime: Number(ohlcv[validationStart]?.[0] || 0),
      validationEndTime: Number(ohlcv[validationEnd]?.[0] || 0),
    });
  }

  return { windows, trainBars, validationBars, stepBars, warmupBars, barsPerDay };
}

export function buildValidationSlice(ohlcv: any[], window: WalkForwardWindow) {
  return {
    validationWarmup: ohlcv.slice(window.warmupStart, window.validationEnd + 1),
    tradeStartTime: window.validationStartTime,
  };
}

export function buildStrictFactorAudit() {
  const audit: FactorAuditItem[] = [
    {
      factor: "price",
      label: "OKX OHLCV",
      status: "enabled",
      usedInBacktest: true,
      requiredTimestamp: "bar timestamp",
      message: "Price candles replay in time order; signals only use the previous candle close and earlier data.",
    },
    {
      factor: "macro",
      label: "Macro data",
      status: "latest_revision_blocked",
      usedInBacktest: false,
      requiredTimestamp: "releasedAt or ALFRED vintage timestamp",
      message: "Only the latest revision or live snapshot is available; disabled in strict mode to avoid look-ahead bias.",
    },
    {
      factor: "onchain",
      label: "On-chain data",
      status: "unavailable",
      usedInBacktest: false,
      requiredTimestamp: "availableAt",
      message: "No historical on-chain series with verifiable publication times; disabled in strict mode.",
    },
    {
      factor: "news",
      label: "News data",
      status: "unavailable",
      usedInBacktest: false,
      requiredTimestamp: "publishedAt",
      message: "No news data that replays by publication time; disabled in strict mode.",
    },
  ];
  return audit;
}

export function summarizeWalkForwardRounds(rounds: WalkForwardRoundLike[]) {
  const validation = rounds.map(round => round.validation || {});
  return {
    rounds: rounds.length,
    validRounds: rounds.filter(round => round.validationStatus === "stable").length,
    insufficientTradeRounds: rounds.filter(round => round.validationStatus === "insufficient_trades").length,
    noValidationTradeRounds: rounds.filter(round => round.validationStatus === "no_validation_trades").length,
    medianReturn: median(validation.map(item => Number(item.totalReturn))),
    worstReturn: validation.length ? Math.min(...validation.map(item => Number(item.totalReturn || 0))) : 0,
    medianProfitFactor: median(validation.map(item => Number(item.profitFactor))),
    medianWinRate: median(validation.map(item => Number(item.winRate))),
    worstMaxDrawdown: validation.length ? Math.max(...validation.map(item => Number(item.maxDrawdown || 0))) : 0,
    medianExpectancy: median(validation.map(item => Number(item.expectancy))),
    totalTrades: validation.reduce((sum, item) => sum + Number(item.totalTrades ?? item.trades ?? 0), 0),
    medianPerturbedReturn: median(rounds.map(round => Number(round.perturbation?.medianReturn))),
    worstPerturbedReturn: rounds.length ? Math.min(...rounds.map(round => Number(round.perturbation?.worstReturn || 0))) : 0,
    fragileRounds: rounds.filter(round => round.validationStatus === "fragile" || round.perturbation?.fragile).length,
  };
}

export function groupWalkForwardRounds(rounds: WalkForwardRoundLike[]) {
  const byStrategy: Record<string, { rounds: WalkForwardRoundLike[]; summary: ReturnType<typeof summarizeWalkForwardRounds>; bySymbol: Record<string, ReturnType<typeof summarizeWalkForwardRounds>> }> = {};
  for (const round of rounds) {
    const strategy = round.strategy || "unknown";
    if (!byStrategy[strategy]) {
      byStrategy[strategy] = { rounds: [], summary: summarizeWalkForwardRounds([]), bySymbol: {} };
    }
    byStrategy[strategy].rounds.push(round);
  }

  for (const [strategy, bucket] of Object.entries(byStrategy)) {
    bucket.summary = summarizeWalkForwardRounds(bucket.rounds);
    const symbols = Array.from(new Set(bucket.rounds.map(round => round.symbol || "unknown")));
    bucket.bySymbol = Object.fromEntries(symbols.map(symbol => [
      symbol,
      summarizeWalkForwardRounds(bucket.rounds.filter(round => (round.symbol || "unknown") === symbol)),
    ]));
    byStrategy[strategy] = bucket;
  }

  return byStrategy;
}
