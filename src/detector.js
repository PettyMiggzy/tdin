import { MIN_NET_PROFIT_PCT } from './config.js';

// Given quotes for one symbol, find the cheapest place to buy (lowest ask)
// and the most expensive place to sell (highest bid), then compute the spread
// NET of both venues' taker fees. Returns null if there's no cross-venue pair.
export function findOpportunity(symbol, quotes) {
  if (!quotes || quotes.length < 2) return null;

  let bestBuy = null;  // lowest ask  — where we buy
  let bestSell = null; // highest bid — where we sell
  for (const q of quotes) {
    if (!bestBuy || q.ask < bestBuy.ask) bestBuy = q;
    if (!bestSell || q.bid > bestSell.bid) bestSell = q;
  }
  if (!bestBuy || !bestSell || bestBuy.id === bestSell.id) return null;

  const buyPrice = bestBuy.ask;
  const sellPrice = bestSell.bid;
  const grossPct = ((sellPrice - buyPrice) / buyPrice) * 100;

  // Real cost/proceeds after taker fees on each leg.
  const buyCost = buyPrice * (1 + bestBuy.taker);
  const sellProceeds = sellPrice * (1 - bestSell.taker);
  const netPct = ((sellProceeds - buyCost) / buyCost) * 100;

  return {
    symbol,
    buyEx: bestBuy.id,
    buyPrice,
    buyFee: bestBuy.taker,
    sellEx: bestSell.id,
    sellPrice,
    sellFee: bestSell.taker,
    grossPct,
    netPct,
    profitable: netPct >= MIN_NET_PROFIT_PCT,
    ts: Date.now(),
  };
}

// Scan every symbol; return opportunities sorted by net profit, best first.
export function scan(quoteMap) {
  const opps = [];
  for (const [symbol, quotes] of quoteMap.entries()) {
    const o = findOpportunity(symbol, quotes);
    if (o) opps.push(o);
  }
  opps.sort((a, b) => b.netPct - a.netPct);
  return opps;
}
