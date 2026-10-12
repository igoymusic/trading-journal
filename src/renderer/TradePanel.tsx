import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode, type IChartApi, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import type { Bar } from '../core/alpaca';
import { chartTime } from '../core/time';
import type { Trade } from '../core/types';
import type { TradeChart } from '../shared/api';
import { holdTime, pnlClass, shortDate, signedUsd, usd } from './format';

type Interval = 1 | 5 | 15;

/** Groups minute bars into larger candles (5-minute, 15-minute). */
function aggregate(bars: Bar[], minutes: Interval): Bar[] {
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

export function TradePanel({ trade, onClose, onOpenSettings }: { trade: Trade; onClose: () => void; onOpenSettings: () => void }) {
  const [chart, setChart] = useState<TradeChart | null>(null);
  const [interval, setInterval] = useState<Interval>(1);

  useEffect(() => {
    setChart(null);
    window.journal.getTradeChart(trade.id).then(setChart);
  }, [trade.id]);

  const priceByFill = new Map(chart?.status === 'ok' ? chart.fills.map((f) => [f.fillId, f]) : []);

  return (
    <section className="trade-panel">
      <div className="panel-head">
        <div>
          <span className="panel-title">{trade.underlying} {trade.strike}{trade.putCall === 'CALL' ? 'C' : 'P'} {shortDate(trade.expiry)}</span>
          <span className="muted"> · {trade.direction === 'LONG' ? 'Long' : 'Short'} {trade.maxContracts} · held {holdTime(trade.openTime, trade.closeTime)}</span>
          <span className={`panel-pnl ${pnlClass(trade.netPnl)}`}>{signedUsd(trade.netPnl)}</span>
        </div>
        <div className="panel-actions">
          {[1, 5, 15].map((m) => (
            <button key={m} className={interval === m ? 'active' : ''} onClick={() => setInterval(m as Interval)}>{m}m</button>
          ))}
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      <div className="panel-body">
        <div className="chart-area">
          {!chart && <div className="chart-message">Loading {trade.underlying} prices…</div>}
          {chart?.status === 'needs-key' && (
            <div className="chart-message">
              <p>Add your Alpaca market data key to see {trade.underlying}'s chart with your entries and exits.</p>
              <button className="primary" onClick={onOpenSettings}>Open Settings</button>
            </div>
          )}
          {chart?.status === 'error' && <div className="chart-message loss">Couldn't load prices: {chart.message}</div>}
          {chart?.status === 'ok' && <PriceChart trade={trade} chart={chart} interval={interval} />}
        </div>

        <div className="fill-list">
          <div className="fill-list-head">Fills</div>
          {trade.fills.map((f) => {
            const point = priceByFill.get(f.id);
            const buy = f.side === 'BUY';
            return (
              <div className="fill-item" key={f.id}>
                <div>
                  <span className={buy ? 'win' : 'loss'}>{f.orderType === 'EXPIRED' ? 'Expired' : buy ? 'Bought' : 'Sold'} {f.quantity}</span>
                  <span> @ {usd(f.price * 100)}</span>
                </div>
                <div className="muted">{f.execTime.slice(11)}</div>
                {(!chart || chart.status === 'ok') && (
                  <div className="muted">
                    {trade.underlying} {point?.underlyingPrice !== undefined ? <b className="underlying-price">{usd(point.underlyingPrice)}</b> : chart ? 'n/a' : '…'}
                  </div>
                )}
              </div>
            );
          })}
          {chart?.status === 'ok' && chart.feed === 'iex' && (
            <div className="muted small">Some prices come from the IEX exchange only, so they can differ by a cent or two.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function PriceChart({ trade, chart, interval }: { trade: Trade; chart: Extract<TradeChart, { status: 'ok' }>; interval: Interval }) {
  const container = useRef<HTMLDivElement>(null);
  const api = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = container.current!;
    const c = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#131722' }, textColor: '#d1d4dc', attributionLogo: true },
      grid: { vertLines: { color: '#1f2430' }, horzLines: { color: '#1f2430' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#363a45' },
      timeScale: { borderColor: '#363a45', timeVisible: true, secondsVisible: false },
    });
    api.current = c;
    const series = c.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });

    const tz = chart.timeZone;
    const size = interval * 60_000;
    const candles = aggregate(chart.bars, interval);
    series.setData(candles.map((b) => ({ time: chartTime(b.time, tz) as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));

    // Opening fills point up from below (long) or down from above (short); closing fills the opposite way.
    const entrySide = trade.direction === 'LONG' ? 'BUY' : 'SELL';
    // Partial fills in the same second at the same price share one marker ("B 2 @ $79.00").
    const groups = new Map<string, { time: number; isEntry: boolean; side: string; qty: number; optionPrice: number; underlying?: number }>();
    for (const f of trade.fills) {
      const point = chart.fills.find((p) => p.fillId === f.id);
      if (!point) continue;
      const key = `${Math.floor(point.time / 1000)}|${f.side}|${f.price}`;
      const g = groups.get(key);
      if (g) g.qty += f.quantity;
      else groups.set(key, { time: point.time, isEntry: f.side === entrySide, side: f.side, qty: f.quantity, optionPrice: f.price, underlying: point.underlyingPrice });
    }
    const markers: SeriesMarker<Time>[] = [];
    for (const g of groups.values()) {
      const candleTime = chartTime(Math.floor(g.time / size) * size, tz) as UTCTimestamp;
      const color = g.isEntry ? '#2962ff' : '#ff9800';
      const shape = g.isEntry ? 'arrowUp' : 'arrowDown';
      const text = `${g.side === 'BUY' ? 'B' : 'S'} ${g.qty} @ ${usd(g.optionPrice * 100)}`;
      markers.push(g.underlying !== undefined
        ? { time: candleTime, position: g.isEntry ? 'atPriceBottom' : 'atPriceTop', price: g.underlying, shape, color, text }
        : { time: candleTime, position: g.isEntry ? 'belowBar' : 'aboveBar', shape, color, text });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(series, markers);

    // Frame the trade: from a bit before the entry to a bit after the exit.
    const first = chart.fills[0]?.time;
    const last = chart.fills[chart.fills.length - 1]?.time;
    if (first !== undefined && last !== undefined) {
      // Wider candles get more room around the trade.
      const pad = Math.max(30 * 60_000 * interval, (last - first) * 0.5);
      c.timeScale().setVisibleRange({ from: chartTime(first - pad, tz) as UTCTimestamp, to: chartTime(last + pad, tz) as UTCTimestamp });
    }
    return () => { c.remove(); api.current = null; };
  }, [chart, interval, trade]);

  return <div className="chart" ref={container} />;
}
