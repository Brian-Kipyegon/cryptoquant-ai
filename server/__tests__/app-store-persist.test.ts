import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cq-persist-test-"));

const writes: string[] = [];
vi.mock("../utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils")>()),
  writeFileAtomic: vi.fn(async (_file: string, contents: string) => {
    writes.push(contents);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }),
}));

describe("persistAppStore", () => {
  it("coalesces bursts of writes and always writes the latest state", async () => {
    const { appStore, persistAppStore, pushAutoTradingLog } = await import("../stores/app-store");
    writes.length = 0;

    // pushAutoTradingLog persists on every call; a scan makes hundreds of such calls.
    const first = Array.from({ length: 50 }, (_, index) => pushAutoTradingLog(`burst ${index}`));
    expect(first).toHaveLength(50);
    await persistAppStore();
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]).autoTrading.recentLogs[0]).toMatch(/burst 49$/);

    // A change made while a write is running is picked up by exactly one more write.
    const running = persistAppStore();
    await new Promise((resolve) => setTimeout(resolve, 1));
    appStore.autoTrading.recentLogs = ["latest", ...appStore.autoTrading.recentLogs];
    const follow = persistAppStore();
    await Promise.all([running, follow]);
    expect(writes).toHaveLength(3);
    expect(JSON.parse(writes[2]).autoTrading.recentLogs[0]).toBe("latest");
  });
});
