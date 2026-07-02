// Offline smoke test — exercises the detection + paper-execution core with
// synthetic quotes, no network. Run with: npm run smoke
import assert from 'node:assert';
import { State } from '../src/state.js';
import { Executor } from '../src/executor.js';
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
  const opps = scan(quoteMap);
  assert(opps.length >= 1);
  for (let i = 1; i < opps.length; i++) assert(opps[i - 1].netPct >= opps[i].netPct);
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

console.log(failures ? `\n${failures} test(s) failed` : '\nSMOKE OK — all core checks passed');
process.exit(failures ? 1 : 0);
