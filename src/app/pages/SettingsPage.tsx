import React from "react";

import type { AutoTradingConfig, ConfigStatus } from "../api";
import { SectionTitle } from "../components/common";
import {
  cardClassName,
  DEFAULT_STRATEGIES,
  mergeConfig,
  type CredentialsForm,
} from "../utils";
import { DEFAULT_AUTO_TRADING_RISK_CONFIG, type AutoTradingRiskConfig } from "../../lib/tradingRuntime";

export function SettingsPage({
  credentialsForm,
  setCredentialsForm,
  autoConfig,
  setAutoConfig,
  configStatus,
  settingsSaving,
  handleSaveSettings,
}: {
  credentialsForm: CredentialsForm;
  setCredentialsForm: React.Dispatch<React.SetStateAction<CredentialsForm>>;
  autoConfig: AutoTradingConfig | null;
  setAutoConfig: React.Dispatch<React.SetStateAction<AutoTradingConfig | null>>;
  configStatus: ConfigStatus | null;
  settingsSaving: boolean;
  handleSaveSettings: () => Promise<void>;
}) {
  return (
    <div className="space-y-6">
      <SectionTitle title="Settings" subtitle="Credentials and auto-trading parameters." />
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <section className={cardClassName()}>
          <SectionTitle title="Credentials" subtitle="Existing keys are never shown; a field is only overwritten when you enter a new value." />
          <div className="grid gap-4 md:grid-cols-2">
            {(
              [
                ["okxKey", "OKX live API key"],
                ["okxSecret", "OKX live secret"],
                ["okxPass", "OKX live passphrase"],
                ["okxDemoKey", "OKX demo API key"],
                ["okxDemoSecret", "OKX demo secret"],
                ["okxDemoPass", "OKX demo passphrase"],
                ["aiUrl", "AI Proxy URL"],
                ["aiKey", "AI Proxy Key"],
                ["aiModel", "AI decision model"],
                ["aiSummaryModel", "AI summary model"],
                ["aiVisionModel", "AI vision model"],
              ] as Array<[keyof CredentialsForm, string]>
            ).map(([key, label]) => (
              <label key={key} className="text-sm text-zinc-400">
                {label}
                <input
                  type={
                    key.toLowerCase().includes("secret") ||
                    key.toLowerCase().includes("pass") ||
                    key.toLowerCase().includes("key")
                      ? "password"
                      : "text"
                  }
                  value={credentialsForm[key]}
                  onChange={(event) =>
                    setCredentialsForm((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                />
              </label>
            ))}
          </div>
        </section>

        <section className={cardClassName()}>
          <SectionTitle title="Auto-trading parameters" />
          <div className="space-y-4">
            <label className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
              <span className="text-sm text-zinc-300">Use demo account</span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-500"
                checked={Boolean(autoConfig?.sandbox)}
                onChange={(event) =>
                  setAutoConfig((current) => mergeConfig(current, { sandbox: event.target.checked }))
                }
              />
            </label>
            <label className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
              <span className="text-sm text-zinc-300">Shadow mode</span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-500"
                checked={Boolean(autoConfig?.shadowMode)}
                onChange={(event) =>
                  setAutoConfig((current) => mergeConfig(current, { shadowMode: event.target.checked }))
                }
              />
            </label>
            {(
              [
                ["autoTradeThreshold", "Confidence threshold", 1],
                ["leverage", "Leverage", 1],
                ["stopLoss", "Stop loss %", 0.1],
                ["takeProfit", "Take profit %", 0.1],
                ["dailyLossLimit", "Daily loss limit %", 0.1],
                ["maxConsecutiveLosses", "Max consecutive losses", 1],
              ] as Array<[keyof AutoTradingRiskConfig, string, number]>
            ).map(([key, label, step]) => (
              <label key={key} className="block text-sm text-zinc-400">
                {label}
                <input
                  type="number"
                  step={step}
                  value={Number(autoConfig?.riskConfigSnapshot[key] ?? DEFAULT_AUTO_TRADING_RISK_CONFIG[key])}
                  onChange={(event) =>
                    setAutoConfig((current) =>
                      mergeConfig(current, {
                        riskConfigSnapshot: {
                          [key]: Number(event.target.value),
                        } as Partial<AutoTradingRiskConfig>,
                      })
                    )
                  }
                  className="mt-2 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                />
              </label>
            ))}

            <div>
              <div className="mb-2 text-sm text-zinc-400">Enabled strategies</div>
              <div className="space-y-2">
                {DEFAULT_STRATEGIES.map((strategy) => {
                  const active = autoConfig?.strategyIds.includes(strategy) ?? false;
                  return (
                    <label key={strategy} className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-indigo-500"
                        checked={active}
                        onChange={(event) => {
                          setAutoConfig((current) => {
                            const base = mergeConfig(current, {});
                            const strategyIds = event.target.checked
                              ? Array.from(new Set([...base.strategyIds, strategy]))
                              : base.strategyIds.filter((value) => value !== strategy);
                            return { ...base, strategyIds: strategyIds.length ? strategyIds : [strategy] };
                          });
                        }}
                      />
                      <span className="text-sm text-zinc-200">{strategy}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              disabled={settingsSaving}
              onClick={() => void handleSaveSettings()}
              className="rounded-2xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-indigo-900"
            >
              {settingsSaving ? "Saving..." : "Save settings"}
            </button>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">
              <div className="mb-2 font-medium text-zinc-200">Credential status</div>
              <div className="grid gap-2">
                <div>OKX live: {configStatus?.okxLive ? "Configured" : "Not configured"}</div>
                <div>OKX demo: {configStatus?.okxDemo ? "Configured" : "Not configured"}</div>
                <div>AI proxy: {configStatus?.ai || configStatus?.zhipu ? "Configured" : "Not configured"}</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
