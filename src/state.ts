import type { BuyRecord } from './types';

const history: BuyRecord[] = [];
let spentSol = 0;

export function addRecord(rec: BuyRecord): void {
  history.unshift(rec);
  if (history.length > 500) history.pop();
}

export function getHistory(limit = 100): BuyRecord[] {
  return history.slice(0, limit);
}

export function getSpentSol(): number {
  return spentSol;
}

export function addSpent(n: number): void {
  spentSol += n;
}

export function resetSpent(): void {
  spentSol = 0;
}
