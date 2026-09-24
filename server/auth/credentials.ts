import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import { CREDENTIALS_FILE, DATA_DIR, LOCAL_SECRET_FILE } from "../config";
import { writeFileAtomic } from "../utils";

// --- Encrypted Credential Store ---
export type OkxCredentials = {
  apiKey?: string;
  secret?: string;
  password?: string;
};

export type AiProxyCredentials = {
  proxyUrl?: string;
  proxyKey?: string;
  decisionModel?: string;
  summaryModel?: string;
  visionModel?: string;
};

export type CredentialStore = {
  okx?: OkxCredentials;
  okxDemo?: OkxCredentials;
  ai?: AiProxyCredentials;
};

export let credentialStore: CredentialStore = {};

export function clearCredentialStore() {
  credentialStore = {};
}

export function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasOkxCredentials(credentials?: OkxCredentials) {
  return !!(hasText(credentials?.apiKey) && hasText(credentials?.secret) && hasText(credentials?.password));
}

export function hasAiCredentials(credentials?: AiProxyCredentials) {
  return !!(hasText(credentials?.proxyUrl) && hasText(credentials?.proxyKey));
}

/** True for the unfilled YOUR_..._HERE values shipped in .env.example. */
export function isEnvPlaceholder(value: string) {
  return /^YOUR_[A-Z0-9_]+_HERE$/.test(value.trim());
}

export function envText(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    // An unedited .env.example must not look like configured credentials.
    if (hasText(value) && !isEnvPlaceholder(value)) return value.trim();
  }
  return undefined;
}

export function getOkxEnvCredentials(sandbox: boolean): OkxCredentials {
  return sandbox
    ? {
        apiKey: envText("OKX_DEMO_API_KEY", "OKX_SIM_API_KEY", "OKX_PAPER_API_KEY"),
        secret: envText("OKX_DEMO_SECRET_KEY", "OKX_DEMO_SECRET", "OKX_SIM_SECRET_KEY", "OKX_PAPER_SECRET_KEY"),
        password: envText("OKX_DEMO_PASSPHRASE", "OKX_DEMO_PASSWORD", "OKX_DEMO_PASS", "OKX_SIM_PASSPHRASE", "OKX_PAPER_PASSPHRASE"),
      }
    : {
        apiKey: envText("OKX_API_KEY", "OKX_LIVE_API_KEY"),
        secret: envText("OKX_SECRET_KEY", "OKX_SECRET", "OKX_LIVE_SECRET_KEY"),
        password: envText("OKX_PASSPHRASE", "OKX_PASSWORD", "OKX_PASS", "OKX_LIVE_PASSPHRASE"),
      };
}

export function getZhipuConfig(task: "decision" | "summary" | "vision" = "decision", body: any = {}) {
  const storedAi = credentialStore.ai || {};
  const baseUrl = body.proxyUrl || body.zhipuBaseUrl || process.env.ZHIPU_BASE_URL || storedAi.proxyUrl || "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  const apiKey = body.proxyKey || body.zhipuApiKey || process.env.ZHIPU_API_KEY || storedAi.proxyKey;
  const decisionModel = body.model || process.env.ZHIPU_DECISION_MODEL || storedAi.decisionModel || "glm-4.5-air";
  const summaryModel = body.model || process.env.ZHIPU_SUMMARY_MODEL || storedAi.summaryModel || decisionModel;
  const visionModel = body.model || process.env.ZHIPU_VISION_MODEL || storedAi.visionModel || "glm-4.6v";
  const model = task === "summary" ? summaryModel : task === "vision" ? visionModel : decisionModel;
  const endpoint = String(baseUrl).includes("/chat/completions")
    ? String(baseUrl)
    : `${String(baseUrl).replace(/\/$/, "")}/chat/completions`;

  return { endpoint, apiKey, model, baseUrl, decisionModel, summaryModel, visionModel };
}

