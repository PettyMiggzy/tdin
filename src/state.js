import { EventEmitter } from 'node:events';
import { EFFECTIVE_MODE } from './config.js';

const dayKey = () => new Date().toISOString().slice(0, 10);

// Central mutable state for the engine + dashboard. Emits 'update' with a
// snapshot whenever the engine finishes a cycle or a control action fires.
export class State extends EventEmitter {
  constructor() {
    super();
    this.mode = EFFECTIVE_MODE; // 'paper' | 'live'
    this.running = true;        // engine loop trading enabled
    this.killed = false;        // hard kill switch
    this.startedAt = Date.now();
    this.lastScan = 0;

    this.quotes = {};           // symbol -> [{ id, bid, ask, taker }]
    this.opportunities = [];    // latest scan result (real, non-artifact)
    this.filtered = 0;          // data-artifact pairs rejected in the last scan
    this.trades = [];           // executed trades, newest first

    this.realizedPnl = 0;
    this.dayKey = dayKey();
    this.dailyPnl = 0;
    this.openExposureUsd = 0;

    this.balances = {};         // exchangeId -> { CURRENCY: amount }
    this.errors = 0;
  }

  rollDayIfNeeded() {
    const k = dayKey();
    if (k !== this.dayKey) { this.dayKey = k; this.dailyPnl = 0; }
  }

  recordTrade(tr) {
    this.trades.unshift(tr);
    if (this.trades.length > 300) this.trades.pop();
    this.realizedPnl += tr.netUsd;
    this.rollDayIfNeeded();
    this.dailyPnl += tr.netUsd;
  }

  snapshot() {
    return {
      mode: this.mode,
      running: this.running,
      killed: this.killed,
      startedAt: this.startedAt,
      lastScan: this.lastScan,
      quotes: this.quotes,
      opportunities: this.opportunities,
      filtered: this.filtered,
      trades: this.trades.slice(0, 50),
      realizedPnl: this.realizedPnl,
      dailyPnl: this.dailyPnl,
      openExposureUsd: this.openExposureUsd,
      balances: this.balances,
      errors: this.errors,
    };
  }

  emitUpdate() { this.emit('update', this.snapshot()); }
}
