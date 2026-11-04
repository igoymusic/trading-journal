// Numbers behind the charts on Home and Reports: the trading score, how wins and losses are spread
// out, when in the week you make or lose money, drawdowns, streaks and hold times.
// Only closed trades count, the same as the reports.

import { statsByDay } from './calendar';
import type { Trade } from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number) => Math.max(0, Math.min(100, n));
// Trades with their Include box unticked are left out (the field arrives with the Include column).
const closedOnly = (trades: Trade[]) => trades.filter((t) => t.status === 'CLOSED' && !(t.journal as { excluded?: boolean } | undefined)?.excluded);

export interface ScoreAxis {
  key: string;
  label: string;
  /** 0-100, where 100 is the outer edge of the radar chart. */
  score: number;
  /** The real number behind the score, ready to show. */
  value: string;
  /** What the axis measures and what earns a full score. */
  explain: string;
}

export interface TradeScore {
  axes: ScoreAxis[];
  /** Average of the axes, 0-100. */
  overall: number;
}

/**
 * A 0-100 score on six things that make a trader consistently profitable, drawn as a radar chart.
 * Each axis tops out at a level most traders would be happy with, so a full shape is a strong month.
 */
export function tradeScore(trades: Trade[]): TradeScore | null {
  const closed = closedOnly(trades);
  if (closed.length === 0) return null;
  const wins = closed.filter((t) => t.netPnl > 0);
  const losses = closed.filter((t) => t.netPnl < 0);
  const grossWin = wins.reduce((a, t) => a + t.netPnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.netPnl, 0);
  const winRate = wins.length / closed.length;
  const pf = grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const ratio = avgLoss ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;
  const dd = drawdown(closed);
  const maxDd = -Math.min(0, ...dd.map((p) => p.drawdown));
  const net = grossWin - grossLoss;
  const recovery = maxDd ? net / maxDd : net > 0 ? Infinity : 0;
  const days = [...statsByDay(closed).values()].filter((d) => d.netPnl !== 0);
  const greenDays = days.filter((d) => d.netPnl > 0).length;
  const dayRate = days.length ? greenDays / days.length : 0;

  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '∞');
  const axes: ScoreAxis[] = [
    { key: 'winRate', label: 'Win %', score: clamp((winRate / 0.6) * 100), value: `${Math.round(winRate * 100)}%`,
      explain: 'Share of trades that made money. 60% or more scores full.' },
    { key: 'profitFactor', label: 'Profit factor', score: clamp((pf / 2.5) * 100), value: fmt(pf),
      explain: 'Total won divided by total lost. 2.5 or more scores full.' },
    { key: 'winLoss', label: 'Win/loss size', score: clamp((ratio / 2) * 100), value: fmt(ratio),
      explain: 'How big your average win is next to your average loss. 2 or more scores full.' },
    { key: 'drawdown', label: 'Drawdown', score: grossWin ? clamp(100 - (maxDd / grossWin) * 200) : 0, value: `−$${Math.round(maxDd).toLocaleString('en-US')}`,
      explain: 'Biggest drop from a high point in your running P&L, next to everything you won. Smaller is better.' },
    { key: 'recovery', label: 'Recovery', score: clamp((recovery / 3) * 100), value: fmt(recovery),
      explain: 'Net P&L divided by the biggest drawdown: how well you climb back. 3 or more scores full.' },
    { key: 'greenDays', label: 'Green days', score: clamp((dayRate / 0.7) * 100), value: `${Math.round(dayRate * 100)}%`,
      explain: 'Share of trading days that ended green. 70% or more scores full.' },
  ];
  const overall = Math.round(axes.reduce((a, x) => a + x.score, 0) / axes.length);
  return { axes: axes.map((a) => ({ ...a, score: Math.round(a.score) })), overall };
}

/** Running P&L by day, and how far below its last high point it sits (0 or negative). */
export function drawdown(trades: Trade[]): { date: string; equity: number; drawdown: number }[] {
  const days = [...statsByDay(closedOnly(trades)).values()].filter((d) => d.netPnl !== 0).sort((a, b) => a.date.localeCompare(b.date));
  let equity = 0;
  let peak = 0;
  return days.map((d) => {
    equity = round2(equity + d.netPnl);
    peak = Math.max(peak, equity);
    return { date: d.date, equity, drawdown: round2(equity - peak) };
  });
}

export interface HistogramBin {
  /** Lower edge, inclusive, in dollars. */
  from: number;
  /** Upper edge, exclusive. */
  to: number;
  count: number;
}

/** A round bin width (1, 2, 2.5 or 5 times a power of ten) that splits `span` into about `target` bins. */
export function niceStep(span: number, target: number): number {
  if (span <= 0) return 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
}

/**
 * How many trades landed in each P&L range, with bins of a round width. Zero is always a bin edge,
 * so a bin is all wins or all losses.
 */
