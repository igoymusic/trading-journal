import { describe, expect, it } from 'vitest';
import { positionAt, replayStartIndex } from '../src/core/replay';
import type { Fill } from '../src/core/types';

const MIN = 60_000;
const t0 = Date.UTC(2026, 8, 15, 14, 0);
const bars = Array.from({ length: 60 }, (_, i) => ({ time: t0 + i * MIN, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe('trade replay', () => {
  it('starts 15 minutes before the first fill, or at the first candle', () => {
    expect(replayStartIndex(bars, t0 + 30 * MIN + 12_000)).toBe(15);
    expect(replayStartIndex(bars, t0 + 5 * MIN)).toBe(0);
    expect(replayStartIndex([], t0)).toBe(0);
  });

  it('tracks contracts held and P&L locked in as fills happen', () => {
    const fill = (id: string, side: 'BUY' | 'SELL', quantity: number, price: number) => ({ id, side, quantity, price, fees: 0.65 * quantity }) as unknown as Fill;
    // Long 2 at $1.00, sell 1 at $1.50, then 1 at $0.80.
    const trade = { direction: 'LONG' as const, avgEntry: 100, fills: [fill('in', 'BUY', 2, 1), fill('a', 'SELL', 1, 1.5), fill('b', 'SELL', 1, 0.8)] };
    const times = new Map([['in', t0 + 10 * MIN + 5_000], ['a', t0 + 20 * MIN + 30_000], ['b', t0 + 25 * MIN]]);
    expect(positionAt(trade, times, t0 + 9 * MIN)).toEqual({ held: 0, realized: 0, started: false });
    // The 14:10 candle includes the entry at 14:10:05.
    expect(positionAt(trade, times, t0 + 10 * MIN)).toEqual({ held: 2, realized: 0, started: true });
    expect(positionAt(trade, times, t0 + 20 * MIN)).toEqual({ held: 1, realized: 49.35, started: true });
    // Out completely: +$50 - $20 - exit fees $1.30 - entry fees $1.30.
    expect(positionAt(trade, times, t0 + 25 * MIN)).toEqual({ held: 0, realized: 27.4, started: true });
  });
});
