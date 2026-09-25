/**
 * Real-time technical indicator calculations
 */

export const calculateRSI = (prices: number[], periods: number = 14): number => {
  if (!prices || prices.length < periods + 1) return 50;
  const numericPrices = prices.map(p => Number(p)).filter(p => !isNaN(p));
  if (numericPrices.length < periods + 1) return 50;

  let gains = 0;
  let losses = 0;
  for (let i = 0; i < periods; i++) {
    const diff = numericPrices[i + 1] - numericPrices[i];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / periods;
  let avgLoss = losses / periods;
  for (let i = periods; i < numericPrices.length - 1; i++) {
    const diff = numericPrices[i + 1] - numericPrices[i];
    if (diff >= 0) {
      avgGain = (avgGain * (periods - 1) + diff) / periods;
      avgLoss = (avgLoss * (periods - 1)) / periods;
    } else {
      avgGain = (avgGain * (periods - 1)) / periods;
      avgLoss = (avgLoss * (periods - 1) - diff) / periods;
    }
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

export const calculateSMA = (prices: number[], periods: number): number => {
  if (!prices || prices.length < periods) return prices?.[prices.length - 1] || 0;
  const numericPrices = prices.map(p => Number(p)).filter(p => !isNaN(p));
  if (numericPrices.length < periods) return numericPrices[numericPrices.length - 1] || 0;
  
  const sum = numericPrices.slice(-periods).reduce((a, b) => a + b, 0);
  return sum / periods;
};

export const calculateStandardDeviation = (prices: number[], periods: number): number => {
  if (!prices || prices.length < periods) return 0;
  const numericPrices = prices.map(p => Number(p)).filter(p => !isNaN(p));
  if (numericPrices.length < periods) return 0;

  const slice = numericPrices.slice(-periods);
  const mean = slice.reduce((a, b) => a + b, 0) / periods;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / periods;
  return Math.sqrt(variance);
};

export const calculateBollingerBands = (prices: number[], periods: number = 20, stdDevMult: number = 2) => {
  const sma = calculateSMA(prices, periods);
  const stdDev = calculateStandardDeviation(prices, periods);
  return {
    middle: sma,
    upper: sma + (stdDev * stdDevMult),
    lower: sma - (stdDev * stdDevMult)
  };
};

export const calculateMACD = (prices: number[], fast: number = 12, slow: number = 26, signal: number = 9) => {
  if (!prices || prices.length < slow + signal) return { macd: 0, signal: 0, histogram: 0 };
  const numericPrices = prices.map(p => Number(p)).filter(p => !isNaN(p));
  if (numericPrices.length < slow + signal) return { macd: 0, signal: 0, histogram: 0 };
  
  const emaSeries = (data: number[], p: number) => {
    if (data.length === 0) return [];
    const k = 2 / (p + 1);
    let emaVal = data[0];
    const values = [emaVal];
    for (let i = 1; i < data.length; i += 1) {
      emaVal = data[i] * k + emaVal * (1 - k);
      values.push(emaVal);
    }
    return values;
  };

  const fastEma = emaSeries(numericPrices, fast);
  const slowEma = emaSeries(numericPrices, slow);
  const macdSeries = numericPrices.map((_, index) => fastEma[index] - slowEma[index]);
  const signalInput = macdSeries.slice(slow - 1);
  const signalSeries = emaSeries(signalInput, signal);
  const macd = macdSeries[macdSeries.length - 1];
  const signalLine = signalSeries[signalSeries.length - 1] || 0;
  
  return {
    macd,
    signal: signalLine,
    histogram: macd - signalLine
  };
};
