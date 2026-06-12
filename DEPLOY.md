# Deploying tdin

This app **holds wallet private keys**, so treat the deploy like a hot wallet:
whoever controls the host can move your funds.

## Before you deploy — non-negotiables

1. **Set `DASHBOARD_TOKEN`** to a long random string. Without it, the API (and
   your wallet) is open to anyone who finds the URL.
2. **Keep `DRY_RUN=true`** until you've confirmed a test buy works, then flip it.
3. Use a **burner wallet** and a small **`MAX_SPEND_SOL`** at first.
4. Make sure the host allows outbound HTTPS to **`quote-api.jup.ag`** (Jupiter)
   and your RPC — buys fail without Jupiter access.

## Required env vars

| Var | Required | Notes |
|---|---|---|
| `SOLANA_RPC_URL` | ✅ | your mainnet RPC |
| `DASHBOARD_TOKEN` | ✅ (public deploy) | shared secret to reach `/api` |
| `DRY_RUN` | — | `true` to simulate (default), `false` for live |
| `WALLET_SECRET` | — | seed one wallet; otherwise add via the UI |
| `MAX_SPEND_SOL` | — | live-spend cap per session |

> Ephemeral hosts wipe `data/` on redeploy, so wallets added via the UI won't
> persist. For those, seed the wallet with `WALLET_SECRET` instead.

## Options

### Render (render.yaml included)
New → Blueprint → point at this repo → fill the `sync: false` env vars → deploy.

### Railway / Fly / Heroku-style (Procfile included)
New project from repo. Set the env vars above. Start command: `npm start`.

### Docker / any VPS (Dockerfile included)
```bash
docker build -t tdin .
docker run -p 3000:3000 --env-file .env tdin
```
Put it behind HTTPS (a reverse proxy) — never expose the raw port publicly.

## First run after deploy

1. Open the URL, enter your `DASHBOARD_TOKEN` when prompted.
2. Add/confirm your wallet, set amount / delay / slippage / max-spend.
3. Do a **dry-run** buy. When the quote looks right, set `DRY_RUN=false` and go live.
