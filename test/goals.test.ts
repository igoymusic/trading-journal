import { describe, expect, it } from 'vitest';
import { brokeLimit, checkDay, monthGoals } from '../src/core/goals';
import type { Trade } from '../src/core/types';

const day = (date: string, netPnl: number, trades = 1) => ({ date, netPnl, trades, wins: 0, losses: 0 });
const goals = { dailyTarget: 100, dailyMaxLoss: 50, maxTradesPerDay: 3, monthlyTarget: 1000 };

function trade(id: string, date: string, netPnl: number): Trade {
  return {
    id, underlying: 'SPY', expiry: date, strike: 600, putCall: 'CALL', direction: 'LONG', status: 'CLOSED',
    openTime: `${date}T10:00:00`, closeTime: `${date}T10:05:00`, maxContracts: 1, avgEntry: 100,
    grossPnl: netPnl, fees: 0, netPnl, fills: [],
  };
}

describe('goals', () => {
  it('checks a day against the target and the limits', () => {
    expect(checkDay(day('2026-09-15', 120, 2), goals)).toEqual({ hitTarget: true, overMaxLoss: false, overTrades: false });
    const bad = checkDay(day('2026-09-16', -60, 5), goals);
    expect(bad).toEqual({ hitTarget: false, overMaxLoss: true, overTrades: true });
    expect(brokeLimit(bad)).toBe(true);
    // Losing exactly the max is still within it.
    expect(checkDay(day('2026-09-17', -50), goals).overMaxLoss).toBe(false);
  });

  it('leaves out goals you have not set', () => {
    expect(checkDay(day('2026-09-15', -500, 20), {})).toEqual({ hitTarget: undefined, overMaxLoss: undefined, overTrades: undefined });
  });

  it('adds up a month', () => {
    const trades = [
      trade('a', '2026-09-15', 150),
      trade('b', '2026-09-16', -80),
      ...['c', 'd', 'e', 'f'].map((id) => trade(id, '2026-09-17', 10)),
      trade('g', '2026-10-01', 500),
    ];
    expect(monthGoals(trades, '2026-09', goals)).toEqual({
      netPnl: 110, monthlyProgress: 0.11, tradedDays: 3, daysHitTarget: 1, daysWithinMaxLoss: 2, daysWithinMaxTrades: 2,
    });
  });
});

describe('custom goals', async () => {
  const { customGoalResult, describeGoal, metricValue, periodKey } = await import('../src/core/goals');
  const trade = (day: string, netPnl: number, extra: Partial<Trade> = {}) => ({
    id: `${day}-${netPnl}`, status: 'CLOSED', openTime: `${day}T10:00:00`, closeTime: `${day}T10:30:00`, netPnl, ...extra,
  }) as Trade;
  const trades = [trade('2026-10-05', 100), trade('2026-10-05', -50), trade('2026-10-07', 80), trade('2026-10-13', -40)];

  it('measures win rate and profit factor', () => {
    expect(metricValue(trades, 'winRate')).toBe(50);
    expect(metricValue(trades, 'profitFactor')).toBe(2);
    expect(metricValue(trades, 'largestLoss')).toBe(50);
  });

  it('groups by Monday-started weeks and checks each one', () => {
    expect(periodKey(trades[3], 'week')).toBe('2026-10-12');
    const r = customGoalResult(trades, { id: 'g', name: '', metric: 'winRate', op: 'atLeast', value: 60, period: 'week' }, '2026-10');
    expect(r.periods.map((p) => [p.key, p.met])).toEqual([['2026-10-05', true], ['2026-10-12', false]]);
    expect([r.met, r.measured]).toEqual([1, 2]);
  });

  it('describes a goal without a name', () => {
    expect(describeGoal({ id: 'g', name: '', metric: 'netPnl', op: 'atLeast', value: 500, period: 'week' })).toBe('Net P&L at least $500 per week');
  });
});
