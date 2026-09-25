import React from "react";

import { apiFetch, postJson, type AppPage, type AuthSessionResponse, type ConfigStatus, type SessionUser } from "./api";
import { AuditDrilldownDrawer } from "./components/AuditDrilldownDrawer";
import { LoginScreen } from "./components/LoginScreen";
import { PageLoading } from "./components/common";
import { useAuditData } from "./hooks/useAuditData";
import { useAutoTradingRuntime } from "./hooks/useAutoTradingRuntime";
import { useBacktest } from "./hooks/useBacktest";
import { useMarketData } from "./hooks/useMarketData";
import { usePortfolioData } from "./hooks/usePortfolioData";
import { useReliabilityData } from "./hooks/useReliabilityData";
import { useToast } from "./hooks/useToast";
import { HeaderBar } from "./layout/HeaderBar";
import { Sidebar } from "./layout/Sidebar";
import { ToastView } from "./layout/ToastView";
import { DashboardPage } from "./pages/DashboardPage";
import { HistoryPage } from "./pages/HistoryPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { SettingsPage } from "./pages/SettingsPage";
import {
  clearToken,
  formatDateOnly,
  mergeConfig,
  persistToken,
  persistUiPref,
  readStoredToken,
  readUiPref,
  UI_PAGE_KEY,
  UI_SYMBOL_KEY,
  UI_TIMEFRAME_KEY,
  type AuditDrilldownState,
  type CredentialsForm,
} from "./utils";
import { DEFAULT_AUTO_TRADING_RISK_CONFIG } from "../lib/tradingRuntime";

const MarketPage = React.lazy(() => import("./pages/MarketPage").then((module) => ({ default: module.MarketPage })));
const BacktestPage = React.lazy(() => import("./pages/BacktestPage").then((module) => ({ default: module.BacktestPage })));
const ReliabilityPage = React.lazy(() => import("./pages/ReliabilityPage").then((module) => ({ default: module.ReliabilityPage })));
const AuditPage = React.lazy(() => import("./pages/AuditPage").then((module) => ({ default: module.AuditPage })));
const DiagnosticsPage = React.lazy(() => import("./pages/DiagnosticsPage").then((module) => ({ default: module.DiagnosticsPage })));

