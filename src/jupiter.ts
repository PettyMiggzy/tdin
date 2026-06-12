import { VersionedTransaction, Keypair } from '@solana/web3.js';
import { getConnection } from './solana';
import type { PriorityFeeMode } from './types';

const WSOL = 'So11111111111111111111111111111111111111112';
const BASE = process.env.JUPITER_API_BASE || 'https://quote-api.jup.ag/v6';

export interface QuoteResult {
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string;
  raw: unknown;
}

/** Quote: how many tokens we'd get for `amountSol` of SOL. */
export async function getQuote(outputMint: string, amountSol: number, slippageBps: number): Promise<QuoteResult> {
  const amount = Math.floor(amountSol * 1e9); // SOL -> lamports
  const url = `${BASE}/quote?inputMint=${WSOL}&outputMint=${outputMint}` +
    `&amount=${amount}&slippageBps=${slippageBps}&swapMode=ExactIn`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter quote failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json() as { inAmount?: string; outAmount?: string; priceImpactPct?: string };
  if (!data || !data.outAmount) {
    throw new Error('No route found (token may have no Jupiter liquidity yet).');
  }
  return {
    inAmount: data.inAmount ?? String(amount),
    outAmount: data.outAmount,
    priceImpactPct: data.priceImpactPct,
    raw: data,
  };
}

export interface SwapOpts {
  priorityFeeMode: PriorityFeeMode;
  priorityFeeMicroLamports: number;
}

/** Build, sign, send and confirm the swap. Returns the signature. */
export async function executeSwap(quoteRaw: unknown, keypair: Keypair, opts: SwapOpts): Promise<string> {
  const conn = getConnection();
  const body: Record<string, unknown> = {
    quoteResponse: quoteRaw,
    userPublicKey: keypair.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
  };
  if (opts.priorityFeeMode === 'fixed') {
    body.computeUnitPriceMicroLamports = Math.floor(opts.priorityFeeMicroLamports);
  } else {
    body.prioritizationFeeLamports = 'auto';
  }

  const res = await fetch(`${BASE}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter swap build failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const { swapTransaction } = await res.json() as { swapTransaction?: string };
  if (!swapTransaction) throw new Error('Jupiter returned no swap transaction');

  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  tx.sign([keypair]);
  const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await confirmSignature(signature);
  return signature;
}

async function confirmSignature(signature: string, timeoutMs = 45000): Promise<void> {
  const conn = getConnection();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await conn.getSignatureStatuses([signature]);
    const info = value[0];
    if (info) {
      if (info.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(info.err)}`);
      if (info.confirmationStatus === 'confirmed' || info.confirmationStatus === 'finalized') return;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error(`Confirmation timed out for ${signature}`);
}
