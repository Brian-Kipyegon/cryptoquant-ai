import React from "react";
import clsx from "clsx";
import { RefreshCw } from "lucide-react";

import type { AutoTradingConfig, AutoTradingStatus, SessionUser } from "../api";
import { AUTO_TRADING_ALLOWED_SYMBOLS, type Ticker } from "../../lib/tradingRuntime";
import { formatPct, formatPrice } from "../utils";

export function HeaderBar({
  selectedSymbol,
  onSelectSymbol,
  selectedTicker,
  autoConfig,
  autoStatus,
  sessionUser,
  onRefresh,
  onLogout,
}: {
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  selectedTicker: Ticker | null;
  autoConfig: AutoTradingConfig | null;
  autoStatus: AutoTradingStatus | null;
  sessionUser: SessionUser;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 px-6 py-4 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedSymbol}
            onChange={(event) => onSelectSymbol(event.target.value)}
            className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          >
            {AUTO_TRADING_ALLOWED_SYMBOLS.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-2">
            <div className="text-xs text-zinc-500">Price</div>
            <div className="text-lg font-semibold text-zinc-50">
              {formatPrice(selectedTicker?.last || 0, 2)}
            </div>
          </div>
          <div
            className={clsx(
              "rounded-2xl border px-4 py-2",
              Number(selectedTicker?.percentage || 0) >= 0
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/20 bg-rose-500/10 text-rose-300"
            )}
          >
            <div className="text-xs text-zinc-500">24H</div>
            <div className="text-lg font-semibold">{formatPct(selectedTicker?.percentage || 0)}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-2">
            <div className="text-xs text-zinc-500">Auto-trading</div>
            <div className="font-medium text-zinc-100">{autoStatus?.state || "stopped"}</div>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-2">
            <div className="text-xs text-zinc-500">Account mode</div>
            <div className="font-medium text-zinc-100">{autoConfig?.sandbox ? "OKX demo" : "OKX live"}</div>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-2">
            <div className="text-xs text-zinc-500">User</div>
            <div className="font-medium text-zinc-100">{sessionUser.username}</div>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-2xl border border-zinc-700 p-2 text-zinc-300 transition hover:border-indigo-500 hover:text-white"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-500 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
