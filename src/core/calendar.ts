// Groups trades by calendar day for the month view. A trade counts on the day it closed
// (still-open trades count on the day they opened), same as the trade list.

import { isCounted, type Trade } from './types';

export interface DayStats {
  /** "YYYY-MM-DD" */
  date: string;
  netPnl: number;
  trades: number;
  wins: number;
  losses: number;
}

export interface CalendarDay extends DayStats {
  /** False for the leading/trailing days that belong to the neighboring months. */
  inMonth: boolean;
}

export interface CalendarWeek {
  days: CalendarDay[];
  /** Totals for the days of this week that fall inside the month. */
  netPnl: number;
  trades: number;
  /** Days in the month with at least one trade. */
  tradedDays: number;
}

export interface CalendarMonth {
  year: number;
  /** 1-12 */
  month: number;
  weeks: CalendarWeek[];
  netPnl: number;
  trades: number;
  tradedDays: number;
  greenDays: number;
  redDays: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function tradeDay(t: Trade): string {
  return (t.closeTime ?? t.openTime).slice(0, 10);
}

/** P&L stats per day, keyed by "YYYY-MM-DD". Open trades add to the count but not the P&L. */
export function statsByDay(trades: Trade[]): Map<string, DayStats> {
  const out = new Map<string, DayStats>();
  for (const t of trades) {
    if (!isCounted(t)) continue;
    const date = tradeDay(t);
    const s = out.get(date) ?? { date, netPnl: 0, trades: 0, wins: 0, losses: 0 };
    s.trades += 1;
    if (t.status === 'CLOSED') {
      s.netPnl = round2(s.netPnl + t.netPnl);
      if (t.netPnl > 0) s.wins += 1;
      else if (t.netPnl < 0) s.losses += 1;
    }
    out.set(date, s);
  }
  return out;
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** A Sunday-to-Saturday grid for one month, with each day's and each week's P&L. */
export function buildMonth(trades: Trade[], year: number, month: number): CalendarMonth {
  const byDay = statsByDay(trades);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Start the grid on the Sunday on or before the 1st.
  const cursor = new Date(first);
  cursor.setUTCDate(1 - first.getUTCDay());

  const weeks: CalendarWeek[] = [];
  const lastOfMonth = new Date(Date.UTC(year, month - 1, daysInMonth));
  while (cursor <= lastOfMonth) {
    const days: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = iso(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
      const inMonth = cursor.getUTCMonth() === month - 1;
      const s = byDay.get(date);
      days.push({ date, inMonth, netPnl: s?.netPnl ?? 0, trades: s?.trades ?? 0, wins: s?.wins ?? 0, losses: s?.losses ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const own = days.filter((d) => d.inMonth);
    weeks.push({
      days,
      netPnl: round2(own.reduce((a, d) => a + d.netPnl, 0)),
      trades: own.reduce((a, d) => a + d.trades, 0),
      tradedDays: own.filter((d) => d.trades > 0).length,
    });
  }

  const all = weeks.flatMap((w) => w.days).filter((d) => d.inMonth && d.trades > 0);
  return {
    year,
    month,
    weeks,
    netPnl: round2(all.reduce((a, d) => a + d.netPnl, 0)),
    trades: all.reduce((a, d) => a + d.trades, 0),
    tradedDays: all.length,
    greenDays: all.filter((d) => d.netPnl > 0).length,
    redDays: all.filter((d) => d.netPnl < 0).length,
  };
}

/** Moves a {year, month} by a number of months. */
export function shiftMonth(year: number, month: number, by: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export interface MonthSummary {
  /** 1-12 */
  month: number;
  netPnl: number;
  trades: number;
  tradedDays: number;
}

export interface YearSummary {
  year: number;
  netPnl: number;
  trades: number;
  tradedDays: number;
  /** Only months with trades, January first. */
  months: MonthSummary[];
}

/** P&L per year and per month, newest year first, for the Year tab's list. */
export function yearSummaries(trades: Trade[]): YearSummary[] {
  const years = new Map<number, YearSummary>();
  for (const d of statsByDay(trades).values()) {
    const y = Number(d.date.slice(0, 4));
    const m = Number(d.date.slice(5, 7));
    const year = years.get(y) ?? { year: y, netPnl: 0, trades: 0, tradedDays: 0, months: [] };
    let month = year.months.find((x) => x.month === m);
    if (!month) {
      month = { month: m, netPnl: 0, trades: 0, tradedDays: 0 };
      year.months.push(month);
    }
    for (const s of [year, month]) {
      s.netPnl = round2(s.netPnl + d.netPnl);
      s.trades += d.trades;
      s.tradedDays += 1;
    }
    years.set(y, year);
  }
  for (const y of years.values()) y.months.sort((a, b) => a.month - b.month);
  return [...years.values()].sort((a, b) => b.year - a.year);
}

/**
 * Running total of net P&L by day, from `from` ("YYYY-MM-DD", inclusive) onward, starting at $0.
 * With no `from`, it covers every trade.
 */
export function equityCurve(trades: Trade[], from: string | null): { date: string; value: number }[] {
  const days = [...statsByDay(trades).values()]
    .filter((d) => (from === null || d.date >= from) && d.netPnl !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (days.length === 0) return from ? [{ date: from, value: 0 }] : [];
  const points: { date: string; value: number }[] = [];
  // Start the line at $0 on the first day of the range, unless a trade already sits there.
  if (from !== null && from < days[0].date) points.push({ date: from, value: 0 });
  let total = 0;
  for (const d of days) {
    total = round2(total + d.netPnl);
    points.push({ date: d.date, value: total });
  }
  return points;
}
