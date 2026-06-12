/**
 * Source of "new" token mints for snipe mode.
 *
 * Two inputs, merged each poll:
 *   1) A manual queue you push mints into from the dashboard (always works).
 *   2) An optional live JSON feed via LAUNCH_FEED_URL (e.g. a new-launches API).
 *
 * Note: brand-new pump.fun tokens still on their bonding curve often have no
 * Jupiter route yet, so those buys will report "no route" until liquidity exists.
 */

let manualQueue: string[] = [];

export function enqueueMint(mint: string): void {
  const m = mint.trim();
  if (m.length >= 32 && !manualQueue.includes(m)) manualQueue.push(m);
}

export function getQueue(): string[] {
  return [...manualQueue];
}

export function clearQueue(): void {
  manualQueue = [];
}

export async function fetchNewMints(): Promise<string[]> {
  const out: string[] = [];

  // 1) drain the manual queue
  if (manualQueue.length) {
    out.push(...manualQueue);
    manualQueue = [];
  }

  // 2) optional live feed
  const url = process.env.LAUNCH_FEED_URL;
  if (url) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.ok) {
        const data: unknown = await res.json();
        const arr: unknown[] = Array.isArray(data)
          ? data
          : ((data as { coins?: unknown[]; data?: unknown[] })?.coins
            ?? (data as { data?: unknown[] })?.data
            ?? []);
        for (const c of arr) {
          const obj = c as Record<string, unknown>;
          const mint = obj.mint ?? obj.address ?? obj.tokenAddress ?? obj.ca;
          if (typeof mint === 'string' && mint.length >= 32) out.push(mint);
        }
      }
    } catch {
      // feed errors are non-fatal — the manual queue still drives snipe mode
    }
  }

  return out;
}
