# CLAUDE.md

Guidance for AI coding agents working in this repository.

CryptoQuant AI is a local-first crypto trading system: a TypeScript core (Express backend + React dashboard) that pulls market data from Binance, scans the most liquid USDT pairs, runs rule-based strategies behind a risk engine, and executes in shadow (paper) mode or live on OKX. A Python LLM agent service is planned (see the roadmap); it does not exist yet.

## Read these first

- [docs/architecture.md](docs/architecture.md): how the system is put together, module by module, and the target architecture.
- [docs/running.md](docs/running.md): setup, configuration, running locally or in Docker, using the dashboard, troubleshooting.
- [docs/roadmap.md](docs/roadmap.md): the phased build plan, what is done, and what comes next.

Check the roadmap before starting feature work so changes fit the current phase.

## Commands

```bash
npm ci                 # install (Node 24+, npm 10+)
npm run setup          # checks Node version, creates .env from .env.example if missing
npm run dev            # dev server with Vite middleware on http://localhost:3000
npm start              # build the frontend, then run the production server
npm run lint           # TypeScript type-check (tsc --noEmit); this is the "lint" step
npm test               # Vitest: src/**/*.test.ts and server/**/*.test.ts
npm run build          # Vite production build into dist/
docker compose up -d --build   # run the core in Docker (data in the core-data volume)
```

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run lint`, `npm test`, `npm run build` on Node 24. Run all three checks before committing.

## Layout

```
server.ts                 Thin entry point: loads .env, createApp(), listen(PORT)
server/
  app.ts                  createApp(): loads stores, registers routes, serves the frontend
  env.ts, config.ts       .env loading (import first) and paths/PORT/DATA_DIR
  market/                 MarketDataProvider (Binance/OKX), public data cache, universe, macro
  trading/                Auto-trading cycle, engine (scheduler), scan targets, take-profit manager
  execution/              OKX order submission
  exchange/               OKX helpers, account normalization, proxy + connectivity status
  persistence/            SQLite (trades, strategy signals, shadow orders)
  stores/                 JSON stores (app state, risk state, logs, traces, audit)
  auth/                   Operator sessions, encrypted credential vault
  backtest/               Backtest engine and history loading
  routes/                 One register*Routes(app) per route group
  __tests__/              Server tests (API smoke, providers, scan cycle, ...)
src/
  lib/                    Pure, tested logic shared by server and UI (indicators, strategy engine,
                          universe selection, backtest validation, portfolio returns)
  app/                    React dashboard (pages/, components/, hooks/, layout/)
scripts/                  run-server.mjs (starts server.ts via tsx), setup.mjs
docs/                     Architecture, running guide, roadmap
```

## Conventions

- TypeScript without `strict`. Discriminated-union narrowing on booleans doesn't work; prefer plain optional fields.
- Pure logic goes in `src/lib/` with a colocated `*.test.ts`. Server modules import from it with relative paths.
- Server modules read `process.env` at load time. `server/env.ts` must stay the first import in `server.ts`; new modules that read env should import from `server/config.ts`.
- ES modules can't reassign an imported `let`. Export a setter function instead (see `clearCredentialStore`).
- Route handlers live in `server/routes/*` and are registered in `server/app.ts`.
- Market data must go through `server/market/public-data.ts` / the active provider (`getMarketDataProvider()`), never direct exchange calls. OKX order sizing uses `fetchOkxExecutionTickerSnapshot` (execution venue prices).
- User-facing text is English. Keep log messages plain ASCII English.
- Tests that boot the server set `DATA_DIR` to a temp dir and env vars *before* dynamically importing server modules (see `server/__tests__/api.test.ts`). Swap market data with `setMarketDataProvider(fake)`; never hit real exchanges in tests.

## Safety rules

- Shadow mode (`shadowMode: true`) is the default and must stay the default. Never change code paths so that live orders can be placed without an explicit live config and OKX credentials.
- Risk checks (daily loss, consecutive losses, leverage caps, macro gate, kill switch, portfolio slots) must not be bypassed or weakened to make a feature work.
- Never commit `.env`, `data/`, SQLite files, logs, or real keys. `.env.example` placeholders (`YOUR_..._HERE`) are ignored by `envText()`.
- Don't add network calls to tests. Binance is the default data source; tests use fake providers.

## Gotchas

- `npm run lint` is only a type-check; there is no ESLint/Prettier.
- `node:sqlite` needs Node 22.5+ (Node 24 recommended); it logs an ExperimentalWarning, which is expected.
- binance.com blocks US IPs: set `DATA_EXCHANGE=binanceus` there.
- Without OKX credentials the dashboard's account panels show "Missing OKX credentials"; scanning and shadow mode still work.
- `ADMIN_PASSWORD` in `.env` is used literally. If unset, a password is generated into `data/.admin-password`.
