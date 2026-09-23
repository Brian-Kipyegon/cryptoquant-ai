import "./env";
import path from "path";
import { fileURLToPath } from "url";

// Repository root (this file lives in <root>/server).
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, "data");
export const AUDIT_FILE = path.join(DATA_DIR, "audit-store.json");
export const APP_STORE_FILE = path.join(DATA_DIR, "app-store.json");
export const TRADING_DB_FILE = path.join(DATA_DIR, "trading.sqlite");
export const CREDENTIALS_FILE = path.join(DATA_DIR, "credentials.enc.json");
export const LOCAL_SECRET_FILE = path.join(DATA_DIR, ".local-secret");
export const LOCAL_ADMIN_PASSWORD_FILE = path.join(DATA_DIR, ".admin-password");
export const PORT = Number(process.env.PORT || 3000);
