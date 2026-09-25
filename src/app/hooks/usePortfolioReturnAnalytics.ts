import React from "react";

import {
  apiFetch,
  type PortfolioReturnAnalytics,
  type PortfolioReturnMode,
  type PortfolioReturnRange,
} from "../api";
import {
  createPortfolioReturnRequestKey,
  isCurrentPortfolioReturnRequest,
  portfolioReturnErrorMessage,
} from "../../lib/portfolioReturnStability";
import { usePollingTask } from "./usePollingTask";

export type PortfolioReturnAnalyticsRuntime = {
  returnMode: PortfolioReturnMode;
  setReturnMode: React.Dispatch<React.SetStateAction<PortfolioReturnMode>>;
  returnRange: PortfolioReturnRange;
  setReturnRange: React.Dispatch<React.SetStateAction<PortfolioReturnRange>>;
  returnAnalytics: PortfolioReturnAnalytics | null;
  returnAnalyticsLoadingInitial: boolean;
  returnAnalyticsRefreshing: boolean;
  returnAnalyticsError: string;
  returnAnalyticsStaleWarning: string;
  returnAnalyticsRequestKey: string;
  refreshReturnAnalytics: (signal?: AbortSignal) => Promise<void>;
};

type PortfolioReturnAnalyticsState = {
  analytics: PortfolioReturnAnalytics | null;
  loadingInitial: boolean;
  refreshing: boolean;
  error: string;
  staleWarning: string;
  requestKey: string;
};

function staleWarningFromAnalytics(payload: PortfolioReturnAnalytics) {
  if (payload.sourceStatus?.state !== "stale") return "";
  return payload.sourceStatus.message || "Showing the last successful snapshot.";
}

export function usePortfolioReturnAnalytics({
  token,
  enabled,
  limit = 200,
}: {
  token: string;
  enabled: boolean;
  limit?: number;
}): PortfolioReturnAnalyticsRuntime {
  const [returnMode, setReturnMode] = React.useState<PortfolioReturnMode>("live");
  const [returnRange, setReturnRange] = React.useState<PortfolioReturnRange>("30d");
  const requestSequenceRef = React.useRef(0);
  const successfulByKeyRef = React.useRef(new Map<string, PortfolioReturnAnalytics>());
  const currentRequestKey = createPortfolioReturnRequestKey(returnMode, returnRange, limit);
  const [state, setState] = React.useState<PortfolioReturnAnalyticsState>({
    analytics: null,
    loadingInitial: false,
    refreshing: false,
    error: "",
    staleWarning: "",
    requestKey: currentRequestKey,
  });

  const refreshReturnAnalytics = React.useCallback(async (signal?: AbortSignal) => {
    if (!token) return;

    const requestKey = createPortfolioReturnRequestKey(returnMode, returnRange, limit);
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    const cachedForKey = successfulByKeyRef.current.get(requestKey) || null;

    setState((previous) => {
      const sameKey = previous.requestKey === requestKey;
      const currentAnalytics = sameKey ? previous.analytics : cachedForKey;
      return {
        analytics: currentAnalytics,
        loadingInitial: !currentAnalytics,
        refreshing: Boolean(currentAnalytics),
        error: "",
        staleWarning: currentAnalytics ? staleWarningFromAnalytics(currentAnalytics) : "",
        requestKey,
      };
    });

    try {
      const query = new URLSearchParams({
        mode: returnMode,
        range: returnRange,
        limit: String(limit),
      });
      const payload = await apiFetch<PortfolioReturnAnalytics>(`/api/portfolio/returns?${query}`, {
        token,
        signal,
      });
      const payloadKey = payload.requestKey || requestKey;
      if (!isCurrentPortfolioReturnRequest(sequence, requestSequenceRef.current, requestKey, payloadKey)) return;

      successfulByKeyRef.current.set(requestKey, { ...payload, requestKey });
      setState({
        analytics: { ...payload, requestKey },
        loadingInitial: false,
        refreshing: false,
        error: "",
        staleWarning: staleWarningFromAnalytics(payload),
        requestKey,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (!isCurrentPortfolioReturnRequest(sequence, requestSequenceRef.current, requestKey)) return;

      const message = portfolioReturnErrorMessage(error);
      const fallback = successfulByKeyRef.current.get(requestKey) || null;
      setState({
        analytics: fallback,
        loadingInitial: false,
        refreshing: false,
        error: fallback ? "" : message,
        staleWarning: fallback ? `Showing the last successful snapshot: ${message}` : "",
        requestKey,
      });
    }
  }, [limit, returnMode, returnRange, token]);

  usePollingTask(
    React.useCallback(async (signal) => {
      await refreshReturnAnalytics(signal);
    }, [refreshReturnAnalytics]),
    enabled,
    [returnMode, returnRange, token],
    20_000,
    60_000
  );

  const showingRequestedKey = state.requestKey === currentRequestKey;

  return {
    returnMode,
    setReturnMode,
    returnRange,
    setReturnRange,
    returnAnalytics: showingRequestedKey ? state.analytics : null,
    returnAnalyticsLoadingInitial: !showingRequestedKey || state.loadingInitial,
    returnAnalyticsRefreshing: showingRequestedKey && state.refreshing,
    returnAnalyticsError: showingRequestedKey ? state.error : "",
    returnAnalyticsStaleWarning: showingRequestedKey ? state.staleWarning : "",
    returnAnalyticsRequestKey: currentRequestKey,
    refreshReturnAnalytics,
  };
}
