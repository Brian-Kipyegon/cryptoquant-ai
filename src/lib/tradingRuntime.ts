import { calculateRSI, calculateSMA, calculateStandardDeviation } from './indicators';
import { evaluateMacroGate, type MacroGateDecision } from './strategyEngine';

export type ChartPoint = {
  time: string;
  price: number;
};

export type OrderBook = {
  bids: [number, number][];
  asks: [number, number][];
};

export type Ticker = {
  symbol: string;
  last: number;
  percentage: number;
  high: number;
  low: number;
  volume: number;
};

export type MarketCorrelation = {
  symbol: string;
  value: number;
};

export type MarketTrend = {
  timeframe: string;
  signal: string;
  strength: number;
};

export type MarketAnalysisState = {
  sentiment: number;
  correlations: MarketCorrelation[];
  trends: MarketTrend[];
  volatility: number;
  liquidity: string;
  volatilityLabel: string;
  institutionalParticipation: string;
  onChainData: {
    exchangeInflow: number;
    whaleActivity: number;
    activeAddresses: number;
    mvrvRatio: number;
    dxy?: number;
    m2?: number;
    dxySource?: 'live' | 'stale' | 'unavailable';
    dataSource?: string;
  };
  macroIndicators: {
    dxyCorrelation: number;
    usdtPremium: number;
    globalLiquidity: number;
    macroRiskScore: number;
    macroGate: MacroGateDecision;
  };
  realIndicators: {
    rsi: number;
    sma20: number;
    stdDev: number;
    volumeSMA: number;
    isRealData: boolean;
  };
  lastSummaryTime: number;
};

export type RuntimeMarketContext = {
  chartData: ChartPoint[];
  prices: number[];
  fundingRate: any;
  orderBook: OrderBook | null;
  marketAnalysis: MarketAnalysisState;
};

export type AutoTradingRiskConfig = {
  stopLoss: number;
  takeProfit: number;
  maxPosition: number;
  leverage: number;
  dailyLossLimit: number;
  maxConsecutiveLosses: number;
  maxPositionPerSymbol: number;
  maxTotalLeverage: number;
  maxRiskPerSignal: number;
  volatilityThreshold: number;
  fundingRateThreshold: number;
  autoTradeThreshold: number;
  shadowMode: boolean;
  debugForceSignal: boolean;
  estimatedFeeRate: number;
};

export const AUTO_TRADING_ALLOWED_SYMBOLS = [
  'BTC/USDT',
  'ETH/USDT',
  'SOL/USDT',
  'DOGE/USDT',
] as const;

export const AUTO_TRADING_ALLOWED_TIMEFRAMES = ['15m', '1h'] as const;

export const DEFAULT_AUTO_TRADING_RISK_CONFIG: AutoTradingRiskConfig = {
  stopLoss: 2.0,
  takeProfit: 6.0,
  maxPosition: 5,
  leverage: 3,
  dailyLossLimit: 3.0,
  maxConsecutiveLosses: 3,
  maxPositionPerSymbol: 15,
  maxTotalLeverage: 10,
  maxRiskPerSignal: 0.5,
  volatilityThreshold: 2.0,
  fundingRateThreshold: 0.08,
  autoTradeThreshold: 85,
  shadowMode: true,
  debugForceSignal: false,
  estimatedFeeRate: 0.05,
};

const DEFAULT_MACRO_GATE = evaluateMacroGate({ macroRiskScore: 0 });

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getNumericValue = (...values: any[]) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
};

