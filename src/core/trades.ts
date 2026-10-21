// Groups fills into round-trip trades: one trade per contract, from flat to flat.

import { CONTRACT_MULTIPLIER, type Fill, isCounted, type Trade } from './types';

function contractKey(f: Fill) {
  return `${f.underlying}|${f.expiry}|${f.strike}|${f.putCall}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Trades you combined by hand: each group lists the ids of trades that count as one. */
export type TradeMerges = string[][];

export function buildTrades(fills: Fill[], merges: TradeMerges = []): Trade[] {
  const sorted = [...fills].sort((a, b) => a.execTime.localeCompare(b.execTime));
  const open = new Map<string, Fill[]>();
  const positions = new Map<string, number>();
  const trades: Trade[] = [];

  for (const fill of sorted) {
    const key = contractKey(fill);
    const signed = fill.side === 'BUY' ? fill.quantity : -fill.quantity;
    const before = positions.get(key) ?? 0;
    const after = before + signed;
    const current = open.get(key) ?? [];
    current.push(fill);
    open.set(key, current);
    positions.set(key, after);
    if (after === 0) {
      trades.push(summarize(current, 'CLOSED'));
      open.delete(key);
    }
  }
  for (const remaining of open.values()) trades.push(summarize(remaining, 'OPEN'));

  return applyMerges(trades, merges).sort((a, b) => (b.closeTime ?? b.openTime).localeCompare(a.closeTime ?? a.openTime));
}

/** Replaces each group of combined trades with one trade made of all their fills. */
function applyMerges(trades: Trade[], merges: TradeMerges): Trade[] {
  if (!merges.length) return trades;
  const byId = new Map(trades.map((t) => [t.id, t]));
  const used = new Set<string>();
  const combined: Trade[] = [];
  for (const group of merges) {
    const parts = group.map((id) => byId.get(id)).filter((t): t is Trade => !!t && !used.has(t.id));
    if (parts.length < 2) continue;
    for (const t of parts) used.add(t.id);
    const fills = parts.flatMap((t) => t.fills).sort((a, b) => a.execTime.localeCompare(b.execTime));
    combined.push({ ...summarize(fills, 'AUTO'), merged: parts.map((t) => t.id).sort() });
  }
  return [...trades.filter((t) => !used.has(t.id)), ...combined];
}

/**
 * Adds a combine of `ids` to the saved groups. A trade that's already combined brings its whole
 * group along, so combining twice makes one bigger group.
 */
export function addMerge(merges: TradeMerges, ids: string[], trades: Trade[]): TradeMerges {
  const parts = new Set(ids.flatMap((id) => trades.find((t) => t.id === id)?.merged ?? [id]));
  const kept = merges.filter((g) => !g.some((id) => parts.has(id)));
  for (const g of merges) if (g.some((id) => parts.has(id))) g.forEach((id) => parts.add(id));
  return parts.size >= 2 ? [...kept, [...parts].sort()] : kept;
}

/** Undoes the combine that made trade `id`. */
export function removeMerge(merges: TradeMerges, id: string, trades: Trade[]): TradeMerges {
  const parts = trades.find((t) => t.id === id)?.merged ?? [id];
  return merges.filter((g) => !g.some((x) => parts.includes(x)));
}

/**
 * One trade from its fills. 'AUTO' (for combined trades) works out whether it's closed: it's open
 * while contracts are still held, and closed once they're all sold. If more were closed than opened
 * (say a paper position you adjusted by hand, so the opening fill never happened), the missing
 * contracts count as bought at the trade's average entry.
 */
function summarize(fills: Fill[], requested: Trade['status'] | 'AUTO'): Trade {
  const first = fills[0];
  const direction = first.side === 'BUY' ? 'LONG' : 'SHORT';
  const entrySide = direction === 'LONG' ? 'BUY' : 'SELL';

  let position = 0;
  let maxContracts = 0;
  let entryQty = 0, entryCost = 0, exitQty = 0, exitCost = 0, cash = 0, fees = 0;
  for (const f of fills) {
    position += f.side === 'BUY' ? f.quantity : -f.quantity;
    maxContracts = Math.max(maxContracts, Math.abs(position));
    const dollars = f.price * f.quantity * CONTRACT_MULTIPLIER;
    cash += f.side === 'SELL' ? dollars : -dollars;
    fees += f.fees;
    if (f.side === entrySide) { entryQty += f.quantity; entryCost += dollars; }
    else { exitQty += f.quantity; exitCost += dollars; }
  }

  let status: Trade['status'] = requested === 'AUTO' ? 'CLOSED' : requested;
  let assumed = 0;
  if (requested === 'AUTO') {
    // Contracts still held (positive) or closed without an opening fill (negative).
    const held = position * (direction === 'LONG' ? 1 : -1);
    if (held > 0) status = 'OPEN';
    if (held < 0 && entryQty) {
      assumed = -held;
      const perContract = entryCost / entryQty;
      entryQty += assumed;
      entryCost += assumed * perContract;
      cash += (direction === 'LONG' ? -1 : 1) * assumed * perContract;
      // As if they'd all been opened together.
      maxContracts = Math.max(maxContracts, entryQty);
    }
  }

  // While a trade is open, only the closed contracts have a realized result.
  const avgEntry = entryQty ? entryCost / entryQty : 0;
  const avgExit = exitQty ? exitCost / exitQty : undefined;
  const grossPnl = status === 'CLOSED'
    ? cash
    : (avgExit === undefined ? 0 : (direction === 'LONG' ? 1 : -1) * (avgExit - avgEntry) * exitQty);

  return {
    id: `${first.id}`,
    underlying: first.underlying,
    expiry: first.expiry,
    strike: first.strike,
    putCall: first.putCall,
    direction,
    openTime: first.execTime,
    closeTime: status === 'CLOSED' ? fills[fills.length - 1].execTime : undefined,
    status,
    maxContracts,
    avgEntry: round2(avgEntry),
    avgExit: avgExit === undefined ? undefined : round2(avgExit),
    grossPnl: round2(grossPnl),
    fees: round2(fees),
    netPnl: round2(grossPnl - fees),
    fills,
    ...(fills.some((f) => f.account) ? { account: fills.find((f) => f.account)!.account } : {}),
    ...(assumed ? { assumedContracts: assumed } : {}),
  };
}

export interface Summary {
  netPnl: number;
  grossPnl: number;
  fees: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
}

export function summarizeTrades(trades: Trade[]): Summary {
  const closed = trades.filter((t) => t.status === 'CLOSED' && isCounted(t));
  const wins = closed.filter((t) => t.netPnl > 0);
  const losses = closed.filter((t) => t.netPnl < 0);
  const sum = (ts: Trade[], f: (t: Trade) => number) => ts.reduce((a, t) => a + f(t), 0);
  const grossWin = sum(wins, (t) => t.netPnl);
  const grossLoss = Math.abs(sum(losses, (t) => t.netPnl));
  return {
    netPnl: round2(sum(closed, (t) => t.netPnl)),
    grossPnl: round2(sum(closed, (t) => t.grossPnl)),
    fees: round2(sum(closed, (t) => t.fees)),
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    avgWin: wins.length ? round2(grossWin / wins.length) : 0,
    avgLoss: losses.length ? round2(-grossLoss / losses.length) : 0,
    profitFactor: grossLoss ? Math.round((grossWin / grossLoss) * 100) / 100 : 0,
  };
}
