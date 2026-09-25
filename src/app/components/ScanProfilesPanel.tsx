import React from "react";
import clsx from "clsx";

import type { AutoTradingConfig } from "../api";
import {
  draftToProfiles,
  profilesToDraft,
  type ScanProfileDraft,
} from "../utils";
import { AUTO_TRADING_ALLOWED_TIMEFRAMES } from "../../lib/tradingRuntime";
import {
  DEFAULT_UNIVERSE_CONFIG,
  UNIVERSE_SIZE_LIMITS,
  UNIVERSE_TIMEFRAMES,
  sanitizeUniverseConfig,
  type UniverseConfig,
} from "../../lib/universe";
import { cardClassName } from "../utils";
import { SectionTitle } from "./common";

export function ScanProfilesPanel({
  config,
  saving,
  onSave,
}: {
  config: AutoTradingConfig | null;
  saving: boolean;
  onSave: (profiles: AutoTradingConfig["scanProfiles"], universe: UniverseConfig) => Promise<void>;
}) {
  const [draft, setDraft] = React.useState<ScanProfileDraft[]>(() => profilesToDraft(config));
  const [universe, setUniverse] = React.useState<UniverseConfig>(() => sanitizeUniverseConfig(config?.universe ?? DEFAULT_UNIVERSE_CONFIG));

  React.useEffect(() => {
    setDraft(profilesToDraft(config));
    setUniverse(sanitizeUniverseConfig(config?.universe ?? DEFAULT_UNIVERSE_CONFIG));
  }, [config]);

  const profileTargets = draft.reduce((acc, row) => acc + (row.enabled ? row.timeframes.length : 0), 0);
  const universeTargets = universe.enabled ? universe.size * universe.timeframes.length : 0;
  const enabledTargets = profileTargets + universeTargets;

  return (
    <section className={cardClassName()}>
      <SectionTitle
        title="Auto-trading scan profiles"
        subtitle="Manual pairs below, plus the most liquid pairs on the market data exchange. Saved immediately and applied from the next auto-trading cycle."
        action={
          <div className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-200">
            Scan targets {universe.enabled ? "up to " : ""}{enabledTargets}
          </div>
        }
      />

      <div className="space-y-3">
        {draft.map((row, rowIndex) => (
          <div
            key={row.symbol}
            className="grid gap-4 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 md:grid-cols-[220px_1fr]"
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(event) => {
                  setDraft((current) =>
                    current.map((item, index) =>
                      index === rowIndex
                        ? {
                            ...item,
                            enabled: event.target.checked,
                            timeframes:
                              event.target.checked && item.timeframes.length === 0 ? ["1h"] : item.timeframes,
                          }
                        : item
                    )
                  );
                }}
                className="h-4 w-4 accent-indigo-500"
              />
              <div>
                <div className="font-medium text-zinc-50">{row.symbol}</div>
                <div className="text-xs text-zinc-500">{row.enabled ? "Enabled" : "Disabled"}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {AUTO_TRADING_ALLOWED_TIMEFRAMES.map((timeframe) => {
                const active = row.timeframes.includes(timeframe);
                return (
                  <label
                    key={timeframe}
                    className={clsx(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition",
                      row.enabled
                        ? "border-zinc-700 bg-zinc-900 text-zinc-200"
                        : "border-zinc-800 bg-zinc-950 text-zinc-600"
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-indigo-500"
                      disabled={!row.enabled}
                      checked={active}
                      onChange={(event) => {
                        setDraft((current) =>
                          current.map((item, index) => {
                            if (index !== rowIndex) return item;
                            let timeframes = item.timeframes;
                            if (event.target.checked) {
                              timeframes = Array.from(new Set([...item.timeframes, timeframe])).sort();
                            } else {
                              timeframes = item.timeframes.filter((value) => value !== timeframe);
                              if (timeframes.length === 0) return item;
                            }
                            return { ...item, timeframes };
                          })
                        );
                      }}
                    />
                    <span>{timeframe}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={universe.enabled}
            onChange={(event) => setUniverse((current) => ({ ...current, enabled: event.target.checked }))}
            className="h-4 w-4 accent-indigo-500"
          />
          <div>
            <div className="font-medium text-zinc-50">Scan the most liquid pairs</div>
            <div className="text-xs text-zinc-500">
              USDT pairs ranked by 24h volume, excluding stablecoins, fiat, wrapped and leveraged tokens. Refreshed hourly.
              In live mode only pairs OKX can trade are included.
            </div>
          </div>
        </label>

        <div className={clsx("mt-4 grid gap-4 md:grid-cols-3", !universe.enabled && "opacity-50")}>
          <label className="text-sm text-zinc-400">
            Pairs
            <input
              type="number"
              min={UNIVERSE_SIZE_LIMITS.min}
              max={UNIVERSE_SIZE_LIMITS.max}
              disabled={!universe.enabled}
              value={universe.size}
              onChange={(event) => setUniverse((current) => ({ ...current, size: Number(event.target.value) }))}
              className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-indigo-500"
            />
          </label>
          <label className="text-sm text-zinc-400">
            Min 24h volume (million USDT)
            <input
              type="number"
              min={0}
              step={0.5}
              disabled={!universe.enabled}
              value={universe.minQuoteVolume / 1_000_000}
              onChange={(event) => setUniverse((current) => ({ ...current, minQuoteVolume: Number(event.target.value) * 1_000_000 }))}
              className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-indigo-500"
            />
          </label>
          <div className="text-sm text-zinc-400">
            Timeframes
            <div className="mt-2 flex flex-wrap gap-2">
              {UNIVERSE_TIMEFRAMES.map((timeframe) => {
                const active = universe.timeframes.includes(timeframe);
                return (
                  <label
                    key={timeframe}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-200"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-indigo-500"
                      disabled={!universe.enabled}
                      checked={active}
                      onChange={(event) =>
                        setUniverse((current) => {
                          const next = event.target.checked
                            ? Array.from(new Set([...current.timeframes, timeframe])).sort()
                            : current.timeframes.filter((value) => value !== timeframe);
                          return next.length ? { ...current, timeframes: next } : current;
                        })
                      }
                    />
                    <span>{timeframe}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <div className="text-sm text-zinc-500">
          Correlation rules: BTC/ETH share a group; every other pair is its own group.
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => onSave(draftToProfiles(draft), sanitizeUniverseConfig(universe))}
          className="rounded-2xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-indigo-900"
        >
          {saving ? "Saving..." : "Save scan profiles"}
        </button>
      </div>
    </section>
  );
}
