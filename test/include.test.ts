import { describe, expect, it } from 'vitest';
import { statsByDay } from '../src/core/calendar';
import { buildReports } from '../src/core/reports';
import { parseTosStatement } from '../src/core/tosCsv';
import { buildTrades, summarizeTrades } from '../src/core/trades';
import { EMPTY_JOURNAL } from '../src/core/types';
import { SAMPLE_STATEMENT } from './fixture';

describe('Include box', () => {
  const trades = buildTrades(parseTosStatement(SAMPLE_STATEMENT).fills);
  const dropped = trades.find((t) => (t.closeTime ?? '').startsWith('2026-01-05'))!;
  const withExcluded = trades.map((t) => (t.id === dropped.id ? { ...t, journal: { ...EMPTY_JOURNAL, excluded: true } } : t));

  it('leaves an unticked trade out of the day, the summary and the reports', () => {
    expect(statsByDay(withExcluded).get('2026-01-05')).toBeUndefined();
    const before = summarizeTrades(trades);
    const after = summarizeTrades(withExcluded);
    expect(after.trades).toBe(before.trades - 1);
    expect(after.netPnl).toBeCloseTo(before.netPnl - dropped.netPnl, 2);
    const total = (ts: typeof trades) => buildReports(ts, [], []).symbol.reduce((a, r) => a + r.trades, 0);
    expect(total(withExcluded)).toBe(total(trades) - 1);
  });
});
