import { describe, expect, it } from 'vitest';
import type { Trade } from '../src/core/types';
import { drawdown, extraStats, niceStep, pnlHistogram, streaks, tradeScore, weekdayHourHeat } from '../src/core/visuals';

function trade(id: string, netPnl: number, open: string, close = open): Trade {
  return {
    id, underlying: 'SPY', expiry: open.slice(0, 10), strike: 600, putCall: 'CALL', direction: 'LONG',
    openTime: open, closeTime: close, status: 'CLOSED', maxContracts: 1, avgEntry: 100, grossPnl: netPnl, fees: 0, netPnl, fills: [],
  };
}

// Mon 9/14 through Thu 9/17, 2026.
const trades = [
  trade('a', 100, '2026-09-14T09:45:00', '2026-09-14T09:55:00'),
  trade('b', -40, '2026-09-14T13:10:00', '2026-09-14T13:40:00'),
  trade('c', -80, '2026-09-15T10:05:00', '2026-09-15T10:10:00'),
  trade('d', 200, '2026-09-16T15:30:00', '2026-09-16T15:50:00'),
  trade('e', -20, '2026-09-17T09:31:00', '2026-09-17T09:33:00'),
];

describe('visuals', () => {
  it('tracks the drop from each high point', () => {
    expect(drawdown(trades)).toEqual([
      { date: '2026-09-14', equity: 60, drawdown: 0 },
      { date: '2026-09-15', equity: -20, drawdown: -80 },
      { date: '2026-09-16', equity: 180, drawdown: 0 },
      { date: '2026-09-17', equity: 160, drawdown: -20 },
    ]);
  });

  it('scores each axis from 0 to 100', () => {
    const s = tradeScore(trades)!;
    const axis = (k: string) => s.axes.find((a) => a.key === k)!;
    expect(axis('winRate').value).toBe('40%');
    expect(axis('winRate').score).toBe(67);
    expect(axis('profitFactor').value).toBe('2.14');
    expect(axis('drawdown').value).toBe('−$80');
    expect(axis('recovery').value).toBe('2.00');
    expect(axis('greenDays').value).toBe('50%');
    for (const a of s.axes) expect(a.score).toBeGreaterThanOrEqual(0);
    expect(tradeScore([])).toBeNull();
  });

  it('bins P&L with zero as an edge', () => {
    expect(niceStep(300, 10)).toBe(50);
    const bins = pnlHistogram(trades, 6);
    expect(bins.some((b) => b.from === 0)).toBe(true);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(5);
    for (const b of bins) expect(b.from < 0 ? b.to <= 0 : true).toBe(true);
  });

  it('sums P&L by weekday and entry hour', () => {
    const heat = weekdayHourHeat(trades);
    expect(heat).toHaveLength(35);
    expect(heat.find((c) => c.weekday === 1 && c.hour === 9)).toMatchObject({ trades: 1, netPnl: 100 });
    expect(heat.find((c) => c.weekday === 3 && c.hour === 15)).toMatchObject({ trades: 1, netPnl: 200 });
  });

  it('counts streaks and extra stats', () => {
    expect(streaks(trades)).toMatchObject({ currentTrades: -1, bestTrades: 1, worstTrades: -2, currentDays: -1 });
    const x = extraStats(trades);
    expect(x.expectancy).toBe(32);
    expect(x.largestWin).toBe(200);
    expect(x.worstDay).toEqual({ date: '2026-09-15', netPnl: -80 });
    expect(x.avgHoldWin).toBe(15);
  });
});
