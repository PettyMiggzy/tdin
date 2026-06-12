import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadConfig, getConfig, updateConfig } from './config';
import { loadWallets, publicWallets, addWallet, removeWallet, getWallet } from './wallets';
import { getSolBalance } from './solana';
import { buyToken } from './buyEngine';
import { getHistory, getSpentSol, resetSpent } from './state';
import { startSniper, stopSniper, sniperStatus } from './sniper';
import { enqueueMint, getQueue, clearQueue } from './launchSource';
import type { BotConfig } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const app = express();
app.use(express.json());

loadConfig();
loadWallets();

// Default the active wallet to the first one available.
(() => {
  const cfg = getConfig();
  const w = publicWallets();
  if (!cfg.activeWallet && w.length) updateConfig({ activeWallet: w[0].pubkey });
})();

// Optional shared-secret gate for all /api routes (set DASHBOARD_TOKEN before deploying).
// Header-only (so the token can't leak into URLs/logs) and compared in constant time.
const TOKEN = process.env.DASHBOARD_TOKEN || '';
function tokenMatches(provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (!TOKEN) return next();
  if (tokenMatches(req.header('x-access-token') || undefined)) return next();
  res.status(401).json({ error: 'Unauthorized' });
});

const CONFIG_FIELDS: (keyof BotConfig)[] = [
  'amountSol', 'delayBetweenBuysSec', 'slippageBps', 'maxSpendSol',
  'priorityFeeMode', 'priorityFeeMicroLamports', 'dryRun', 'activeWallet',
  'snipeMaxBuys', 'snipePollSec',
];

app.get('/api/state', async (_req: Request, res: Response) => {
  const cfg = getConfig();
  const wallets = await Promise.all(publicWallets().map(async (w) => {
    let balanceSol: number | null = null;
    try { balanceSol = await getSolBalance(w.pubkey); } catch { balanceSol = null; }
    return { ...w, balanceSol, active: w.pubkey === cfg.activeWallet };
  }));

  res.json({
    config: cfg,
    wallets,
    sniper: sniperStatus(),
    queue: getQueue(),
    spend: { maxSpendSol: cfg.maxSpendSol, spentSol: getSpentSol() },
    history: getHistory(100),
    rpcConfigured: Boolean(process.env.SOLANA_RPC_URL),
    authRequired: Boolean(TOKEN),
  });
});

app.post('/api/config', (req: Request, res: Response) => {
  const patch: Partial<BotConfig> = {};
  for (const k of CONFIG_FIELDS) {
    if (req.body && k in req.body) (patch as Record<string, unknown>)[k] = req.body[k];
  }
  res.json({ config: updateConfig(patch) });
});

app.post('/api/wallets', (req: Request, res: Response) => {
  const { label, secret } = req.body ?? {};
  if (!secret) { res.status(400).json({ error: 'secret is required' }); return; }
  try {
    const entry = addWallet(label || '', secret);
    if (!getConfig().activeWallet) updateConfig({ activeWallet: entry.pubkey });
    res.json({ pubkey: entry.pubkey, label: entry.label });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.delete('/api/wallets/:pubkey', (req: Request, res: Response) => {
  const { pubkey } = req.params;
  if (!getWallet(pubkey)) { res.status(404).json({ error: 'Wallet not found' }); return; }
  removeWallet(pubkey);
  if (getConfig().activeWallet === pubkey) {
    const remaining = publicWallets();
    updateConfig({ activeWallet: remaining.length ? remaining[0].pubkey : null });
  }
  res.json({ ok: true });
});

app.post('/api/buy', async (req: Request, res: Response) => {
  const { mint, amountSol, walletPubkey } = req.body ?? {};
  if (!mint) { res.status(400).json({ error: 'mint is required' }); return; }
  const rec = await buyToken({
    mint: String(mint),
    amountSol: amountSol !== undefined ? Number(amountSol) : undefined,
    walletPubkey: walletPubkey ? String(walletPubkey) : undefined,
    source: 'manual',
  });
  res.json(rec);
});

app.post('/api/sniper/start', (_req: Request, res: Response) => res.json(startSniper()));
app.post('/api/sniper/stop', (_req: Request, res: Response) => res.json(stopSniper()));

app.post('/api/sniper/queue', (req: Request, res: Response) => {
  const { mint } = req.body ?? {};
  if (!mint) { res.status(400).json({ error: 'mint is required' }); return; }
  enqueueMint(String(mint));
  res.json({ queue: getQueue() });
});
app.post('/api/sniper/queue/clear', (_req: Request, res: Response) => {
  clearQueue();
  res.json({ queue: getQueue() });
});

app.post('/api/spend/reset', (_req: Request, res: Response) => {
  resetSpent();
  res.json({ spentSol: getSpentSol() });
});

app.use(express.static(PUBLIC_DIR));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log('\n  tdin · Solana buy bot dashboard');
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  RPC:      ${process.env.SOLANA_RPC_URL ? 'configured' : 'NOT SET — add SOLANA_RPC_URL to .env'}`);
  console.log(`  Dry-run:  ${getConfig().dryRun ? 'ON (simulating buys)' : 'OFF — LIVE TRADING'}`);
  console.log(`  Auth:     ${TOKEN ? 'token required' : 'OPEN — set DASHBOARD_TOKEN before deploying'}\n`);
});
