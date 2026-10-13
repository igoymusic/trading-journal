import { useEffect, useMemo, useState } from 'react';
import { tradeDay } from '../core/calendar';
import { dayChartTrade, dayTickers } from '../core/dayChart';
import type { Trade } from '../core/types';
import type { TradeChart } from '../shared/api';
import { signedUsd, pnlClass } from './format';
import { type Interval, PriceChart } from './TradePanel';

const NO_LEVELS = { stops: [], targets: [] };

/** The day's trades together on the underlying's chart, one ticker at a time. Hidden without market data. */
export function DayChart({ trades, date, version }: { trades: Trade[]; date: string; version: number }) {
  const tickers = useMemo(() => dayTickers(trades, date), [trades, date]);
  const [ticker, setTicker] = useState(tickers[0]);
  const [interval, setInterval] = useState<Interval>(1);
  const [chart, setChart] = useState<TradeChart | null>(null);
  const shown = tickers.includes(ticker) ? ticker : tickers[0];
  const day = useMemo(() => (shown ? dayChartTrade(trades, date, shown) : null), [trades, date, shown]);

  useEffect(() => {
    if (!shown) return;
    setChart(null);
    window.journal.getDayChart(date, shown).then(setChart);
  }, [date, shown, version]);

  if (!day || chart?.status === 'needs-key') return null;
  const count = trades.filter((t) => t.underlying === shown && tradeDay(t) === date).length;

  return (
    <section className="trade-panel day-chart">
      <div className="panel-head">
        <div>
          <span className="panel-title">{shown} · all trades</span>
          <span className="muted"> · {count} trade{count === 1 ? '' : 's'}</span>
          <span className={`panel-pnl ${pnlClass(day.trade.netPnl)}`}>{signedUsd(day.trade.netPnl)}</span>
        </div>
        <div className="panel-actions">
          {tickers.length > 1 && tickers.map((t) => (
            <button key={t} className={t === shown ? 'active' : ''} onClick={() => setTicker(t)}>{t}</button>
          ))}
          {tickers.length > 1 && <span className="divider" />}
          {[1, 5, 15].map((m) => (
            <button key={m} className={interval === m ? 'active' : ''} onClick={() => setInterval(m as Interval)}>{m}m</button>
          ))}
        </div>
      </div>
      <div className="panel-body">
        <div className="chart-area">
          {!chart && <div className="chart-message">Loading {shown} prices…</div>}
          {chart?.status === 'error' && <div className="chart-message loss">Couldn't load prices: {chart.message}</div>}
          {chart?.status === 'ok' && (
            <PriceChart
              key={`${shown}:${interval}`}
              trade={day.trade}
              chart={chart}
              interval={interval}
              levels={NO_LEVELS}
              placing={null}
              onPlace={() => {}}
              onMove={() => {}}
              replayAt={null}
              fillInfo={day}
            />
          )}
        </div>
      </div>
      {chart?.status === 'ok' && chart.estimatedFrom && (
        <div className="muted small day-chart-note">≈ {chart.symbol} estimated from {chart.estimatedFrom} scaled by each day's closing prices.</div>
      )}
    </section>
  );
}
