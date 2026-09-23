import { fetchMacroData, type MacroData } from "../../src/services/macroService";
import { evaluateMacroGate } from "../../src/lib/strategyEngine";

// --- Macro Data Cache ---
export let cachedMacroData: MacroData | null = null;
export const FRED_API_KEY = process.env.FRED_API_KEY || "";
export const MACRO_CACHE_TTL_MS = 5 * 60 * 1000;
export let macroRefreshPromise: Promise<MacroData | null> | null = null;

export async function updateMacroCache(force = false) {
  if (!force && cachedMacroData && Date.now() - cachedMacroData.timestamp <= MACRO_CACHE_TTL_MS) {
    return cachedMacroData;
  }
  if (macroRefreshPromise) return macroRefreshPromise;

  macroRefreshPromise = (async () => {
    try {
      console.log("[Macro] Updating macro data cache...");
      const nextMacroData = await fetchMacroData(FRED_API_KEY, cachedMacroData);
      cachedMacroData = nextMacroData;
      console.log("[Macro] Cache updated successfully.");
      return cachedMacroData;
    } catch (e) {
      console.error("[Macro] Failed to update macro cache:", e);
      return cachedMacroData;
    } finally {
      macroRefreshPromise = null;
    }
  })();

  return macroRefreshPromise;
}

export async function ensureFreshMacroData(maxAgeMs = MACRO_CACHE_TTL_MS) {
  if (cachedMacroData && Date.now() - cachedMacroData.timestamp <= maxAgeMs) {
    return cachedMacroData;
  }
  return updateMacroCache(true);
}

export function buildFallbackMacroData(): MacroData {
  const macroRiskScore = 0;
  return {
    dxy: 0,
    m2: 0,
    m2Change3mPct: 0,
    dxyChange30dPct: 0,
    btcCorrelation: 0,
    dxySource: "unavailable",
    macroRiskScore,
    macroGate: evaluateMacroGate({ macroRiskScore }),
    timestamp: Date.now(),
  };
}