export function pnlHistogram(trades: Trade[], target = 16): HistogramBin[] {
  const values = closedOnly(trades).map((t) => t.netPnl);
  if (values.length === 0) return [];
  // Trim the farthest 2% on each side so one huge day doesn't squash everything else into one bar;
  // those trades still count, in the end bins.
  const sorted = [...values].sort((a, b) => a - b);
  const lo = Math.min(0, sorted[Math.floor(sorted.length * 0.02)]);
  const hi = Math.max(0, sorted[Math.ceil(sorted.length * 0.98) - 1]);
  const step = niceStep(hi - lo, target);
  const first = Math.floor(lo / step) * step;
  const last = Math.max(Math.ceil(hi / step) * step, first + step);
  const bins: HistogramBin[] = [];
  for (let x = first; x < last - step / 2; x += step) bins.push({ from: round2(x), to: round2(x + step), count: 0 });
  for (const v of values) {
    const i = Math.floor((v - first) / step);
    bins[Math.max(0, Math.min(bins.length - 1, i))].count += 1;
  }
  return bins;
}

export interface HeatCell {
  /** 1 = Monday ... 5 = Friday. */
  weekday: number;
  /** Hour of entry, 9 = 9:30-10:00 (the open), 10 = 10:00-11:00 ... 15 = 3:00-4:00. */
  hour: number;
  trades: number;
  wins: number;
  netPnl: number;
}

export const HEAT_HOURS = [9, 10, 11, 12, 13, 14, 15];

/** Net P&L for each weekday and hour you entered, Monday to Friday during market hours. */
export function weekdayHourHeat(trades: Trade[]): HeatCell[] {
  const cells: HeatCell[] = [];
  for (let weekday = 1; weekday <= 5; weekday++) for (const hour of HEAT_HOURS) cells.push({ weekday, hour, trades: 0, wins: 0, netPnl: 0 });
  for (const t of closedOnly(trades)) {
    const weekday = new Date(`${t.openTime.slice(0, 10)}T12:00:00`).getDay();
    const hour = Math.max(9, Math.min(15, Number(t.openTime.slice(11, 13))));
    const cell = cells.find((c) => c.weekday === weekday && c.hour === hour);
    if (!cell) continue;
    cell.trades += 1;
    if (t.netPnl > 0) cell.wins += 1;
    cell.netPnl = round2(cell.netPnl + t.netPnl);
  }
  return cells;
}

/** Minutes from the first fill to the last. */
export const holdMinutes = (t: Trade) => (t.closeTime ? Math.max(0, (Date.parse(t.closeTime) - Date.parse(t.openTime)) / 60_000) : 0);

export interface Streaks {
  /** Positive for wins in a row, negative for losses, counted back from the latest. */
  currentTrades: number;
  currentDays: number;
  bestTrades: number;
  worstTrades: number;
  bestDays: number;
  worstDays: number;
}

function runs(results: number[]) {
  let current = 0;
  let best = 0;
  let worst = 0;
  for (const r of results) {
    if (r > 0) current = current > 0 ? current + 1 : 1;
    else if (r < 0) current = current < 0 ? current - 1 : -1;
    else continue;
    best = Math.max(best, current);
    worst = Math.min(worst, current);
  }
  return { current, best, worst };
}

/** Longest and current runs of winning and losing trades and days. Break-even ones are skipped. */
export function streaks(trades: Trade[]): Streaks {
  const closed = closedOnly(trades).sort((a, b) => (a.closeTime ?? '').localeCompare(b.closeTime ?? ''));
  const byTrade = runs(closed.map((t) => t.netPnl));
  const byDay = runs([...statsByDay(closed).values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => d.netPnl));
  return {
    currentTrades: byTrade.current, bestTrades: byTrade.best, worstTrades: byTrade.worst,
    currentDays: byDay.current, bestDays: byDay.best, worstDays: byDay.worst,
  };
}

export interface ExtraStats {
  /** Average net P&L per trade. */
  expectancy: number;
  largestWin: number;
  largestLoss: number;
  bestDay: { date: string; netPnl: number } | null;
  worstDay: { date: string; netPnl: number } | null;
  greenDays: number;
  redDays: number;
  /** Average minutes held, for winners and for losers. */
  avgHoldWin: number;
  avgHoldLoss: number;
}

export function extraStats(trades: Trade[]): ExtraStats {
  const closed = closedOnly(trades);
  const wins = closed.filter((t) => t.netPnl > 0);
  const losses = closed.filter((t) => t.netPnl < 0);
  const days = [...statsByDay(closed).values()].filter((d) => d.netPnl !== 0);
  const avgHold = (ts: Trade[]) => (ts.length ? ts.reduce((a, t) => a + holdMinutes(t), 0) / ts.length : 0);
  const pick = (better: (a: number, b: number) => boolean) =>
    days.reduce<{ date: string; netPnl: number } | null>((best, d) => (!best || better(d.netPnl, best.netPnl) ? { date: d.date, netPnl: d.netPnl } : best), null);
  return {
    expectancy: closed.length ? round2(closed.reduce((a, t) => a + t.netPnl, 0) / closed.length) : 0,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.netPnl)) : 0,
    largestLoss: losses.length ? Math.min(...losses.map((t) => t.netPnl)) : 0,
    bestDay: pick((a, b) => a > b),
    worstDay: pick((a, b) => a < b),
    greenDays: days.filter((d) => d.netPnl > 0).length,
    redDays: days.filter((d) => d.netPnl < 0).length,
    avgHoldWin: avgHold(wins),
    avgHoldLoss: avgHold(losses),
  };
}
