// One chart per day and ticker: every trade's fills on the underlying together.

import { tradeDay } from './calendar';
import { isCounted, type Trade } from './types';

/** The tickers traded on a day, most-traded first. */
export function dayTickers(trades: Trade[], date: string): string[] {
  const counts = new Map<string, number>();
  for (const t of trades) if (tradeDay(t) === date) counts.set(t.underlying, (counts.get(t.underlying) ?? 0) + 1);
  return [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
}

export interface DayChartTrade {
  /** All of the day's fills on this ticker, shaped like one trade so the trade chart can draw it. */
  trade: Trade;
  /** Fills that opened a position (drawn as entries); the rest are exits. */
  entryIds: Set<string>;
  /** Short contract name per fill, e.g. "580C", to tell trades apart on the chart. */
  contract: Map<string, string>;
}

export function dayChartTrade(trades: Trade[], date: string, underlying: string): DayChartTrade | null {
  const picked = trades.filter((t) => tradeDay(t) === date && t.underlying === underlying);
  if (!picked.length) return null;
  const entryIds = new Set<string>();
  const contract = new Map<string, string>();
  for (const t of picked) {
    const entrySide = t.direction === 'LONG' ? 'BUY' : 'SELL';
    for (const f of t.fills) {
      if (f.side === entrySide) entryIds.add(f.id);
      contract.set(f.id, `${f.strike}${f.putCall === 'CALL' ? 'C' : 'P'}`);
    }
  }
  const fills = picked.flatMap((t) => t.fills).sort((a, b) => a.execTime.localeCompare(b.execTime));
  const first = picked[0];
  return {
    trade: {
      ...first,
      id: `day:${date}:${underlying}`,
      openTime: fills[0].execTime,
      closeTime: fills[fills.length - 1].execTime,
      status: 'CLOSED',
      fills,
      netPnl: picked.filter(isCounted).reduce((a, t) => a + t.netPnl, 0),
      journal: undefined,
    },
    entryIds,
    contract,
  };
}
