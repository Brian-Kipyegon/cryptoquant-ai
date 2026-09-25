// Universe selection: which pairs the auto-trading scan covers.
// Pure functions shared by the server (selection) and the dashboard (settings).

export const UNIVERSE_TIMEFRAMES = ['15m', '1h', '4h'] as const;

export type UniverseConfig = {
  /** Scan the most liquid pairs in addition to the manual scan profiles. */
  enabled: boolean;
  /** Number of pairs to scan, ranked by 24h quote volume. */
  size: number;
  /** Timeframes scanned for every universe pair. */
  timeframes: string[];
  /** Minimum 24h volume in the quote currency (USDT). */
  minQuoteVolume: number;
};

export const DEFAULT_UNIVERSE_CONFIG: UniverseConfig = {
  enabled: true,
  size: 100,
  timeframes: ['1h'],
  minQuoteVolume: 5_000_000,
};

export const UNIVERSE_SIZE_LIMITS = { min: 1, max: 300 } as const;

export const UNIVERSE_QUOTE = 'USDT';

// Assets that are pegged or wrapped and therefore not worth trading against USDT.
const EXCLUDED_BASES = new Set([
  // stablecoins
  'USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'PYUSD', 'USDE', 'USD1', 'USDD', 'UST', 'USTC', 'FRAX', 'LUSD', 'GUSD', 'SUSD', 'RLUSD', 'XUSD', 'BFUSD',
  // fiat
  'EUR', 'EURI', 'AEUR', 'GBP', 'TRY', 'BRL', 'AUD', 'RUB', 'UAH', 'ZAR', 'JPY', 'ARS', 'MXN', 'COP', 'PLN', 'RON', 'CZK', 'NGN', 'IDR',
  // wrapped / liquid-staked duplicates of majors
  'WBTC', 'WBETH', 'BETH', 'STETH', 'WSTETH', 'WETH', 'BTCB', 'BNSOL',
]);

// Binance leveraged tokens (BTCUP, ETHDOWN, ...) and 3L/3S style tokens elsewhere.
const LEVERAGED_TOKEN = /^(BTC|ETH|BNB|XRP|ADA|DOT|LINK|TRX|LTC|EOS|XLM|FIL|SXP|UNI|AAVE|SUSHI|YFI|XTZ|1INCH|BCH)(UP|DOWN|BULL|BEAR)$|^[A-Z0-9]+[2-5][LS]$/;

export type UniverseMarket = { symbol: string; base: string; quote: string; active: boolean };
export type UniverseTicker = { last?: number; quoteVolume?: number; baseVolume?: number };

export type UniverseEntry = {
  symbol: string;
  quoteVolume: number;
  last: number;
};

export function isExcludedBase(base: string) {
  const upper = String(base || '').toUpperCase();
  return EXCLUDED_BASES.has(upper) || LEVERAGED_TOKEN.test(upper);
}

function quoteVolumeOf(ticker: UniverseTicker) {
  const quote = Number(ticker.quoteVolume);
  if (Number.isFinite(quote) && quote > 0) return quote;
  const derived = Number(ticker.baseVolume) * Number(ticker.last);
  return Number.isFinite(derived) ? derived : 0;
}

/** Ranks active USDT pairs by 24h quote volume and returns the top `size`. */
export function selectUniverse(
  markets: UniverseMarket[],
  tickers: Record<string, UniverseTicker>,
  options: Pick<UniverseConfig, 'size' | 'minQuoteVolume'>,
  allowedSymbols?: Set<string> | null,
): UniverseEntry[] {
  const ranked: UniverseEntry[] = [];
  for (const market of markets) {
    if (!market.active || market.quote !== UNIVERSE_QUOTE) continue;
    if (isExcludedBase(market.base)) continue;
    if (allowedSymbols && !allowedSymbols.has(market.symbol)) continue;
    const ticker = tickers[market.symbol];
    const last = Number(ticker?.last);
    if (!ticker || !Number.isFinite(last) || last <= 0) continue;
    const quoteVolume = quoteVolumeOf(ticker);
    if (quoteVolume < options.minQuoteVolume) continue;
    ranked.push({ symbol: market.symbol, quoteVolume, last });
  }
  ranked.sort((a, b) => b.quoteVolume - a.quoteVolume || a.symbol.localeCompare(b.symbol));
  return ranked.slice(0, options.size);
}

export function sanitizeUniverseConfig(input: Partial<UniverseConfig> | null | undefined): UniverseConfig {
  const source = input && typeof input === 'object' ? input : {};
  const allowed = new Set<string>(UNIVERSE_TIMEFRAMES);
  const timeframes = Array.from(new Set(
    (Array.isArray(source.timeframes) ? source.timeframes : [])
      .map((value) => String(value || '').trim())
      .filter((value) => allowed.has(value))
  ));
  const size = Math.round(Number(source.size));
  const minQuoteVolume = Number(source.minQuoteVolume);
  return {
    enabled: source.enabled === undefined ? DEFAULT_UNIVERSE_CONFIG.enabled : Boolean(source.enabled),
    size: Number.isFinite(size)
      ? Math.min(UNIVERSE_SIZE_LIMITS.max, Math.max(UNIVERSE_SIZE_LIMITS.min, size))
      : DEFAULT_UNIVERSE_CONFIG.size,
    timeframes: timeframes.length ? timeframes.sort() : [...DEFAULT_UNIVERSE_CONFIG.timeframes],
    minQuoteVolume: Number.isFinite(minQuoteVolume) && minQuoteVolume >= 0
      ? minQuoteVolume
      : DEFAULT_UNIVERSE_CONFIG.minQuoteVolume,
  };
}
