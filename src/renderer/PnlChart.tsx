import { BaselineSeries, ColorType, createChart, type Time } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { equityCurve } from '../core/calendar';
import type { Trade } from '../core/types';
import { pnlClass, signedUsd } from './format';

const RANGES = ['MTD', '3M', 'YTD', '1Y', 'All'] as const;
type Range = (typeof RANGES)[number];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** First day of the range, in local time, or null for all history. */
function rangeStart(range: Range, today: Date): string | null {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (range) {
    case 'MTD': return iso(new Date(y, m, 1));
    case '3M': return iso(new Date(y, m - 3, today.getDate()));
    case 'YTD': return iso(new Date(y, 0, 1));
    case '1Y': return iso(new Date(y - 1, m, today.getDate()));
    case 'All': return null;
  }
}

/** Running net P&L over time, green above zero and red below, like a brokerage account summary. */
export function PnlChart({ trades }: { trades: Trade[] }) {
  const [range, setRange] = useState<Range>('MTD');
  const container = useRef<HTMLDivElement>(null);
  const points = equityCurve(trades, rangeStart(range, new Date()));
  const total = points.at(-1)?.value ?? 0;

  useEffect(() => {
    const c = createChart(container.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#787b86', attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: '#1f2430' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false,
    });
    const series = c.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#26a69a', topFillColor1: 'rgba(38, 166, 154, 0.35)', topFillColor2: 'rgba(38, 166, 154, 0.02)',
      bottomLineColor: '#ef5350', bottomFillColor1: 'rgba(239, 83, 80, 0.02)', bottomFillColor2: 'rgba(239, 83, 80, 0.35)',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (v: number) => signedUsd(v) },
    });
    series.setData(points.map((p) => ({ time: p.date as Time, value: p.value })));
    c.timeScale().fitContent();
    return () => c.remove();
  }, [JSON.stringify(points)]);

  return (
    <div className="pnl-chart card">
      <div className="card-head">
        <div>
          <div className="tile-label">Net P&L {range === 'All' ? 'all time' : range === 'MTD' ? 'month to date' : range === 'YTD' ? 'year to date' : `past ${range === '1Y' ? 'year' : '3 months'}`}</div>
          <div className={`tile-value ${pnlClass(total)}`}>{signedUsd(total)}</div>
        </div>
        <div className="range-buttons">
          {RANGES.map((r) => <button key={r} className={r === range ? 'active' : ''} onClick={() => setRange(r)}>{r}</button>)}
        </div>
      </div>
      <div className="pnl-chart-body" ref={container} />
    </div>
  );
}
