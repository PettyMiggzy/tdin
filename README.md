# tdin — Solana auto-buy bot + dashboard

A small, self-hosted tool to **set a wallet and automate buys on Solana**. Swaps
route through [Jupiter](https://station.jup.ag/). Manual buys plus an optional
**snipe** mode, driven from a web dashboard.

Built for personal trading: **one active wallet at a time** (switchable), your
funds, your keys. It deliberately does *not* coordinate many wallets buying the
same token — that's market manipulation, not a buy bot.

## Features

- 🔑 **Switchable wallets** — add/remove wallets, pick the active one in the UI.
- 💰 **Custom amounts** — default SOL-per-buy plus per-buy override.
- ⏱️ **Custom delay** — configurable time between buys (used by snipe/batch).
- 🎯 **Manual buy** — paste a mint, buy it via Jupiter.
- 🤖 **Snipe toggle** — auto-buys mints from a queue (and an optional live feed).
- 🛟 **Safety rails** — dry-run mode (default ON), max-spend cap, slippage limit.
- 📊 **Dashboard** — balances, live config, activity log with Solscan links.

## Quick start

```bash
npm install
cp .env.example .env      # then edit SOLANA_RPC_URL (and optionally a wallet)
npm start                 # http://localhost:3000
```

1. Open the dashboard, **Add wallet** (base58 private key or JSON array). Keys
   are stored server-side in `data/wallets.json` (gitignored) — never committed.
2. Set your **amount**, **delay**, **slippage**, and **max-spend cap**.
3. Leave **Dry run ON** and do a test buy — you'll get a quote, no SOL spent.
4. When ready, turn **Dry run OFF** to trade live.

## Configuration

All values have env defaults (`.env`) and are editable live in the UI:

| Setting | Env | Notes |
|---|---|---|
| RPC URL | `SOLANA_RPC_URL` | your mainnet RPC (Alchemy/Helius/QuickNode) |
| Amount per buy | `DEFAULT_AMOUNT_SOL` | SOL spent per buy |
| Delay between buys | `DEFAULT_DELAY_SEC` | seconds |
| Slippage | `DEFAULT_SLIPPAGE_BPS` | 1000 = 10% |
| Max spend cap | `MAX_SPEND_SOL` | hard cap on live spend per session |
| Dry run | `DRY_RUN` | `true` = simulate, `false` = live |
| Dashboard token | `DASHBOARD_TOKEN` | require a token for `/api` (set before deploying) |
| Launch feed | `LAUNCH_FEED_URL` | optional JSON feed of new mints for snipe mode |

## Snipe mode

Snipe mode buys **new mints** it hasn't seen, using the active wallet, honouring
your delay and `SNIPE_MAX_BUYS` per run. Two inputs:

1. **Queue** — push mints from the dashboard (always works).
2. **Live feed** — set `LAUNCH_FEED_URL` to a JSON endpoint of recent launches.

> Brand-new pump.fun tokens still on their bonding curve often have no Jupiter
> route yet — those buys report "no route" until liquidity exists. A direct
> pump.fun bonding-curve path can be added later if you want true launch sniping.

## Security

- **Never commit keys.** `.env` and `data/` are gitignored.
- Private keys stay **server-side**; the browser only ever sees public keys.
- If you deploy this anywhere reachable, **set `DASHBOARD_TOKEN`** and put it
  behind HTTPS. A buy bot holding keys on an open port is a liability.
- Test with a **burner wallet** and small amounts first.

## Deploy

It's a plain Node server (`npm start`). Any host that runs Node 18+ works
(Render / Railway / Fly / a VPS). Set the same env vars there, and **set
`DASHBOARD_TOKEN`**. Keys live in env or `data/` on the server — choose a host
you trust with them.

## Tech

TypeScript · Express · `@solana/web3.js` · Jupiter v6 · vanilla-JS dashboard.
