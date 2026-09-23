import path from "path";
import fsp from "fs/promises";
import crypto from "crypto";

export const publicMarketCache = new Map<string, { expiresAt: number; data: any }>();
export const fileWriteQueue = new Map<string, Promise<void>>();

export async function cachedPublicMarket<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = publicMarketCache.get(key);
  if (cached && cached.expiresAt > now) return cached.data as T;
  const data = await fetcher();
  publicMarketCache.set(key, { data, expiresAt: now + ttlMs });
  return data;
}

export async function writeFileAtomic(filePath: string, contents: string, options?: { mode?: number }) {
  const previous = fileWriteQueue.get(filePath) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      const tmpFile = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      await fsp.writeFile(tmpFile, contents, options);
      await fsp.rename(tmpFile, filePath);
    });
  fileWriteQueue.set(filePath, next);
  try {
    await next;
  } finally {
    if (fileWriteQueue.get(filePath) === next) {
      fileWriteQueue.delete(filePath);
    }
  }
}

// --- Global Exchange Instances (for reuse) ---


export function normalizeNumber(value: any): number | null {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function safeJsonParse<T>(value: any, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizeBooleanInt(value: any, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value ? 1 : 0;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return 1;
  if (["0", "false", "no", "off"].includes(normalized)) return 0;
  return fallback;
}

export function stringifyJson(value: any) {
  if (value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

export function firstNumber(...values: any[]) {
  for (const value of values) {
    const normalized = normalizeNumber(value);
    if (normalized !== null) return normalized;
  }
  return 0;
}

export function floorToStep(value: number, step: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(step) || step <= 0) return value;
  const decimals = Math.max(0, (String(step).split(".")[1] || "").length);
  return Number((Math.floor(value / step) * step).toFixed(decimals));
}
