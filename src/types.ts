export interface WalletEntry {
  label: string;
  secret: string; // base58 secret key — server-side only, never sent to client
  pubkey: string;
  source: 'env' | 'file';
}

export type PriorityFeeMode = 'auto' | 'fixed';

export interface BotConfig {
  amountSol: number;            // default SOL per buy
  delayBetweenBuysSec: number;  // time between buys (snipe / batch)
  slippageBps: number;          // 1000 = 10%
  maxSpendSol: number;          // cap on total live spend per session
  priorityFeeMode: PriorityFeeMode;
  priorityFeeMicroLamports: number;
  dryRun: boolean;              // simulate buys (quote only, no spend)
  activeWallet: string | null;  // pubkey of the wallet buys execute from
  snipeMaxBuys: number;         // max auto-buys per sniper run
  snipePollSec: number;         // poll interval for new launches
}

export type BuyStatus = 'success' | 'failed' | 'dry-run' | 'skipped';
export type BuySource = 'manual' | 'sniper';

export interface BuyRecord {
  id: string;
  ts: number;
  mint: string;
  amountSol: number;
  wallet: string;       // pubkey
  status: BuyStatus;
  signature?: string;
  outAmount?: string;   // raw token amount from quote
  error?: string;
  source: BuySource;
}
