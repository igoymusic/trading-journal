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
    expect(t).toMatchObject({ id: 'a', status: 'CLOSED', direction: 'LONG', merged: ['a', 'c'], assumedContracts: 1, maxContracts: 2, avgEntry: 600, avgExit: 875 });
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

describe('shown fills', () => {
  it('adds contracts closed without an opening fill to the first entry', async () => {
    const { shownFills } = await import('../src/core/trades');
    const fill = (id: string, side: 'BUY' | 'SELL', quantity: number) => ({
      id, side, quantity, price: 1, fees: 0, execTime: `2026-10-09T14:0${id}:00`, underlying: 'SPY', expiry: '2026-10-09', strike: 600, putCall: 'CALL' as const,
    });
    const t = { direction: 'LONG', assumedContracts: 1, fills: [fill('1', 'BUY', 1), fill('2', 'SELL', 1), fill('3', 'SELL', 1)] } as any;
    expect(shownFills(t).map((f) => f.quantity)).toEqual([2, 1, 1]);
    expect(t.fills[0].quantity).toBe(1);
  });
});
