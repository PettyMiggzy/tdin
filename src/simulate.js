// Monte Carlo projection of arbitrage P&L over a time window for a given bankroll.
//
// This is NOT a backtest — a true 24h backtest needs 24h of recorded gap data.
// It's a transparent model: you plug in how often you actually WIN a depth-verified
// gap, how much you capture, how often a leg fails, and the fixed cost of moving
// inventory between venues — and it shows the distribution of outcomes. Every
// assumption is explicit and overridable so you can pressure-test it yourself.

function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function poisson(rng, lambda) { // Knuth
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}
function normal(rng, mean, std) { // Box-Muller
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export const DEFAULTS = {
  bankroll: 25,
  hours: 24,
  perTradeFrac: 0.4,        // fraction of bankroll working per trade (need inventory on both sides)
  perTradeCapUsd: 500,      // absolute per-trade cap
  minOrderUsd: 5,           // exchange minimum notional; below this you simply can't trade
  winnableGapsPerHour: 1.5, // depth-verified gaps you actually WIN (after losing races to faster bots)
  capturedNetPctMean: 0.35, // % net captured on a winning trade, at your size
  capturedNetPctStd: 0.25,
  failRate: 0.25,           // fraction of attempts where a leg slips/fails into a loss
  failLossPctMean: 0.6,     // % of notional lost unwinding a failed leg
  // Inventory rebalancing. Each trade skews inventory (coin piles up on one venue,
  // USDT on the other). When the skew exhausts a side's buffer you must transfer,
  // paying a ~fixed fee. This scales with trade count and INVERSELY with bankroll —
  // the structural reason small accounts get eaten alive by fixed transfer costs.
  skewFraction: 0.35,       // fraction of trades that net-skew inventory (lower if gaps go both ways)
  rebalanceFeeUsd: 0.4,     // fixed cost per inventory transfer (very token-dependent)
  runs: 20000,
  seed: 12345,
};

export function simulate(params = {}) {
  const p = { ...DEFAULTS, ...params };
  const perTrade = Math.min(p.bankroll * p.perTradeFrac, p.perTradeCapUsd);
  const canTrade = perTrade >= p.minOrderUsd;
  const rng = makeRng(p.seed);

  const bufferPerSide = Math.max(1, p.bankroll * 0.5); // working inventory per side
  const results = new Array(p.runs);
  let rebalSum = 0;
  for (let r = 0; r < p.runs; r++) {
    let pnl = 0;
    let rebalances = 0;
    if (canTrade) {
      const n = poisson(rng, p.winnableGapsPerHour * p.hours);
      for (let i = 0; i < n; i++) {
        if (rng() < p.failRate) {
          pnl -= perTrade * Math.max(0, normal(rng, p.failLossPctMean, p.failLossPctMean * 0.5)) / 100;
        } else {
          pnl += perTrade * Math.max(0, normal(rng, p.capturedNetPctMean, p.capturedNetPctStd)) / 100;
        }
      }
      // Skew accumulates at perTrade * skewFraction per trade; every bufferPerSide
      // of accumulated skew forces one transfer.
      rebalances = Math.floor((n * p.skewFraction * perTrade) / bufferPerSide);
      pnl -= rebalances * p.rebalanceFeeUsd;
    }
    rebalSum += rebalances;
    results[r] = pnl;
  }

  results.sort((a, b) => a - b);
  const q = (x) => results[Math.max(0, Math.min(results.length - 1, Math.floor(x * (results.length - 1))))];
  const mean = results.reduce((s, x) => s + x, 0) / results.length;
  const pProfit = results.filter((x) => x > 0).length / results.length;

  const grossPerDay = canTrade
    ? p.winnableGapsPerHour * p.hours * (1 - p.failRate) * perTrade * (p.capturedNetPctMean / 100)
    : 0;
  const meanRebalances = rebalSum / p.runs;
  const rebalanceDrag = meanRebalances * p.rebalanceFeeUsd;

  return {
    params: p,
    perTrade,
    canTrade,
    mean,
    median: q(0.5),
    p5: q(0.05),
    p95: q(0.95),
    worst: results[0],
    best: results[results.length - 1],
    pProfit,
    meanPctOfBankroll: (mean / p.bankroll) * 100,
    grossPerDay,
    meanRebalances,
    rebalanceDrag,
  };
}