export function ConsoleApp() {
  const [token, setTokenState] = React.useState(() => readStoredToken());
  const [sessionUser, setSessionUser] = React.useState<SessionUser | null>(null);
  const [authChecked, setAuthChecked] = React.useState(false);
  const [loginLoading, setLoginLoading] = React.useState(false);
  const [page, setPage] = React.useState<AppPage>(() => readUiPref(UI_PAGE_KEY, "dashboard"));
  const [selectedSymbol, setSelectedSymbol] = React.useState(() => readUiPref(UI_SYMBOL_KEY, "BTC/USDT"));
  const [chartTimeframe, setChartTimeframe] = React.useState<"15m" | "1h">(() => {
    const saved = readUiPref<"15m" | "1h">(UI_TIMEFRAME_KEY, "1h");
    return saved === "15m" ? "15m" : "1h";
  });
  const [configStatus, setConfigStatus] = React.useState<ConfigStatus | null>(null);
  const [credentialsForm, setCredentialsForm] = React.useState<CredentialsForm>({
    okxKey: "",
    okxSecret: "",
    okxPass: "",
    okxDemoKey: "",
    okxDemoSecret: "",
    okxDemoPass: "",
    aiUrl: "",
    aiKey: "",
    aiModel: "",
    aiSummaryModel: "",
    aiVisionModel: "",
  });
  const [auditDrilldown, setAuditDrilldown] = React.useState<AuditDrilldownState>({
    open: false,
    mode: "regime",
    selectedKey: null,
  });
  const [selectedTraceId, setSelectedTraceId] = React.useState<string | null>(null);
  const [diagnosticsDate, setDiagnosticsDate] = React.useState("");
  const [diagnosticsPage, setDiagnosticsPage] = React.useState(1);
  const [selectedShadowOrderId, setSelectedShadowOrderId] = React.useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = React.useState(false);

  const { toast, setToast } = useToast();
  const sessionEnabled = Boolean(sessionUser && token);

  const autoTrading = useAutoTradingRuntime({
    token,
    enabled: sessionEnabled,
    page,
    onToast: setToast,
  });
  const market = useMarketData({
    enabled: sessionEnabled,
    page,
    selectedSymbol,
    chartTimeframe,
  });
  const portfolio = usePortfolioData({
    token,
    enabled: sessionEnabled,
    page,
    selectedSymbol,
    sandbox: autoTrading.autoConfig?.sandbox ?? false,
  });
  const reliability = useReliabilityData({
    token,
    enabled: sessionEnabled,
    page,
  });
  const audit = useAuditData({
    token,
    enabled: sessionEnabled,
    page,
    auditDrilldownOpen: auditDrilldown.open,
  });
  const backtest = useBacktest({
    token,
    onToast: setToast,
  });

  React.useEffect(() => {
    persistUiPref(UI_PAGE_KEY, page);
  }, [page]);

  React.useEffect(() => {
    persistUiPref(UI_SYMBOL_KEY, selectedSymbol);
  }, [selectedSymbol]);

  React.useEffect(() => {
    persistUiPref(UI_TIMEFRAME_KEY, chartTimeframe);
  }, [chartTimeframe]);

  const refreshConfigStatus = React.useCallback(async () => {
    const status = await apiFetch<ConfigStatus>("/api/config/status", token ? { token } : {});
    setConfigStatus(status);
  }, [token]);

  React.useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      try {
        const status = await apiFetch<ConfigStatus>("/api/config/status", token ? { token } : {});
        if (cancelled) return;
        setConfigStatus(status);
        if (!token) {
          setSessionUser(null);
          setAuthChecked(true);
          return;
        }

        const session = await apiFetch<AuthSessionResponse>("/api/auth/session", { token });
        if (cancelled) return;
        if (session.authenticated && session.user) {
          setSessionUser(session.user);
        } else {
          clearToken();
          setTokenState("");
          setSessionUser(null);
        }
      } catch {
        if (!cancelled) {
          clearToken();
          setTokenState("");
          setSessionUser(null);
        }
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    };

    void checkSession();
    return () => {
      cancelled = true;
    };
  }, [token]);

  React.useEffect(() => {
    if (!sessionEnabled) return;
    void Promise.all([
      refreshConfigStatus(),
      autoTrading.refreshStatus(),
      reliability.refreshReliability(),
      market.refreshSelectedMarket(),
      portfolio.refreshPortfolio(),
    ]).catch((error) => {
      console.error(error);
      setToast({ kind: "error", message: error instanceof Error ? error.message : "Initialization failed" });
    });
  }, [
    refreshConfigStatus,
    sessionEnabled,
    setToast,
    autoTrading.refreshStatus,
    reliability.refreshReliability,
    market.refreshSelectedMarket,
    portfolio.refreshPortfolio,
  ]);

  const selectedTicker = market.runtimeMarket.tickers[selectedSymbol] || market.runtimeMarket.ticker;

  const filteredTraces = React.useMemo(() => {
    return autoTrading.diagnosticsTraces.filter((trace) => {
      if (!diagnosticsDate) return true;
      return formatDateOnly(trace.createdAt) === diagnosticsDate;
    });
  }, [autoTrading.diagnosticsTraces, diagnosticsDate]);

  const tracePageCount = Math.max(1, Math.ceil(filteredTraces.length / 10));

  const visibleTraces = React.useMemo(() => {
    const pageIndex = Math.min(diagnosticsPage, tracePageCount) - 1;
    return filteredTraces.slice(pageIndex * 10, pageIndex * 10 + 10);
  }, [diagnosticsPage, filteredTraces, tracePageCount]);

  React.useEffect(() => {
    if (diagnosticsPage > tracePageCount) setDiagnosticsPage(tracePageCount);
  }, [diagnosticsPage, tracePageCount]);

  React.useEffect(() => {
    if (!visibleTraces.length) {
      setSelectedTraceId(null);
      return;
    }
    if (!visibleTraces.some((trace) => trace.id === selectedTraceId)) {
      setSelectedTraceId(visibleTraces[0].id);
    }
  }, [selectedTraceId, visibleTraces]);

  const selectedTrace = React.useMemo(
    () => autoTrading.diagnosticsTraces.find((trace) => trace.id === selectedTraceId) || null,
    [autoTrading.diagnosticsTraces, selectedTraceId]
  );

  const allShadowOrders = React.useMemo(
    () => [...autoTrading.shadowOpenOrders, ...autoTrading.shadowClosedOrders],
    [autoTrading.shadowClosedOrders, autoTrading.shadowOpenOrders]
  );

  React.useEffect(() => {
    if (!allShadowOrders.length) {
      setSelectedShadowOrderId(null);
      return;
    }
    if (!selectedShadowOrderId || !allShadowOrders.some((row) => row.id === selectedShadowOrderId)) {
      setSelectedShadowOrderId(allShadowOrders[0].id);
    }
  }, [allShadowOrders, selectedShadowOrderId]);

  const selectedShadowOrder = React.useMemo(
    () => allShadowOrders.find((row) => row.id === selectedShadowOrderId) || null,
    [allShadowOrders, selectedShadowOrderId]
  );

  const handleLogin = React.useCallback(
    async (username: string, password: string) => {
      setLoginLoading(true);
      try {
        const response = await postJson<{ token: string; user: SessionUser }>("/api/auth/login", {
          username,
          password,
        });
        persistToken(response.token);
        setTokenState(response.token);
        setSessionUser(response.user);
        setAuthChecked(true);
        setToast({ kind: "success", message: "Signed in" });
      } finally {
        setLoginLoading(false);
      }
    },
    [setToast]
  );

  const handleLogout = React.useCallback(async () => {
    try {
      if (token) {
        await postJson("/api/auth/logout", {}, { token });
      }
    } catch {
      // Ignore logout network errors.
    } finally {
      clearToken();
      setTokenState("");
      setSessionUser(null);
      setToast({ kind: "info", message: "Signed out" });
    }
  }, [token, setToast]);

  const handleSaveSettings = React.useCallback(async () => {
    const merged = mergeConfig(autoTrading.autoConfig, {
      sandbox: autoTrading.autoConfig?.sandbox ?? false,
      shadowMode: autoTrading.autoConfig?.shadowMode ?? DEFAULT_AUTO_TRADING_RISK_CONFIG.shadowMode,
    });
    setSettingsSaving(true);
    try {
      await Promise.all([
        postJson<{ ok: true }>("/api/config/credentials", credentialsForm, { token }),
        autoTrading.saveAutoConfig(merged),
      ]);
      await refreshConfigStatus();
      setToast({
        kind: "success",
        message:
          autoTrading.autoStatus?.state === "running"
            ? "Configuration saved; it applies from the next scan."
            : "Configuration saved.",
      });
    } catch (error: any) {
      setToast({ kind: "error", message: error?.message || "Failed to save configuration" });
    } finally {
      setSettingsSaving(false);
    }
  }, [
    autoTrading.autoConfig,
    autoTrading.autoStatus?.state,
    autoTrading.saveAutoConfig,
    credentialsForm,
    refreshConfigStatus,
    setToast,
    token,
  ]);

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Initializing console...
      </div>
    );
  }

  if (!sessionUser || !token) {
    return <LoginScreen onLogin={handleLogin} loading={loginLoading} />;
  }

  let content: React.ReactNode = null;
  switch (page) {
    case "dashboard":
      content = (
        <DashboardPage
          balance={portfolio.balance}
          positions={portfolio.positions}
          realizedPnl={portfolio.realizedPnl}
          autoStatus={autoTrading.autoStatus}
          autoConfig={autoTrading.autoConfig}
          autoLogs={autoTrading.autoLogs}
          autoActionPending={autoTrading.autoActionPending}
          handleAutoAction={autoTrading.handleAutoAction}
          selectedSymbol={selectedSymbol}
          chartTimeframe={chartTimeframe}
          setChartTimeframe={setChartTimeframe}
          chartData={market.chartData}
          scanProfilesSaving={autoTrading.scanProfilesSaving}
          handleSaveScanProfiles={autoTrading.handleSaveScanProfiles}
        />
      );
      break;
    case "market":
      content = (
        <React.Suspense fallback={<PageLoading title="Loading market analysis..." />}>
          <MarketPage
            selectedSymbol={selectedSymbol}
            chartTimeframe={chartTimeframe}
            setChartTimeframe={setChartTimeframe}
            runtimeMarket={market.runtimeMarket}
            chartData={market.chartData}
          />
        </React.Suspense>
      );
      break;
    case "portfolio":
      content = (
        <PortfolioPage
          balance={portfolio.balance}
          positions={portfolio.positions}
          realizedPnl={portfolio.realizedPnl}
          returnMode={portfolio.returnMode}
          setReturnMode={portfolio.setReturnMode}
          returnRange={portfolio.returnRange}
          setReturnRange={portfolio.setReturnRange}
          returnAnalytics={portfolio.returnAnalytics}
          returnAnalyticsLoadingInitial={portfolio.returnAnalyticsLoadingInitial}
          returnAnalyticsRefreshing={portfolio.returnAnalyticsRefreshing}
          returnAnalyticsError={portfolio.returnAnalyticsError}
          returnAnalyticsStaleWarning={portfolio.returnAnalyticsStaleWarning}
        />
      );
      break;
    case "history":
      content = <HistoryPage historyOrders={portfolio.historyOrders} localTrades={portfolio.localTrades} />;
      break;
    case "backtest":
      content = (
        <React.Suspense fallback={<PageLoading title="Loading strategy validation..." />}>
          <BacktestPage
            backtestForm={backtest.backtestForm}
            setBacktestForm={backtest.setBacktestForm}
            backtestResult={backtest.backtestResult}
            backtestLoading={backtest.backtestLoading}
            backtestError={backtest.backtestError}
            handleRunBacktest={backtest.handleRunBacktest}
          />
        </React.Suspense>
      );
      break;
    case "reliability":
      content = (
        <React.Suspense fallback={<PageLoading title="Loading execution reliability..." />}>
          <ReliabilityPage
            riskState={reliability.riskState}
            autoConfig={autoTrading.autoConfig}
            orderLifecycle={reliability.orderLifecycle}
            securityEvents={reliability.securityEvents}
          />
        </React.Suspense>
      );
      break;
    case "audit":
      content = (
        <React.Suspense fallback={<PageLoading title="Loading audit..." />}>
          <AuditPage
            auditSummary={audit.auditSummary}
            researchWeekly={audit.researchWeekly}
            onOpenDrilldown={(mode, selectedKey) => setAuditDrilldown({ open: true, mode, selectedKey })}
          />
        </React.Suspense>
      );
      break;
    case "diagnostics":
      content = (
        <React.Suspense fallback={<PageLoading title="Loading strategy diagnostics..." />}>
          <DiagnosticsPage
            diagnosticsCycles={autoTrading.diagnosticsCycles}
            diagnosticsDate={diagnosticsDate}
            setDiagnosticsDate={setDiagnosticsDate}
            diagnosticsPage={diagnosticsPage}
            setDiagnosticsPage={setDiagnosticsPage}
            tracePageCount={tracePageCount}
            filteredTraces={filteredTraces}
            visibleTraces={visibleTraces}
            selectedTraceId={selectedTraceId}
            setSelectedTraceId={setSelectedTraceId}
            selectedTrace={selectedTrace}
            shadowSummary={autoTrading.shadowSummary}
            shadowOpenOrders={autoTrading.shadowOpenOrders}
            shadowClosedOrders={autoTrading.shadowClosedOrders}
            selectedShadowOrderId={selectedShadowOrderId}
            setSelectedShadowOrderId={setSelectedShadowOrderId}
            selectedShadowOrder={selectedShadowOrder}
          />
        </React.Suspense>
      );
      break;
    case "settings":
      content = (
        <SettingsPage
          credentialsForm={credentialsForm}
          setCredentialsForm={setCredentialsForm}
          autoConfig={autoTrading.autoConfig}
          setAutoConfig={autoTrading.setAutoConfig}
          configStatus={configStatus}
          settingsSaving={settingsSaving}
          handleSaveSettings={handleSaveSettings}
        />
      );
      break;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="grid min-h-screen lg:grid-cols-[240px_1fr]">
        <Sidebar page={page} onSelectPage={setPage} />

        <main className="min-w-0">
          <HeaderBar
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
            selectedTicker={selectedTicker}
            autoConfig={autoTrading.autoConfig}
            autoStatus={autoTrading.autoStatus}
            sessionUser={sessionUser}
            onRefresh={() => void market.refreshSelectedMarket()}
            onLogout={() => void handleLogout()}
          />

          <div className="p-6">{content}</div>
        </main>
      </div>

      <AuditDrilldownDrawer
        open={auditDrilldown.open}
        mode={auditDrilldown.mode}
        selectedKey={auditDrilldown.selectedKey}
        onClose={() => setAuditDrilldown((current) => ({ ...current, open: false }))}
        onSelect={(value) => setAuditDrilldown((current) => ({ ...current, selectedKey: value }))}
        researchWeekly={audit.researchWeekly}
        auditTrades={audit.auditTrades}
        loading={audit.auditTradesLoading}
        error={audit.auditTradesError}
      />

      <ToastView toast={toast} />
    </div>
  );
}
