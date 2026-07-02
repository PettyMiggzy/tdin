import { EFFECTIVE_MODE, MAX_SLIPPAGE_PCT, PAPER_START_USDT, PAPER_SEED_INVENTORY_USD } from './config.js';
import { log } from './logger.js';

const split = (symbol) => { const [base, quote] = symbol.split('/'); return { base, quote }; };

// Executes the two legs of an arbitrage trade.
//
// CEX arbitrage is NOT atomic: you can't buy-here-sell-there in one transaction.
// The realistic model is inventory-based — you pre-fund USDT *and* the coin on
// both exchanges, so when A is cheaper than B you BUY on A (spend USDT, gain coin)
// and SELL on B (spend coin, gain USDT) at the same time. Inventory drifts over
// time and must be rebalanced; this executor tracks per-venue balances so that
// drift is visible instead of silent.
export class Executor {
  constructor(hub, state) {
    this.hub = hub;
    this.state = state;
    this.paper = {}; // id -> { CURRENCY: amount }
    this.seeded = false;
  }

  // Seed simulated balances once, using first-observed prices to value inventory.
  seedPaper(quoteMap) {
    for (const id of this.hub.ids) {
      this.paper[id] = this.paper[id] || {};
      if (this.paper[id].USDT === undefined) this.paper[id].USDT = PAPER_START_USDT;
    }
    for (const [symbol, quotes] of quoteMap.entries()) {
      const { base } = split(symbol);
      for (const q of quotes) {
        this.paper[q.id] = this.paper[q.id] || {};
        if (this.paper[q.id][base] === undefined) {
          const mid = (q.bid + q.ask) / 2;
          this.paper[q.id][base] = mid > 0 ? PAPER_SEED_INVENTORY_USD / mid : 0;
        }
      }
    }
    this.seeded = true;
    this._syncBalances();
  }

  _syncBalances() {
    this.state.balances = JSON.parse(JSON.stringify(this.paper));
  }

  async execute(opp, sizeUsd) {
    const { base, quote } = split(opp.symbol);
    const qty = sizeUsd / opp.buyPrice; // size in base coin
    if (EFFECTIVE_MODE === 'live') return this._live(opp, qty, base, quote);
    return this._paper(opp, qty, base, quote);
  }

  _paper(opp, qty, base, quote) {
    const slip = MAX_SLIPPAGE_PCT / 100;
    const buyPx = opp.buyPrice * (1 + slip);   // pessimistic: pay a touch more
    const sellPx = opp.sellPrice * (1 - slip); // pessimistic: receive a touch less
    const buyCost = qty * buyPx * (1 + opp.buyFee);       // USDT spent on buy leg
    const sellProceeds = qty * sellPx * (1 - opp.sellFee); // USDT gained on sell leg

    const buyAcct = this.paper[opp.buyEx];
    const sellAcct = this.paper[opp.sellEx];
    if (!buyAcct || (buyAcct[quote] || 0) < buyCost) {
      return { ok: false, reason: `insufficient ${quote} on ${opp.buyEx} (need ${buyCost.toFixed(2)})` };
    }
    if (!sellAcct || (sellAcct[base] || 0) < qty) {
      return { ok: false, reason: `insufficient ${base} inventory on ${opp.sellEx} (need ${qty.toFixed(6)}) — rebalance` };
    }

    // Apply both legs.
    buyAcct[quote] -= buyCost;
    buyAcct[base] = (buyAcct[base] || 0) + qty;
    sellAcct[base] -= qty;
    sellAcct[quote] = (sellAcct[quote] || 0) + sellProceeds;

    const notional = qty * buyPx;
    const netUsd = sellProceeds - buyCost;
    const tr = {
      ts: Date.now(), mode: 'paper', symbol: opp.symbol,
      buyEx: opp.buyEx, sellEx: opp.sellEx,
      qty, buyPx, sellPx, sizeUsd: notional,
      netUsd, netPct: notional > 0 ? (netUsd / notional) * 100 : 0,
    };
    this.state.recordTrade(tr);
    this._syncBalances();
    log.trade(`PAPER ${opp.symbol}: buy ${opp.buyEx}@${buyPx.toFixed(4)} / sell ${opp.sellEx}@${sellPx.toFixed(4)} qty ${qty.toFixed(6)} => ${netUsd >= 0 ? '+' : ''}${netUsd.toFixed(3)} ${quote}`);
    return { ok: true, trade: tr };
  }

  async _live(opp, qty, base, quote) {
    const buyEx = this.hub.exchanges.get(opp.buyEx);
    const sellEx = this.hub.exchanges.get(opp.sellEx);
    if (!buyEx || !sellEx) return { ok: false, reason: 'exchange unavailable for live order' };
    if (!buyEx.apiKey || !sellEx.apiKey) {
      return { ok: false, reason: `missing API keys for ${opp.buyEx} or ${opp.sellEx}` };
    }

    // Fire both legs concurrently to minimize the window where only one is filled.
    let buyOrder;
    let sellOrder;
    try {
      [buyOrder, sellOrder] = await Promise.all([
        buyEx.createOrder(opp.symbol, 'market', 'buy', qty),
        sellEx.createOrder(opp.symbol, 'market', 'sell', qty),
      ]);
    } catch (e) {
      log.error(`LIVE order error on ${opp.symbol}: ${e.message}. MANUAL CHECK REQUIRED — one leg may have filled, leaving an open position.`);
      return { ok: false, reason: `live order failed: ${e.message}` };
    }

    const buyCost = buyOrder.cost ?? qty * opp.buyPrice;
    const sellProceeds = sellOrder.cost ?? qty * opp.sellPrice;
    const netUsd = sellProceeds - buyCost;
    const tr = {
      ts: Date.now(), mode: 'live', symbol: opp.symbol,
      buyEx: opp.buyEx, sellEx: opp.sellEx, qty,
      buyPx: buyOrder.average ?? opp.buyPrice,
      sellPx: sellOrder.average ?? opp.sellPrice,
      sizeUsd: buyCost, netUsd, netPct: buyCost > 0 ? (netUsd / buyCost) * 100 : 0,
      buyOrderId: buyOrder.id, sellOrderId: sellOrder.id,
    };
    this.state.recordTrade(tr);
    log.trade(`LIVE ${opp.symbol}: buy ${opp.buyEx} / sell ${opp.sellEx} qty ${qty.toFixed(6)} => ${netUsd >= 0 ? '+' : ''}${netUsd.toFixed(3)} ${quote}`);
    return { ok: true, trade: tr };
  }
}
