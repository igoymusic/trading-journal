import { describe, expect, it } from 'vitest';
import { applyFilter, buildReports, daysToExpiry, EMPTY_FILTER, isFiltering } from '../src/core/reports';
import type { Trade, TradeJournal } from '../src/core/types';

function trade(id: string, over: Partial<Trade> & { j?: Partial<TradeJournal> } = {}): Trade {
  const { j, ...rest } = over;
  return {
    id, underlying: 'SPY', expiry: '2026-09-15', strike: 600, putCall: 'CALL', direction: 'LONG',
    openTime: '2026-09-15T09:45:00', closeTime: '2026-09-15T10:05:00', status: 'CLOSED',
    maxContracts: 1, avgEntry: 100, grossPnl: 0, fees: 0, netPnl: 0, fills: [],
    journal: j ? { notes: '', setupId: null, mistakes: [], rating: null, ...j } : undefined,
    ...rest,
  };
}

const trades = [
  trade('a', { netPnl: 50, j: { setupId: 'orb', rating: 5, underlyingEntry: 100, underlyingExit: 102, stops: [{ price: 99, contracts: 1 }] } }),
  trade('b', { netPnl: -20, putCall: 'PUT', j: { setupId: 'orb', mistakes: ['fomo', 'late'] } }),
  trade('c', { netPnl: 30, underlying: 'TSLA', expiry: '2026-09-19', openTime: '2026-09-15T13:10:00', closeTime: '2026-09-16T10:00:00' }),
  trade('d', { netPnl: -10, openTime: '2026-09-14T15:59:00', closeTime: '2026-09-14T15:59:30', expiry: '2026-10-16', j: { mistakes: ['fomo'] } }),
  trade('open', { status: 'OPEN', closeTime: undefined, netPnl: 0 }),
];

describe('filters', () => {
  const ids = (f: Partial<typeof EMPTY_FILTER>) => applyFilter(trades, { ...EMPTY_FILTER, ...f }).map((t) => t.id);

  it('passes everything with no filter set', () => {
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
    expect(ids({})).toHaveLength(5);
  });

  it('filters by date, symbol, side and result', () => {
    expect(ids({ from: '2026-09-15', to: '2026-09-15' })).toEqual(['a', 'b', 'open']);
    expect(ids({ symbols: ['TSLA'] })).toEqual(['c']);
    expect(ids({ putCall: 'PUT' })).toEqual(['b']);
    expect(ids({ result: 'loss' })).toEqual(['b', 'd']);
  });

  it('filters by setup, mistake and days to expiry, with "none" for untagged trades', () => {
    expect(ids({ setups: ['orb'] })).toEqual(['a', 'b']);
    expect(ids({ setups: ['none'] })).toEqual(['c', 'd', 'open']);
    expect(ids({ mistakes: ['fomo'] })).toEqual(['b', 'd']);
    expect(ids({ dte: ['0'] })).toEqual(['a', 'b', 'open']);
    expect(ids({ dte: ['2-7', '31+'] })).toEqual(['c', 'd']);
  });
});

describe('playbook reports', () => {
  const setups = [{ id: 'orb', name: 'ORB', color: '#fff', rules: [{ id: 'r1', text: 'Wait 5m' }, { id: 'r2', text: 'Stop under range' }] }];
  const pb = [
    trade('p1', { netPnl: 40, j: { setupId: 'orb', rulesFollowed: ['r1', 'r2'] } }),
    trade('p2', { netPnl: -25, j: { setupId: 'orb', rulesFollowed: ['r2'] } }),
    trade('p3', { netPnl: -15, j: { setupId: 'orb' } }),
    trade('p4', { netPnl: 10 }),
  ];
  const r = buildReports(pb, setups, []);

  it('compares trades that followed every rule with ones that broke one', () => {
    expect(r.playbook.map((x) => [x.label, x.trades, x.netPnl])).toEqual([['Followed every rule', 1, 40], ['Broke a rule', 2, -40]]);
  });

  it('shows what each broken rule cost', () => {
    expect(r.rulesBroken.map((x) => [x.label, x.trades, x.netPnl])).toEqual([['Wait 5m (ORB)', 2, -40], ['Stop under range (ORB)', 1, -15]]);
  });
});

describe('reports', () => {
  const r = buildReports(trades, [{ id: 'orb', name: 'ORB', color: '#fff' }],
    [{ id: 'fomo', name: 'FOMO' }, { id: 'late', name: 'Late entry' }]);

  it('counts days to expiry from the day the trade opened', () => {
    expect(daysToExpiry(trades[2])).toBe(4);
    // thinkorswim sometimes dates a same-day option the day before.
    expect(daysToExpiry(trade('x', { openTime: '2026-05-01T11:44:33', expiry: '2026-04-30' }))).toBe(0);
  });

  it('breaks results out by setup, with win rate, profit factor and average R', () => {
    expect(r.setup).toEqual([
      { key: 'orb', label: 'ORB', trades: 2, wins: 1, winRate: 0.5, netPnl: 30, avgPnl: 15, profitFactor: 2.5, avgR: 2, totalR: 2, rTrades: 1 },
      expect.objectContaining({ key: 'none', trades: 2, netPnl: 20 }),
    ]);
  });

  it('counts a trade under each of its mistakes, and leaves out open trades', () => {
    expect(r.mistake.map((m) => [m.label, m.trades, m.netPnl])).toEqual([['No mistakes', 2, 80], ['FOMO', 2, -30], ['Late entry', 1, -20]]);
  });

  it('groups by entry time in half hours and by weekday', () => {
    expect(r.timeOfDay.map((m) => [m.label, m.trades])).toEqual([['9:30am–10:00am', 2], ['1:00pm–1:30pm', 1], ['3:30pm–4:00pm', 1]]);
    expect(r.weekday.map((m) => [m.label, m.trades])).toEqual([['Monday', 1], ['Tuesday', 3]]);
    expect(r.putCall.map((m) => m.label)).toEqual(['Calls', 'Puts']);
    expect(r.rating.map((m) => m.label)).toEqual(['★★★★★', 'Not rated']);
  });
});