export async function getCredentialSecret() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const configuredSecret = process.env.APP_SECRET || process.env.CREDENTIALS_SECRET;
  if (hasText(configuredSecret)) return configuredSecret;

  try {
    const existingSecret = await fsp.readFile(LOCAL_SECRET_FILE, "utf-8");
    if (hasText(existingSecret)) return existingSecret.trim();
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      console.warn("[Credentials] Failed to read local secret:", error.message);
    }
  }

  const generatedSecret = crypto.randomBytes(32).toString("hex");
  await fsp.writeFile(LOCAL_SECRET_FILE, generatedSecret, { mode: 0o600 });
  console.warn("[Credentials] APP_SECRET is not set; generated a local development secret under data/.");
  return generatedSecret;
}

export async function getCredentialKey() {
  const secret = await getCredentialSecret();
  return crypto.scryptSync(secret, "cryptoquant-ai-credential-store-v1", 32);
}

export async function encryptCredentials(data: CredentialStore) {
  const key = await getCredentialKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), "utf-8"),
    cipher.final(),
  ]);

  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
}

export async function decryptCredentials(payload: any): Promise<CredentialStore> {
  const key = await getCredentialKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf-8"));
}

export async function loadCredentialStore() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    if (!fs.existsSync(CREDENTIALS_FILE)) return;
    const raw = await fsp.readFile(CREDENTIALS_FILE, "utf-8");
    credentialStore = await decryptCredentials(JSON.parse(raw));
    console.log("[Credentials] Encrypted credential store loaded.");
  } catch (error) {
    credentialStore = {};
    console.warn("[Credentials] Failed to load encrypted credential store:", error);
  }
}

export async function persistCredentialStore() {
  const encrypted = await encryptCredentials(credentialStore);
  await writeFileAtomic(CREDENTIALS_FILE, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
}

export function sanitizedCredentialStatus() {
  const envOkxLive = hasOkxCredentials(getOkxEnvCredentials(false));
  const envOkxDemo = hasOkxCredentials(getOkxEnvCredentials(true));
  const envZhipu = !!hasText(process.env.ZHIPU_API_KEY);
  const storedOkxLive = hasOkxCredentials(credentialStore.okx);
  const storedOkxDemo = hasOkxCredentials(credentialStore.okxDemo);
  const storedAiProxy = hasAiCredentials(credentialStore.ai);

  return {
    okx: envOkxLive || storedOkxLive,
    okxLive: envOkxLive || storedOkxLive,
    okxDemo: envOkxDemo || storedOkxDemo,
    ai: envZhipu || storedAiProxy,
    aiProxy: envZhipu || storedAiProxy,
    zhipu: envZhipu || storedAiProxy,
    smtp: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
    sources: {
      okxLive: envOkxLive ? "env" : storedOkxLive ? "vault" : null,
      okxDemo: envOkxDemo ? "env" : storedOkxDemo ? "vault" : null,
      aiProxy: envZhipu ? "env" : storedAiProxy ? "vault" : null,
      smtp: process.env.SMTP_USER && process.env.SMTP_PASS ? "env" : null,
    },
  };
}

export function resolveOkxCredentials(body: any, sandbox: boolean): Required<OkxCredentials> | null {
  const env = getOkxEnvCredentials(sandbox);
  const stored = sandbox ? credentialStore.okxDemo : credentialStore.okx;
  const credentials = {
    apiKey: body?.apiKey || env.apiKey || stored?.apiKey,
    secret: body?.secret || env.secret || stored?.secret,
    password: body?.password || env.password || stored?.password,
  };

  if (!hasOkxCredentials(credentials)) return null;
  return credentials as Required<OkxCredentials>;
}

export function mergeText<T extends Record<string, any>>(current: T | undefined, next: Partial<T>) {
  const merged: T = { ...(current || {}) } as T;
  for (const [key, value] of Object.entries(next)) {
    if (hasText(value)) {
      (merged as any)[key] = value.trim();
    }
  }
  return merged;
}
