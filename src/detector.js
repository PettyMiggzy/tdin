import { MIN_NET_PROFIT_PCT, OUTLIER_DEVIATION_PCT, MAX_SANE_SPREAD_PCT } from './config.js';

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Given quotes for one symbol, find the cheapest place to buy (lowest ask) and
// the most expensive place to sell (highest bid), then compute the spread NET of
// both venues' taker fees.
//
// First it throws out bad data: any venue whose mid-price disagrees wildly with
// the cross-venue median is dropped. That single step kills the two failure modes
// that otherwise produce fake "opportunities" — a stale/broken price feed, and two
// unrelated tokens sharing a ticker across exchanges (e.g. a 7-billion-% "gap").
export function findOpportunity(symbol, quotes) {
  if (!quotes || quotes.length < 2) return null;

  const med = median(quotes.map((q) => (q.bid + q.ask) / 2));
  const sane = med > 0
    ? quotes.filter((q) => Math.abs((q.bid + q.ask) / 2 - med) / med <= OUTLIER_DEVIATION_PCT / 100)
    : [];
  const flaggedOutliers = quotes.length - sane.length;
  if (sane.length < 2) return null; // not enough agreeing venues to trust

  let bestBuy = null;  // lowest ask  — where we buy
  let bestSell = null; // highest bid — where we sell
  for (const q of sane) {
    if (!bestBuy || q.ask < bestBuy.ask) bestBuy = q;
    if (!bestSell || q.bid > bestSell.bid) bestSell = q;
  }
  if (!bestBuy || !bestSell || bestBuy.id === bestSell.id) return null;

  const buyPrice = bestBuy.ask;
  const sellPrice = bestSell.bid;
  const grossPct = ((sellPrice - buyPrice) / buyPrice) * 100;

  const buyCost = buyPrice * (1 + bestBuy.taker);
  const sellProceeds = sellPrice * (1 - bestSell.taker);
  const netPct = ((sellProceeds - buyCost) / buyCost) * 100;

  // Even after outlier removal, an implausibly wide spread is a trap — thin, stale,
  // or un-exitable liquidity — not free money. Flag it and never auto-trade it.
  const suspicious = grossPct > MAX_SANE_SPREAD_PCT;

  return {
    symbol,
    buyEx: bestBuy.id, buyPrice, buyFee: bestBuy.taker,
    sellEx: bestSell.id, sellPrice, sellFee: bestSell.taker,
    venues: sane.length,
    flaggedOutliers,
    grossPct,
    netPct,
    suspicious,
    profitable: netPct >= MIN_NET_PROFIT_PCT && !suspicious,
    ts: Date.now(),
  };
}

// Scan every symbol. Returns { list, suspicious } where `list` is the ranked set
// of real (non-artifact) opportunities and `suspicious` counts the data traps we
// refused to rank or trade.
export function scan(quoteMap) {
  const list = [];
  let suspicious = 0;
  for (const [symbol, quotes] of quoteMap.entries()) {
    const o = findOpportunity(symbol, quotes);
    if (!o) continue;
    if (o.suspicious) { suspicious++; continue; }
    list.push(o);
  }
  list.sort((a, b) => b.netPct - a.netPct);
  return { list, suspicious };
}
