import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { BotConfig, PriorityFeeMode } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

function envNum(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function envBool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return def;
  return v === '1' || v.toLowerCase() === 'true';
}

const defaults: BotConfig = {
  amountSol: envNum('DEFAULT_AMOUNT_SOL', 0.01),
  delayBetweenBuysSec: envNum('DEFAULT_DELAY_SEC', 3),
  slippageBps: envNum('DEFAULT_SLIPPAGE_BPS', 1000),
  maxSpendSol: envNum('MAX_SPEND_SOL', 0.5),
  priorityFeeMode: (process.env.PRIORITY_FEE_MODE === 'fixed' ? 'fixed' : 'auto') as PriorityFeeMode,
  priorityFeeMicroLamports: envNum('PRIORITY_FEE_MICROLAMPORTS', 100000),
  dryRun: envBool('DRY_RUN', true),
  activeWallet: null,
  snipeMaxBuys: envNum('SNIPE_MAX_BUYS', 5),
  snipePollSec: envNum('SNIPE_POLL_SEC', 5),
};

let current: BotConfig = { ...defaults };

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadConfig(): BotConfig {
  ensureDataDir();
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<BotConfig>;
      current = { ...defaults, ...raw };
    }
  } catch (e) {
    console.warn('Could not load config.json, using defaults:', (e as Error).message);
  }
  return current;
}

export function getConfig(): BotConfig {
  return current;
}

export function updateConfig(patch: Partial<BotConfig>): BotConfig {
  // basic sanitisation / clamping
  const next: BotConfig = { ...current, ...patch };
  next.amountSol = Math.max(0, Number(next.amountSol) || 0);
  next.delayBetweenBuysSec = Math.max(0, Number(next.delayBetweenBuysSec) || 0);
  next.slippageBps = Math.min(5000, Math.max(0, Math.floor(Number(next.slippageBps) || 0)));
  next.maxSpendSol = Math.max(0, Number(next.maxSpendSol) || 0);
  next.priorityFeeMicroLamports = Math.max(0, Math.floor(Number(next.priorityFeeMicroLamports) || 0));
  next.snipeMaxBuys = Math.max(0, Math.floor(Number(next.snipeMaxBuys) || 0));
  next.snipePollSec = Math.max(1, Math.floor(Number(next.snipePollSec) || 1));
  next.priorityFeeMode = next.priorityFeeMode === 'fixed' ? 'fixed' : 'auto';
  next.dryRun = Boolean(next.dryRun);
  current = next;
  saveConfig();
  return current;
}

export function saveConfig(): void {
  ensureDataDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2));
}
