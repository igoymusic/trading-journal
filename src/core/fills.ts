// Recognizing the same execution reported twice, e.g. once in a thinkorswim CSV and again by
// broker sync, so it only counts once.

import type { Fill } from './types';

const contractKey = (f: Fill) => `${f.underlying}|${f.expiry}|${f.strike}|${f.putCall}`;

/**
 * Same contract, side, size and price, at the same time (within two minutes), or on the same day
 * when one of them only has the date.
 */
export function sameFill(a: Fill, b: Fill): boolean {
  if (contractKey(a) !== contractKey(b) || a.side !== b.side || a.quantity !== b.quantity) return false;
  if (Math.abs(a.price - b.price) > 0.0051) return false;
  if (a.execTime.slice(0, 10) !== b.execTime.slice(0, 10)) return false;
  if (a.timeExact === false || b.timeExact === false) return true;
  return Math.abs(Date.parse(`${a.execTime}Z`) - Date.parse(`${b.execTime}Z`)) <= 120_000;
}

/**
 * The incoming fills that aren't already in the journal, by id or (from another source) by
 * `sameFill`. Each existing fill can only stand in for one incoming fill, so two identical
 * trades on the same day both survive.
 */
export function newFills(incoming: Fill[], existing: Fill[]): Fill[] {
  return matchFills(incoming, existing).fresh;
}

/** Like `newFills`, also returning which existing fill each recognized duplicate matched. */
export function matchFills(incoming: Fill[], existing: Fill[]): { fresh: Fill[]; matched: { existing: Fill; incoming: Fill }[] } {
  const ids = new Set(existing.map((f) => f.id));
  const pool = new Map<string, Fill[]>();
  for (const f of existing) {
    const k = contractKey(f);
    pool.set(k, [...(pool.get(k) ?? []), f]);
  }
  const out: Fill[] = [];
  const matched: { existing: Fill; incoming: Fill }[] = [];
  for (const f of incoming) {
    if (ids.has(f.id)) continue;
    const candidates = pool.get(contractKey(f)) ?? [];
    const i = candidates.findIndex((e) => e.broker !== f.broker && sameFill(e, f));
    if (i >= 0) {
      matched.push({ existing: candidates[i], incoming: f });
      candidates.splice(i, 1);
      continue;
    }
    ids.add(f.id);
    out.push(f);
  }
  return { fresh: out, matched };
}

/**
 * Fills on the same side at the same second and price, shown as one row ("Bought 2" rather than two
 * "Bought 1" rows). `added` counts contracts closed without an opening fill that the row includes.
 */
export function groupFills<F extends Pick<Fill, 'id' | 'side' | 'price' | 'quantity' | 'execTime' | 'orderType' | 'timeExact'>>(
  shown: F[], real: { id: string; quantity: number }[],
): { fill: F; added: number }[] {
  const rows: { fill: F; added: number }[] = [];
  for (const f of shown) {
    const added = f.quantity - (real.find((x) => x.id === f.id)?.quantity ?? f.quantity);
    const last = rows[rows.length - 1];
    const same = last && last.fill.side === f.side && last.fill.price === f.price && last.fill.execTime === f.execTime
      && last.fill.orderType === f.orderType && last.fill.timeExact !== false && f.timeExact !== false;
    if (same) rows[rows.length - 1] = { fill: { ...last.fill, quantity: last.fill.quantity + f.quantity }, added: last.added + added };
    else rows.push({ fill: f, added });
  }
  return rows;
}
