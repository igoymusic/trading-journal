import { useEffect, useMemo, useState } from 'react';
import { tradeDay } from '../core/calendar';
import { dayChartTrade, dayTickers } from '../core/dayChart';
import type { Trade } from '../core/types';
import type { ChartView, TradeChart } from '../shared/api';
import { signedUsd, pnlClass } from './format';
import { indexProxy } from '../core/indexProxy';
import { ChartViewSwitch, type Interval, PanelResizer, PriceChart, useFullscreen, usePanelHeight } from './TradePanel';
import { DrawToolbar, pasteIntoChart, UndoRedo, useDrawings } from './drawings';

const NO_LEVELS = { stops: [], targets: [] };

/** The day's trades together on the underlying's chart, one ticker at a time. Hidden without market data. */
export function DayChart({ trades, date, version }: { trades: Trade[]; date: string; version: number }) {
  const tickers = useMemo(() => dayTickers(trades, date), [trades, date]);
  const [ticker, setTicker] = useState(tickers[0]);
  const [interval, setInterval] = useState<Interval>(1);
  const [chart, setChart] = useState<TradeChart | null>(null);
  const [view, setView] = useState<ChartView>('etf');
  // Click the bar to fold the chart away; remembered across days and restarts.
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('dayChartCollapsed') === '1'; } catch { return false; } });
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem('dayChartCollapsed', c ? '0' : '1'); } catch { /* not saved; fine */ }
    return !c;
  });
  const shown = tickers.includes(ticker) ? ticker : tickers[0];
  const day = useMemo(() => (shown ? dayChartTrade(trades, date, shown) : null), [trades, date, shown]);

  const bars = chart?.status === 'ok' ? chart.bars : [];
  const draw = useDrawings(chart?.status === 'ok' ? chart.symbol : shown ?? '', bars[0]?.time, bars[bars.length - 1]?.time, `day:${date}`);
  const [hint, setHint] = useState('');
  const [fullscreen, setFullscreen] = useFullscreen();
  const [height, startResize] = usePanelHeight('dayChartHeight');
  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => setHint(''), 5000);
    return () => window.clearTimeout(t);
  }, [hint]);
  const paste = async () => setHint(await pasteIntoChart(draw, chart?.status === 'ok' ? chart.fills[0]?.time ?? Date.now() : Date.now()));

  useEffect(() => {
    if (!shown) return;
    setChart(null);
    window.journal.getDayChart(date, shown, view).then(setChart, (err: Error) => setChart({ status: 'error', message: err.message }));
  }, [date, shown, version, view]);

  if (!day || chart?.status === 'needs-key') return null;
  const count = trades.filter((t) => t.underlying === shown && tradeDay(t) === date).length;

  return (
    <section
      className={`trade-panel day-chart ${collapsed ? 'collapsed' : ''} ${fullscreen ? 'fullscreen' : ''}`}
      style={fullscreen || collapsed ? undefined : { height }}
      tabIndex={-1}
      onMouseDownCapture={(e) => { if (!(e.target as HTMLElement).closest('input, textarea, select, button')) (e.currentTarget as HTMLElement).focus({ preventScroll: true }); }}
      onPaste={(e) => { if (!(e.target as HTMLElement).closest('input, textarea')) { e.preventDefault(); paste(); } }}
    >
      <div className="panel-head clickable" onClick={toggle} title={collapsed ? 'Show the chart' : 'Hide the chart'}>
        <div>
          <span className="collapse-arrow">{collapsed ? '▸' : '▾'}</span>
          <span className="panel-title">{shown} · all trades</span>
          <span className="muted"> · {count} trade{count === 1 ? '' : 's'}</span>
          <span className={`panel-pnl ${pnlClass(day.trade.netPnl)}`}>{signedUsd(day.trade.netPnl)}</span>
        </div>
        <div className="panel-actions" onClick={(e) => e.stopPropagation()}>
          {!collapsed && draw && chart?.status === 'ok' && <><UndoRedo scope={draw.scope} /><span className="divider" /></>}
          {tickers.length > 1 && tickers.map((t) => (
            <button key={t} className={t === shown ? 'active' : ''} onClick={() => setTicker(t)}>{t}</button>
          ))}
          {tickers.length > 1 && <span className="divider" />}
          {shown && indexProxy(shown) && <><ChartViewSwitch underlying={shown} view={view} onChange={setView} /><span className="divider" /></>}
          {[1, 5, 15].map((m) => (
            <button key={m} className={interval === m ? 'active' : ''} onClick={() => setInterval(m as Interval)}>{m}m</button>
          ))}
          {!collapsed && <button onClick={() => setFullscreen(!fullscreen)} title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}>{fullscreen ? '🗗' : '⛶'}</button>}
        </div>
      </div>
      {!collapsed && <div className="panel-body">
        <div className={`chart-area ${draw && chart?.status === 'ok' ? 'with-tools' : ''}`}>
          {draw && chart?.status === 'ok' && <DrawToolbar draw={draw} onPaste={paste} />}
          {!chart && <div className="chart-message">Loading {shown} prices…</div>}
          {chart?.status === 'error' && <div className="chart-message loss">Couldn't load prices: {chart.message}</div>}
          {chart?.status === 'ok' && (
            <PriceChart
              key={`${shown}:${view}:${interval}`}
              trade={day.trade}
              chart={chart}
              interval={interval}
              levels={NO_LEVELS}
              placing={null}
              onPlace={() => {}}
              onMove={() => {}}
              replayAt={null}
              fillInfo={day}
              draw={draw}
            />
          )}
          {hint && <div className="placing-hint">{hint}</div>}
          {!hint && draw && draw.tool !== 'select' && (
            <div className="placing-hint">{draw.tool === 'hline' ? 'Click where the price line goes.' : draw.tool === 'text' ? 'Click where the note goes.' : 'Drag on the chart, or click two points.'} Esc cancels.</div>
          )}
        </div>
      </div>}
      {!collapsed && chart?.status === 'ok' && chart.estimatedFrom && (
        <div className="muted small day-chart-note">≈ {chart.symbol} estimated from {chart.estimatedFrom} scaled by each day's closing prices.</div>
      )}
      {!fullscreen && !collapsed && <PanelResizer onStart={startResize} />}
    </section>
  );
}
