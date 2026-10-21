// Goals you set for yourself (a daily target, a max daily loss, a cap on trades per day and a
// monthly target), and how each day and month measured up.

import { type DayStats, statsByDay, tradeDay } from './calendar';
import { isCounted, type Trade } from './types';

/** Any goal left out isn't tracked. Dollar amounts are positive (a $200 max loss is 200). */
export interface Goals {
  dailyTarget?: number;
  dailyMaxLoss?: number;
  maxTradesPerDay?: number;
  /** Most losing trades you allow yourself in a day. */
  maxLossesPerDay?: number;
  monthlyTarget?: number;
  /** Goals you make up yourself, e.g. "win rate at least 60% each week". */
  custom?: CustomGoal[];
}

export type GoalMetric = 'netPnl' | 'winRate' | 'trades' | 'losingTrades' | 'profitFactor' | 'largestLoss' | 'avgWin' | 'avgRating' | 'mistakes' | 'positives';
export type GoalPeriod = 'day' | 'week' | 'month';

export interface CustomGoal {
  id: string;
  /** Your own name for it; empty uses a description built from the rest. */
  name: string;
  metric: GoalMetric;
  op: 'atLeast' | 'atMost';
  value: number;
  period: GoalPeriod;
}

export const GOAL_METRICS: { key: GoalMetric; label: string; unit: '$' | '%' | '' }[] = [
  { key: 'netPnl', label: 'Net P&L', unit: '$' },
  { key: 'winRate', label: 'Win rate', unit: '%' },
  { key: 'trades', label: 'Number of trades', unit: '' },
  { key: 'losingTrades', label: 'Losing trades', unit: '' },
  { key: 'profitFactor', label: 'Profit factor', unit: '' },
  { key: 'largestLoss', label: 'Largest loss on one trade', unit: '$' },
  { key: 'avgWin', label: 'Average winner', unit: '$' },
  { key: 'avgRating', label: 'Average rating (stars)', unit: '' },
  { key: 'mistakes', label: 'Mistakes tagged', unit: '' },
  { key: 'positives', label: 'Positive tags', unit: '' },
];

export const hasGoals = (g: Goals) =>
  [g.dailyTarget, g.dailyMaxLoss, g.maxTradesPerDay, g.maxLossesPerDay, g.monthlyTarget].some((v) => v !== undefined) || !!g.custom?.length;

/** "Win rate at least 60% per week" */
export function describeGoal(g: CustomGoal): string {
  if (g.name.trim()) return g.name.trim();
  const m = GOAL_METRICS.find((x) => x.key === g.metric)!;
  const v = m.unit === '$' ? `$${g.value.toLocaleString()}` : m.unit === '%' ? `${g.value}%` : String(g.value);
  return `${m.label} ${g.op === 'atLeast' ? 'at least' : 'at most'} ${v} per ${g.period}`;
}

/** The value of a metric over some trades, or undefined when it can't be measured (e.g. no closed trades). */
export function metricValue(all: Trade[], metric: GoalMetric): number | undefined {
  const trades = all.filter(isCounted);
  const closed = trades.filter((t) => t.status === 'CLOSED');
  const wins = closed.filter((t) => t.netPnl > 0);
  const losses = closed.filter((t) => t.netPnl < 0);
  const sum = (ts: Trade[]) => ts.reduce((a, t) => a + t.netPnl, 0);
  switch (metric) {
    case 'netPnl': return Math.round(sum(closed) * 100) / 100;
    case 'winRate': return closed.length ? (wins.length / closed.length) * 100 : undefined;
    case 'trades': return trades.length;
    case 'losingTrades': return losses.length;
    case 'profitFactor': return losses.length ? sum(wins) / -sum(losses) : wins.length ? Infinity : undefined;
    case 'largestLoss': return closed.length ? Math.max(0, ...losses.map((t) => -t.netPnl)) : undefined;
    case 'avgWin': return wins.length ? sum(wins) / wins.length : undefined;
    case 'avgRating': {
      const rated = trades.map((t) => t.journal?.rating).filter((r): r is number => !!r);
      return rated.length ? rated.reduce((a, r) => a + r, 0) / rated.length : undefined;
    }
    case 'mistakes': return trades.reduce((a, t) => a + (t.journal?.mistakes.length ?? 0), 0);
    case 'positives': return trades.reduce((a, t) => a + (t.journal?.positives?.length ?? 0), 0);
  }
}

