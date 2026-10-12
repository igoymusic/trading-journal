// Risk and reward measured on the underlying's price, not the option's, to keep the math simple.
// You place stop and target levels on the underlying's chart; each level covers some contracts.
//
//   risk   = how far price could move against you, from your entry to your stops
//   reward = how far it moved in your favor (realized) or would have to your targets (planned)
//   R      = reward / risk

import type { PriceLevel, Trade, TradeJournal } from './types';

/** +1 if the trade makes money when the underlying rises (long call, short put), -1 otherwise. */
export function bias(t: Pick<Trade, 'putCall' | 'direction'>): 1 | -1 {
  return (t.putCall === 'CALL') === (t.direction === 'LONG') ? 1 : -1;
}

/** Contract-weighted average distance from `from` to each level, in the trade's favor. */
function weightedMove(levels: PriceLevel[], from: number, dir: 1 | -1): number | null {
  const total = levels.reduce((a, l) => a + l.contracts, 0);
  if (!levels.length || total <= 0) return null;
  return levels.reduce((a, l) => a + (l.contracts / total) * dir * (l.price - from), 0);
}

export interface RiskReward {
  /** Underlying points at risk per share (always positive). */
  risk: number;
  /** R earned by the actual exit, if the trade has closed. */
  realizedR?: number;
  /** R the targets would have paid, if targets are set. */
  plannedR?: number;
}

/**
 * R for a trade from its stops and targets. Null when there's no stop, or the stops sit on the
 * wrong side of the entry (they wouldn't limit a loss).
 */
export function riskReward(trade: Pick<Trade, 'putCall' | 'direction'>, j: TradeJournal | undefined): RiskReward | null {
  if (!j?.stops?.length || j.underlyingEntry === undefined) return null;
  const dir = bias(trade);
  const toStops = weightedMove(j.stops, j.underlyingEntry, dir);
  if (toStops === null || toStops >= 0) return null;
  const risk = -toStops;
  const out: RiskReward = { risk };
  if (j.underlyingExit !== undefined) out.realizedR = (dir * (j.underlyingExit - j.underlyingEntry)) / risk;
  const toTargets = j.targets?.length ? weightedMove(j.targets, j.underlyingEntry, dir) : null;
  if (toTargets !== null) out.plannedR = toTargets / risk;
  return out;
}

/** Quantity-weighted average of the underlying's price over a set of fills. */
export function averageUnderlying(fills: { quantity: number; underlying?: number }[]): number | undefined {
  const priced = fills.filter((f) => f.underlying !== undefined);
  const qty = priced.reduce((a, f) => a + f.quantity, 0);
  if (!qty) return undefined;
  return priced.reduce((a, f) => a + f.underlying! * f.quantity, 0) / qty;
}

/**
 * Stops and targets read off how you actually got out: each exit that made money after fees
 * becomes a target, each one that didn't (break-even loses the commissions) becomes a stop, at
 * the underlying's price when it filled. Exits on the wrong side of the entry for their kind
 * (e.g. a loss while the underlying moved your way, from time decay) can't be read this way and
 * are left out. Null if nothing could be identified.
 */
export function levelsFromExits(
  trade: Pick<Trade, 'putCall' | 'direction' | 'avgEntry' | 'fills'>,
  underlyingByFill: Map<string, number>,
): { stops: PriceLevel[]; targets: PriceLevel[] } | null {
  const entrySide = trade.direction === 'LONG' ? 'BUY' : 'SELL';
  const entries = trade.fills.filter((f) => f.side === entrySide);
  const entryQty = entries.reduce((a, f) => a + f.quantity, 0);
  const entryU = averageUnderlying(entries.map((f) => ({ quantity: f.quantity, underlying: underlyingByFill.get(f.id) })));
  if (!entryQty || entryU === undefined) return null;
  const entryFeePerContract = entries.reduce((a, f) => a + f.fees, 0) / entryQty;
  const dir = trade.direction === 'LONG' ? 1 : -1;
  const b = bias(trade);
  const out = { stops: [] as PriceLevel[], targets: [] as PriceLevel[] };
  for (const f of trade.fills) {
    const u = underlyingByFill.get(f.id);
    if (f.side === entrySide || u === undefined || !f.quantity) continue;
    const perContract = dir * (f.price * 100 - trade.avgEntry) - entryFeePerContract - f.fees / f.quantity;
    const kind = perContract > 0 ? 'targets' : 'stops';
    const move = b * (u - entryU);
    if (kind === 'targets' ? move <= 0 : move >= 0) continue;
    const price = Math.round(u * 100) / 100;
    const same = out[kind].find((l) => l.price === price);
    if (same) same.contracts += f.quantity;
    else out[kind].push({ price, contracts: f.quantity });
  }
  return out.stops.length || out.targets.length ? out : null;
}

/** "+1.8R" */
export function formatR(r: number): string {
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)}R`;
}
