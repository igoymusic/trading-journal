import { describe, expect, it } from 'vitest';
import { buildMonth, neighborDay, shiftMonth, statsByDay } from '../src/core/calendar';
import { parseTosStatement } from '../src/core/tosCsv';
import { buildTrades } from '../src/core/trades';
import { SAMPLE_STATEMENT } from './fixture';

describe('P&L calendar', () => {
  const trades = buildTrades(parseTosStatement(SAMPLE_STATEMENT).fills);

  it('puts each trade on the day it closed, open trades on the day they opened', () => {
    const days = statsByDay(trades);
    expect(days.get('2026-01-05')).toMatchObject({ trades: 1, netPnl: -10.12, losses: 1 });
    expect(days.get('2026-01-09')).toMatchObject({ trades: 1, netPnl: -200.53 });
    // Both legs of the MU spread are still open: counted, but no P&L yet.
    expect(days.get('2026-03-31')).toMatchObject({ trades: 2, netPnl: 0, wins: 0, losses: 0 });
  });

  it('lays a month out Sunday to Saturday with weekly totals', () => {
    const jan = buildMonth(trades, 2026, 1);
    // Jan 1, 2026 is a Thursday, so the grid starts on Sunday Dec 28 and needs 5 weeks.
    expect(jan.weeks).toHaveLength(5);
    expect(jan.weeks[0].days[0]).toMatchObject({ date: '2025-12-28', inMonth: false });
    expect(jan.weeks[0].days[4]).toMatchObject({ date: '2026-01-01', inMonth: true });
    // Jan 5 (Mon) and Jan 9 (Fri) are in the second week.
    expect(jan.weeks[1]).toMatchObject({ netPnl: -210.65, trades: 2, tradedDays: 2 });
    expect(jan).toMatchObject({ netPnl: -210.65, trades: 2, tradedDays: 2, greenDays: 0, redDays: 2 });
  });

  it('leaves days from the neighboring months out of the totals', () => {
    const dec = buildMonth(trades, 2025, 12);
    expect(dec.trades).toBe(0);
    expect(dec.weeks.at(-1)!.days.some((d) => d.date === '2026-01-01' && !d.inMonth)).toBe(true);
  });

  it('steps between months and traded days', () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2025, 12, 1)).toEqual({ year: 2026, month: 1 });
    const days = ['2026-01-05', '2026-01-09', '2026-03-31'];
    expect(neighborDay(days, '2026-01-09', -1)).toBe('2026-01-05');
    expect(neighborDay(days, '2026-01-09', 1)).toBe('2026-03-31');
    expect(neighborDay(days, '2026-03-31', 1)).toBeNull();
  });
});
