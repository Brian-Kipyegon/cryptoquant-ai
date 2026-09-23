import express from "express";
import fsp from "fs/promises";
import crypto from "crypto";
import { ADMIN_USERNAME, SESSION_TTL_MS, addSecurityEvent, adminPasswordHash, appStore, hashSecret, persistAppStore, timingSafeEqualString } from "../stores/app-store";
import { CREDENTIALS_FILE } from "../config";
import { clearCredentialStore, credentialStore, hasText, mergeText, persistCredentialStore, sanitizedCredentialStatus } from "../auth/credentials";
import { getBearerToken, getSession } from "../auth/session";
import { privateExchanges } from "../exchange/connectivity";

export function registerAuthRoutes(app: express.Express) {
  app.post("/api/auth/login", async (req, res) => {
    const { username = ADMIN_USERNAME, password } = req.body || {};
    const normalizedUsername = String(username || ADMIN_USERNAME).trim();
    const passwordHash = hasText(password) ? hashSecret(password) : "";

    if (normalizedUsername !== ADMIN_USERNAME || !passwordHash || !timingSafeEqualString(passwordHash, adminPasswordHash)) {
      addSecurityEvent("auth.login_failed", req, { username: normalizedUsername });
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    appStore.sessions.unshift({
      tokenHash: hashSecret(token),
      username: ADMIN_USERNAME,
      role: "admin",
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      lastSeenAt: now,
    });
    appStore.sessions = appStore.sessions.filter(session => session.expiresAt > now).slice(0, 20);
    await persistAppStore();
    addSecurityEvent("auth.login_success", req, undefined, ADMIN_USERNAME);

    res.json({
      token,
      user: { username: ADMIN_USERNAME, role: "admin" },
      expiresAt: now + SESSION_TTL_MS,
    });
  });

  app.get("/api/auth/session", (req, res) => {
    const session = getSession(req);
    if (!session) return res.json({ authenticated: false });
    res.json({
      authenticated: true,
      user: { username: session.username, role: session.role },
      expiresAt: session.expiresAt,
    });
  });

  app.post("/api/auth/logout", async (req, res) => {
    const token = getBearerToken(req);
    if (token) {
      const tokenHash = hashSecret(token);
      appStore.sessions = appStore.sessions.filter(session => session.tokenHash !== tokenHash);
      await persistAppStore();
    }
    addSecurityEvent("auth.logout", req, undefined, (req as any).operator?.username);
    res.json({ ok: true });
  });

  // Check which keys are configured without exposing secrets.
  app.get("/api/config/status", (req, res) => {
    const session = getSession(req);
    res.json({
      ...sanitizedCredentialStatus(),
      auth: {
        required: true,
        authenticated: !!session,
        user: session ? { username: session.username, role: session.role } : null,
      },
    });
  });

  app.post("/api/config/credentials", async (req, res) => {
    try {
      const {
        okxKey,
        okxSecret,
        okxPass,
        okxDemoKey,
        okxDemoSecret,
        okxDemoPass,
        aiUrl,
        aiKey,
        aiModel,
        aiSummaryModel,
        aiVisionModel,
      } = req.body || {};

      credentialStore.okx = mergeText(credentialStore.okx, {
        apiKey: okxKey,
        secret: okxSecret,
        password: okxPass,
      });
      credentialStore.okxDemo = mergeText(credentialStore.okxDemo, {
        apiKey: okxDemoKey,
        secret: okxDemoSecret,
        password: okxDemoPass,
      });
      credentialStore.ai = mergeText(credentialStore.ai, {
        proxyUrl: aiUrl,
        proxyKey: aiKey,
        decisionModel: aiModel,
        summaryModel: aiSummaryModel,
        visionModel: aiVisionModel,
      });

      await persistCredentialStore();
      res.json({ ok: true, status: sanitizedCredentialStatus() });
    } catch (error: any) {
      console.error("[Credentials] Save failed:", error);
      res.status(500).json({ error: error.message || "Failed to save credentials" });
    }
  });

  app.delete("/api/config/credentials", async (_req, res) => {
    try {
      clearCredentialStore();
      await fsp.rm(CREDENTIALS_FILE, { force: true });
      privateExchanges.clear();
      res.json({ ok: true, status: sanitizedCredentialStatus() });
    } catch (error: any) {
      console.error("[Credentials] Clear failed:", error);
      res.status(500).json({ error: error.message || "Failed to clear credentials" });
    }
  });
}