/** Which day, week (its Monday) or month a trade counts toward. */
export function periodKey(t: Trade, period: GoalPeriod): string {
  const day = tradeDay(t);
  if (period === 'day') return day;
  if (period === 'month') return day.slice(0, 7);
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export interface CustomGoalResult {
  goal: CustomGoal;
  /** Each period you traded in the month, oldest first, with whether it met the goal. */
  periods: { key: string; value: number | undefined; met: boolean | undefined }[];
  met: number;
  measured: number;
}

/** How a custom goal went over the days, weeks or the month of "YYYY-MM" that you traded in. */
export function customGoalResult(trades: Trade[], goal: CustomGoal, monthKey: string): CustomGoalResult {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!tradeDay(t).startsWith(monthKey)) continue;
    const k = periodKey(t, goal.period);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const periods = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, ts]) => {
    const value = metricValue(ts, goal.metric);
    return { key, value, met: value === undefined ? undefined : goal.op === 'atLeast' ? value >= goal.value : value <= goal.value };
  });
  return { goal, periods, met: periods.filter((p) => p.met).length, measured: periods.filter((p) => p.met !== undefined).length };
}

export interface DayGoalCheck {
  hitTarget?: boolean;
  /** Lost more than the max daily loss. */
  overMaxLoss?: boolean;
  /** Took more trades than the daily cap. */
  overTrades?: boolean;
  /** Had more losing trades than the daily cap. */
  overLosses?: boolean;
}

export function checkDay(day: DayStats, g: Goals): DayGoalCheck {
  return {
    hitTarget: g.dailyTarget === undefined ? undefined : day.netPnl >= g.dailyTarget,
    overMaxLoss: g.dailyMaxLoss === undefined ? undefined : day.netPnl < -g.dailyMaxLoss,
    overTrades: g.maxTradesPerDay === undefined ? undefined : day.trades > g.maxTradesPerDay,
    overLosses: g.maxLossesPerDay === undefined ? undefined : day.losses > g.maxLossesPerDay,
  };
}

/** A day broke one of your limits (max loss or max trades). */
export const brokeLimit = (c: DayGoalCheck) => !!(c.overMaxLoss || c.overTrades || c.overLosses);

export interface MonthGoals {
  netPnl: number;
  /** Share of the monthly target reached so far (can pass 1, or be negative). */
  monthlyProgress?: number;
  tradedDays: number;
  daysHitTarget?: number;
  daysWithinMaxLoss?: number;
  daysWithinMaxTrades?: number;
  daysWithinMaxLosses?: number;
}

/** How a month ("YYYY-MM") is going against your goals, over the days you traded. */
export function monthGoals(trades: Trade[], monthKey: string, g: Goals): MonthGoals {
  const days = [...statsByDay(trades).values()].filter((d) => d.date.startsWith(monthKey) && d.trades > 0);
  const checks = days.map((d) => checkDay(d, g));
  const count = (f: (c: DayGoalCheck) => boolean | undefined, goal: number | undefined) =>
    goal === undefined ? undefined : checks.filter(f).length;
  const netPnl = Math.round(days.reduce((a, d) => a + d.netPnl, 0) * 100) / 100;
  return {
    netPnl,
    monthlyProgress: g.monthlyTarget ? netPnl / g.monthlyTarget : undefined,
    tradedDays: days.length,
    daysHitTarget: count((c) => c.hitTarget, g.dailyTarget),
    daysWithinMaxLoss: count((c) => !c.overMaxLoss, g.dailyMaxLoss),
    daysWithinMaxTrades: count((c) => !c.overTrades, g.maxTradesPerDay),
    daysWithinMaxLosses: count((c) => !c.overLosses, g.maxLossesPerDay),
  };
}
