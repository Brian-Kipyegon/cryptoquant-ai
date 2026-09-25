# Roadmap

How CryptoQuant AI is being built, from a stabilized rule-based core to an LLM agent system trading live. For the system design see [architecture.md](architecture.md).

## Goal

A multi-agent crypto trading system for 1h–1d swing trading on liquid spot pairs:

- a deterministic TypeScript core (this repo) that scans 100+ Binance pairs, applies code-enforced risk limits and executes in shadow or live mode;
- a Python agent service (LangGraph) that reasons over market, news and on-chain context with memory of past trades, checking the market every 5 minutes and running a full decision graph at least hourly;
- a dashboard showing market data and exactly what each agent saw, decided and why.

## Principles

1. **Agents propose, code disposes.** No agent places orders; every proposal passes the risk engine.
2. **Measure against a baseline.** The rule-based strategy is the benchmark. Every agent component must beat it in forward testing or it gets removed.
3. **Forward testing is the evidence.** LLM backtests are contaminated (models may remember past prices), so only paper trading after the model's training cutoff counts.
4. **Shadow first, live small.** Weeks of shadow results before real money, then 5–10% of intended capital with human approval.

## Status

| Phase | Status |
| --- | --- |
| 0. Stabilize the core | Done ([#1](https://github.com/Brian-Kipyegon/cryptoquant-ai/pull/1)) |
| 1. Binance data + universe | Done ([#2](https://github.com/Brian-Kipyegon/cryptoquant-ai/pull/2), stacked on #1) |
| 2. Baseline and dashboard v1 | Next |
| 3. Agent service + watcher | Planned |
| 4. Multi-agent graph + memory | Planned |
| 5. Forward test (+ knowledge graph) | Planned |
| 6. Live, small | After gates |

Update this table as phases land.

## Phases

### Phase 0: Stabilize the core (done)

- Split the 7,125-line `server.ts` into `server/` modules; `createApp()` for tests.
- Server tests (unit and API smoke test).
- Removed the legacy minified UI bundle and iframe panels.
- Translated all UI, strategy and server text to English; fixed mis-encoded log messages.
- Replaced Windows `.bat` launchers with `npm run setup` / `npm start`.
- Dockerfile and docker-compose.

Exit criteria met: identical API behavior, CI checks green locally.

### Phase 1: Binance data + universe (done)

- `MarketDataProvider` with Binance (default) and OKX; `DATA_EXCHANGE` selects.
- Universe of the top USDT pairs by 24h volume (default 100), refreshed hourly.
- Scan cycle covers profiles + universe with parallel fetching and stale-data checks.
- Shadow mode runs without an OKX account (paper balance).
- `/api/market/*` routes; dashboard symbol list, universe settings and data-venue status.
- Storage bounded: selective signal recording, retention pruning, coalesced JSON writes.

Exit criteria: scan loop runs on 100+ Binance pairs in shadow mode (verified with a fake provider; confirm against live Binance).

### Phase 2: Baseline and dashboard v1 (next)

- Cross-pair scoring (trend, momentum, volume, volatility, relative strength vs BTC) to rank the universe and produce a shortlist.
- 4h and 1d features for higher-timeframe trend filters.
- Extract risk checks into `server/risk/` so rule strategies and future agent proposals share one gate. New limits: correlation-cluster cap (correlation groups today only know four coins), stops never widen, per-symbol cooldown after a stop-out, total exposure cap.
- Market scanner page: sortable universe table with scores and signal flags.
- Server-Sent Events for live dashboard updates instead of polling.

Exit criteria: the baseline passes walk-forward backtests on Binance history: positive after fees, max drawdown under 25%, stable across windows.

### Phase 3: Agent service skeleton + watcher

- New `agent-service/` (Python 3.12, FastAPI, LangGraph) in this repo, run via Docker Compose.
- Core bridge: `GET /api/agent/universe`, `GET /api/agent/snapshot`, `POST /api/agent/proposals` (returns risk verdicts), `POST /api/agent/cycles`; core → agent `POST /agent/escalate`, `POST /agent/outcomes`. Shared service token, private network.
- 5-minute watcher agent (one cheap LLM call over positions and top movers) that can only escalate.
- Single portfolio-manager agent producing typed `TradeProposal`s into the risk engine.
- Agent activity page in the dashboard.

Exit criteria: proposals flow end to end in shadow mode with under 1% invalid output.

### Phase 4: Multi-agent graph + memory

- Technical, news/sentiment, on-chain and macro analysts; bull/bear debate; risk reviewer; reflection after trade close.
- Postgres + pgvector trade journal and news store; the core moves to Postgres/TimescaleDB.
- Langfuse tracing; approvals page with human approval before orders.
- Hourly full cycles plus escalations; caps on cycles per hour and per-symbol cooldowns.

Exit criteria: the graph runs in shadow mode beside baseline and single-agent ablations.

### Phase 5: Forward test (+ knowledge graph)

- At least 8 weeks of shadow results for full system vs baseline vs ablations.
- Neo4j knowledge graph only if specific relationship questions justify it.
- `BinanceSpotExecutor` with OCO take-profit/stop-loss, tested on the Binance testnet.

Exit criteria: beats the baseline and BTC after fees; max drawdown under 15%; Sharpe above 1.0; LLM cost under 20% of gross profit.

### Phase 6: Live, small

- Binance spot with 5–10% of intended capital; human approval on each trade at first.
- Then remove per-trade approval if live results track shadow results.

## Decisions needed

- [ ] Jurisdiction: Binance or Binance.US?
- [ ] Starting capital and maximum acceptable drawdown in currency terms.
- [ ] News, social and on-chain data sources, and budget.
- [ ] LLM providers and a monthly spend ceiling.
- [ ] Keep OKX as a second execution venue or drop it once Binance execution works?
- [ ] How long per-trade human approval stays on in live mode.

## Known issues and follow-ups

- GitHub Actions has no workflow runs on this repo yet; enable Actions so CI runs on PRs.
- Phase 1 has not been run against live Binance from the development sandbox (blocked there).
- Two module import cycles remain (`auth/session` ↔ `stores/app-store`; `exchange/okx*` ↔ `connectivity`); safe today, worth untangling.
- The Docker image is ~660 MB because Vite and Tailwind are runtime dependencies.
- Backtest symbol choices are still the original four pairs.
