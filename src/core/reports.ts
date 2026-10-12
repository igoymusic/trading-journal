// Filters and reports: narrow the trade list down, then break results out by setup, mistake,
// days to expiry, call vs put, time of day and so on. Only closed trades count toward results.

import { tradeDay } from './calendar';
import { riskReward } from './rr';
import type { MistakeTag, Setup, Trade } from './types';

/** Empty lists and missing values mean "any". */
export interface TradeFilter {
  /** "YYYY-MM-DD", inclusive, by the day the trade closed. */
  from?: string;
  to?: string;
  symbols: string[];
  putCall?: 'CALL' | 'PUT';
  direction?: 'LONG' | 'SHORT';
  /** Setup ids; "none" matches trades with no setup. */
  setups: string[];
  /** Trades with any of these mistakes; "none" matches trades with no mistakes. */
  mistakes: string[];
  result?: 'win' | 'loss';
  /** Days-to-expiry bucket keys from DTE_BUCKETS. */
  dte: string[];
}

export const EMPTY_FILTER: TradeFilter = { symbols: [], setups: [], mistakes: [], dte: [] };

export function isFiltering(f: TradeFilter): boolean {
  return !!(f.from || f.to || f.symbols.length || f.putCall || f.direction || f.setups.length || f.mistakes.length || f.result || f.dte.length);
}

/**
 * Calendar days from the day you opened the trade to expiration (0 = same-day expiry).
 * thinkorswim occasionally lists a same-day option's expiration as the day before; those count as 0.
 */
export function daysToExpiry(t: Trade): number {
  return Math.max(0, Math.round((Date.parse(t.expiry) - Date.parse(t.openTime.slice(0, 10))) / 86_400_000));
}

export const DTE_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
  { key: '0', label: '0 DTE', min: 0, max: 0 },
  { key: '1', label: '1 DTE', min: 1, max: 1 },
  { key: '2-7', label: '2–7 DTE', min: 2, max: 7 },
  { key: '8-30', label: '8–30 DTE', min: 8, max: 30 },
  { key: '31+', label: '31+ DTE', min: 31, max: Infinity },
];

const dteBucket = (t: Trade) => DTE_BUCKETS.find((b) => daysToExpiry(t) >= b.min && daysToExpiry(t) <= b.max)!;

export function applyFilter(trades: Trade[], f: TradeFilter): Trade[] {
  return trades.filter((t) => {
    const day = tradeDay(t);
    const j = t.journal;
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (f.symbols.length && !f.symbols.includes(t.underlying)) return false;
    if (f.putCall && t.putCall !== f.putCall) return false;
    if (f.direction && t.direction !== f.direction) return false;
    if (f.setups.length && !f.setups.includes(j?.setupId ?? 'none')) return false;
    if (f.mistakes.length) {
      const ids = j?.mistakes.length ? j.mistakes : ['none'];
      if (!ids.some((id) => f.mistakes.includes(id))) return false;
    }
    if (f.result === 'win' && !(t.status === 'CLOSED' && t.netPnl > 0)) return false;
    if (f.result === 'loss' && !(t.status === 'CLOSED' && t.netPnl < 0)) return false;
    if (f.dte.length && !f.dte.includes(dteBucket(t).key)) return false;
    return true;
  });
}

