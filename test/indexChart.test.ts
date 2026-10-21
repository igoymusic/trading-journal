import { describe, expect, it } from 'vitest';
import { buildTrades } from '../src/core/trades';
import type { Fill } from '../src/core/types';
import { JournalDb } from '../src/main/db';
import { buildTradeChart } from '../src/main/market';

const fills: Fill[] = [
  { id: 'a', broker: 'thinkorswim', execTime: '2026-10-09T10:48:27', underlying: 'SPXW', expiry: '2026-10-09', strike: 6750, putCall: 'CALL', side: 'BUY', quantity: 1, positionEffect: 'OPEN', price: 3, orderType: 'MKT', spread: 'SINGLE', fees: 0.53 },
  { id: 'b', broker: 'thinkorswim', execTime: '2026-10-09T10:58:04', underlying: 'SPXW', expiry: '2026-10-09', strike: 6750, putCall: 'CALL', side: 'SELL', quantity: 1, positionEffect: 'CLOSE', price: 4, orderType: 'MKT', spread: 'SINGLE', fees: 0.53 },
];

describe('SPX trades on the SPY chart', () => {
  it("show SPY's own prices, with no daily closes needed", async () => {
    const db = new JournalDb(':memory:');
    db.addFills(fills);
    // A price saved earlier on the scaled SPX chart mustn't show up on the SPY one.
    db.saveFillPrice('a', 6710, 0, 'sip:SPY');
    const fetchFn = (async (url: string) => {
      if (url.includes('fred') || url.includes('yahoo')) throw new Error('should not be asked');
      const u = new URL(url);
      const body = u.pathname.endsWith('/bars')
        ? { bars: [{ t: '2026-10-09T14:48:00Z', o: 671, h: 672, l: 670, c: 671.5, v: 1 }] }
        : { trades: [{ t: new Date(Date.parse(u.searchParams.get('end')!) - 300).toISOString(), p: 671.2 }] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }) as any;
    const settings = { timeZone: 'America/New_York', alpacaCredentials: () => ({ keyId: 'k', secretKey: 's' }) } as any;
    const chart = await buildTradeChart(buildTrades(fills)[0], db, settings, fetchFn);
    expect(chart.status).toBe('ok');
    if (chart.status !== 'ok') return;
    expect(chart.symbol).toBe('SPY');
    expect(chart.estimatedFrom).toBeUndefined();
    expect(chart.bars[0].close).toBe(671.5);
    expect(chart.fills.map((f) => [f.fillId, f.underlyingPrice])).toEqual([['a', 671.2], ['b', 671.2]]);
    expect(db.fillPrice('a')!.price).toBe(6710);
  });
});
