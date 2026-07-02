import { POLL_INTERVAL_MS, EFFECTIVE_MODE, DEPTH_CHECK, DEPTH_CHECK_TOP, MAX_TRADE_USD } from './config.js';
import { scan } from './detector.js';
import { verifyDepth } from './depth.js';
import { checkTrade } from './risk.js';
import { log } from './logger.js';

// The scan → detect → risk-check → execute loop.
export class Engine {
  constructor(hub, state, executor, symbols) {
    this.hub = hub;
    this.state = state;
    this.executor = executor;
    this.symbols = symbols;
    this.timer = null;
    this.busy = false; // guards against overlapping ticks on slow networks
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const quoteMap = await this.hub.fetchQuotes(this.symbols);
      if (!this.executor.seeded) this.executor.seedPaper(quoteMap);

      // Publish quotes for the dashboard.
      const q = {};
      for (const [s, arr] of quoteMap.entries()) q[s] = arr;
      this.state.quotes = q;
      this.state.lastScan = Date.now();

      const { list: opps, suspicious } = scan(quoteMap);
      this.state.filtered = suspicious;

      // Confirm the top candidates are actually fillable at size against real books.
      if (DEPTH_CHECK) await this.verifyTop(opps);
      this.state.opportunities = opps;

      if (this.state.running && !this.state.killed) {
        let deployed = 0;
        for (const opp of opps) {
          if (!opp.profitable) break; // list is sorted desc; nothing better remains
          if (DEPTH_CHECK && !opp.fillable) continue; // top-of-book only, or thin book — don't trade it
          const chk = checkTrade(this.state, opp, deployed);
          if (!chk.ok) {
            if (chk.reason === 'per-cycle notional cap reached') break;
            continue;
          }
          const res = await this.executor.execute(opp, chk.sizeUsd);
          if (res.ok) deployed += chk.sizeUsd;
          else log.warn(`skip ${opp.symbol}: ${res.reason}`);
        }
        this.state.openExposureUsd = deployed;
      }
    } catch (e) {
      this.state.errors++;
      log.error(`tick error: ${e.message}`);
    } finally {
      this.busy = false;
      this.state.emitUpdate();
    }
  }

  // Pull real order books for the top profitable candidates and annotate each
  // with whether it's genuinely fillable at MAX_TRADE_USD (not just at the tip).
  async verifyTop(opps) {
    const top = opps.filter((o) => o.profitable).slice(0, DEPTH_CHECK_TOP);
    await Promise.all(top.map(async (o) => {
      const v = await verifyDepth(this.hub, o, MAX_TRADE_USD);
      o.depthChecked = true;
      if (v.ok) {
        o.netPctAtSize = v.netPctAtSize;
        o.fillable = v.stillProfitable;
        o.depthReason = v.stillProfitable ? null : 'unprofitable at size';
      } else {
        o.fillable = false;
        o.depthReason = v.reason;
      }
    }));
  }

  start() {
    log.info(
      `Engine starting in ${EFFECTIVE_MODE.toUpperCase()} mode — `
      + `${this.symbols.length} symbols across ${this.hub.ids.length} exchanges every ${POLL_INTERVAL_MS}ms.`,
    );
    this.tick();
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
