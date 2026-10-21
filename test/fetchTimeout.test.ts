import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTrades } from '../src/core/trades';
import type { Fill } from '../src/core/types';
import { JournalDb } from '../src/main/db';
import { fetchWithTimeout } from '../src/main/fetchTimeout';
import { buildTradeChart, FRED_TIMEOUT_MS } from '../src/main/market';

afterEach(() => vi.useRealTimers());

describe('requests that never answer', () => {
  it('give up after the timeout', async () => {
    vi.useFakeTimers();
    const never = fetchWithTimeout((() => new Promise(() => {})) as any, 5000);
    const result = never('https://example.com/x').catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toBe('No answer from example.com after 5 seconds.');
  });

  it('still chart an SPX trade when FRED stalls, using the closes already saved', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fills: Fill[] = [
      { id: 'a', broker: 'thinkorswim', execTime: '2026-10-09T10:48:27', underlying: 'SPXW', expiry: '2026-10-09', strike: 6750, putCall: 'CALL', side: 'BUY', quantity: 1, positionEffect: 'OPEN', price: 3, orderType: 'MKT', spread: 'SINGLE', fees: 0.53 },
      { id: 'b', broker: 'thinkorswim', execTime: '2026-10-09T10:58:04', underlying: 'SPXW', expiry: '2026-10-09', strike: 6750, putCall: 'CALL', side: 'SELL', quantity: 1, positionEffect: 'CLOSE', price: 4, orderType: 'MKT', spread: 'SINGLE', fees: 0.53 },
    ];
    const db = new JournalDb(':memory:');
    db.addFills(fills);
    // FRED was read before, but not since this trade's day.
    db.setMeta('fred:SP500', JSON.stringify({ fetchedAt: 0, closes: [['2026-10-08', 6700]] }));
    let fredCalls = 0;
    const fetchFn = (async (url: string) => {
      if (url.includes('fred')) { fredCalls++; return new Promise(() => {}); }
      const u = new URL(url);
      const body = u.pathname.endsWith('/bars')
        ? { bars: [{ t: '2026-10-08T19:59:00Z', o: 670, h: 670, l: 670, c: 670, v: 1 }, { t: '2026-10-09T14:48:00Z', o: 671, h: 672, l: 670, c: 671.5, v: 1 }] }
        : { trades: [{ t: new Date(Date.parse(u.searchParams.get('end')!) - 300).toISOString(), p: 671 }] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }) as any;
    const settings = { timeZone: 'America/New_York', alpacaCredentials: () => ({ keyId: 'k', secretKey: 's' }) } as any;

    const pending = buildTradeChart(buildTrades(fills)[0], db, settings, fetchFn, undefined, 'index');
    await vi.advanceTimersByTimeAsync(FRED_TIMEOUT_MS);
    const chart = await pending;
    expect(chart.status).toBe('ok');
    if (chart.status !== 'ok') return;
    expect(chart.estimatedFrom).toBe('SPY');
    // 6700 / 670 = 10x SPY.
    expect(chart.fills[0].underlyingPrice).toBe(6710);

    // The next chart within the hour doesn't wait on FRED again.
    await buildTradeChart(buildTrades(fills)[0], db, settings, fetchFn, undefined, 'index');
    expect(fredCalls).toBe(1);
  });
});

describe('daily index closes', () => {
  it('fall back to Yahoo Finance when FRED fails, skipping a day still trading', async () => {
    const { parseYahooChart } = await import('../src/core/indexProxy');
    // 10/20 and 10/21 at the 9:30 open; it's 10/21 at noon New York time.
    const json = { chart: { result: [{ timestamp: [1792503000, 1792589400], indicators: { quote: [{ close: [6701.234, 6710] }] } }] } };
    expect([...parseYahooChart(json, Date.parse('2026-10-21T16:00:00Z'))]).toEqual([['2026-10-20', 6701.23]]);
    expect(parseYahooChart(json, Date.parse('2026-10-21T21:00:00Z')).get('2026-10-21')).toBe(6710);
  });

  it('chart SPX from Yahoo closes when FRED is down', async () => {
    const fills: Fill[] = [
      { id: 'a', broker: 'thinkorswim', execTime: '2026-10-09T10:48:27', underlying: 'SPXW', expiry: '2026-10-09', strike: 6750, putCall: 'CALL', side: 'BUY', quantity: 1, positionEffect: 'OPEN', price: 3, orderType: 'MKT', spread: 'SINGLE', fees: 0.53 },
      { id: 'b', broker: 'thinkorswim', execTime: '2026-10-09T10:58:04', underlying: 'SPXW', expiry: '2026-10-09', strike: 6750, putCall: 'CALL', side: 'SELL', quantity: 1, positionEffect: 'CLOSE', price: 4, orderType: 'MKT', spread: 'SINGLE', fees: 0.53 },
    ];
    const db = new JournalDb(':memory:');
    db.addFills(fills);
    const fetchFn = (async (url: string) => {
      if (url.includes('fred')) return { ok: false, status: 403, text: async () => 'blocked' };
      if (url.includes('yahoo')) {
        // 10/8/2026 at the 9:30 open, New York time.
        const body = { chart: { result: [{ timestamp: [1791466200], indicators: { quote: [{ close: [6700] }] } }] } };
        return { ok: true, status: 200, json: async () => body };
      }
      const u = new URL(url);
      const body = u.pathname.endsWith('/bars')
        ? { bars: [{ t: '2026-10-08T19:59:00Z', o: 670, h: 670, l: 670, c: 670, v: 1 }, { t: '2026-10-09T14:48:00Z', o: 671, h: 672, l: 670, c: 671.5, v: 1 }] }
        : { trades: [{ t: new Date(Date.parse(u.searchParams.get('end')!) - 300).toISOString(), p: 671 }] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }) as any;
    const settings = { timeZone: 'America/New_York', alpacaCredentials: () => ({ keyId: 'k', secretKey: 's' }) } as any;
    const chart = await buildTradeChart(buildTrades(fills)[0], db, settings, fetchFn, undefined, 'index');
    expect(chart.status).toBe('ok');
    if (chart.status === 'ok') expect(chart.fills[0].underlyingPrice).toBe(6710);
  });
});
