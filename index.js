import { ExchangeHub } from './src/exchanges.js';
import { State } from './src/state.js';
import { Executor } from './src/executor.js';
import { Engine } from './src/engine.js';
import { startServer } from './src/server.js';
import { log } from './src/logger.js';
import {
  MODE, CONFIRM_LIVE, EFFECTIVE_MODE,
  SYMBOLS, AUTO_SYMBOLS, QUOTE_CURRENCIES, MIN_VENUES, MAX_SYMBOLS,
} from './src/config.js';

async function main() {
  log.info('Booting arbitrage engine…');

  if (MODE === 'live' && !CONFIRM_LIVE) {
    log.warn('MODE=live but CONFIRM_LIVE!=true → forcing PAPER. Set CONFIRM_LIVE=true to arm real trading.');
  }
  if (EFFECTIVE_MODE === 'live') {
    log.warn('⚠  LIVE TRADING ARMED — real orders will be placed with real funds.');
  }

  const hub = await new ExchangeHub().init();

  let symbols = SYMBOLS;
  if (AUTO_SYMBOLS) {
    symbols = hub.discoverSymbols({ quotes: QUOTE_CURRENCIES, minVenues: MIN_VENUES, max: MAX_SYMBOLS });
    log.info(`auto-discovered ${symbols.length} pairs quoted in [${QUOTE_CURRENCIES.join(', ')}] on ≥${MIN_VENUES} venues`);
  }
  if (symbols.length === 0) throw new Error('No symbols to scan — check SYMBOLS / QUOTE_CURRENCIES / MIN_VENUES.');

  const state = new State();
  const executor = new Executor(hub, state);
  const engine = new Engine(hub, state, executor, symbols);

  startServer(state);
  engine.start();

  const shutdown = () => { log.warn('shutting down…'); engine.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  log.error(`fatal: ${e.stack || e.message}`);
  process.exit(1);
});
