import fs from "fs";
import fsp from "fs/promises";
import { AUDIT_FILE, DATA_DIR } from "../config";
import { writeFileAtomic } from "../utils";

export const STRATEGY_VERSION = "v2.1.0-reliability-risk-audit";
export const auditStore = {
  aiSnapshots: [] as any[],
  orderReceipts: [] as any[],
  riskEvents: [] as any[],
  positionChanges: [] as any[],
};

// Helper to add to audit store with limit
export function addToAudit<T>(list: T[], item: T, limit = 100) {
  list.unshift({ ...item, timestamp: Date.now() });
  if (list.length > limit) list.pop();
  persistAuditStore().catch(error => console.error("[Audit] Persist failed:", error));
}

export async function loadAuditStore() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    if (!fs.existsSync(AUDIT_FILE)) return;
    const raw = await fsp.readFile(AUDIT_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    for (const key of Object.keys(auditStore) as Array<keyof typeof auditStore>) {
      if (Array.isArray(parsed[key])) {
        auditStore[key] = parsed[key].slice(0, 500);
      }
    }
    console.log("[Audit] Persistent audit store loaded.");
  } catch (error) {
    console.warn("[Audit] Failed to load persistent audit store:", error);
  }
}

export async function persistAuditStore() {
  await writeFileAtomic(AUDIT_FILE, JSON.stringify(auditStore, null, 2));
}

// --- Local Operations Store: auth sessions, security events, order lifecycle ---
