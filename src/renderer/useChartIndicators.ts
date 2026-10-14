// Draws the chosen indicators on a price chart, fetching the earlier history they need (other
// days' minutes, or daily candles) and redrawing when the list or the replay position changes.

import { useEffect, useRef, useState } from 'react';
import { type IChartApi, type ISeriesApi, LineSeries, type UTCTimestamp } from 'lightweight-charts';
import type { Bar } from '../core/alpaca';
import { aggregateBars, computeIndicator, nyDay, type DayBar, historyNeeded, type Indicator, indicatorName, type IndicatorResult } from '../core/indicators';
import { chartTime } from '../core/time';
import type { TradeChart } from '../shared/api';
import { BandFill } from './bandFill';
import { onIndicatorsChange, indicators as currentIndicators } from './indicatorsStore';
import { withAlpha } from './colors';

type OkChart = Extract<TradeChart, { status: 'ok' }>;
/** The ETF whose volume stands in for an index's. */
const ETF_FOR: Record<string, string> = { SPX: 'SPY', SPXW: 'SPY', XSP: 'SPY', NDX: 'QQQ', NDXP: 'QQQ', RUT: 'IWM', RUTW: 'IWM', DJX: 'DIA' };

export interface LegendEntry { id: string; name: string; color: string }

export function useChartIndicators(
  api: React.MutableRefObject<IChartApi | null>,
  candles: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>,
  built: number, chart: OkChart, underlying: string, interval: number, replayAt: number | null,
): LegendEntry[] {
  const [list, setList] = useState(currentIndicators);
  useEffect(() => onIndicatorsChange(() => setList(currentIndicators())), []);
  const [results, setResults] = useState<{ ind: Indicator; result: IndicatorResult; note?: string }[]>([]);
  // History already fetched for this chart, by what was asked.
  const history = useRef(new Map<string, Promise<Bar[] | DayBar[]>>());
  useEffect(() => { history.current.clear(); }, [chart]);

  // Work out every visible indicator's values.
  useEffect(() => {
    const visible = list.filter((i) => i.visible);
    if (!visible.length || !chart.bars.length) { setResults([]); return; }
    let cancelled = false;
    const fromSchwab = chart.feed === 'schwab';
    const firstDay = nyDay(chart.bars[0].time);
    const lastDay = nyDay(chart.bars[chart.bars.length - 1].time);
    const fetchOnce = <T extends Bar[] | DayBar[]>(key: string, load: () => Promise<T>) => {
      if (!history.current.has(key)) history.current.set(key, load());
      return history.current.get(key) as Promise<T>;
    };
    (async () => {
      const chartBars = aggregateBars(chart.bars, interval);
      const out = [];
      for (const ind of visible) {
        let minuteBars = chart.bars;
        let dailyBars: DayBar[] | undefined;
        const need = historyNeeded(ind);
        let volumeBars: Bar[] | undefined;
        if (ind.kind === 'vwap' && !chart.bars.some((b) => b.volume > 0)) {
          // An index has no volume: weight by its ETF's (SPY for SPX).
          const etf = ETF_FOR[underlying.toUpperCase()];
          const days = [...new Set(chart.bars.map((b) => nyDay(b.time)))];
          volumeBars = etf ? await fetchOnce(`v:${etf}`, () => window.journal.etfMinuteBars(etf, days)) : [];
        }
        if (ind.timeframe === 'D') {
          dailyBars = await fetchOnce(`D:${need}`, () => window.journal.historyDailyBars(underlying, lastDay, need, fromSchwab));
        } else if (need) {
          const minutes = ind.timeframe === 'chart' ? interval : ind.timeframe;
          const earlier = await fetchOnce(`m:${minutes}:${need}`, () => window.journal.historyMinuteBars(underlying, firstDay, minutes, need, fromSchwab));
          minuteBars = [...earlier, ...chart.bars];
        }
        const note = volumeBars ? (volumeBars.length ? ` (${ETF_FOR[underlying.toUpperCase()]} volume)` : ' (needs Alpaca for volume)') : undefined;
        out.push({ ind, result: computeIndicator(ind, { chartBars, chartMinutes: interval, minuteBars, dailyBars, volumeBars }), note });
      }
      if (!cancelled) setResults(out);
    })().catch(() => { if (!cancelled) setResults([]); });
    return () => { cancelled = true; };
  }, [list, chart, interval, underlying]);

  // Draw them, stopping at the replay's minute.
  useEffect(() => {
    const c = api.current;
    const main = candles.current;
    if (!c || !main) return;
    const tz = chart.timeZone;
    const shown = (pts: { time: number; value: number }[]) => pts
      .filter((p) => replayAt === null || p.time <= replayAt)
      .map((p) => ({ time: chartTime(p.time, tz) as UTCTimestamp, value: p.value }));
    const added: ISeriesApi<'Line'>[] = [];
    const fills: { series: ISeriesApi<'Line'>; band: BandFill }[] = [];
    for (const { ind, result } of results) {
      const line = (data: { time: UTCTimestamp; value: number }[], width: number) => {
        const s = c.addSeries(LineSeries, {
          color: ind.color, lineWidth: width as 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        s.setData(data);
        added.push(s);
        return s;
      };
      line(shown(result.main), ind.width);
      if (result.upper && result.lower) {
        const up = shown(result.upper);
        const lo = shown(result.lower);
        const upper = line(up, Math.max(1, ind.width - 0.5));
        line(lo, Math.max(1, ind.width - 0.5));
        if (ind.fillOpacity > 0) {
          const lower = new Map(lo.map((p) => [p.time, p.value]));
          const band = new BandFill(up.filter((p) => lower.has(p.time)).map((p) => ({ time: p.time, upper: p.value, lower: lower.get(p.time)! })), withAlpha(ind.color, ind.fillOpacity));
          upper.attachPrimitive(band);
          fills.push({ series: upper, band });
        }
      }
    }
    return () => {
      // The chart may already be gone when it was rebuilt.
      if (api.current !== c) return;
      for (const f of fills) f.series.detachPrimitive(f.band);
      for (const s of added) c.removeSeries(s);
    };
  }, [results, replayAt, built]);

  return results.map(({ ind, note }) => ({ id: ind.id, name: indicatorName(ind) + (note ?? ''), color: ind.color }));
}
