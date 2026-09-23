import express from "express";
import path from "path";
import fsp from "fs/promises";
import crypto from "crypto";
import { LOCAL_ADMIN_PASSWORD_FILE } from "../config";
import { addSecurityEvent, appStore, hashSecret } from "../stores/app-store";
import { hasText } from "./credentials";

export async function getAdminPassword() {
  if (hasText(process.env.ADMIN_PASSWORD)) return process.env.ADMIN_PASSWORD;

  try {
    const existingPassword = await fsp.readFile(LOCAL_ADMIN_PASSWORD_FILE, "utf-8");
    if (hasText(existingPassword)) return existingPassword.trim();
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      console.warn("[Auth] Failed to read local admin password:", error.message);
    }
  }

  const generatedPassword = crypto.randomBytes(18).toString("base64url");
  await fsp.writeFile(LOCAL_ADMIN_PASSWORD_FILE, generatedPassword, { mode: 0o600 });
  console.warn(`[Auth] ADMIN_PASSWORD is not set. Generated local admin password in ${LOCAL_ADMIN_PASSWORD_FILE}`);
  return generatedPassword;
}

export function getBearerToken(req: express.Request) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7).trim();
  const tokenHeader = req.headers["x-admin-token"];
  return Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
}

export function getSession(req: express.Request) {
  const token = getBearerToken(req);
  if (!token) return null;
  const tokenHash = hashSecret(token);
  const now = Date.now();
  const session = appStore.sessions.find(item => item.tokenHash === tokenHash && item.expiresAt > now);
  if (!session) return null;
  session.lastSeenAt = now;
  (req as any).operator = { username: session.username, role: session.role };
  return session;
}

export function isPublicApi(req: express.Request) {
  if (req.path.startsWith("/auth/")) return true;
  if (req.method === "GET" && req.path === "/config/status") return true;
  if (req.method === "GET" && req.path === "/macro") return true;
  if (req.method === "GET" && (
    req.path.startsWith("/okx/ticker/") ||
    req.path.startsWith("/okx/orderbook/") ||
    req.path === "/okx/tickers" ||
    req.path.startsWith("/okx/ohlcv/") ||
    req.path.startsWith("/okx/funding/")
  )) return true;
  return false;
}

export function requireOperator(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (isPublicApi(req)) return next();
  const session = getSession(req);
  if (!session) {
    addSecurityEvent("auth.denied", req, { reason: "missing_or_expired_session" });
    return res.status(401).json({ error: "Authentication required" });
  }
  session.lastSeenAt = Date.now();
  next();
}
