import express from "express";
import { cachedPublicMarket } from "../utils";
import { okxBar, okxPublicGet, toCcxtLikeSwapSymbol, toOkxSwapInstId } from "../exchange/okx";

export function registerMarketRoutes(app: express.Express) {
  app.get("/api/okx/ticker/:symbol", async (req, res) => {
    try {
      const symbolParam = req.params.symbol || "BTC-USDT";
      const instId = toOkxSwapInstId(symbolParam);
      const ticker = await cachedPublicMarket(`ticker:${instId}`, 3000, async () => {
        const [raw] = await okxPublicGet("/api/v5/market/ticker", { instId });
        const last = Number(raw?.last || 0);
        const open = Number(raw?.open24h || last);
        return {
          symbol: toCcxtLikeSwapSymbol(instId),
          timestamp: Number(raw?.ts || Date.now()),
          datetime: new Date(Number(raw?.ts || Date.now())).toISOString(),
          high: Number(raw?.high24h || last),
          low: Number(raw?.low24h || last),
          bid: Number(raw?.bidPx || 0),
          bidVolume: Number(raw?.bidSz || 0),
          ask: Number(raw?.askPx || 0),
          askVolume: Number(raw?.askSz || 0),
          open,
          close: last,
          last,
          change: last - open,
          percentage: open ? ((last - open) / open) * 100 : 0,
          baseVolume: Number(raw?.vol24h || 0),
          volume: Number(raw?.vol24h || 0),
          info: raw
        };
      });
      res.json(ticker);
    } catch (error: any) {
      console.error('[Ticker Error]', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/okx/orderbook/:symbol", async (req, res) => {
    try {
      const symbolParam = req.params.symbol || "BTC-USDT";
      const instId = toOkxSwapInstId(symbolParam);
      const orderbook = await cachedPublicMarket(`orderbook:${instId}`, 3000, async () => {
        const [raw] = await okxPublicGet("/api/v5/market/books", { instId, sz: 20 });
        return {
          symbol: toCcxtLikeSwapSymbol(instId),
          timestamp: Number(raw?.ts || Date.now()),
          datetime: new Date(Number(raw?.ts || Date.now())).toISOString(),
          bids: (raw?.bids || []).map((row: string[]) => [Number(row[0]), Number(row[1])]),
          asks: (raw?.asks || []).map((row: string[]) => [Number(row[0]), Number(row[1])]),
          info: raw
        };
      });
      res.json(orderbook);
    } catch (error: any) {
      console.error('[Orderbook Error]', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/okx/tickers", async (req, res) => {
    try {
      const coreInstIds = new Set(["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP", "DOGE-USDT-SWAP"]);
      const tickers = await cachedPublicMarket("tickers:core", 10000, async () => {
        const rows = await okxPublicGet("/api/v5/market/tickers", { instType: "SWAP" });
        return Object.fromEntries(rows
          .filter((raw: any) => coreInstIds.has(raw.instId))
          .map((raw: any) => {
            const last = Number(raw.last || 0);
            const open = Number(raw.open24h || last);
            return [toCcxtLikeSwapSymbol(raw.instId), {
              symbol: toCcxtLikeSwapSymbol(raw.instId),
              timestamp: Number(raw.ts || Date.now()),
              datetime: new Date(Number(raw.ts || Date.now())).toISOString(),
              high: Number(raw.high24h || last),
              low: Number(raw.low24h || last),
              bid: Number(raw.bidPx || 0),
              ask: Number(raw.askPx || 0),
              open,
              close: last,
              last,
              percentage: open ? ((last - open) / open) * 100 : 0,
              baseVolume: Number(raw.vol24h || 0),
              info: raw
            }];
          }));
      });
      res.json(tickers);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/okx/ohlcv/:symbol", async (req, res) => {
    try {
      const symbolParam = req.params.symbol || "BTC-USDT";
      const instId = toOkxSwapInstId(symbolParam);
      const timeframe = (req.query.t as string) || "1h";
      const limit = Math.min(300, Math.max(24, Number(req.query.limit || 120)));
      const ohlcv = await cachedPublicMarket(`ohlcv:${instId}:${timeframe}:${limit}`, 60000, async () => {
        const rows = await okxPublicGet("/api/v5/market/candles", { instId, bar: okxBar(timeframe), limit });
        return rows
          .map((row: string[]) => [Number(row[0]), Number(row[1]), Number(row[2]), Number(row[3]), Number(row[4]), Number(row[5])])
          .sort((a: number[], b: number[]) => a[0] - b[0]);
      });
      res.json(ohlcv);
    } catch (error: any) {
      console.error('[OHLCV Error]', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/okx/funding/:symbol", async (req, res) => {
    try {
      const symbolParam = req.params.symbol || "BTC-USDT";
      const instId = toOkxSwapInstId(symbolParam);
      const funding = await cachedPublicMarket(`funding:${instId}`, 60000, async () => {
        const [raw] = await okxPublicGet("/api/v5/public/funding-rate", { instId });
        return {
          symbol: toCcxtLikeSwapSymbol(instId),
          fundingRate: Number(raw?.fundingRate || 0),
          nextFundingRate: Number(raw?.nextFundingRate || 0),
          fundingTimestamp: Number(raw?.fundingTime || 0),
          nextFundingTime: Number(raw?.nextFundingTime || 0),
          timestamp: Date.now(),
          info: raw
        };
      });
      res.json(funding);
    } catch (error: any) {
      const finalErrMsg = error?.message || "Funding rate fetch failed";
      console.error('[Funding Error]', finalErrMsg);
      res.status(500).json({ error: finalErrMsg });
    }
  });
}
