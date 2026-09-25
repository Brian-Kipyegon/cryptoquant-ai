import type { UniverseConfig } from "../../lib/universe";
import React from "react";

import {
  apiFetch,
  postJson,
  putJson,
  type AutoTradingConfig,
  type AutoTradingCycleSummary,
  type AutoTradingStatus,
  type AutoTradingTrace,
  type ShadowOrder,
  type ShadowSummary,
} from "../api";
import { usePollingTask } from "./usePollingTask";

export function useAutoTradingRuntime({
  token,
  enabled,
  page,
  onToast,
}: {
  token: string;
  enabled: boolean;
  page: string;
  onToast: (toast: { kind: "success" | "error" | "info"; message: string }) => void;
}) {
  const [autoConfig, setAutoConfig] = React.useState<AutoTradingConfig | null>(null);
  const [autoStatus, setAutoStatus] = React.useState<AutoTradingStatus | null>(null);
  const [autoLogs, setAutoLogs] = React.useState<string[]>([]);
  const [diagnosticsTraces, setDiagnosticsTraces] = React.useState<AutoTradingTrace[]>([]);
  const [diagnosticsCycles, setDiagnosticsCycles] = React.useState<AutoTradingCycleSummary[]>([]);
  const [shadowSummary, setShadowSummary] = React.useState<ShadowSummary | null>(null);
  const [shadowOpenOrders, setShadowOpenOrders] = React.useState<ShadowOrder[]>([]);
  const [shadowClosedOrders, setShadowClosedOrders] = React.useState<ShadowOrder[]>([]);
  const [scanProfilesSaving, setScanProfilesSaving] = React.useState(false);
  const [autoActionPending, setAutoActionPending] = React.useState<null | "start" | "stop" | "run">(null);

  const refreshStatus = React.useCallback(
    async (signal?: AbortSignal) => {
      const [statusPayload, logs, configPayload] = await Promise.all([
        apiFetch<AutoTradingStatus>("/api/auto-trading/status", { token, signal }),
        apiFetch<string[]>("/api/auto-trading/logs?limit=20", { token, signal }),
        apiFetch<{ config: AutoTradingConfig | null; status: AutoTradingStatus }>("/api/auto-trading/config", {
          token,
          signal,
        }),
      ]);
      setAutoStatus(statusPayload);
      setAutoLogs(logs);
      setAutoConfig(configPayload.config);
    },
    [token]
  );

  const refreshDiagnostics = React.useCallback(
    async (signal?: AbortSignal) => {
      const [cyclesPayload, tracesPayload, summaryPayload, openPayload, closedPayload] = await Promise.all([
        apiFetch<AutoTradingCycleSummary[]>("/api/auto-trading/cycles?limit=50", { token, signal }),
        apiFetch<AutoTradingTrace[]>("/api/auto-trading/traces?limit=200", { token, signal }),
        apiFetch<ShadowSummary>("/api/shadow/summary", { token, signal }),
        apiFetch<ShadowOrder[]>("/api/shadow/orders?status=open&limit=100", { token, signal }),
        apiFetch<ShadowOrder[]>("/api/shadow/orders?status=closed&limit=100", { token, signal }),
      ]);
      setDiagnosticsCycles(cyclesPayload);
      setDiagnosticsTraces(tracesPayload);
      setShadowSummary(summaryPayload);
      setShadowOpenOrders(openPayload);
      setShadowClosedOrders(closedPayload);
    },
    [token]
  );

  const saveAutoConfig = React.useCallback(
    async (nextConfig: AutoTradingConfig) => {
      const payload = await putJson<{ config: AutoTradingConfig; status: AutoTradingStatus }>(
        "/api/auto-trading/config",
        nextConfig,
        { token }
      );
      setAutoConfig(payload.config);
      setAutoStatus(payload.status);
      await refreshStatus();
      return payload;
    },
    [refreshStatus, token]
  );

  const handleSaveScanProfiles = React.useCallback(
    async (profiles: AutoTradingConfig["scanProfiles"], universe?: UniverseConfig) => {
      if (!autoConfig) return;
      setScanProfilesSaving(true);
      try {
        await saveAutoConfig({ ...autoConfig, scanProfiles: profiles, ...(universe ? { universe } : {}) });
        onToast({ kind: "success", message: "Scan profiles saved; they apply from the next scan." });
      } catch (error: any) {
        onToast({ kind: "error", message: error?.message || "Failed to save scan profiles" });
      } finally {
        setScanProfilesSaving(false);
      }
    },
    [autoConfig, onToast, saveAutoConfig]
  );

  const handleAutoAction = React.useCallback(
    async (action: "start" | "stop" | "run") => {
      setAutoActionPending(action);
      try {
        if (action === "start") {
          const payload = await postJson<AutoTradingStatus>("/api/auto-trading/start", {}, { token });
          setAutoStatus(payload);
        } else if (action === "stop") {
          const payload = await postJson<AutoTradingStatus>("/api/auto-trading/stop", {}, { token });
          setAutoStatus(payload);
        } else {
          const payload = await postJson<{ summary?: AutoTradingCycleSummary; status: AutoTradingStatus }>(
            "/api/auto-trading/run-once",
            {},
            { token }
          );
          setAutoStatus(payload.status);
        }
        await Promise.all([refreshStatus(), refreshDiagnostics()]);
        onToast({
          kind: "success",
          message: action === "run" ? "Manual scan triggered" : `Auto-trading ${action === "start" ? "started" : "stopped"}`,
        });
      } catch (error: any) {
        onToast({ kind: "error", message: error?.message || "Action failed" });
      } finally {
        setAutoActionPending(null);
      }
    },
    [onToast, refreshDiagnostics, refreshStatus, token]
  );

  usePollingTask(
    React.useCallback(async (signal) => {
      const [status, logs] = await Promise.all([
        apiFetch<AutoTradingStatus>("/api/auto-trading/status", { token, signal }),
        apiFetch<string[]>("/api/auto-trading/logs?limit=20", { token, signal }),
      ]);
      setAutoStatus(status);
      setAutoLogs(logs);
    }, [token]),
    enabled,
    [token],
    15_000,
    60_000
  );

  usePollingTask(
    React.useCallback(async (signal) => {
      await refreshDiagnostics(signal);
    }, [refreshDiagnostics]),
    enabled && page === "diagnostics",
    [page, token],
    15_000,
    60_000
  );

  return {
    autoConfig,
    setAutoConfig,
    autoStatus,
    autoLogs,
    diagnosticsTraces,
    diagnosticsCycles,
    shadowSummary,
    shadowOpenOrders,
    shadowClosedOrders,
    scanProfilesSaving,
    autoActionPending,
    refreshStatus,
    refreshDiagnostics,
    saveAutoConfig,
    handleSaveScanProfiles,
    handleAutoAction,
  };
}
