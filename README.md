# CryptoQuant AI

CryptoQuant AI is a local-first quantitative cryptocurrency trading dashboard for research, monitoring, backtesting, and optional OKX execution. It combines a React/Vite frontend with an Express/TypeScript backend, local SQLite persistence, OKX market/account integrations, Zhipu GLM-assisted summaries, and risk controls for strategy evaluation.

> This project is for research and personal operations. It is not financial advice. Use demo trading first, keep API permissions limited, and never expose this service directly to the public internet without proper hardening.

## Features

- OKX market data, account balance, positions, order history, and order submission support.
- Demo and live OKX credential paths with a local encrypted credential store.
- Regime-based strategy engine with trend breakout, mean reversion, macro risk gating, TP/SL construction, and risk kill switch behavior.
- Shadow trading, walk-forward backtesting, portfolio return analytics, execution diagnostics, reliability views, and audit trails.
- Local SQLite and JSON persistence for trades, state, risk events, and research snapshots.
- React dashboard for monitoring, backtesting, portfolio returns, diagnostics and audit trails.

## Prerequisites

- Node.js 24 or newer.
- npm 10 or newer.
- Git.
- Optional OKX API credentials for live or demo trading.
- Optional Zhipu GLM API key for AI-assisted summaries.
- Optional FRED API key for macro data.
- Optional local HTTP/SOCKS proxy if your network cannot reach OKX directly.

## Installation

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/cryptoquant-ai.git
cd cryptoquant-ai
npm ci
npm run setup
```

`npm run setup` checks your Node.js version and creates `.env` from `.env.example` if it doesn't exist yet. Edit `.env` and replace every `YOUR_..._HERE` value with your own local credentials. Leave optional services blank if you do not use them.

## Usage

Start the local development server:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

Build and run in production mode:

```bash
npm start
```

This runs `npm run build` followed by `npm run start:prod`. Set `PORT` to listen on a port other than 3000, and `DATA_DIR` to keep runtime data somewhere other than `./data`.

### Docker

```bash
npm run setup                 # or: cp .env.example .env
# edit .env
docker compose up -d --build
```

The app is served on `http://localhost:3000`. Runtime data (SQLite database, JSON stores and the encrypted credential vault) lives in the `core-data` Docker volume, so it survives container restarts and rebuilds. The container runs as the unprivileged `node` user and exposes a health check on `/api/auth/session`.

To pull the Node.js base image from a registry mirror, pass `NODE_IMAGE`, for example `docker compose build --build-arg NODE_IMAGE=mirror.gcr.io/library/node:24-slim`.

Run validation:

```bash
npm run lint
npm test
npm run build
```

## Configuration

The app reads configuration from `.env`. Important variables include:

- `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_TTL_HOURS` for local operator login.
- `APP_SECRET` for local encrypted credential storage.
- `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` for OKX live mode.
- `OKX_DEMO_API_KEY`, `OKX_DEMO_SECRET_KEY`, `OKX_DEMO_PASSPHRASE` for OKX demo mode.
- `EXCHANGE_PROXY_URL` for optional proxy routing, for example `http://127.0.0.1:10808`.
- `ZHIPU_API_KEY` and model settings for AI-assisted summaries.
- `FRED_API_KEY` for macro data.
- `SMTP_USER`, `SMTP_PASS`, `SMTP_TO` for optional email notifications.

Never commit `.env`, `data/`, logs, SQLite files, screenshots containing account information, or encrypted credential stores.

## Security Notes

- Start with OKX demo trading before live trading.
- Restrict exchange API keys to the minimum permissions needed.
- Do not put API keys in frontend code.
- Use a long random `APP_SECRET` before saving credentials in the local vault.
- Keep this service behind local authentication and do not publish it as an unauthenticated public web app.
- Review generated orders, leverage, take-profit, and stop-loss behavior before enabling live execution.

## License

MIT. See [LICENSE](./LICENSE).