export function createDefaultMarketAnalysis(): MarketAnalysisState {
  return {
    sentiment: 65,
    correlations: [
      { symbol: 'BTC/USDT', value: 1.0 },
      { symbol: 'ETH/USDT', value: 0.85 },
      { symbol: 'SOL/USDT', value: 0.72 },
      { symbol: 'DOGE/USDT', value: 0.58 },
    ],
    trends: [
      { timeframe: '15m', signal: 'BUY', strength: 80 },
      { timeframe: '1h', signal: 'BUY', strength: 65 },
      { timeframe: '4h', signal: 'NEUTRAL', strength: 45 },
      { timeframe: '1d', signal: 'SELL', strength: 30 },
    ],
    volatility: 0.45,
    liquidity: 'Ample',
    volatilityLabel: 'Medium',
    institutionalParticipation: 'High',
    onChainData: {
      exchangeInflow: 0,
      whaleActivity: 50,
      activeAddresses: 10000,
      mvrvRatio: 1.5,
      dxy: 0,
      m2: 0,
      dxySource: 'unavailable',
      dataSource: 'default',
    },
    macroIndicators: {
      dxyCorrelation: 0,
      usdtPremium: 0.1,
      globalLiquidity: 0,
      macroRiskScore: 0,
      macroGate: DEFAULT_MACRO_GATE,
    },
    realIndicators: {
      rsi: 50,
      sma20: 0,
      stdDev: 0,
      volumeSMA: 0,
      isRealData: false,
    },
    lastSummaryTime: 0,
  };
}

export function normalizeDisplaySymbol(symbol: string) {
  if (!symbol) return 'BTC/USDT';
  const upper = String(symbol).toUpperCase();
  const noMargin = upper.includes(':') ? upper.split(':')[0] : upper;
  const noSwap = noMargin.endsWith('-SWAP') ? noMargin.slice(0, -5) : noMargin;
  if (noSwap.includes('/')) return noSwap;
  const parts = noSwap.split('-').filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return noSwap;
}

export function normalizeTicker(targetSymbol: string, tickerData: any): Ticker | null {
  if (!tickerData) return null;
  const last = getNumericValue(tickerData.last, tickerData.close, tickerData.info?.last);
  if (last <= 0) return null;
  const open = getNumericValue(tickerData.open, tickerData.open24h, tickerData.info?.open24h);
  return {
    symbol: normalizeDisplaySymbol(targetSymbol),
    last,
    percentage: Number.isFinite(Number(tickerData.percentage))
      ? Number(tickerData.percentage)
      : open > 0 ? ((last - open) / open) * 100 : 0,
    high: getNumericValue(tickerData.high, tickerData.high24h, tickerData.info?.high24h, last),
    low: getNumericValue(tickerData.low, tickerData.low24h, tickerData.info?.low24h, last),
    volume: getNumericValue(tickerData.volume, tickerData.baseVolume, tickerData.vol24h, tickerData.info?.vol24h),
  };
}

