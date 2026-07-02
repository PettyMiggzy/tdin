// Offline smoke test — exercises the detection + paper-execution core with
// synthetic quotes, no network. Run with: npm run smoke
import assert from 'node:assert';
import { State } from '../src/state.js';
import { Executor } from '../src/executor.js';
import { ExchangeHub } from '../src/exchanges.js';
import { scan, findOpportunity } from '../src/detector.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`FAIL  ${name}: ${e.message}`); }
};

// A stub hub is enough for the paper path (no network calls).
const hub = { ids: ['alpha', 'beta'], exchanges: new Map([['alpha', {}], ['beta', {}]]) };

const quoteMap = new Map([
  ['BTC/USDT', [
    { id: 'alpha', bid: 60000, ask: 60010, taker: 0.001 },
    { id: 'beta', bid: 61000, ask: 61010, taker: 0.001 }, // clear ~1.6% gross gap
  ]],
  ['ETH/USDT', [
    { id: 'alpha', bid: 3000, ask: 3000.5, taker: 0.001 },
    { id: 'beta', bid: 3000.2, ask: 3000.7, taker: 0.001 }, // tiny gap, fees eat it
  ]],
]);

check('detector picks lowest ask to buy and highest bid to sell', () => {
  const o = findOpportunity('BTC/USDT', quoteMap.get('BTC/USDT'));
  assert(o, 'expected an opportunity');
  assert.equal(o.buyEx, 'alpha');
  assert.equal(o.sellEx, 'beta');
  assert(o.profitable, 'expected profitable after fees');
  assert(o.netPct < o.grossPct, 'net must be below gross');
});

check('detector rejects a gap that fees erase', () => {
  const o = findOpportunity('ETH/USDT', quoteMap.get('ETH/USDT'));
  assert(o, 'still returns the pair');
  assert.equal(o.profitable, false, 'ETH gap should not be profitable');
});

check('detector ignores single-venue symbols', () => {
  assert.equal(findOpportunity('X/USDT', [{ id: 'alpha', bid: 1, ask: 2, taker: 0.001 }]), null);
});

check('scan sorts by net profit desc', () => {
  const { list: opps } = scan(quoteMap);
  assert(opps.length >= 1);
  for (let i = 1; i < opps.length; i++) assert(opps[i - 1].netPct >= opps[i].netPct);
});

check('scan drops a 2-venue ticker collision entirely', () => {
  const qm = new Map([['BANANA/USDT', [
    { id: 'latoken', bid: 0.0000001, ask: 0.0000002, taker: 0.001 }, // different token, same ticker
    { id: 'gate', bid: 50, ask: 50.1, taker: 0.001 },
  ]]]);
  const { list } = scan(qm);
  assert(!list.find((o) => o.symbol === 'BANANA/USDT'), 'ticker-collision pair must not appear as an opportunity');
});

check('scan flags an absurd spread as suspicious, keeps the sane cluster clean', () => {
  const qm = new Map([['JUNK/USDT', [
    { id: 'a', bid: 1.00, ask: 1.01, taker: 0.001 },
    { id: 'b', bid: 1.004, ask: 1.014, taker: 0.001 },
    { id: 'c', bid: 5000, ask: 5001, taker: 0.001 }, // broken feed
  ]]]);
  const { list, suspicious } = scan(qm);
  const j = list.find((o) => o.symbol === 'JUNK/USDT');
  if (j) assert(j.grossPct < 5, 'outlier feed should have been filtered out');
  assert(suspicious === 0, 'a sane cluster with one dropped outlier is not itself suspicious');
});

check('paper execution books a profit and updates balances', () => {
  const state = new State();
  const ex = new Executor(hub, state);
  ex.seedPaper(quoteMap);
  const opp = findOpportunity('BTC/USDT', quoteMap.get('BTC/USDT'));
  const before = state.balances.alpha.USDT;
  const res = ex._paper(opp, 100 / opp.buyPrice, 'BTC', 'USDT');
  assert(res.ok, 'execution should succeed: ' + (res.reason || ''));
  assert(state.realizedPnl > 0, 'expected positive realized pnl');
  assert(state.balances.alpha.USDT < before, 'buy leg should spend USDT on alpha');
  assert.equal(state.trades.length, 1);
});

check('paper execution blocks when inventory is missing', () => {
  const state = new State();
  const ex = new Executor(hub, state);
  ex.seedPaper(quoteMap);
  ex.paper.beta.BTC = 0; // no coin to sell on beta
  const opp = findOpportunity('BTC/USDT', quoteMap.get('BTC/USDT'));
  const res = ex._paper(opp, 100 / opp.buyPrice, 'BTC', 'USDT');
  assert.equal(res.ok, false);
  assert(/insufficient BTC/.test(res.reason), 'should report missing inventory');
});

check('discoverSymbols keeps multi-venue pairs and filters by quote', () => {
  const hub = new ExchangeHub();
  const spot = (symbol, quote) => ({ symbol, quote, spot: true, active: true });
  hub.exchanges = new Map([
    ['a', { markets: { 'BTC/USDT': spot('BTC/USDT', 'USDT'), 'FOO/BTC': spot('FOO/BTC', 'BTC') } }],
    ['b', { markets: { 'BTC/USDT': spot('BTC/USDT', 'USDT'), 'ZZZ/USDT': spot('ZZZ/USDT', 'USDT') } }],
    ['c', { markets: { 'BTC/USDT': spot('BTC/USDT', 'USDT') } }],
  ]);
  const syms = hub.discoverSymbols({ quotes: ['USDT'], minVenues: 2, max: 100 });
  assert(syms.includes('BTC/USDT'), 'BTC/USDT on 3 venues should be kept');
  assert(!syms.includes('ZZZ/USDT'), 'single-venue pair should be dropped');
  assert(!syms.includes('FOO/BTC'), 'non-USDT quote should be filtered out');
  assert.equal(syms[0], 'BTC/USDT', 'most-listed pair should sort first');
});

console.log(failures ? `\n${failures} test(s) failed` : '\nSMOKE OK — all core checks passed');
process.exit(failures ? 1 : 0);
