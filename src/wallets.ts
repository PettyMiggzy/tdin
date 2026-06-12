import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import type { WalletEntry } from './types';
import { ensureDataDir } from './config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const WALLETS_PATH = path.join(DATA_DIR, 'wallets.json');

let wallets: WalletEntry[] = [];

/** Build a Keypair from a base58 secret key, or a JSON byte-array string. */
export function keypairFromSecret(secret: string): Keypair {
  const trimmed = secret.trim();
  if (trimmed.startsWith('[')) {
    const arr = Uint8Array.from(JSON.parse(trimmed) as number[]);
    return Keypair.fromSecretKey(arr);
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

function deriveEntry(label: string, secret: string, source: 'env' | 'file'): WalletEntry {
  const kp = keypairFromSecret(secret);
  return { label: label || 'wallet', secret: secret.trim(), pubkey: kp.publicKey.toBase58(), source };
}

export function loadWallets(): void {
  ensureDataDir();
  wallets = [];
  const seen = new Set<string>();
  const push = (label: string, secret: string, source: 'env' | 'file') => {
    try {
      const entry = deriveEntry(label, secret, source);
      if (seen.has(entry.pubkey)) return;
      seen.add(entry.pubkey);
      wallets.push(entry);
    } catch (e) {
      console.warn(`Skipping invalid wallet secret (${label}):`, (e as Error).message);
    }
  };

  if (process.env.WALLET_SECRET) push('env', process.env.WALLET_SECRET, 'env');
  if (process.env.WALLET_SECRETS) {
    process.env.WALLET_SECRETS.split(',').map(s => s.trim()).filter(Boolean)
      .forEach((s, i) => push(`env-${i + 1}`, s, 'env'));
  }

  try {
    if (fs.existsSync(WALLETS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(WALLETS_PATH, 'utf8')) as { label: string; secret: string }[];
      raw.forEach(w => push(w.label, w.secret, 'file'));
    }
  } catch (e) {
    console.warn('Could not read wallets.json:', (e as Error).message);
  }
}

/** Public view — never includes secrets. */
export function publicWallets(): { label: string; pubkey: string; source: string }[] {
  return wallets.map(w => ({ label: w.label, pubkey: w.pubkey, source: w.source }));
}

export function getWallet(pubkey: string): WalletEntry | undefined {
  return wallets.find(w => w.pubkey === pubkey);
}

export function getKeypair(pubkey: string): Keypair | undefined {
  const w = getWallet(pubkey);
  return w ? keypairFromSecret(w.secret) : undefined;
}

export function addWallet(label: string, secret: string): WalletEntry {
  const entry = deriveEntry(label || `wallet-${wallets.length + 1}`, secret, 'file');
  if (wallets.some(w => w.pubkey === entry.pubkey)) {
    throw new Error('That wallet is already loaded');
  }
  wallets.push(entry);
  persist();
  return entry;
}

export function removeWallet(pubkey: string): void {
  wallets = wallets.filter(w => w.pubkey !== pubkey);
  persist();
}

/** Persist only UI-added wallets to disk (env-seeded keys stay in env). */
function persist(): void {
  ensureDataDir();
  const data = wallets.filter(w => w.source === 'file').map(w => ({ label: w.label, secret: w.secret }));
  fs.writeFileSync(WALLETS_PATH, JSON.stringify(data, null, 2));
}
