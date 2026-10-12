import { describe, expect, it } from 'vitest';
import { parseTosStatement, parseTosExpiry, underlyingFromSymbol } from '../src/core/tosCsv';
import { buildTrades, summarizeTrades } from '../src/core/trades';
import { SAMPLE_STATEMENT } from './fixture';

describe('thinkorswim import', () => {
  const { fills, skipped, unmatchedFees } = parseTosStatement(SAMPLE_STATEMENT);

  it('reads every option fill plus expirations', () => {
    expect(skipped).toEqual([]);
    expect(unmatchedFees).toBe(0);
    expect(fills).toHaveLength(7);
    expect(fills[0]).toMatchObject({
      execTime: '2026-01-05T10:00:01', underlying: 'SPY', expiry: '2026-01-05',
      strike: 600, putCall: 'CALL', side: 'BUY', quantity: 2, price: 0.79, fees: 1.06,
    });
  });

  it('gives the extra leg of a multi-leg order its time and a share of the fee', () => {
    const legs = fills.filter((f) => f.underlying === 'MU');
    expect(legs.map((f) => f.execTime)).toEqual(['2026-03-31T10:11:21', '2026-03-31T10:11:21']);
    expect(legs.reduce((a, f) => a + f.fees, 0)).toBeCloseTo(1.6, 6);
    expect(legs.find((f) => f.strike === 275)?.fees).toBeCloseTo(1.0667, 3);
  });

  it('turns an expiration into a $0 closing fill', () => {
    const exp = fills.find((f) => f.orderType === 'EXPIRED');
    expect(exp).toMatchObject({ underlying: 'TSLA', side: 'SELL', quantity: 1, price: 0, execTime: '2026-01-09T16:00:00' });
  });

  it('parses symbols and dates', () => {
    expect(parseTosExpiry('2 APR 26')).toBe('2026-04-02');
    expect(underlyingFromSymbol('WBD 0/100 (US$ 3101.67) (Weeklys)')).toBe('WBD');
  });

  it('rejects files without trade history', () => {
    expect(() => parseTosStatement('Cash Balance\nDATE,TIME\n')).toThrow(/Account Trade History/);
  });
});

describe('trade grouping', () => {
  const trades = buildTrades(parseTosStatement(SAMPLE_STATEMENT).fills);

  it('groups a scale-out into one trade with P&L per contract in dollars', () => {
    const spy = trades.find((t) => t.underlying === 'SPY')!;
    expect(spy).toMatchObject({
      status: 'CLOSED', direction: 'LONG', maxContracts: 2,
      avgEntry: 79, avgExit: 75, grossPnl: -8, fees: 2.12, netPnl: -10.12,
      openTime: '2026-01-05T10:00:01', closeTime: '2026-01-05T10:06:00',
    });
  });

  it('closes an expired option as a full loss', () => {
    const tsla = trades.find((t) => t.underlying === 'TSLA')!;
    expect(tsla).toMatchObject({ status: 'CLOSED', grossPnl: -200, closeTime: '2026-01-09T16:00:00' });
  });

  it('keeps unfinished positions open', () => {
    expect(trades.filter((t) => t.status === 'OPEN').map((t) => t.strike).sort()).toEqual([275, 300]);
  });

  it('summarizes closed trades', () => {
    const s = summarizeTrades(trades);
    expect(s).toMatchObject({ trades: 2, wins: 0, losses: 2, grossPnl: -208 });
  });
});
