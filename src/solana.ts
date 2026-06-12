import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

let connection: Connection | null = null;

export function getConnection(): Connection {
  if (!connection) {
    const url = process.env.SOLANA_RPC_URL;
    if (!url) throw new Error('SOLANA_RPC_URL is not set');
    connection = new Connection(url, 'confirmed');
  }
  return connection;
}

export async function getSolBalance(pubkey: string): Promise<number> {
  const conn = getConnection();
  const lamports = await conn.getBalance(new PublicKey(pubkey), 'confirmed');
  return lamports / LAMPORTS_PER_SOL;
}
