// 24h P&L projection for a small bankroll, calibrated by the live depth probe.
// Usage: BANKROLL=25 node sim/run.mjs
import { simulate, DEFAULTS } from '../src/simulate.js';

const BANKROLL = Number(process.env.BANKROLL || 25);
const money = (n) => (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
const bar = (c = '─') => c.repeat(68);

console.log(bar('═'));
console.log(` 24h P&L projection — bankroll $${BANKROLL}, inventory-based CEX arbitrage`);
console.log(bar('═'));
console.log(`
Grounded in a LIVE depth probe (300 pairs, 31 exchanges, one snapshot):
  • ~34 top-of-book "tradable" gaps existed at that instant
  • 12 of ~20 checked SURVIVED a real $10 depth test — the rest were
    mirages (ZRO −18%, WAL −38%, GALA −13% once you walk the book)
  • survivors averaged ~1.1% net at $10  (~$0.11 per trade)

So gaps are real at $10 size. The dominant unknown is how many you actually
WIN per hour across 24h (you lose races to faster bots, and the gap can move
between depth-check and fill). We sweep that. Numbers are assumptions you can
edit in src/simulate.js.
`);

// Scenarios sweep the biggest unknown: winnable gaps per hour.
const scenarios = [
  { name: 'Pessimistic', winnableGapsPerHour: 0.5, capturedNetPctMean: 0.5, failRate: 0.35 },
  { name: 'Base', winnableGapsPerHour: 2.0, capturedNetPctMean: 0.7, failRate: 0.30 },
  { name: 'Optimistic', winnableGapsPerHour: 5.0, capturedNetPctMean: 0.9, failRate: 0.25 },
];

for (const sc of scenarios) {
  const r = simulate({ bankroll: BANKROLL, ...sc });
  const tradesDay = Math.round(sc.winnableGapsPerHour * 24);
  console.log(`${sc.name}  —  ${sc.winnableGapsPerHour} winnable gaps/h  (~${tradesDay} trades/day, ${(sc.capturedNetPctMean).toFixed(2)}% captured)`);
  if (!r.canTrade) {
    console.log(`   per-trade $${r.perTrade.toFixed(2)} is below the $${DEFAULTS.minOrderUsd} exchange minimum — can't trade.\n`);
    continue;
  }
  console.log(`   median 24h P&L : ${money(r.median)}   (${(r.median / BANKROLL * 100).toFixed(1)}% of bankroll)`);
  console.log(`   mean / range   : ${money(r.mean)}   [5th ${money(r.p5)} … 95th ${money(r.p95)}]`);
  console.log(`   P(end day up)  : ${(r.pProfit * 100).toFixed(0)}%`);
  console.log(`   breakdown/day  : gross ${money(r.grossPerDay)}  −  ~${r.meanRebalances.toFixed(0)} rebalances ${money(-r.rebalanceDrag)}  −  fail-losses`);
  console.log('');
}

console.log(bar());
console.log(' Why bankroll size matters (same "Base" activity, transfer drag shown):');
console.log(bar());
console.log('  bankroll   per-trade   median 24h P&L    P(up)    transfer drag/day');
for (const bank of [25, 100, 1000, 10000]) {
  const r = simulate({ bankroll: bank, winnableGapsPerHour: 2.0, capturedNetPctMean: 0.7, failRate: 0.30 });
  const row = `  $${String(bank).padEnd(8)} $${r.perTrade.toFixed(0).padStart(4)}       ${money(r.median).padStart(9)}      ${(r.pProfit * 100).toFixed(0).padStart(3)}%      ${money(-r.rebalanceDrag)}`;
  console.log(row + (r.canTrade ? '' : '   (below min order)'));
}

console.log(`
${bar()}
 BOTTOM LINE for $25
${bar()}
 • Gaps are REAL at $10 size — this is NOT the ticker-collision fantasy.
   The problem isn't finding gaps; it's that $25 is too small to keep.
 • In EVERY scenario the model loses money: roughly -$1 to -$7 over 24h.
   And the cruel twist — trading MORE loses MORE. Each $10 trade nets only
   ~$0.07, but every ~3 trades your inventory skews enough to force a ~$0.40
   transfer. Fixed costs swamp the tiny edge. Base case: +$2.35 gross,
   -$5.18 in rebalancing = net negative.
 • This flips entirely with size (see table): the SAME strategy is roughly
   break-even at ~$100 and clearly positive at $1k+, because the fixed
   transfer cost stops being a meaningful % of the bankroll.
 • The one escape hatch for a tiny account: trade only pairs whose gaps
   oscillate BOTH directions so inventory self-balances and you (almost)
   never transfer. That's real, but narrow and hard — marginal at best.
 • Honest verdict: $25 is a LEARNING budget, not an earning one. Run it in
   paper mode to measure your real win-rate; expect to grow the bankroll
   (or the technique) before it pays. Nothing here counts the unbuilt part:
   actually winning the execution race in real time.
`);
process.exit(0);
