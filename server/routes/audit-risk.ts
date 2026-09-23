import express from "express";
import { STRATEGY_VERSION, addToAudit, auditStore } from "../stores/audit-store";
import { appStore, normalizeRiskStateDate, updatePersistentRiskState } from "../stores/app-store";
import { normalizeNumber } from "../utils";

export function registerAuditRiskRoutes(app: express.Express) {
  // Audit Endpoints
  app.get("/api/audit/summary", (req, res) => {
    res.json({
      version: STRATEGY_VERSION,
      counts: {
        aiSnapshots: auditStore.aiSnapshots.length,
        orderReceipts: auditStore.orderReceipts.length,
        riskEvents: auditStore.riskEvents.length,
        positionChanges: auditStore.positionChanges.length,
        orderLifecycle: appStore.orderLifecycle.length,
        securityEvents: appStore.securityEvents.length,
      }
    });
  });

  app.get("/api/audit/logs/:type", (req, res) => {
    const type = req.params.type as keyof typeof auditStore;
    if (auditStore[type]) {
      res.json(auditStore[type]);
    } else {
      res.status(404).json({ error: "Invalid audit type" });
    }
  });

  app.post("/api/audit/risk-event", (req, res) => {
    const body = req.body || {};
    addToAudit(auditStore.riskEvents, body);
    if (body.reason || body.event || body.dailyPnL !== undefined || body.macroGate) {
      updatePersistentRiskState({
        reason: body.reason,
        dailyPnL: normalizeNumber(body.dailyPnL) ?? appStore.riskState.dailyPnL,
        macroGate: body.macroGate?.state || body.macroGate || appStore.riskState.macroGate,
        macroScore: normalizeNumber(body.macroScore ?? body.macroGate?.score) ?? appStore.riskState.macroScore,
        killSwitchActive: body.killSwitchActive ?? appStore.riskState.killSwitchActive,
        cooldownUntil: normalizeNumber(body.cooldownUntil) ?? appStore.riskState.cooldownUntil,
      });
    }
    res.json({ status: "ok", riskState: appStore.riskState });
  });

  app.get("/api/security/events", (req, res) => {
    res.json(appStore.securityEvents.slice(0, 500));
  });

  app.get("/api/orders/lifecycle", (req, res) => {
    res.json(appStore.orderLifecycle.slice(0, 500));
  });

  app.get("/api/risk/state", (_req, res) => {
    normalizeRiskStateDate();
    res.json(updatePersistentRiskState({}));
  });

  app.post("/api/risk/state", (req, res) => {
    const body = req.body || {};
    const state = updatePersistentRiskState({
      dailyPnL: normalizeNumber(body.dailyPnL) ?? appStore.riskState.dailyPnL,
      // Consecutive stop-loss count is server-derived from realized PnL / fills.
      // Do not trust client-sent values here, otherwise stale tabs can poison account risk state.
      consecutiveStopLosses: appStore.riskState.consecutiveStopLosses,
      macroGate: body.macroGate?.state || body.macroGate || appStore.riskState.macroGate,
      macroScore: normalizeNumber(body.macroScore ?? body.macroGate?.score) ?? appStore.riskState.macroScore,
      newRiskBlocked: body.newRiskBlocked ?? appStore.riskState.newRiskBlocked,
      killSwitchActive: body.killSwitchActive ?? appStore.riskState.killSwitchActive,
      lastKillSwitchReason: body.lastKillSwitchReason || appStore.riskState.lastKillSwitchReason,
      cooldownUntil: normalizeNumber(body.cooldownUntil) ?? appStore.riskState.cooldownUntil,
      reason: body.reason,
    });
    res.json(state);
  });

  app.post("/api/risk/kill-switch/reset", (_req, res) => {
    const state = updatePersistentRiskState({
      killSwitchActive: false,
      newRiskBlocked: false,
      cooldownUntil: 0,
      lastKillSwitchReason: undefined,
      reason: "manual_reset",
    });
    res.json(state);
  });
}
