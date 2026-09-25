# Running CryptoQuant AI

Step-by-step instructions to install, configure, run and use the project. For how it works internally see [architecture.md](architecture.md).

> Research software, not financial advice. Start in shadow mode, use OKX demo keys before live keys, restrict API key permissions, and never expose the service to the public internet without hardening.

## 1. Prerequisites

- **Node.js 24+** and **npm 10+** (the server uses the built-in `node:sqlite` module).
- **Git**.
- Network access to Binance (default market data) or Binance.US / OKX. From the US use `DATA_EXCHANGE=binanceus`, because binance.com blocks US IPs.
- Optional: OKX API keys (demo and/or live) for account features and live trading.
- Optional: Docker, FRED API key (macro data), Zhipu GLM key (AI summaries), SMTP account (email notifications).

## 2. Install

```bash
git clone https://github.com/Brian-Kipyegon/cryptoquant-ai.git
cd cryptoquant-ai
npm ci
npm run setup
```

`npm run setup` checks your Node.js version and creates `.env` from `.env.example` if it doesn't exist.

## 3. Configure `.env`

Open `.env` and set at least:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=choose-a-strong-password
APP_SECRET=a-long-random-string-used-to-encrypt-saved-keys
DATA_EXCHANGE=binance
```

Values still set to `YOUR_..._HERE` placeholders are ignored for exchange credentials, but `ADMIN_PASSWORD` is used literally, so change it.

### All settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_USERNAME` | `admin` | Dashboard login name |
| `ADMIN_PASSWORD` | generated | Dashboard password. If unset, one is generated into `data/.admin-password` |
| `SESSION_TTL_HOURS` | `12` | Login session lifetime |
| `APP_SECRET` | generated | Encrypts keys saved in the dashboard. Set it before saving keys; changing it later makes saved keys unreadable |
| `DATA_EXCHANGE` | `binance` | Market data source: `binance`, `binanceus` or `okx` |
| `SHADOW_PAPER_EQUITY_USDT` | `10000` | Paper balance for shadow mode when no OKX account is configured |
| `STRATEGY_SIGNAL_RETENTION_DAYS` | `14` | Days of strategy signal history kept in SQLite |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where SQLite, JSON stores and the credential vault live |
| `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` | none | OKX live account |
| `OKX_DEMO_API_KEY`, `OKX_DEMO_SECRET_KEY`, `OKX_DEMO_PASSPHRASE` | none | OKX demo account |
| `EXCHANGE_PROXY_URL` | none | Optional HTTP/SOCKS proxy for exchange requests, e.g. `http://127.0.0.1:10808` |
| `FRED_API_KEY` | none | Macro data (DXY, M2) for the macro gate |
| `ZHIPU_API_KEY`, `ZHIPU_BASE_URL`, `ZHIPU_*_MODEL` | none | AI summaries via `/api/ai/analyze` |
| `SMTP_USER`, `SMTP_PASS`, `SMTP_TO` | none | Email notifications |

OKX and AI keys can also be entered on the dashboard's **Settings** page; they are stored encrypted in `data/credentials.enc.json`. Environment variables take precedence.

## 4. Run

### Development

```bash
npm run dev
```

Serves the API and the dashboard (with Vite hot reload) on http://localhost:3000.

### Production

```bash
npm start
```

Builds the frontend into `dist/` and starts the server in production mode. `npm run start:prod` starts it without rebuilding.

### Docker

```bash
npm run setup          # or: cp .env.example .env, then edit it
docker compose up -d --build
docker compose logs -f core
```

- The app is on http://localhost:3000.
- Data lives in the `core-data` volume and survives restarts and rebuilds.
- The container runs as the unprivileged `node` user and has a health check on `/api/auth/session`.
- If Docker Hub rate-limits the base image: `docker compose build --build-arg NODE_IMAGE=mirror.gcr.io/library/node:24-slim`.

## 5. First login

1. Open http://localhost:3000.
2. Sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
3. The **Dashboard** shows run controls, connectivity (market data, OKX account, proxy), the agent activity log, a price chart and the scan profile panel.

Without OKX keys the account panels show "Missing OKX credentials". That's expected; market data, scanning and shadow mode still work.

