import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readServerSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : readServerSources(fullPath);
    return entry.name.endsWith(".ts") ? [fs.readFileSync(fullPath, "utf-8")] : [];
  });
}

// The server lives in server.ts plus the modules under server/.
const serverSource = [
  fs.readFileSync(path.join(process.cwd(), "server.ts"), "utf-8"),
  ...readServerSources(path.join(process.cwd(), "server")),
].join("\n");

describe("OKX order submit path", () => {
  it("uses attachAlgoOrds for attached TP/SL on raw OKX orders", () => {
    expect(serverSource).toContain("orderPayload.attachAlgoOrds");
    expect(serverSource).toContain("privatePostTradeOrder(orderPayload)");
    expect(serverSource).not.toContain("orderPayload.tpTriggerPx");
    expect(serverSource).not.toContain("orderPayload.slTriggerPx");
  });

  it("does not keep the old ccxt order route branch alive", () => {
    expect(serverSource).not.toContain("params.tpTriggerPx");
    expect(serverSource).not.toContain("params.slTriggerPx");
    expect(serverSource).not.toContain("exchange.createMarketOrder(ccxtSymbol");
  });
});
