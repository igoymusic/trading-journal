import { describe, expect, it } from 'vitest';
import { cleanIndicators, computeIndicator, newIndicator, vwap } from '../src/core/indicators';
import type { Bar } from '../src/core/alpaca';

const min = 60_000;
// 2026-10-09 10:00 New York.
const t0 = Date.parse('2026-10-09T14:00:00Z');
const bar = (i: number, close: number, volume = 100): Bar => ({ time: t0 + i * min, open: close, high: close + 1, low: close - 1, close, volume });

describe('indicators', () => {
  const bars = [1, 2, 3, 4, 5, 6].map((c, i) => bar(i, c));
  const input = { chartBars: bars, chartMinutes: 1, minuteBars: bars };

  it('works out simple, weighted and exponential averages like TradingView', () => {
    const sma = computeIndicator({ ...newIndicator('ma', 'a'), length: 3 }, input).main;
    expect(sma.map((p) => p.value)).toEqual([2, 3, 4, 5]);
    const wma = computeIndicator({ ...newIndicator('ma', 'a'), length: 3, maType: 'wma' }, input).main;
    expect(wma[0].value).toBeCloseTo((1 + 4 + 9) / 6);
    const ema = computeIndicator({ ...newIndicator('ma', 'a'), length: 3, maType: 'ema' }, input).main;
    // Starts at the simple average, then 2/(3+1) of each new value.
    expect(ema[0].value).toBe(2);
    expect(ema[1].value).toBeCloseTo(4 * 0.5 + 2 * 0.5);
  });

  it('draws Bollinger Bands with the population standard deviation', () => {
    const r = computeIndicator({ ...newIndicator('bb', 'b'), length: 3, mult: 2 }, input);
    const sd = Math.sqrt(2 / 3);
    expect(r.upper![0].value).toBeCloseTo(2 + 2 * sd);
    expect(r.lower![0].value).toBeCloseTo(2 - 2 * sd);
  });

  it('uses earlier history so the line starts filled in', () => {
    const chartBars = bars.slice(3);
    const r = computeIndicator({ ...newIndicator('ma', 'a'), length: 3 }, { chartBars, chartMinutes: 1, minuteBars: bars });
    expect(r.main.map((p) => p.value)).toEqual([3, 4, 5]);
  });

  it('takes a daily average onto minute candles, waiting for closes or forming', () => {
    const dailyBars = [10, 20, 30].map((c, i) => ({ day: `2026-10-0${6 + i}`, open: c, high: c, low: c, close: c, volume: 0 }));
    const day = { chartBars: bars, chartMinutes: 1, minuteBars: bars, dailyBars };
    const waiting = computeIndicator({ ...newIndicator('ma', 'a'), length: 3, timeframe: 'D' }, day).main;
    // Only finished days: 10, 20, 30.
    expect(waiting.every((p) => p.value === 20)).toBe(true);
    const forming = computeIndicator({ ...newIndicator('ma', 'a'), length: 3, timeframe: 'D', waitForClose: false }, day).main;
    // The last two days plus today's price so far.
    expect(forming.map((p) => p.value)).toEqual([1, 2, 3, 4, 5, 6].map((c) => (20 + 30 + c) / 3));
  });

  it('takes a 5-minute average onto 1-minute candles', () => {
    const many = Array.from({ length: 20 }, (_, i) => bar(i, i));
    const r = computeIndicator({ ...newIndicator('ma', 'a'), length: 2, timeframe: 5 }, { chartBars: many, chartMinutes: 1, minuteBars: many });
    // 5-minute closes: 4, 9, 14, 19. Minute 9 finishes the second one.
    const at = (i: number) => r.main.find((p) => p.time === t0 + i * min)?.value;
    expect(at(9)).toBe((4 + 9) / 2);
    expect(at(10)).toBe((4 + 9) / 2);
    expect(at(14)).toBe((9 + 14) / 2);
  });

  it('starts VWAP over each day', () => {
    const next = { ...bar(0, 50), time: t0 + 86_400_000 };
    const v = vwap([bar(0, 10, 100), bar(1, 20, 300), next]);
    expect(v[1].value).toBeCloseTo((10 * 100 + 20 * 300) / 400);
    expect(v[2].value).toBe(50);
  });

  it('cleans saved settings', () => {
    const [i] = cleanIndicators([{ id: 'x', kind: 'ma', length: 9999, timeframe: 'D', color: 'nope' }, { kind: 'bogus' }]);
    expect(i).toMatchObject({ length: 500, timeframe: 'D', color: '#ff9800' });
    expect(cleanIndicators('x')).toEqual([]);
  });
});