export interface ReportRow {
  key: string;
  label: string;
  trades: number;
  wins: number;
  winRate: number;
  netPnl: number;
  avgPnl: number;
  /** Gross wins / gross losses; null when there are no losses. */
  profitFactor: number | null;
  /** Average R over the trades that have a stop set, and how many that is. */
  avgR: number | null;
  rTrades: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function row(key: string, label: string, trades: Trade[]): ReportRow {
  const wins = trades.filter((t) => t.netPnl > 0);
  const grossWin = wins.reduce((a, t) => a + t.netPnl, 0);
  const grossLoss = -trades.filter((t) => t.netPnl < 0).reduce((a, t) => a + t.netPnl, 0);
  const net = trades.reduce((a, t) => a + t.netPnl, 0);
  const rs = trades.map((t) => riskReward(t, t.journal)?.realizedR).filter((r): r is number => r !== undefined);
  return {
    key, label,
    trades: trades.length,
    wins: wins.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    netPnl: round2(net),
    avgPnl: trades.length ? round2(net / trades.length) : 0,
    profitFactor: grossLoss ? Math.round((grossWin / grossLoss) * 100) / 100 : null,
    avgR: rs.length ? Math.round((rs.reduce((a, r) => a + r, 0) / rs.length) * 100) / 100 : null,
    rTrades: rs.length,
  };
}

/** Groups closed trades; a trade can land in several groups (e.g. two mistakes). Order follows `groups`. */
function groupBy(trades: Trade[], groups: { key: string; label: string }[], keysOf: (t: Trade) => string[]): ReportRow[] {
  const closed = trades.filter((t) => t.status === 'CLOSED');
  return groups
    .map((g) => row(g.key, g.label, closed.filter((t) => keysOf(t).includes(g.key))))
    .filter((r) => r.trades > 0);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "09:30" style label for a minute of the day. */
const clock = (m: number) => {
  const h = Math.floor(m / 60);
  return `${h > 12 ? h - 12 : h}:${String(m % 60).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
};

export interface Reports {
  setup: ReportRow[];
  mistake: ReportRow[];
  dte: ReportRow[];
  putCall: ReportRow[];
  direction: ReportRow[];
  timeOfDay: ReportRow[];
  weekday: ReportRow[];
  symbol: ReportRow[];
  rating: ReportRow[];
}

export function buildReports(trades: Trade[], setups: Setup[], mistakes: MistakeTag[]): Reports {
  const symbols = [...new Set(trades.map((t) => t.underlying))].sort();
  // Half-hour slots by entry time; everything before 9:30 or after 4:00 gets its own slot.
  const slots = [{ key: 'pre', label: 'Before 9:30am' }];
  for (let m = 9 * 60 + 30; m < 16 * 60; m += 30) slots.push({ key: String(m), label: `${clock(m)}–${clock(m + 30)}` });
  slots.push({ key: 'post', label: 'After 4:00pm' });
  const slotOf = (t: Trade) => {
    const m = Number(t.openTime.slice(11, 13)) * 60 + Number(t.openTime.slice(14, 16));
    if (m < 570) return 'pre';
    if (m >= 960) return 'post';
    return String(570 + Math.floor((m - 570) / 30) * 30);
  };

  return {
    setup: groupBy(trades, [...setups.map((s) => ({ key: s.id, label: s.name })), { key: 'none', label: 'No setup' }], (t) => [t.journal?.setupId ?? 'none']),
    mistake: groupBy(trades, [{ key: 'none', label: 'No mistakes' }, ...mistakes.map((m) => ({ key: m.id, label: m.name }))],
      (t) => (t.journal?.mistakes.length ? t.journal.mistakes : ['none'])),
    dte: groupBy(trades, DTE_BUCKETS, (t) => [dteBucket(t).key]),
    putCall: groupBy(trades, [{ key: 'CALL', label: 'Calls' }, { key: 'PUT', label: 'Puts' }], (t) => [t.putCall]),
    direction: groupBy(trades, [{ key: 'LONG', label: 'Bought to open' }, { key: 'SHORT', label: 'Sold to open' }], (t) => [t.direction]),
    timeOfDay: groupBy(trades, slots, (t) => [slotOf(t)]),
    weekday: groupBy(trades, WEEKDAYS.map((d, i) => ({ key: String(i), label: d })), (t) => [String(new Date(`${t.openTime.slice(0, 10)}T12:00:00`).getDay())]),
    symbol: groupBy(trades, symbols.map((s) => ({ key: s, label: s })), (t) => [t.underlying]),
    rating: groupBy(trades, [5, 4, 3, 2, 1].map((n) => ({ key: String(n), label: '★'.repeat(n) })).concat({ key: 'none', label: 'Not rated' }),
      (t) => [t.journal?.rating ? String(t.journal.rating) : 'none']),
  };
}
