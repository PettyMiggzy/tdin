import { PublicKey } from '@solana/web3.js';
import { getConfig } from './config';
import { getQuote, executeSwap } from './jupiter';
import { getKeypair } from './wallets';
import { addRecord, getSpentSol, addSpent } from './state';
import type { BuyRecord, BuySource } from './types';

export interface BuyParams {
  mint: string;
  amountSol?: number;       // overrides config default
  walletPubkey?: string;    // overrides active wallet
  source?: BuySource;
}

export async function buyToken(params: BuyParams): Promise<BuyRecord> {
  const cfg = getConfig();
  const amountSol = params.amountSol ?? cfg.amountSol;
  const walletPubkey = params.walletPubkey ?? cfg.activeWallet ?? '';
  const source: BuySource = params.source ?? 'manual';

  const base: BuyRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    mint: params.mint,
    amountSol,
    wallet: walletPubkey || 'none',
    status: 'failed',
    source,
  };

  if (!isValidMint((params.mint ?? '').trim())) return fail(base, 'Invalid mint address');
  if (!walletPubkey) return fail(base, 'No active wallet selected');
  if (!(amountSol > 0)) return fail(base, 'Amount must be greater than 0');

  // Enforce the spend cap for live buys only.
  if (!cfg.dryRun) {
    const spent = getSpentSol();
    if (spent + amountSol > cfg.maxSpendSol + 1e-9) {
      return fail(base, `Max-spend cap hit (${spent.toFixed(4)}/${cfg.maxSpendSol} SOL). Raise the cap or reset.`);
    }
  }

  const kp = getKeypair(walletPubkey);
  if (!kp) return fail(base, 'Active wallet not found on server');

  try {
    const quote = await getQuote(params.mint.trim(), amountSol, cfg.slippageBps);

    if (cfg.dryRun) {
      return record({ ...base, status: 'dry-run', outAmount: quote.outAmount });
    }

    const signature = await executeSwap(quote.raw, kp, {
      priorityFeeMode: cfg.priorityFeeMode,
      priorityFeeMicroLamports: cfg.priorityFeeMicroLamports,
    });
    addSpent(amountSol);
    return record({ ...base, status: 'success', signature, outAmount: quote.outAmount });
  } catch (e) {
    return fail(base, (e as Error).message);
  }
}

function record(rec: BuyRecord): BuyRecord {
  addRecord(rec);
  return rec;
}

function fail(base: BuyRecord, error: string): BuyRecord {
  return record({ ...base, status: 'failed', error });
}

function isValidMint(mint: string): boolean {
  if (mint.length < 32 || mint.length > 44) return false;
  try { new PublicKey(mint); return true; } catch { return false; }
}
