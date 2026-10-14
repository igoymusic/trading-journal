// Chart indicators: moving averages, Bollinger Bands and VWAP. A moving average or Bollinger
// Bands can be worked out on another timeframe than the chart's (e.g. a 20-day average on a
// one-minute chart), the way TradingView's "Timeframe" input does.

import type { Bar } from './alpaca';

export type IndicatorKind = 'ma' | 'bb' | 'vwap';
export type MaType = 'sma' | 'ema' | 'wma';
export type PriceSource = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4';
/** 'chart' follows the chart; a number is minutes; 'D' is daily. */
export type IndicatorTimeframe = 'chart' | 1 | 5 | 15 | 30 | 60 | 'D';

export interface Indicator {
  id: string;
  kind: IndicatorKind;
  visible: boolean;
  maType: MaType;
  length: number;
  source: PriceSource;
  timeframe: IndicatorTimeframe;
  /** Only change when the other timeframe's candle closes (TradingView's "Wait for timeframe closes"). */
  waitForClose: boolean;
  /** Bollinger Bands' width in standard deviations. */
  mult: number;
  color: string;
  width: number;
  /** Shading between Bollinger Bands, 0 to 1. */
  fillOpacity: number;
}

export const MA_TYPES: { value: MaType; label: string }[] = [
  { value: 'sma', label: 'Simple (SMA)' }, { value: 'ema', label: 'Exponential (EMA)' }, { value: 'wma', label: 'Weighted (WMA)' },
];
export const SOURCES: PriceSource[] = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'];
export const TIMEFRAMES: { value: IndicatorTimeframe; label: string }[] = [
  { value: 'chart', label: 'Same as chart' }, { value: 1, label: '1 minute' }, { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' }, { value: 30, label: '30 minutes' }, { value: 60, label: '1 hour' }, { value: 'D', label: '1 day' },
];

export function newIndicator(kind: IndicatorKind, id: string): Indicator {
  const base = { id, kind, visible: true, maType: 'sma' as MaType, source: 'close' as PriceSource, timeframe: 'chart' as IndicatorTimeframe, waitForClose: true, mult: 2, width: 1.5, fillOpacity: 0.08 };
  if (kind === 'bb') return { ...base, length: 20, color: '#2962ff' };
  if (kind === 'vwap') return { ...base, length: 1, source: 'hlc3', color: '#e040fb' };
  return { ...base, length: 20, color: '#ff9800' };
}

/** Fills in defaults and drops anything that isn't a real setting. */
export function cleanIndicators(saved: unknown): Indicator[] {
  if (!Array.isArray(saved)) return [];
  const tfs = new Set<unknown>(TIMEFRAMES.map((t) => t.value));
  return saved.slice(0, 20).flatMap((s): Indicator[] => {
    if (!s || typeof s !== 'object' || !['ma', 'bb', 'vwap'].includes(s.kind) || typeof s.id !== 'string') return [];
    const d = newIndicator(s.kind, s.id);
    const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
    return [{
      ...d,
      visible: s.visible !== false,
      maType: MA_TYPES.some((m) => m.value === s.maType) ? s.maType : d.maType,
      length: Math.round(num(s.length, 1, 500, d.length)),
      source: SOURCES.includes(s.source) ? s.source : d.source,
      timeframe: tfs.has(s.timeframe) ? s.timeframe : d.timeframe,
      waitForClose: s.waitForClose !== false,
      mult: num(s.mult, 0.1, 10, d.mult),
      color: typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : d.color,
      width: num(s.width, 1, 4, d.width),
      fillOpacity: num(s.fillOpacity, 0, 0.8, d.fillOpacity),
    }];
  });
}

/** "SMA 20 close · 1D" for the chart's legend. */
export function indicatorName(i: Indicator): string {
  if (i.kind === 'vwap') return 'VWAP';
  const tf = i.timeframe === 'chart' ? '' : ` · ${i.timeframe === 'D' ? '1D' : i.timeframe === 60 ? '1h' : `${i.timeframe}m`}`;
  const ma = i.maType.toUpperCase();
  return i.kind === 'bb' ? `BB ${i.length} ${i.mult} ${i.source}${i.maType === 'sma' ? '' : ` ${ma}`}${tf}` : `${ma} ${i.length} ${i.source}${tf}`;
}

export function sourceValue(b: Bar, s: PriceSource): number {
  switch (s) {
    case 'open': return b.open;
    case 'high': return b.high;
    case 'low': return b.low;
    case 'hl2': return (b.high + b.low) / 2;
    case 'hlc3': return (b.high + b.low + b.close) / 3;
    case 'ohlc4': return (b.open + b.high + b.low + b.close) / 4;
    default: return b.close;
  }
}

/** Groups minute bars into larger candles. */
export function aggregateBars(bars: Bar[], minutes: number): Bar[] {
  if (minutes === 1) return bars;
  const size = minutes * 60_000;
  const out: Bar[] = [];
  for (const b of bars) {
    const bucket = Math.floor(b.time / size) * size;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
    } else {
      out.push({ ...b, time: bucket });
    }
  }
  return out;
}

