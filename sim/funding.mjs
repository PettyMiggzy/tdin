// Live funding-rate scanner. Perps pay funding between longs/shorts every few
// hours; the rate differs across venues. Long the low-funding venue + short the
// high-funding venue on the SAME coin = delta-neutral, and you collect the spread.
import ccxt from 'ccxt';

const IDS = (process.env.EX || 'okx,gate,kucoin,bitget,htx,mexc,bingx,phemex,cryptocom,bybit,binance').split(',');
const hub = new Map();
await Promise.all(IDS.map(async (id) => {
  if (typeof ccxt[id] !== 'function') return;
  const ex = new ccxt[id]({ enableRateLimit: true, timeout: 15000, options: { defaultType: 'swap' } });
  try { await ex.loadMarkets(); if (ex.has.fetchFundingRates) hub.set(id, ex); } catch {}
}));
console.log(`funding data from ${hub.size} venues: ${[...hub.keys()].join(', ')}\n`);

const perps = (ex) => Object.values(ex.markets)
  .filter((m) => m.swap && m.linear && m.settle === 'USDT' && m.active !== false).map((m) => m.symbol);

const rates = new Map(); // symbol -> [{id, rate}]
await Promise.all([...hub].map(async ([id, ex]) => {
  let fr = {};
  try { fr = await ex.fetchFundingRates(perps(ex).slice(0, 300)); }
  catch { try { fr = await ex.fetchFundingRates(); } catch { return; } }
  for (const [sym, info] of Object.entries(fr)) {
    const r = Number(info.fundingRate);
    if (!Number.isFinite(r)) continue;
    if (!rates.has(sym)) rates.set(sym, []);
    rates.get(sym).push({ id, rate: r });
  }
}));

// Cross-venue spreads (delta-neutral). Assume 8h funding → 3x/day → ~1095x/yr for APR.
const APR = 1095;
const spreads = [];
for (const [sym, arr] of rates) {
  if (arr.length < 2) continue;
  let hi = arr[0]; let lo = arr[0];
  for (const q of arr) { if (q.rate > hi.rate) hi = q; if (q.rate < lo.rate) lo = q; }
  const spread = hi.rate - lo.rate;
  if (spread <= 0) continue;
  spreads.push({ sym, shortOn: hi.id, longOn: lo.id, venues: arr.length, spread, apr: spread * APR * 100 });
}
spreads.sort((a, b) => b.spread - a.spread);

console.log(`Top delta-neutral funding spreads (${rates.size} perps scanned):`);
console.log('  pair              short on      long on      venues   spread/8h   ~APR (neutral)');
console.log('  ' + '-'.repeat(82));
for (const s of spreads.slice(0, 15)) {
  console.log('  ' + s.sym.padEnd(17) + s.shortOn.padEnd(13) + s.longOn.padEnd(13)
    + String(s.venues).padStart(4) + '     ' + (s.spread * 100).toFixed(4).padStart(8) + '%   ' + s.apr.toFixed(1).padStart(7) + '%');
}
console.log('\n(APR assumes 8h funding intervals; real intervals vary 1-8h. Delta-neutral = no directional bet;');
console.log(' risks: funding flips, both legs need margin, liquidation if under-collateralized, exchange risk.)');
