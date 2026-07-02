// Order-book depth verification. Top-of-book (best bid/ask) lies about how much
// you can actually trade: the best ask may be $20 deep before the price jumps
// back. These helpers walk the real book to compute the true fill for a target
// size, so a "gap" can be confirmed or exposed as a mirage.

// Buy `usdTarget` worth by walking asks upward. asks = [[price, amount], ...] ascending.
export function walkBuy(asks, usdTarget) {
  let spent = 0;
  let qty = 0;
  for (const [price, amount] of asks) {
    if (!(price > 0) || !(amount > 0)) continue;
    const levelUsd = price * amount;
    const take = Math.min(usdTarget - spent, levelUsd);
    if (take <= 0) break;
    qty += take / price;
    spent += take;
    if (spent >= usdTarget - 1e-9) break;
  }
  return { spent, qty, filled: spent >= usdTarget - 1e-6, vwap: qty > 0 ? spent / qty : 0 };
}

// Sell `qtyTarget` of the coin by walking bids downward. bids = [[price, amount], ...] descending.
export function walkSell(bids, qtyTarget) {
  let got = 0;
  let sold = 0;
  for (const [price, amount] of bids) {
    if (!(price > 0) || !(amount > 0)) continue;
    const take = Math.min(qtyTarget - sold, amount);
    if (take <= 0) break;
    got += take * price;
    sold += take;
    if (sold >= qtyTarget - 1e-12) break;
  }
  return { got, sold, filled: sold >= qtyTarget - 1e-9, vwap: sold > 0 ? got / sold : 0 };
}

// Fetch both books and compute the real net % achievable at `usdSize`.
// Returns { ok, netPctAtSize, netUsd, slippagePct, stillProfitable, ... } or { ok:false, reason }.
// Note: we deliberately do NOT pass a depth limit — exchanges disagree on allowed
// values (htx wants 5/10/20/150, kucoin wants 20/100, …), so we let each use its
// default, which is plenty of levels for walking a small order.
export async function verifyDepth(hub, opp, usdSize) {
  const buyEx = hub.exchanges.get(opp.buyEx);
  const sellEx = hub.exchanges.get(opp.sellEx);
  if (!buyEx || !sellEx) return { ok: false, reason: 'venue unavailable' };
  if (!buyEx.has.fetchOrderBook || !sellEx.has.fetchOrderBook) {
    return { ok: false, reason: 'order book not supported' };
  }

  let buyBook;
  let sellBook;
  try {
    [buyBook, sellBook] = await Promise.all([
      buyEx.fetchOrderBook(opp.symbol),
      sellEx.fetchOrderBook(opp.symbol),
    ]);
  } catch (e) {
    return { ok: false, reason: `book fetch failed: ${e.message}` };
  }

  const buy = walkBuy(buyBook.asks || [], usdSize);
  if (!buy.filled || buy.qty <= 0) {
    return { ok: false, reason: 'thin buy-side depth', fillableUsd: buy.spent };
  }
  const sell = walkSell(sellBook.bids || [], buy.qty);
  if (!sell.filled) {
    return { ok: false, reason: 'thin sell-side depth', fillableUsd: sell.got };
  }

  const cost = buy.spent * (1 + opp.buyFee);
  const proceeds = sell.got * (1 - opp.sellFee);
  const netUsd = proceeds - cost;
  const netPctAtSize = cost > 0 ? (netUsd / cost) * 100 : 0;

  return {
    ok: true,
    usdSize,
    vwapBuy: buy.vwap,
    vwapSell: sell.vwap,
    topNetPct: opp.netPct,        // what top-of-book claimed
    netPctAtSize,                 // what you'd actually get at this size
    slippagePct: opp.netPct - netPctAtSize,
    netUsd,
    stillProfitable: netUsd > 0,
  };
}
