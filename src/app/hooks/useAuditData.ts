import React from "react";

import { apiFetch, type AuditSummary, type ResearchWeekly, type TradeRow } from "../api";
import { usePollingTask } from "./usePollingTask";

export function useAuditData({
  token,
  enabled,
  page,
  auditDrilldownOpen,
}: {
  token: string;
  enabled: boolean;
  page: string;
  auditDrilldownOpen: boolean;
}) {
  const [auditSummary, setAuditSummary] = React.useState<AuditSummary | null>(null);
  const [researchWeekly, setResearchWeekly] = React.useState<ResearchWeekly | null>(null);
  const [auditTrades, setAuditTrades] = React.useState<TradeRow[]>([]);
  const [auditTradesLoading, setAuditTradesLoading] = React.useState(false);
  const [auditTradesError, setAuditTradesError] = React.useState("");

  const refreshAudit = React.useCallback(async () => {
    const [summaryPayload, weeklyPayload] = await Promise.all([
      apiFetch<AuditSummary>("/api/audit/summary", { token }),
      apiFetch<ResearchWeekly>("/api/research/weekly", { token }),
    ]);
    setAuditSummary(summaryPayload);
    setResearchWeekly(weeklyPayload);
  }, [token]);

  usePollingTask(
    React.useCallback(async () => {
      await refreshAudit();
    }, [refreshAudit]),
    enabled && page === "audit",
    [page],
    20_000,
    60_000
  );

  React.useEffect(() => {
    if (!auditDrilldownOpen || auditTrades.length > 0 || auditTradesLoading || !token) return;
    let cancelled = false;
    setAuditTradesLoading(true);
    setAuditTradesError("");
    apiFetch<TradeRow[]>("/api/trades?limit=500", { token })
      .then((rows) => {
        if (!cancelled) setAuditTrades(rows);
      })
      .catch((error) => {
        if (!cancelled) setAuditTradesError(error instanceof Error ? error.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setAuditTradesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [auditDrilldownOpen, auditTrades.length, auditTradesLoading, token]);

  return {
    auditSummary,
    researchWeekly,
    auditTrades,
    auditTradesLoading,
    auditTradesError,
    refreshAudit,
  };
}