/** One daily candle, by New York date. */
export interface DayBar { day: string; open: number; high: number; low: number; close: number; volume: number }

// Date formatting is slow, and New York's date only changes on the hour: remember it per hour.
const dayByHour = new Map<number, string>();
export const nyDay = (ms: number) => {
  const hour = Math.floor(ms / 3_600_000);
  let d = dayByHour.get(hour);
  if (d === undefined) {
    d = new Date(hour * 3_600_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    dayByHour.set(hour, d);
  }
  return d;
};

/** The values an average is taken over, with exponential averages carried along as they go. */
class Averager {
  private ema: (number | null)[] = [];
  constructor(private type: MaType, private length: number, private values: number[]) {
    if (type !== 'ema') return;
    // Starts from a simple average, like TradingView.
    const a = 2 / (length + 1);
    let prev: number | null = null;
    let sum = 0;
    values.forEach((v, i) => {
      if (prev === null) {
        sum += v;
        if (i === length - 1) prev = sum / length;
      } else prev = v * a + prev * (1 - a);
      this.ema.push(prev);
    });
  }

  /** The average over the first `count` values, plus `extra` as one more if given. */
  at(count: number, extra?: number): number | null {
    const n = this.length;
    const total = count + (extra === undefined ? 0 : 1);
    if (total < n) return null;
    if (this.type === 'ema') {
      if (extra === undefined) return this.ema[count - 1] ?? null;
      const prev = this.ema[count - 1];
      if (prev === null || prev === undefined) return null;
      const a = 2 / (n + 1);
      return extra * a + prev * (1 - a);
    }
    const window = this.window(count, extra);
    if (this.type === 'wma') return window.reduce((s, v, i) => s + v * (i + 1), 0) / ((n * (n + 1)) / 2);
    return window.reduce((s, v) => s + v, 0) / n;
  }

  /** Population standard deviation over the same window (what TradingView's Bollinger Bands use). */
  stdev(count: number, extra?: number): number | null {
    const total = count + (extra === undefined ? 0 : 1);
    if (total < this.length) return null;
    const window = this.window(count, extra);
    const mean = window.reduce((s, v) => s + v, 0) / window.length;
    return Math.sqrt(window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length);
  }

  private window(count: number, extra?: number) {
    const take = extra === undefined ? this.length : this.length - 1;
    const w = this.values.slice(Math.max(0, count - take), count);
    if (extra !== undefined) w.push(extra);
    return w;
  }
}

export interface IndicatorInput {
  /** The chart's candles (already grouped to the chart's timeframe), oldest first. */
  chartBars: Bar[];
  chartMinutes: number;
  /** Minute candles: earlier days' history followed by the chart's own, oldest first. */
  minuteBars: Bar[];
  /** Completed daily candles before the chart's last day, oldest first (only needed for 'D'). */
  dailyBars?: DayBar[];
  /** For an index (no volume of its own): its ETF's minute candles, whose volume VWAP uses. */
  volumeBars?: Bar[];
}

export interface IndicatorPoint { time: number; value: number }
export interface IndicatorResult {
  /** Middle line (the average, the Bollinger basis, or VWAP). */
  main: IndicatorPoint[];
  upper?: IndicatorPoint[];
  lower?: IndicatorPoint[];
}

/** The indicator's values at each of the chart's candles. */
export function computeIndicator(ind: Indicator, input: IndicatorInput): IndicatorResult {
  if (ind.kind === 'vwap') {
    if (!input.volumeBars) return { main: vwap(input.chartBars, ind.source) };
    // Each chart candle gets the ETF's volume over the same minutes.
    const size = input.chartMinutes * 60_000;
    const vol = new Map<number, number>();
    for (const b of input.volumeBars) {
      const k = Math.floor(b.time / size) * size;
      vol.set(k, (vol.get(k) ?? 0) + b.volume);
    }
    return { main: vwap(input.chartBars, ind.source, (t) => vol.get(t) ?? 0) };
  }
  const { chartBars, chartMinutes } = input;
  const chartSize = chartMinutes * 60_000;
  const main: IndicatorPoint[] = [];
  const upper: IndicatorPoint[] = [];
  const lower: IndicatorPoint[] = [];
  const push = (time: number, avg: Averager, count: number, extra?: number) => {
    const m = avg.at(count, extra);
    if (m === null) return;
    main.push({ time, value: m });
    if (ind.kind === 'bb') {
      const sd = avg.stdev(count, extra);
      if (sd === null) return;
      upper.push({ time, value: m + ind.mult * sd });
      lower.push({ time, value: m - ind.mult * sd });
    }
  };

  if (ind.timeframe === 'chart' || ind.timeframe === chartMinutes) {
    // On the chart's own candles, with earlier history first so the line starts filled in.
    const firstChart = chartBars[0]?.time ?? Infinity;
    const history = aggregateBars(input.minuteBars.filter((b) => b.time < firstChart), chartMinutes);
    const all = [...history, ...chartBars];
    const avg = new Averager(ind.maType, ind.length, all.map((b) => sourceValue(b, ind.source)));
    chartBars.forEach((b, i) => push(b.time, avg, history.length + i + 1));
    return ind.kind === 'bb' ? { main, upper, lower } : { main };
  }

  // Another timeframe: build its candles, then for each chart candle use the ones finished by
  // the time it closes, plus (unless waiting for closes) the one still forming.
  let periods: { start: number; key: string; bar: Bar }[];
  let periodOf: (ms: number) => string;
  if (ind.timeframe === 'D') {
    periodOf = nyDay;
    const official = new Map((input.dailyBars ?? []).map((d) => [d.day, d]));
    const fromMinutes = new Map<string, Bar>();
    for (const b of input.minuteBars) {
      const day = nyDay(b.time);
      const cur = fromMinutes.get(day);
      if (!cur) fromMinutes.set(day, { ...b });
      else { cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.volume += b.volume; }
    }
    const days = [...new Set([...official.keys(), ...fromMinutes.keys()])].sort();
    periods = days.map((day) => {
      const o = official.get(day);
      const bar = o ? { time: 0, open: o.open, high: o.high, low: o.low, close: o.close, volume: o.volume } : fromMinutes.get(day)!;
      return { start: 0, key: day, bar };
    });
  } else {
    const size = ind.timeframe * 60_000;
    periodOf = (ms) => String(Math.floor(ms / size) * size);
    periods = aggregateBars(input.minuteBars, ind.timeframe).map((bar) => ({ start: bar.time, key: String(bar.time), bar }));
  }
  const index = new Map(periods.map((p, i) => [p.key, i]));
  const values = periods.map((p) => sourceValue(p.bar, ind.source));
  const avg = new Averager(ind.maType, ind.length, values);
  const minutes = input.minuteBars;
  // The forming candle, built up minute by minute as the chart candles go by.
  let k = 0;
  let formingKey = '';
  let forming: Bar | null = null;
  for (const c of chartBars) {
    const closes = c.time + chartSize;
    const key = periodOf(c.time);
    const current = index.get(key);
    if (current === undefined) continue;
    // Does the chart candle finish this period? (A daily period ends with the day's last candle.)
    const nextKey = periodOf(closes);
    const periodDone = ind.timeframe === 'D' ? false : nextKey !== key;
    const finished = periodDone ? current + 1 : current;
    if (ind.waitForClose || periodDone) { push(c.time, avg, finished); continue; }
    // The forming candle: this period's minutes up to the chart candle's close.
    while (k < minutes.length && minutes[k].time < closes) {
      const b = minutes[k++];
      const bk = periodOf(b.time);
      if (bk !== formingKey || !forming) { formingKey = bk; forming = { ...b }; }
      else { forming.high = Math.max(forming.high, b.high); forming.low = Math.min(forming.low, b.low); forming.close = b.close; }
    }
    if (forming && formingKey === key) push(c.time, avg, current, sourceValue(forming, ind.source));
  }
  return ind.kind === 'bb' ? { main, upper, lower } : { main };
}

/** Volume-weighted average price, starting over each New York trading day. */
export function vwap(bars: Bar[], source: PriceSource = 'hlc3', volumeAt?: (time: number) => number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  let day = '';
  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    const d = nyDay(b.time);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    const v = volumeAt ? volumeAt(b.time) : b.volume;
    pv += sourceValue(b, source) * v;
    vol += v;
    if (vol > 0) out.push({ time: b.time, value: pv / vol });
  }
  return out;
}

/** How many candles of history the indicator needs before the chart starts. */
export function historyNeeded(ind: Indicator): number {
  if (ind.kind === 'vwap') return 0;
  return ind.maType === 'ema' ? ind.length * 4 + 10 : ind.length + 2;
}
