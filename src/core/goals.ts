// Goals you set for yourself (a daily target, a max daily loss, a cap on trades per day and a
// monthly target), and how each day and month measured up.

import { type DayStats, statsByDay } from './calendar';
import type { Trade } from './types';

/** Any goal left out isn't tracked. Dollar amounts are positive (a $200 max loss is 200). */
export interface Goals {
  dailyTarget?: number;
  dailyMaxLoss?: number;
  maxTradesPerDay?: number;
  monthlyTarget?: number;
}

export const hasGoals = (g: Goals) => Object.values(g).some((v) => v !== undefined);

export interface DayGoalCheck {
  hitTarget?: boolean;
  /** Lost more than the max daily loss. */
  overMaxLoss?: boolean;
  /** Took more trades than the daily cap. */
  overTrades?: boolean;
}

export function checkDay(day: DayStats, g: Goals): DayGoalCheck {
  return {
    hitTarget: g.dailyTarget === undefined ? undefined : day.netPnl >= g.dailyTarget,
    overMaxLoss: g.dailyMaxLoss === undefined ? undefined : day.netPnl < -g.dailyMaxLoss,
    overTrades: g.maxTradesPerDay === undefined ? undefined : day.trades > g.maxTradesPerDay,
  };
}

/** A day broke one of your limits (max loss or max trades). */
export const brokeLimit = (c: DayGoalCheck) => !!(c.overMaxLoss || c.overTrades);

export interface MonthGoals {
  netPnl: number;
  /** Share of the monthly target reached so far (can pass 1, or be negative). */
  monthlyProgress?: number;
  tradedDays: number;
  daysHitTarget?: number;
  daysWithinMaxLoss?: number;
  daysWithinMaxTrades?: number;
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
  };
}
