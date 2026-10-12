import { describe, expect, it } from 'vitest';
import { AlpacaClient } from '../src/core/alpaca';
import { chartTime, zonedToUtcMillis } from '../src/core/time';
import { buildTrades } from '../src/core/trades';
import type { Fill } from '../src/core/types';
import { JournalDb } from '../src/main/db';
import { buildTradeChart } from '../src/main/market';

/** A stand-in for Alpaca's API that records requests and answers from a handler. */
function fakeAlpaca(handler: (path: string, params: URLSearchParams) => { status?: number; body: unknown }) {
  const calls: { path: string; params: URLSearchParams }[] = [];
  const fetchFn = async (url: string) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, params: u.searchParams });
    const { status = 200, body } = handler(u.pathname, u.searchParams);
    return { ok: status < 400, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { fetchFn: fetchFn as any, calls };
}

describe('time zones', () => {
  it('converts New York wall-clock time to UTC across daylight saving', () => {
    expect(new Date(zonedToUtcMillis('2026-10-12T11:49:07', 'America/New_York')).toISOString()).toBe('2026-10-12T15:49:07.000Z');
    expect(new Date(zonedToUtcMillis('2026-01-05T09:30:00', 'America/New_York')).toISOString()).toBe('2026-01-05T14:30:00.000Z');
    expect(new Date(zonedToUtcMillis('2026-01-05T09:30:00', 'America/Chicago')).toISOString()).toBe('2026-01-05T15:30:00.000Z');
  });

  it('shifts chart times so the axis reads in local time', () => {
    const utc = Date.parse('2026-10-12T15:49:07Z');
    expect(new Date(chartTime(utc, 'America/New_York') * 1000).toISOString()).toBe('2026-10-12T11:49:07.000Z');
  });
});

describe('Alpaca client', () => {
  const creds = { keyId: 'k', secretKey: 's' };

  it('follows pagination for minute bars', async () => {
    const { fetchFn, calls } = fakeAlpaca((_p, q) => q.get('page_token')
      ? { body: { bars: [{ t: '2026-10-12T13:31:00Z', o: 2, h: 2, l: 2, c: 2, v: 1 }], next_page_token: null } }
      : { body: { bars: [{ t: '2026-10-12T13:30:00Z', o: 1, h: 1, l: 1, c: 1, v: 1 }], next_page_token: 'abc' } });
    const { bars, feed } = await new AlpacaClient(creds, fetchFn).minuteBars('SPY', 0, 1);
    expect(bars.map((b) => b.close)).toEqual([1, 2]);
    expect(feed).toBe('sip');
    expect(calls[0].params.get('timeframe')).toBe('1Min');
    expect(calls[1].params.get('page_token')).toBe('abc');
  });

  it('asks for the latest trade at or before the end of the fill second', async () => {
    const { fetchFn, calls } = fakeAlpaca(() => ({ body: { trades: [{ t: '2026-10-12T15:49:06.912Z', p: 745.12 }] } }));
    const print = await new AlpacaClient(creds, fetchFn).lastTradeAtOrBefore('SPY', Date.parse('2026-10-12T15:49:07Z'));
    expect(print).toEqual({ time: Date.parse('2026-10-12T15:49:06.912Z'), price: 745.12, feed: 'sip' });
    expect(calls[0].path).toBe('/v2/stocks/SPY/trades');
    expect(calls[0].params.get('end')).toBe('2026-10-12T15:49:08.000Z');
    expect(calls[0].params.get('sort')).toBe('desc');
    expect(calls[0].params.get('limit')).toBe('1');
  });

  it('falls back to IEX when the plan does not cover SIP data', async () => {
    const { fetchFn } = fakeAlpaca((_p, q) => q.get('feed') === 'sip'
      ? { status: 403, body: 'subscription does not permit querying recent SIP data' }
      : { body: { trades: [{ t: '2026-10-12T15:49:06Z', p: 1 }] } });
    expect((await new AlpacaClient(creds, fetchFn).lastTradeAtOrBefore('SPY', 0))?.feed).toBe('iex');
  });

  it('reports bad keys plainly', async () => {
    const { fetchFn } = fakeAlpaca(() => ({ status: 401, body: 'unauthorized' }));
    await expect(new AlpacaClient(creds, fetchFn).minuteBars('SPY', 0, 1)).rejects.toThrow(/rejected the API key/);
  });
});

describe('trade chart', () => {
  const fills: Fill[] = [
    { id: 'a', broker: 'thinkorswim', execTime: '2026-10-09T10:48:27', underlying: 'SPY', expiry: '2026-10-09', strike: 700, putCall: 'CALL', side: 'BUY', quantity: 1, positionEffect: 'OPEN', price: 0.79, orderType: 'MKT', spread: 'SINGLE', fees: 0.53 },
    { id: 'b', broker: 'thinkorswim', execTime: '2026-10-09T10:58:04', underlying: 'SPY', expiry: '2026-10-09', strike: 700, putCall: 'CALL', side: 'SELL', quantity: 1, positionEffect: 'CLOSE', price: 0.74, orderType: 'MKT', spread: 'SINGLE', fees: 0.53 },
  ];
  const settings = { timeZone: 'America/New_York', alpacaCredentials: () => ({ keyId: 'k', secretKey: 's' }) } as any;

  it('asks for a key when none is saved', async () => {
    const db = new JournalDb(':memory:');
    const chart = await buildTradeChart(buildTrades(fills)[0], db, { ...settings, alpacaCredentials: () => null });
    expect(chart.status).toBe('needs-key');
  });

  it('loads candles and fill prices once, then serves them from the database', async () => {
    const db = new JournalDb(':memory:');
    db.addFills(fills);
    const { fetchFn, calls } = fakeAlpaca((path, q) => path.endsWith('/bars')
      ? { body: { bars: [{ t: '2026-10-09T14:48:00Z', o: 700, h: 701, l: 699, c: 700.5, v: 10 }] } }
      : { body: { trades: [{ t: new Date(Date.parse(q.get('end')!) - 300).toISOString(), p: q.get('end')!.includes('14:48') ? 700.25 : 699.9 }] } });
    const trade = buildTrades(fills)[0];

    const first = await buildTradeChart(trade, db, settings, fetchFn);
    if (first.status !== 'ok') throw new Error(first.status);
    expect(first.bars).toHaveLength(1);
    expect(first.fills.map((f) => f.underlyingPrice)).toEqual([700.25, 699.9]);
    // The fill at 10:48:27 New York time is 14:48:27 UTC.
    expect(new Date(first.fills[0].time).toISOString()).toBe('2026-10-09T14:48:27.000Z');
    expect(calls).toHaveLength(3);

    const second = await buildTradeChart(trade, db, settings, fetchFn);
    expect(second).toEqual(first);
    expect(calls).toHaveLength(3);
  });
});
