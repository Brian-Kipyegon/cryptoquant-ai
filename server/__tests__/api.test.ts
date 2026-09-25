import fs from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Configure before the server modules are imported: they read env at load time.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cq-api-test-"));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = "test-password";
process.env.APP_SECRET = "test-app-secret-0123456789";
delete process.env.OKX_API_KEY;
delete process.env.OKX_DEMO_API_KEY;

let server: Server;
let baseUrl = "";
let token = "";

async function api(method: string, pathname: string, body?: unknown, auth = true) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}

beforeAll(async () => {
  const { createApp } = await import("../app");
  const app = await createApp({ serveFrontend: false, startBackgroundJobs: false });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("API smoke test", () => {
  it("rejects unauthenticated API calls", async () => {
    const res = await api("GET", "/api/trades", undefined, false);
    expect(res.status).toBe(401);
  });

  it("rejects a wrong password", async () => {
    const res = await api("POST", "/api/auth/login", { username: "admin", password: "nope" }, false);
    expect(res.status).toBe(401);
  });

  it("logs in and reports the session", async () => {
    const login = await api("POST", "/api/auth/login", { username: "admin", password: "test-password" }, false);
    expect(login.status).toBe(200);
    token = login.json.token;
    expect(token).toBeTruthy();

    const session = await api("GET", "/api/auth/session");
    expect(session.json).toMatchObject({ authenticated: true, user: { username: "admin" } });
  });

  it("stores state under DATA_DIR", () => {
    expect(fs.existsSync(path.join(dataDir, "trading.sqlite"))).toBe(true);
  });

  it("serves the default risk state and accepts updates", async () => {
    const initial = await api("GET", "/api/risk/state");
    expect(initial.status).toBe(200);
    expect(initial.json).toMatchObject({ killSwitchActive: false, newRiskBlocked: false });

    const updated = await api("POST", "/api/risk/state", { dailyPnL: -12.5 });
    expect(updated.status).toBe(200);
    expect(updated.json.dailyPnL).toBe(-12.5);
  });

  it("records and lists trades", async () => {
    const record = await api("POST", "/api/trades/record", {
      symbol: "BTC/USDT", side: "buy", amount: 1, price: 100, mode: "shadow",
    });
    expect(record.status).toBe(200);
    expect(record.json.ok).toBe(true);

    const list = await api("GET", "/api/trades");
    expect(list.json).toHaveLength(1);
    expect(list.json[0]).toMatchObject({ symbol: "BTC/USDT", side: "BUY", mode: "shadow" });
  });

  it("starts with the auto-trading engine stopped", async () => {
    const status = await api("GET", "/api/auto-trading/status");
    expect(status.status).toBe(200);
    expect(status.json.state).toBe("stopped");
  });

  it("saves and clears AI credentials", async () => {
    const saved = await api("POST", "/api/config/credentials", { aiKey: "k-123", aiUrl: "https://example.test/v1" });
    expect(saved.status).toBe(200);
    expect(saved.json.status.aiProxy).toBe(true);

    const cleared = await api("DELETE", "/api/config/credentials");
    expect(cleared.status).toBe(200);
    expect(cleared.json.status.aiProxy).toBe(false);
  });

  it("returns 404 for unknown audit log types", async () => {
    const res = await api("GET", "/api/audit/logs/bogus");
    expect(res.status).toBe(404);
  });
});
