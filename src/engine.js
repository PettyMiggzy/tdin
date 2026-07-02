import { POLL_INTERVAL_MS, SYMBOLS, EFFECTIVE_MODE } from './config.js';
import { scan } from './detector.js';
import { checkTrade } from './risk.js';
import { log } from './logger.js';

// The scan → detect → risk-check → execute loop.
export class Engine {
  constructor(hub, state, executor) {
    this.hub = hub;
    this.state = state;
    this.executor = executor;
    this.timer = null;
    this.busy = false; // guards against overlapping ticks on slow networks
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const quoteMap = await this.hub.fetchQuotes(SYMBOLS);
      if (!this.executor.seeded) this.executor.seedPaper(quoteMap);

      // Publish quotes for the dashboard.
      const q = {};
      for (const [s, arr] of quoteMap.entries()) q[s] = arr;
      this.state.quotes = q;
      this.state.lastScan = Date.now();

      const opps = scan(quoteMap);
      this.state.opportunities = opps;

      if (this.state.running && !this.state.killed) {
        let deployed = 0;
        for (const opp of opps) {
          if (!opp.profitable) break; // list is sorted desc; nothing better remains
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

  start() {
    log.info(
      `Engine starting in ${EFFECTIVE_MODE.toUpperCase()} mode — `
      + `${SYMBOLS.length} symbols across ${this.hub.ids.length} exchanges every ${POLL_INTERVAL_MS}ms.`,
    );
    this.tick();
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
