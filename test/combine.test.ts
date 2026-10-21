import { describe, expect, it } from 'vitest';
import { addMerge, buildTrades, removeMerge } from '../src/core/trades';
import type { Fill } from '../src/core/types';

const fill = (id: string, time: string, side: 'BUY' | 'SELL', price: number, effect: 'OPEN' | 'CLOSE'): Fill => ({
  id, broker: 'thinkorswim', execTime: `2026-10-21T${time}`, underlying: 'SPX', expiry: '2026-10-21', strike: 7735, putCall: 'CALL',
  side, quantity: 1, positionEffect: effect, price, orderType: 'MKT', spread: 'SINGLE', fees: 0,
});

// Bought 1 and sold it, then sold 1 more that had no opening fill (an adjusted paper position).
const fills = [fill('a', '10:24:19', 'BUY', 6, 'OPEN'), fill('b', '10:33:56', 'SELL', 7.1, 'CLOSE'), fill('c', '10:47:47', 'SELL', 10.4, 'CLOSE')];

describe('combining trades', () => {
  it('shows the stray closing fill as its own open trade until combined', () => {
    const trades = buildTrades(fills);
    expect(trades.map((t) => `${t.id} ${t.status} ${t.direction}`)).toEqual(['c OPEN SHORT', 'a CLOSED LONG']);
  });

  it('counts a missing opening fill at the average entry once combined', () => {
    const merges = addMerge([], ['c', 'a'], buildTrades(fills));
    expect(merges).toEqual([['a', 'c']]);
    const [t] = buildTrades(fills, merges);
    expect(t).toMatchObject({ id: 'a', status: 'CLOSED', direction: 'LONG', merged: ['a', 'c'], assumedContracts: 1, avgEntry: 600, avgExit: 875 });
    // Sold for $710 + $1,040, bought 2 at $600.
    expect(t.netPnl).toBe(550);
  });

  it('splits back apart, and grows a group when combining again', () => {
    const extra = [...fills, fill('d', '11:00:00', 'BUY', 5, 'OPEN'), fill('e', '11:05:00', 'SELL', 6, 'CLOSE')];
    let merges = addMerge([], ['a', 'c'], buildTrades(extra));
    merges = addMerge(merges, ['a', 'd'], buildTrades(extra, merges));
    expect(merges).toEqual([['a', 'c', 'd']]);
    expect(buildTrades(extra, merges).find((t) => t.id === 'a')?.status).toBe('CLOSED');
    expect(removeMerge(merges, 'a', buildTrades(extra, merges))).toEqual([]);
  });
});
