import ccxt from 'ccxt';
import { EXCHANGES, EFFECTIVE_MODE, DEFAULT_TAKER_FEE } from './config.js';
import { log } from './logger.js';

// Pull API credentials for an exchange id from the environment, e.g.
// BINANCE_API_KEY / BINANCE_SECRET / BINANCE_PASSWORD.
function credsFor(id) {
  const up = id.toUpperCase();
  const apiKey = process.env[`${up}_API_KEY`];
  const secret = process.env[`${up}_SECRET`];
  const password = process.env[`${up}_PASSWORD`];
  if (apiKey && secret) return { apiKey, secret, ...(password ? { password } : {}) };
  return null;
}

// A broad set of reputable spot CEXs, used when EXCHANGES=all. Unknown ids or
// venues without bulk fetchTickers are pruned; failed loads are skipped at init.
const CURATED_ALL = [
  'binance', 'binanceus', 'kraken', 'coinbase', 'okx', 'bybit', 'kucoin', 'gate', 'mexc',
  'bitget', 'htx', 'bingx', 'cryptocom', 'gemini', 'bitstamp', 'bitfinex', 'poloniex',
  'whitebit', 'probit', 'xt', 'lbank', 'digifinex', 'coinex', 'ascendex', 'phemex', 'woo',
  'hitbtc', 'bitmart', 'bitrue', 'latoken', 'exmo', 'okcoin', 'p2b', 'coincatch', 'bigone',
  'fmfwio', 'novadax', 'timex', 'tokocrypto', 'bitvavo',
];

// Expand the requested list; 'all' → curated venues that support bulk fetchTickers.
function resolveExchangeIds(requested) {
  if (!requested.map((s) => s.toLowerCase()).includes('all')) return requested;
  return CURATED_ALL.filter((id) => {
    if (typeof ccxt[id] !== 'function') return false;
    try { return !!new ccxt[id]().has.fetchTickers; } catch { return false; }
  });
}

// Wraps a set of CCXT exchange clients and exposes unified quote fetching.
export class ExchangeHub {
  constructor() {
    this.exchanges = new Map(); // id -> ccxt instance (only successfully loaded ones)
  }

  async init() {
    const ids = resolveExchangeIds(EXCHANGES);
    log.info(`initializing ${ids.length} exchange(s)…`);
    await Promise.all(ids.map(async (id) => {
      if (typeof ccxt[id] !== 'function') {
        log.warn(`Unknown exchange id '${id}' — skipping`);
        return;
      }
      const creds = credsFor(id);
      const opts = { enableRateLimit: true, timeout: 15000 };
      // Only attach keys when live trading is actually armed.
      if (creds && EFFECTIVE_MODE === 'live') Object.assign(opts, creds);

      let ex;
      try {
        ex = new ccxt[id](opts);
      } catch (e) {
        log.warn(`init failed ${id}: ${e.message}`);
        return;
      }
      try {
        await ex.loadMarkets();
        this.exchanges.set(id, ex);
        const tag = creds && EFFECTIVE_MODE === 'live' ? ' [keys]' : '';
        log.info(`loaded ${id} (${Object.keys(ex.markets).length} markets)${tag}`);
      } catch (e) {
        log.warn(`loadMarkets failed ${id}: ${e.message}`);
      }
    }));

    if (this.exchanges.size === 0) {
      throw new Error('No exchanges could be initialized (network blocked or all ids invalid).');
    }
    return this;
  }

  get ids() { return [...this.exchanges.keys()]; }

  hasSymbol(id, symbol) {
    const ex = this.exchanges.get(id);
    return !!(ex && ex.markets && ex.markets[symbol]);
  }

  takerFee(id, symbol) {
    const ex = this.exchanges.get(id);
    const m = ex && ex.markets && ex.markets[symbol];
    const f = m && m.taker;
    return typeof f === 'number' && f >= 0 ? f : DEFAULT_TAKER_FEE;
  }

  // Discover spot pairs listed on >= minVenues connected exchanges, restricted to
  // the given quote currencies. Sorted by how many venues list them (a rough
  // liquidity/ubiquity proxy), capped to `max`.
  discoverSymbols({ quotes = ['USDT'], minVenues = 2, max = 300 } = {}) {
    const quoteSet = new Set(quotes.map((q) => q.toUpperCase()));
    const count = new Map(); // symbol -> number of venues listing it
    for (const ex of this.exchanges.values()) {
      for (const m of Object.values(ex.markets || {})) {
        if (!m || m.spot !== true || m.active === false) continue;
        if (!quoteSet.has(String(m.quote || '').toUpperCase())) continue;
        count.set(m.symbol, (count.get(m.symbol) || 0) + 1);
      }
    }
    return [...count.entries()]
      .filter(([, c]) => c >= minVenues)
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([s]) => s);
  }

  // Returns Map<symbol, Array<{ id, bid, ask, taker }>> for the requested symbols.
  // For large scans (many symbols) it pulls each venue's whole ticker set in one
  // bulk call and filters locally — far cheaper than per-symbol requests.
  async fetchQuotes(symbols) {
    const out = new Map(symbols.map((s) => [s, []]));
    const bulk = symbols.length > 40;

    await Promise.all([...this.exchanges.entries()].map(async ([id, ex]) => {
      const wanted = symbols.filter((s) => this.hasSymbol(id, s));
      if (wanted.length === 0) return;

      let tickers = {};
      try {
        if (ex.has.fetchTickers) tickers = bulk ? await ex.fetchTickers() : await ex.fetchTickers(wanted);
        else tickers = await this._perSymbol(ex, wanted);
      } catch {
        // Some venues reject a symbol list or time out on bulk — degrade gracefully.
        try {
          tickers = ex.has.fetchTickers ? await ex.fetchTickers() : await this._perSymbol(ex, wanted);
        } catch { tickers = {}; }
      }

      for (const s of wanted) {
        const t = tickers[s];
        if (!t) continue;
        const bid = Number(t.bid);
        const ask = Number(t.ask);
        if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) continue;
        out.get(s).push({ id, bid, ask, taker: this.takerFee(id, s) });
      }
    }));

    return out;
  }

  async _perSymbol(ex, symbols) {
    const tickers = {};
    for (const s of symbols) {
      try { tickers[s] = await ex.fetchTicker(s); } catch { /* skip this symbol */ }
    }
    return tickers;
  }
}
