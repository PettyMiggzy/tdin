import 'dotenv/config';

// ── small parsers ────────────────────────────────────────────
const bool = (v, d = false) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(String(v).trim()));
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const list = (v, d = []) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : d);

// ── venues & pairs ───────────────────────────────────────────
export const EXCHANGES = list(process.env.EXCHANGES, [
  'binance', 'kraken', 'coinbase', 'okx', 'bybit', 'kucoin', 'gate', 'mexc', 'bitget', 'htx',
]);

export const SYMBOLS = list(process.env.SYMBOLS, [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT', 'LTC/USDT', 'AVAX/USDT', 'LINK/USDT',
]);

export const POLL_INTERVAL_MS = num(process.env.POLL_INTERVAL_MS, 5000);

// ── strategy / risk ──────────────────────────────────────────
export const MIN_NET_PROFIT_PCT = num(process.env.MIN_NET_PROFIT_PCT, 0.3);
export const MAX_TRADE_USD = num(process.env.MAX_TRADE_USD, 100);
export const MAX_OPEN_USD = num(process.env.MAX_OPEN_USD, 500);
export const DAILY_LOSS_LIMIT_USD = num(process.env.DAILY_LOSS_LIMIT_USD, 50);
export const MAX_SLIPPAGE_PCT = num(process.env.MAX_SLIPPAGE_PCT, 0.1);
export const DEFAULT_TAKER_FEE = num(process.env.DEFAULT_TAKER_FEE, 0.001);

// ── paper accounting ─────────────────────────────────────────
export const PAPER_START_USDT = num(process.env.PAPER_START_USDT, 1000);
export const PAPER_SEED_INVENTORY_USD = num(process.env.PAPER_SEED_INVENTORY_USD, 500);

// ── dashboard ────────────────────────────────────────────────
export const SERVER_PORT = num(process.env.PORT, 3000);

// ── live-trading gate ────────────────────────────────────────
// Real orders are placed ONLY when MODE=live AND CONFIRM_LIVE=true.
// Any other combination is forced to paper so a stray env var can't
// start spending real money.
export const MODE = /^live$/i.test((process.env.MODE || 'paper').trim()) ? 'live' : 'paper';
export const CONFIRM_LIVE = bool(process.env.CONFIRM_LIVE, false);
export const LIVE_ARMED = MODE === 'live' && CONFIRM_LIVE;
export const EFFECTIVE_MODE = LIVE_ARMED ? 'live' : 'paper';
