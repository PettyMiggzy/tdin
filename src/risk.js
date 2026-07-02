import { MAX_TRADE_USD, MAX_OPEN_USD, DAILY_LOSS_LIMIT_USD } from './config.js';

// Gate a single opportunity before execution. Returns { ok, reason?, sizeUsd? }.
// sizeUsd is the notional we're cleared to deploy on this trade.
export function checkTrade(state, opp, deployedThisCycle = 0) {
  if (state.killed) return { ok: false, reason: 'kill switch engaged' };
  if (!state.running) return { ok: false, reason: 'engine paused' };

  state.rollDayIfNeeded();
  if (state.dailyPnl <= -Math.abs(DAILY_LOSS_LIMIT_USD)) {
    return { ok: false, reason: `daily loss limit hit (${state.dailyPnl.toFixed(2)} USD)` };
  }

  if (!opp.profitable) return { ok: false, reason: 'below min net profit' };

  // Respect the per-cycle notional cap.
  const remaining = MAX_OPEN_USD - deployedThisCycle;
  if (remaining < 1) return { ok: false, reason: 'per-cycle notional cap reached' };

  const sizeUsd = Math.min(MAX_TRADE_USD, remaining);
  return { ok: true, sizeUsd };
}
