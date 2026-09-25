# Requisite

This checklist summarizes the environment, configuration, and safety checks needed before running or publishing CryptoQuant AI.

## System Requirements

- Windows 10/11, macOS, or Linux.
- Node.js 24 or newer.
- npm 10 or newer.
- Git.
- Stable network access to the market data exchange (Binance by default) and, for account features, OKX; or a local proxy configured through `EXCHANGE_PROXY_URL`.

## First Run

```bash
npm ci
cp .env.example .env
npm run dev
```

On Windows, either copy `.env.example` to `.env` manually or run:

```cmd
copy .env.example .env
```

Then open:

```text
http://localhost:3000
```

## Required Local Configuration

Set these values in `.env` before using authenticated features:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD_HERE
APP_SECRET=YOUR_LONG_RANDOM_APP_SECRET_HERE
```

`APP_SECRET` protects the local encrypted credential store. Use a long random value and keep it private.

## Optional Integrations

OKX live trading:

```env
OKX_API_KEY=YOUR_OKX_API_KEY_HERE
OKX_SECRET_KEY=YOUR_OKX_SECRET_KEY_HERE
OKX_PASSPHRASE=YOUR_OKX_PASSPHRASE_HERE
```

OKX demo trading:

```env
OKX_DEMO_API_KEY=YOUR_OKX_DEMO_API_KEY_HERE
OKX_DEMO_SECRET_KEY=YOUR_OKX_DEMO_SECRET_KEY_HERE
OKX_DEMO_PASSPHRASE=YOUR_OKX_DEMO_PASSPHRASE_HERE
```

AI summaries and macro data:

```env
ZHIPU_API_KEY=YOUR_ZHIPU_API_KEY_HERE
FRED_API_KEY=YOUR_FRED_API_KEY_HERE
```

Optional proxy:

```env
EXCHANGE_PROXY_URL=http://127.0.0.1:10808
```

Use the actual host and port for your local proxy software.

## Local Runtime Files

The app creates local runtime files under `data/`, including SQLite databases, JSON state stores, local generated passwords, and encrypted credential files. These are private machine-local files and must not be committed.

## Pre-Publish Safety Check

Before publishing to GitHub, verify:

- `.env` is absent.
- `data/`, `output/`, `dist/`, `node_modules/`, and `.playwright-cli/` are absent.
- No real OKX, Zhipu, FRED, SMTP, admin, app secret, wallet, or private-key values are present.
- No screenshots, logs, SQLite files, or encrypted credential stores are present.
- `npm run lint`, `npm test`, and `npm run build` pass.

## Trading Safety

- Start in OKX demo mode.
- Use minimum required API permissions.
- Do not expose this app directly to the public internet.
- Review leverage, order sizing, take-profit, and stop-loss behavior before live execution.
- This project is not financial advice.