## 6. Run the auto-trader in shadow mode

Shadow mode simulates trades at real market prices without placing orders. It is the default.

1. On the **Dashboard**, open **Auto-trading scan profiles**:
   - Tick the manual pairs and timeframes you always want scanned.
   - Leave **Scan the most liquid pairs** on and set the number of pairs (default 100), timeframes (default 1h) and minimum 24h volume (default 5 million USDT).
   - Click **Save scan profiles**.
2. On **Settings**, check **Shadow mode** is on and review the risk parameters (confidence threshold, stop loss %, take profit %, daily loss limit, max consecutive losses). Save.
3. Back on the **Dashboard**, click **Scan now** to run one cycle, or **Start** to run continuously (every 5 minutes by default).
4. Watch the **Agent activity log**. A healthy scan logs `Scan started`, then `Scanning N targets (M universe pairs) on Binance`, then candidates or "No auto-trading candidates passed the filters".

Where to look next:

- **Diagnostics**: the latest cycle funnel, why each candidate was blocked (decision traces), open and closed shadow positions.
- **Portfolio**: returns for the shadow, demo or live scope.
- **Audit** and **Reliability**: risk events, security events, order lifecycle.

## 7. Backtesting

On **Backtest**, pick a timeframe, symbols and strategies, set the training/validation windows and risk per trade, then click **Run walk-forward validation**. History comes from the market data exchange (Binance by default). Rounds with too few trades are flagged rather than shown as stable.

## 8. Going live (OKX)

Only after shadow and demo results justify it:

1. Add OKX **demo** keys first (Settings or `.env`), enable **Use demo account**, turn **Shadow mode** off, and run.
2. For live trading add live keys, turn off demo, and keep shadow mode off.

Notes:

- Live orders go to OKX USDT perpetual swaps and are sized with OKX prices, while signals use `DATA_EXCHANGE` data.
- In live mode the universe only includes pairs OKX lists as USDT swaps.
- Configs saved before the universe feature existed don't scan the universe in live mode until you enable it.
- Restrict OKX keys to trading (no withdrawals) and allow-list your IP.

## 9. Tests and checks

```bash
npm run lint    # type-check
npm test        # unit, API and scan-cycle tests (no network access needed)
npm run build   # production build
```

CI runs the same three steps on Node 24.

## 10. Data and reset

Everything lives in `DATA_DIR` (default `./data`):

- `trading.sqlite`: trades, strategy signals, shadow orders
- `app-store.json`: sessions, config, logs, traces, risk state
- `audit-store.json`: audit records
- `credentials.enc.json`, `.local-secret`, `.admin-password`: secrets

To start fresh, stop the server and delete the directory (in Docker: `docker compose down -v`). This also deletes saved keys and history.

## 11. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Market data is not reachable before auto-trading start` | The market data exchange can't be reached. Check your network, set `EXCHANGE_PROXY_URL`, or switch `DATA_EXCHANGE` (US users: `binanceus`). |
| `451` or `403` errors from Binance | binance.com is blocked in your region. Use `DATA_EXCHANGE=binanceus`, or a proxy where that's permitted. |
| `Missing OKX credentials for live mode` | Live mode needs OKX keys. Add them or turn shadow mode on. |
| "Missing OKX credentials" toast in shadow mode | The account panels need OKX; scanning doesn't. Safe to ignore. |
| `Stale candles` in the log | The exchange returned old data for that pair; it is skipped for the cycle. Persistent staleness points to exchange or network issues. |
| `EXCHANGE_PROXY_URL points to ... not reachable` | Start your proxy or clear `EXCHANGE_PROXY_URL`. |
| Can't log in | Check `ADMIN_PASSWORD` in `.env`, or read `data/.admin-password` if it was generated. |
| Saved keys disappeared after changing `APP_SECRET` | The vault is encrypted with `APP_SECRET`. Restore the old value or re-enter the keys. |
| `ExperimentalWarning: SQLite is an experimental feature` | Expected with `node:sqlite`; harmless. |
| Docker build fails with `429 Too Many Requests` | Docker Hub rate limit. Use the `NODE_IMAGE` build arg with a mirror (see Docker above). |
