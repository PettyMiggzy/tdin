import { getConfig } from './config';
import { buyToken } from './buyEngine';
import { fetchNewMints } from './launchSource';

interface SniperState {
  running: boolean;
  startedAt: number | null;
  buysThisRun: number;
  seen: Set<string>;
  lastError?: string;
  lastPoll?: number;
}

const state: SniperState = {
  running: false,
  startedAt: null,
  buysThisRun: 0,
  seen: new Set<string>(),
};

let timer: ReturnType<typeof setTimeout> | null = null;
let busy = false;

export function sniperStatus() {
  return {
    running: state.running,
    startedAt: state.startedAt,
    buysThisRun: state.buysThisRun,
    seenCount: state.seen.size,
    lastError: state.lastError ?? null,
    lastPoll: state.lastPoll ?? null,
  };
}

export function startSniper() {
  if (state.running) return sniperStatus();
  state.running = true;
  state.startedAt = Date.now();
  state.buysThisRun = 0;
  state.lastError = undefined;
  schedule(0);
  return sniperStatus();
}

export function stopSniper() {
  state.running = false;
  if (timer) { clearTimeout(timer); timer = null; }
  return sniperStatus();
}

function schedule(delayMs: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void loop(); }, delayMs);
}

async function loop(): Promise<void> {
  if (!state.running) return;
  const cfg = getConfig();

  if (busy) { schedule(cfg.snipePollSec * 1000); return; }
  busy = true;
  try {
    state.lastPoll = Date.now();

    if (state.buysThisRun >= cfg.snipeMaxBuys) {
      state.lastError = `Reached snipe limit (${cfg.snipeMaxBuys}). Sniper stopped.`;
      state.running = false;
      return;
    }

    const mints = await fetchNewMints();
    for (const mint of mints) {
      if (!state.running) break;
      if (state.seen.has(mint)) continue;
      state.seen.add(mint);
      if (state.buysThisRun >= cfg.snipeMaxBuys) break;

      const rec = await buyToken({ mint, source: 'sniper' });
      if (rec.status === 'success' || rec.status === 'dry-run') state.buysThisRun++;

      // honour the configured gap between buys
      await sleep(cfg.delayBetweenBuysSec * 1000);
    }
    state.lastError = undefined;
  } catch (e) {
    state.lastError = (e as Error).message;
  } finally {
    busy = false;
    if (state.running) schedule(getConfig().snipePollSec * 1000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