export function formatOhlcvTime(timestamp: number, timeframe = '1h') {
  const date = new Date(timestamp);
  if (timeframe === '1w') {
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  }
  if (timeframe === '1d') {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${hours}:${minutes}`;
}

export function deriveMacroRiskScoreFromIndicators(macroIndicators: any) {
  if (Number.isFinite(Number(macroIndicators?.macroRiskScore))) {
    return clamp(Number(macroIndicators.macroRiskScore), -1, 1);
  }
  return clamp((((macroIndicators?.globalLiquidity ?? 50) - 50) / 50) * 0.6, -1, 1);
}

export function deriveMarketMicrostructure(
  tickerData: any,
  fundingData: any,
  orderBookData: OrderBook | null,
  previous: MarketAnalysisState,
  fallback?: {
    ticker?: Ticker | null;
    fundingRate?: any;
    orderBook?: OrderBook | null;
  }
) {
  const lastPrice = Number(tickerData?.last || fallback?.ticker?.last || 0);
  const high = Number(tickerData?.high || tickerData?.high24h || fallback?.ticker?.high || lastPrice);
  const low = Number(tickerData?.low || tickerData?.low24h || fallback?.ticker?.low || lastPrice);
  const open = Number(
    tickerData?.open ||
    tickerData?.open24h ||
    (lastPrice ? lastPrice / (1 + ((tickerData?.percentage || 0) / 100)) : lastPrice)
  );
  const pct = Number.isFinite(Number(tickerData?.percentage))
    ? Number(tickerData.percentage)
    : open > 0 ? ((lastPrice - open) / open) * 100 : 0;
  const funding = Number(fundingData?.fundingRate || fallback?.fundingRate?.fundingRate || 0);
  const bids = orderBookData?.bids || fallback?.orderBook?.bids || [];
  const asks = orderBookData?.asks || fallback?.orderBook?.asks || [];
  const bidVol = bids.slice(0, 10).reduce((acc, [, size]) => acc + Number(size || 0), 0);
  const askVol = asks.slice(0, 10).reduce((acc, [, size]) => acc + Number(size || 0), 0);
  const totalDepth = bidVol + askVol;
  const imbalance = totalDepth > 0 ? (bidVol - askVol) / totalDepth : 0;
  const topDepth = [...bids.slice(0, 3), ...asks.slice(0, 3)].reduce((acc, [, size]) => acc + Number(size || 0), 0);
  const whaleActivity = totalDepth > 0 ? clamp((topDepth / totalDepth) * 100, 0, 100) : previous.onChainData.whaleActivity;
  const volume = Number(tickerData?.baseVolume || tickerData?.vol24h || fallback?.ticker?.volume || 0);
  const range = lastPrice > 0 ? Math.max(0, high - low) : 0;
  const positionInRange = range > 0 ? clamp((lastPrice - low) / range, 0, 1) : 0.5;
  const volatilityVal = lastPrice > 0 ? range / lastPrice : previous.volatility;
  const volLabel = volatilityVal > 0.05 ? 'Very high' : volatilityVal > 0.03 ? 'High' : volatilityVal > 0.01 ? 'Medium' : 'Low';
  const liqLabel = totalDepth > 500 ? 'Very high' : totalDepth > 100 ? 'Ample' : totalDepth > 0 ? 'Moderate' : 'Waiting for order book';
  const instLabel = whaleActivity > 55 || Math.abs(pct) > 5 ? 'Very high' : whaleActivity > 35 || Math.abs(pct) > 2 ? 'High' : 'Medium';
  const sentiment = clamp(Math.round((positionInRange * 55) + 45 + (imbalance * 20) + (funding * 10000)), 1, 99);
  const baseCorrelations: Record<string, number> = {
    'BTC/USDT': 1,
    'ETH/USDT': 0.86,
    'SOL/USDT': 0.72,
    'DOGE/USDT': 0.58,
  };

  return {
    sentiment,
    volatility: volatilityVal,
    volatilityLabel: volLabel,
    liquidity: liqLabel,
    institutionalParticipation: instLabel,
    correlations: previous.correlations.map((item) => ({
      ...item,
      value: item.symbol === 'BTC/USDT'
        ? 1
        : clamp((baseCorrelations[item.symbol] || item.value) + (Math.abs(pct) > 3 ? 0.04 : 0) + (Math.abs(imbalance) * 0.03), 0.3, 0.99),
    })),
    onChainData: {
      ...previous.onChainData,
      exchangeInflow: -imbalance * 1000,
      whaleActivity,
      activeAddresses: Math.round(clamp(volume * 10, 5000, 250000)),
      mvrvRatio: clamp(1 + positionInRange + (pct / 100), 0.6, 3.5),
      dataSource: 'market_microstructure_proxy',
    },
    macroIndicators: previous.macroIndicators,
    trends: [
      { timeframe: '15m', signal: pct > 0.5 ? 'BUY' : pct < -0.5 ? 'SELL' : 'NEUTRAL', strength: Math.min(100, Math.abs(pct) * 50 + 50) },
      { timeframe: '1h', signal: pct > 1.0 ? 'BUY' : pct < -1.0 ? 'SELL' : 'NEUTRAL', strength: Math.min(100, Math.abs(pct) * 30 + 40) },
      { timeframe: '4h', signal: previous.trends[2]?.signal || 'NEUTRAL', strength: previous.trends[2]?.strength || 45 },
      { timeframe: '1d', signal: previous.trends[3]?.signal || 'NEUTRAL', strength: previous.trends[3]?.strength || 45 },
    ],
  };
}

export function buildMarketRuntimeContext(
  targetSymbol: string,
  tickerData: any,
  fundingData: any,
  orderBookData: OrderBook | null,
  ohlcvData: any[],
  previous: MarketAnalysisState,
  timeframe = '1h',
  fallback?: {
    ticker?: Ticker | null;
    fundingRate?: any;
    orderBook?: OrderBook | null;
  }
): RuntimeMarketContext {
  const normalizedTicker = normalizeTicker(targetSymbol, tickerData);
  const rows = Array.isArray(ohlcvData) ? ohlcvData : [];
  const prices = rows.map((item: any) => Number(item[4])).filter(Number.isFinite);
  const volumes = rows.map((item: any) => Number(item[5])).filter(Number.isFinite);
  const rsi = prices.length >= 15 ? calculateRSI(prices) : previous.realIndicators.rsi;
  const sma20 = prices.length >= 20 ? calculateSMA(prices, 20) : previous.realIndicators.sma20;
  const stdDev = prices.length >= 20 ? calculateStandardDeviation(prices, 20) : previous.realIndicators.stdDev;
  const volumeSMA = volumes.length >= 20 ? calculateSMA(volumes, 20) : previous.realIndicators.volumeSMA;
  const currentVolume = volumes[volumes.length - 1] || 0;
  const microstructure = deriveMarketMicrostructure(
    normalizedTicker || tickerData,
    fundingData,
    orderBookData,
    previous,
    fallback
  );
  const institutionalParticipation = currentVolume > 0 && volumeSMA > 0
    ? currentVolume > volumeSMA * 1.5 ? 'Very high' : currentVolume > volumeSMA ? 'High' : 'Moderate'
    : microstructure.institutionalParticipation;

  return {
    prices,
    fundingRate: fundingData,
    orderBook: orderBookData,
    chartData: rows
      .map((item: any) => ({
        time: formatOhlcvTime(Number(item[0]), timeframe),
        price: Number(item[4]),
      }))
      .filter((point: ChartPoint) => Number.isFinite(point.price)),
    marketAnalysis: {
      ...previous,
      ...microstructure,
      institutionalParticipation,
      onChainData: {
        ...previous.onChainData,
        ...microstructure.onChainData,
      },
      macroIndicators: {
        ...previous.macroIndicators,
        ...microstructure.macroIndicators,
      },
      realIndicators: {
        rsi,
        sma20,
        stdDev,
        volumeSMA,
        isRealData: prices.length >= 20,
      },
    },
  };
}

export function estimateShadowExecution(
  side: 'buy' | 'sell',
  targetTicker: Ticker,
  targetOrderBook: OrderBook | null,
  apiLatency = 0
) {
  const theoreticalPrice = targetTicker.last || 0;
  const bestAsk = targetOrderBook?.asks?.[0]?.[0] || theoreticalPrice;
  const bestBid = targetOrderBook?.bids?.[0]?.[0] || theoreticalPrice;
  const executablePrice = side === 'buy' ? bestAsk : bestBid;
  const spreadBps = theoreticalPrice > 0 ? Math.abs(bestAsk - bestBid) / theoreticalPrice * 10000 : 0;
  const slippageBps = theoreticalPrice > 0
    ? (side === 'buy'
      ? Math.max(0, executablePrice - theoreticalPrice) / theoreticalPrice * 10000
      : Math.max(0, theoreticalPrice - executablePrice) / theoreticalPrice * 10000)
    : 0;

  return {
    theoreticalPrice,
    executablePrice,
    spreadBps,
    slippageBps,
    latencyMs: apiLatency || 0,
  };
}

export function calculateRiskManagedAmount(args: {
  balanceTotal: number;
  currentPrice: number;
  stopLossPrice?: number;
  riskConfig: AutoTradingRiskConfig;
  sizeMultiplier?: number;
}) {
  const sizeMultiplier = args.sizeMultiplier ?? 1;
  const stopDistancePct = args.currentPrice > 0 && args.stopLossPrice
    ? Math.abs(args.currentPrice - args.stopLossPrice) / args.currentPrice
    : args.riskConfig.stopLoss / 100;
  const riskBudget = args.balanceTotal * (args.riskConfig.maxRiskPerSignal / 100);
  const notionalByRisk = stopDistancePct > 0 ? riskBudget / stopDistancePct : 0;
  const marginByRisk = notionalByRisk / Math.max(1, args.riskConfig.leverage);
  const maxMargin = args.balanceTotal * (args.riskConfig.maxPosition / 100);
  const amount = Math.min(maxMargin, marginByRisk) * sizeMultiplier;

  return {
    amount: Number.isFinite(amount) ? amount : 0,
    stopDistancePct,
    riskBudget,
  };
}
