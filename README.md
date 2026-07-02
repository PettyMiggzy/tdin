# arb-scanner

A cross-exchange **arbitrage detector and auto-trader** for centralized crypto exchanges,
built on [CCXT](https://github.com/ccxt/ccxt). It scans many exchanges at once, finds where a
coin is cheapest to buy and most expensive to sell, computes the spread **net of both venues'
fees**, and (optionally) trades it automatically.

It ships in **paper (simulation) mode**. Live trading is a flag you deliberately arm later —
see [Going live](#going-live).

---

## What it actually does — and the honest reality

Arbitrage is legitimate: you buy low on one venue and sell high on another at the same time,
nudging the two prices back together. Nobody is deceived; the market pays you for the service.

But go in clear-eyed:

- **Obvious gaps on major pairs (BTC, ETH) get eaten in milliseconds** by professional firms
  with servers colocated inside the exchanges. Retail does not win those races.
- **Fees usually erase the gap.** A round trip costs ~0.2% in taker fees alone. When this tool
  scanned 6 live exchanges on 8 major pairs, the *best* spread was +0.098% gross → **−0.201%
  net**. It correctly placed **zero** trades. That is the normal result on liquid majors.
- **Where edges sometimes still exist:** newer / smaller / thinly-listed tokens, less-liquid
  venues, cross-chain. Bigger gaps — but bigger risk (low liquidity, frozen withdrawals, getting
  stuck holding a bag). Edit `SYMBOLS` in `.env` to point the scanner there.
- **CEX arbitrage is not atomic.** You cannot buy-here-sell-there in one transaction. The real
  model is *inventory-based*: pre-fund USDT **and** the coin on **both** exchanges so both legs
  fill instantly, then rebalance inventory periodically. This tool tracks per-venue balances so
  that drift is visible.

**Run paper mode for days first.** See whether real, profitable gaps show up for the coins you
care about before risking a cent.

---

## Quick start (paper mode — no keys, no risk)

```bash
npm install
cp .env.example .env      # defaults are fine to start
npm start
```

Open **http://localhost:3000**. The dashboard shows a live price grid, opportunities net of
fees, simulated trades, P&L, and Pause / Kill controls.

Run the offline logic tests any time with:

```bash
npm run smoke
```

---

## How it fits together

| File | Responsibility |
|------|----------------|
| `src/config.js`    | Loads `.env`; exchanges, symbols, risk limits, live-trading gate |
| `src/exchanges.js` | CCXT hub — connects venues, loads markets, fetches bid/ask + real taker fees |
| `src/detector.js`  | Finds best buy / best sell per symbol; computes spread **net of fees** |
| `src/risk.js`      | Per-trade size cap, per-cycle cap, daily-loss limit, kill switch |
| `src/executor.js`  | Two-leg execution — paper (simulated fills) and live (concurrent orders) |
| `src/engine.js`    | The scan → detect → risk-check → execute loop |
| `src/state.js`     | Central state + event stream for the dashboard |
| `src/server.js`    | Express dashboard, JSON state, SSE live feed, control endpoints |
| `public/index.html`| The dashboard UI |
| `index.js`         | Entry point / wiring |

---

## Configuration

All settings live in `.env` (copy from `.env.example`). Highlights:

| Variable | Default | Meaning |
|----------|---------|---------|
| `EXCHANGES` | 10 major venues | CCXT ids to scan (see note below) |
| `SYMBOLS` | 8 majors | Pairs to watch, e.g. `BTC/USDT,ETH/USDT` |
| `POLL_INTERVAL_MS` | `5000` | Scan frequency |
| `MIN_NET_PROFIT_PCT` | `0.3` | Minimum net spread to call a gap tradable |
| `MAX_TRADE_USD` | `100` | Max notional per trade |
| `MAX_OPEN_USD` | `500` | Max notional deployed per scan cycle |
| `DAILY_LOSS_LIMIT_USD` | `50` | Auto-stop for the day past this loss |
| `MAX_SLIPPAGE_PCT` | `0.1` | Conservative haircut per leg in paper fills |
| `PORT` | `3000` | Dashboard port |
| `MODE` | `paper` | `paper` or `live` |
| `CONFIRM_LIVE` | `false` | Must **also** be `true` to place real orders |

> **Exchange ids** are CCXT's, not brand names — e.g. Gate.io is `gate`, HTX is `htx`. Some
> venues geo-block certain server IPs (you may see `451`/`403` for `binance`/`bybit` from some
> hosts); those are skipped automatically and usually work from your own machine.

---

## The dashboard

- **Overview tiles** — realized & daily P&L, trade count, best current net spread, uptime, errors.
- **Opportunities** — every cross-venue pair with gross %, net % (after fees), and a TRADABLE flag.
- **Price grid** — every symbol × exchange; the cheapest ask (buy) is green, the highest bid
  (sell) is blue. The gap between them, minus fees, is the whole game.
- **Trades** — executed paper/live fills with per-trade net.
- **Controls** — **Pause** (stop trading, keep scanning), **Kill** (hard stop), **Reset kill**.

---

## Going live

> ⚠️ **Live mode places real orders with real money and can lose it.** Only arm it after paper
> mode has shown consistent, real profit for the coins and venues you intend to trade.

1. **Create API keys with _trade_ permission only — never _withdrawal_.** Restrict each key to
   your IP address in the exchange's API settings. If a trade-only, IP-locked key leaks, an
   attacker still cannot move your funds off the exchange.
2. Add keys to `.env` as `<EXCHANGEID>_API_KEY` / `_SECRET` / `_PASSWORD` (some venues like
   `okx`/`kucoin` need the passphrase).
3. **Fund both sides.** For inventory-based arb you need USDT *and* the coin on *both* exchanges
   you want to trade between, or a leg will fail for lack of inventory.
4. Set **both** `MODE=live` **and** `CONFIRM_LIVE=true`. Either one alone stays in paper — this
   is deliberate, so a stray env var can't start spending real money.
5. Start small: low `MAX_TRADE_USD`, a tight `DAILY_LOSS_LIMIT_USD`, and watch the first trades.

### Live execution risk

Both legs are fired **concurrently** to shrink the window where only one has filled — but that
window is never zero. If one leg errors, the engine logs a loud `MANUAL CHECK REQUIRED` and
stops; you may be left holding an open position to unwind by hand. This is inherent to
non-atomic CEX arbitrage, not a defect. Size positions accordingly.

---

## Limitations & roadmap

Current version uses **top-of-book** (best bid/ask) only, so it doesn't yet model how far into
the order book a given size would fill. Natural next steps:

- Order-book **depth** checks so `MAX_TRADE_USD` respects real liquidity.
- Automated **inventory rebalancing** across venues.
- **Triangular** arbitrage within a single exchange.
- **DEX / on-chain** legs (incl. Monad) for CEX↔DEX gaps.

---

## Disclaimer

This is software for education and personal use. Trading cryptocurrency carries substantial risk
of loss. Nothing here is financial advice. You are responsible for complying with the laws and
the exchange terms of service that apply to you.
