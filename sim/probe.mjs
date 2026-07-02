// Live ground-truth probe: scan once, then pull REAL order books for the top
// candidates and see how many survive a depth check at a small trade size.
// Usage: SIZE=10 MAX_SYMBOLS=300 node sim/probe.mjs
import { ExchangeHub } from '../src/exchanges.js';
import { scan } from '../src/detector.js';
import { verifyDepth } from '../src/depth.js';

const SIZE = Number(process.env.SIZE || 10);
const TOP = Number(process.env.TOP || 25);

const hub = await new ExchangeHub().init();
const symbols = hub.discoverSymbols({
  quotes: (process.env.QUOTE_CURRENCIES || 'USDT').split(','),
  minVenues: Number(process.env.MIN_VENUES || 2),
  max: Number(process.env.MAX_SYMBOLS || 300),
});
console.log(`scanning ${symbols.length} pairs across ${hub.ids.length} exchanges…`);

const { list } = scan(await hub.fetchQuotes(symbols));
const candidates = list.filter((o) => o.profitable);
console.log(`\ntop-of-book "tradable" gaps: ${candidates.length}`);
console.log(`depth-checking the top ${Math.min(candidates.length, TOP)} at $${SIZE} per leg:\n`);

let real = 0;
let checked = 0;
const survivors = [];
for (const o of candidates.slice(0, TOP)) {
  checked++;
  const v = await verifyDepth(hub, o, SIZE);
  if (!v.ok) {
    console.log(`  ✗ ${o.symbol.padEnd(13)} top ${o.netPct.toFixed(2).padStart(6)}%  →  ${v.reason}`);
    continue;
  }
  if (v.stillProfitable) {
    real++;
    survivors.push({ ...o, netPctAtSize: v.netPctAtSize, netUsd: v.netUsd });
    console.log(`  ✓ REAL   ${o.symbol.padEnd(13)} top ${o.netPct.toFixed(2).padStart(6)}%  →  at $${SIZE}: ${v.netPctAtSize.toFixed(2)}%  (+$${v.netUsd.toFixed(4)})`);
  } else {
    console.log(`  ✗ mirage ${o.symbol.padEnd(13)} top ${o.netPct.toFixed(2).padStart(6)}%  →  at $${SIZE}: ${v.netPctAtSize.toFixed(2)}%  ($${v.netUsd.toFixed(4)})`);
  }
}

console.log(`\n──────────────────────────────────────────────`);
console.log(`survived depth check at $${SIZE}: ${real} / ${checked}`);
if (survivors.length) {
  const avg = survivors.reduce((s, x) => s + x.netPctAtSize, 0) / survivors.length;
  console.log(`avg real net at $${SIZE}: ${avg.toFixed(3)}%  |  avg $ per trade: $${(survivors.reduce((s, x) => s + x.netUsd, 0) / survivors.length).toFixed(4)}`);
}
console.log(`(this is ONE snapshot — gap frequency over time drives the 24h projection)`);
process.exit(0);
