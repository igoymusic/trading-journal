import { colors } from './colors';
import {
  CandlestickSeries, ColorType, createChart, CrosshairMode, type IChartApi, type IPriceLine, type ISeriesApi, LineStyle, type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import type { Bar } from '../core/alpaca';
import { filledBy, positionAt, replayStartIndex } from '../core/replay';
import { chartTime } from '../core/time';
import { dollarRiskReward } from '../core/optionLevels';
import { averageUnderlying, formatR, levelsFromExits, riskReward } from '../core/rr';
import { EMPTY_JOURNAL, type PriceLevel, type Trade } from '../core/types';
import type { LevelPrices, TradeChart } from '../shared/api';
import { type FillMarker, FillMarkersPrimitive } from './fillMarkers';
import { exitKind } from '../core/markerStyles';
import { onMarkerStylesChange } from './markerStyles';
import { type Drawing, type ChartPoint, drawingStart, moveHandle, shiftDrawing } from '../core/drawings';
import { DrawToolbar, type DrawingState, finishShape, pasteIntoChart, shapeFor, useDrawings } from './drawings';
import { ScreenshotGallery, useScreenshotCount } from './Screenshots';
import { DrawingsPrimitive, type Xy } from './drawingsPrimitive';
import { holdTime, pnlClass, shortDate, signedUsd, optionUsd, usd } from './format';
import { useJournal } from './journal';

type LevelKind = 'stops' | 'targets';
interface Levels { stops: PriceLevel[]; targets: PriceLevel[] }
const round2 = (n: number) => Math.round(n * 100) / 100;

export type Interval = 1 | 5 | 15;

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

export function TradePanel({ trade, onClose, onOpenSettings }: { trade: Trade; onClose?: () => void; onOpenSettings: () => void }) {
  const [chart, setChart] = useState<TradeChart | null>(null);
  const [interval, setInterval] = useState<Interval>(1);
  const [placing, setPlacing] = useState<LevelKind | null>(null);
  // Replay: which minute bar is showing, whether it's playing, and how many candles a second.
  const [replay, setReplay] = useState<{ index: number; playing: boolean; speed: number } | null>(null);
  const [tab, setTab] = useState<'chart' | 'shots'>('chart');
  const [fullscreen, setFullscreen] = useFullscreen();
  const [hint, setHint] = useState('');
  const shotCount = useScreenshotCount(trade.id);
  const { saveTrade } = useJournal();
  const sectionRef = useRef<HTMLElement>(null);
  const journal = trade.journal ?? EMPTY_JOURNAL;
  const levels: Levels = { stops: journal.stops ?? [], targets: journal.targets ?? [] };

  useEffect(() => {
    setChart(null);
    setReplay(null);
    window.journal.getTradeChart(trade.id).then(setChart);
  }, [trade.id]);

  const bars = chart?.status === 'ok' ? chart.bars : [];
  const draw = useDrawings(trade.underlying, bars[0]?.time, bars[bars.length - 1]?.time);
  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => setHint(''), 5000);
    return () => window.clearTimeout(t);
  }, [hint]);
  async function paste() {
    const at = chart?.status === 'ok' ? chart.fills[0]?.time ?? bars[0]?.time : undefined;
    const message = await pasteIntoChart(draw, at ?? Date.now(), trade.id);
    setHint(message);
    if (message.startsWith('Screenshot')) setTab('shots');
  }
  // Without a market data key the app works without charts: no chart, prices or R, just a hint.
  const chartsOff = chart?.status === 'needs-key';
  const playing = !!replay?.playing;
  useEffect(() => {
    if (!replay?.playing) return;
    const timer = window.setInterval(() => setReplay((r) => {
      if (!r) return r;
      const index = Math.min(r.index + 1, bars.length - 1);
      return { ...r, index, playing: index < bars.length - 1 };
    }), 1000 / replay.speed);
    return () => window.clearInterval(timer);
  }, [playing, replay?.speed, bars]);

  const step = (by: number) => setReplay((r) => r && { ...r, playing: false, index: Math.max(0, Math.min(bars.length - 1, r.index + by)) });
  function startReplay() {
    if (chart?.status !== 'ok' || !bars.length) return;
    setPlacing(null);
    setReplay({ index: replayStartIndex(bars, chart.fills[0]?.time), playing: true, speed: 2 });
  }

  // Replay keys: space plays or pauses, the arrow keys step a minute, Esc ends it.
  useEffect(() => {
    if (!replay) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select')) return;
      if (e.key === ' ') { e.preventDefault(); setReplay((r) => r && { ...r, playing: !r.playing && r.index < bars.length - 1 }); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'Escape') setReplay(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [!!replay, bars]);

  useEffect(() => {
    if (!placing) return;
    const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape') setPlacing(null); };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [placing]);

  const priceByFill = new Map(chart?.status === 'ok' ? chart.fills.map((f) => [f.fillId, f]) : []);

  // Where the underlying was when you got in and out, for measuring R.
  const entrySide = trade.direction === 'LONG' ? 'BUY' : 'SELL';
  const withPrices = trade.fills.map((f) => ({ ...f, underlying: priceByFill.get(f.id)?.underlyingPrice }));
  const underlyingEntry = averageUnderlying(withPrices.filter((f) => f.side === entrySide));
  const underlyingExit = trade.status === 'CLOSED' ? averageUnderlying(withPrices.filter((f) => f.side !== entrySide)) : undefined;
  const rr = riskReward(trade, journal);

  // What the option would have been worth at each line (real price or estimate), for dollar risk.
  const [levelPrices, setLevelPrices] = useState<LevelPrices | null>(null);
  const levelsKey = JSON.stringify(levels);
  useEffect(() => {
    if (chart?.status !== 'ok' || !levels.stops.length && !levels.targets.length) { setLevelPrices(null); return; }
    let current = true;
    const timer = setTimeout(() => {
      window.journal.getLevelPrices(trade.id, levels.stops, levels.targets).then((p) => { if (current) setLevelPrices(p); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [chart, levelsKey]);

  function saveLevels(next: Levels) {
    saveTrade(trade.id, {
      ...journal,
      stops: next.stops,
      targets: next.targets,
      underlyingEntry: underlyingEntry ?? journal.underlyingEntry,
      underlyingExit: underlyingExit ?? journal.underlyingExit,
    });
  }

  // The first time a trade's chart loads, start its lines at the exits you actually took.
  // Once lines have been saved (even all removed), they're left as you set them.
  useEffect(() => {
    if (chart?.status !== 'ok' || journal.stops !== undefined || journal.targets !== undefined) return;
    const prices = new Map(chart.fills.flatMap((f) => (f.underlyingPrice === undefined ? [] : [[f.fillId, f.underlyingPrice] as const])));
    const found = levelsFromExits(trade, prices);
    if (found) saveLevels(found);
  }, [chart]);

  function placeLevel(price: number) {
    if (!placing) return;
    const allocated = levels[placing].reduce((a, l) => a + l.contracts, 0);
    const contracts = Math.max(1, trade.maxContracts - allocated);
    saveLevels({ ...levels, [placing]: [...levels[placing], { price: round2(price), contracts }] });
    setPlacing(null);
  }

  function changeLevel(kind: LevelKind, index: number, patch: Partial<PriceLevel> | null) {
    const list = patch === null
      ? levels[kind].filter((_, i) => i !== index)
      : levels[kind].map((l, i) => (i === index ? { ...l, ...patch } : l));
    saveLevels({ ...levels, [kind]: list });
  }

  return (
    <section
      className={`trade-panel ${fullscreen ? 'fullscreen' : ''}`}
      ref={sectionRef}
      tabIndex={-1}
      // Clicking anywhere in the panel lets Ctrl+V paste into it.
      onMouseDownCapture={(e) => { if (!(e.target as HTMLElement).closest('input, textarea, select, button')) sectionRef.current?.focus({ preventScroll: true }); }}
      onPaste={(e) => {
        if ((e.target as HTMLElement).closest('input, textarea') || tab !== 'chart') return;
        e.preventDefault();
        paste();
      }}
    >
      <div className="panel-head">
        <div>
          <span className="panel-title">{trade.underlying} {trade.strike}{trade.putCall === 'CALL' ? 'C' : 'P'} {shortDate(trade.expiry)}</span>
          <span className="muted"> · {trade.direction === 'LONG' ? 'Long' : 'Short'} {trade.maxContracts} · held {holdTime(trade.openTime, trade.closeTime)}</span>
          <span className={`panel-pnl ${pnlClass(trade.netPnl)}`}>{signedUsd(trade.netPnl)}</span>
          {rr?.realizedR !== undefined && <span className={`panel-r ${pnlClass(rr.realizedR)}`}>{formatR(rr.realizedR)}</span>}
          {rr?.plannedR !== undefined && <span className="panel-r muted">planned 1 : {rr.plannedR.toFixed(1)}</span>}
        </div>
        <div className="panel-actions">
          <div className="view-tabs">
            <button className={tab === 'chart' ? 'active' : ''} onClick={() => setTab('chart')}>Chart</button>
            <button className={tab === 'shots' ? 'active' : ''} onClick={() => setTab('shots')}>Screenshots{shotCount ? ` (${shotCount})` : ''}</button>
          </div>
          {tab === 'chart' && chart?.status === 'ok' && (
            <button className={replay ? 'active' : ''} onClick={() => (replay ? setReplay(null) : startReplay())}
              title="Watch the trade play out minute by minute">
              {replay ? 'End replay' : '▶ Replay'}
            </button>
          )}
          {tab === 'chart' && !chartsOff && [1, 5, 15].map((m) => (
            <button key={m} className={interval === m ? 'active' : ''} onClick={() => setInterval(m as Interval)}>{m}m</button>
          ))}
          <button onClick={() => setFullscreen(!fullscreen)} title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}>{fullscreen ? '🗗' : '⛶'}</button>
          {onClose && <button onClick={onClose} aria-label="Close">✕</button>}
        </div>
      </div>

      <div className={`panel-body ${chartsOff ? 'charts-off' : ''}`}>
        {tab === 'shots' && <div className="chart-area"><ScreenshotGallery tradeId={trade.id} /></div>}
        {tab === 'chart' && !chartsOff && <div className={`chart-area ${replay ? 'replaying' : ''} ${draw && chart?.status === 'ok' ? 'with-tools' : ''}`}>
          {draw && chart?.status === 'ok' && <DrawToolbar draw={draw} onPaste={paste} />}
          {!chart && <div className="chart-message">Loading {trade.underlying} prices…</div>}
          {chart?.status === 'error' && <div className="chart-message loss">Couldn't load prices: {chart.message}</div>}
          {chart?.status === 'ok' && (
            <PriceChart
              trade={trade}
              chart={chart}
              interval={interval}
              levels={levels}
              placing={placing}
              onPlace={placeLevel}
              onMove={(kind, i, price) => changeLevel(kind, i, { price: round2(price) })}
              replayAt={replay ? bars[replay.index]?.time ?? null : null}
              draw={draw}
            />
          )}
          {replay && chart?.status === 'ok' && (
            <ReplayBar
              trade={trade}
              chart={chart}
              index={replay.index}
              playing={replay.playing}
              speed={replay.speed}
              onPlay={() => setReplay((r) => r && { ...r, playing: !r.playing, index: r.index >= bars.length - 1 ? replayStartIndex(bars, chart.fills[0]?.time) : r.index })}
              onStep={step}
              onRestart={() => setReplay((r) => r && { ...r, playing: false, index: replayStartIndex(bars, chart.fills[0]?.time) })}
              onSpeed={(speed) => setReplay((r) => r && { ...r, speed })}
              onSeek={(index) => setReplay((r) => r && { ...r, playing: false, index })}
            />
          )}
          {hint && <div className="placing-hint">{hint}</div>}
          {!hint && draw && draw.tool !== 'select' && !placing && (
            <div className="placing-hint">{draw.tool === 'hline' ? 'Click where the price line goes.' : draw.tool === 'text' ? 'Click where the note goes.' : 'Drag on the chart, or click two points.'} Esc cancels.</div>
          )}
          {placing && <div className="placing-hint">Click the chart where your {placing === 'stops' ? 'stop' : 'target'} is. Press Esc to cancel.</div>}
        </div>}

        <div className="fill-list">
          <div className="fill-list-head">Fills</div>
          {trade.fills.map((f) => {
            const point = priceByFill.get(f.id);
            const buy = f.side === 'BUY';
            return (
              <div className="fill-item" key={f.id}>
                <div>
                  <span className={buy ? 'win' : 'loss'}>{f.orderType === 'EXPIRED' ? 'Expired' : buy ? 'Bought' : 'Sold'} {f.quantity}</span>
                  <span> @ {optionUsd(f.price)}</span>
                </div>
                <div className="muted" title={f.account ? `From ${f.account}` : undefined}>
                  {f.timeExact === false ? 'time not reported' : f.execTime.slice(11)}
                </div>
                {(!chart || chart.status === 'ok') && (
                  <div className="muted">
                    {trade.underlying} {point?.underlyingPrice !== undefined ? <b className="underlying-price">{usd(point.underlyingPrice)}</b> : chart || f.timeExact === false ? 'n/a' : '…'}
                  </div>
                )}
              </div>
            );
          })}
          {chart?.status === 'ok' && (
            <RiskPanel
              trade={trade}
              levels={levels}
              placing={placing}
              onPlacing={setPlacing}
              onChange={changeLevel}
              canMeasure={underlyingEntry !== undefined}
              rr={rr}
              prices={levelPrices}
            />
          )}
          {chart?.status === 'ok' && chart.estimatedFrom && (
            <div className="muted small">
              ≈ {chart.symbol} has no free minute data, so this chart is {chart.estimatedFrom} scaled to {chart.symbol} by each
              day's closing prices. Expect it within a point or two of the real index.
            </div>
          )}
          {chart?.status === 'ok' && chart.feed === 'iex' && (
            <div className="muted small">Some prices come from the IEX exchange only, so they can differ by a cent or two.</div>
          )}
          {chartsOff && (
            <div className="muted small charts-off-hint">
              Charts are off. Add a free Alpaca market data key to see the chart, the underlying's price at each fill, and R.{' '}
              <button className="link" onClick={onOpenSettings}>Open Settings</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Full screen for a chart panel; Esc leaves it. */
export function useFullscreen(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement).closest?.('input, textarea')) return;
      setOn(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('has-fullscreen');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('has-fullscreen'); };
  }, [on]);
  return [on, setOn];
}

export function PriceChart({ trade, chart, interval, levels, placing, onPlace, onMove, replayAt, fillInfo, draw }: {
  trade: Trade;
  /** Drawing tools and the drawings to show; leave out for a chart without them. */
  draw?: DrawingState | null;
  /** For a chart of several trades: which fills are entries, and a contract name for each label. */
  fillInfo?: FillInfo;
  chart: Extract<TradeChart, { status: 'ok' }>;
  interval: Interval;
  /** During a replay, the minute being shown (epoch ms); the chart stops there. Null shows everything. */
  replayAt: number | null;
  levels: Levels;
  placing: LevelKind | null;
  onPlace: (price: number) => void;
  onMove: (kind: LevelKind, index: number, price: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const api = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lines = useRef(new Map<string, IPriceLine>());
  const markersRef = useRef<FillMarkersPrimitive | null>(null);
  const [built, setBuilt] = useState(0);
  // The chart's event handlers are set up once per build, so they read the latest props from here.
  const live = useRef({ trade, levels, placing, onPlace, onMove, draw });
  live.current = { trade, levels, placing, onPlace, onMove, draw };
  const drawingsRef = useRef<DrawingsPrimitive | null>(null);
  // Typing a note: where the box is and what's in it.
  const [editing, setEditing] = useState<{ id: string; a: ChartPoint; at: Xy; text: string } | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const replayAtRef = useRef(replayAt);
  replayAtRef.current = replayAt;

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
      upColor: colors().candleUp, downColor: colors().candleDown, borderVisible: false, wickUpColor: colors().candleUp, wickDownColor: colors().candleDown,
    });

    const tz = chart.timeZone;
    const { candles, markers } = chartData(chart, live.current.trade, interval, replayAtRef.current, fillInfo);
    series.setData(candles.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
    const primitive = new FillMarkersPrimitive(markers, candles);
    series.attachPrimitive(primitive);
    markersRef.current = primitive;
    // Labels you dragged before go back where you put them.
    let gone = false;
    window.journal.markerLabels(live.current.trade.fills.map((f) => f.id)).then((saved) => {
      if (gone) return;
      for (const [id, offset] of Object.entries(saved)) primitive.offsets.set(id, offset);
      primitive.update();
    });
    const stopStyles = onMarkerStylesChange(() => primitive.update());
    const drawings = new DrawingsPrimitive(
      aggregate(chart.bars, interval).map((b) => chartTime(b.time, tz) as UTCTimestamp), interval * 60, tz,
    );
    series.attachPrimitive(drawings);
    drawingsRef.current = drawings;

    // Frame the trade: from a bit before the entry to a bit after the exit.
    const first = chart.fills[0]?.time;
    const last = chart.fills[chart.fills.length - 1]?.time;
    if (first !== undefined && last !== undefined) {
      // Wider candles get more room around the trade.
      const pad = Math.max(30 * 60_000 * interval, (last - first) * 0.5);
      c.timeScale().setVisibleRange({ from: chartTime(first - pad, tz) as UTCTimestamp, to: chartTime(last + pad, tz) as UTCTimestamp });
    }
    seriesRef.current = series;

    // In placing mode, a click on the chart drops the level at that price.
    c.subscribeClick((param) => {
      const { placing: kind, onPlace: place } = live.current;
      if (!kind || !param.point) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price !== null) place(price);
    });

    // Levels can be dragged up and down. Grabbing one stops the chart from panning meanwhile.
    const lineAt = (y: number): { kind: LevelKind; index: number } | null => {
      for (const kind of ['stops', 'targets'] as const) {
        const index = live.current.levels[kind].findIndex((l) => {
          const ly = series.priceToCoordinate(l.price);
          return ly !== null && Math.abs(ly - y) <= 5;
        });
        if (index >= 0) return { kind, index };
      }
      return null;
    };
    const yOf = (e: MouseEvent) => e.clientY - el.getBoundingClientRect().top;
    const xyOf = (e: MouseEvent): Xy => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    // Only the price area takes drawings, not the price scale on the right.
    const inPane = (p: Xy) => p.x >= 0 && p.y >= 0 && p.x <= c.timeScale().width() && p.y <= el.clientHeight - c.timeScale().height();
    let drag: { kind: LevelKind; index: number; price: number } | null = null;
    // Dragging a fill's label: which one, and where on the label it was grabbed.
    let labelDrag: { id: string; tipX: number; y: number; grab: Xy; start: Xy; moved: boolean } | null = null;
    const labelsMovable = () => !live.current.placing && !editingRef.current && (!live.current.draw || live.current.draw.tool === 'select');
    // Drawing a line or box: where it started. Moving a drawing: what was grabbed and where.
    let creating: { a: ChartPoint; start: Xy; moved: boolean; clicks: number } | null = null;
    let moving: { original: Drawing; handle?: string; from: ChartPoint; start: Xy; moved: boolean } | null = null;
    const lock = (on: boolean) => c.applyOptions({ handleScroll: !on, handleScale: !on });
    const draft = (): Drawing | null => drawings.preview;
    const setDraft = (d: Drawing | null) => { drawings.preview = d; drawings.update(); };

    const onDraw = (e: MouseEvent): boolean => {
      const d = live.current.draw;
      const at = xyOf(e);
      if (!d || live.current.placing || !inPane(at) || e.button !== 0) return false;
      if (editingRef.current) return false;
      const point = drawings.fromXy(at);
      if (!point) return false;
      if (d.tool === 'select') {
        const hit = drawings.findAt(at);
        if (!hit) { if (d.selected) d.setSelected(null); return false; }
        const original = d.list.find((x) => x.id === hit.id)!;
        d.setSelected(hit.id);
        moving = { original, handle: hit.handle, from: point, start: at, moved: false };
        return true;
      }
      if (creating) { creating.clicks++; return true; }
      const base = { id: d.newId(), day: d.dayFor(point.time), color: d.color };
      if (d.tool === 'hline') {
        d.put({ ...base, ...d.style, kind: 'hline', price: round2(point.price) });
        d.setSelected(base.id);
        d.setTool('select');
      } else if (d.tool === 'vline') {
        d.put({ ...base, kind: 'vline', time: point.time });
        d.setSelected(base.id);
        d.setTool('select');
      } else if (d.tool === 'text') {
        setEditing({ id: base.id, a: point, at, text: '' });
        d.setTool('select');
      } else {
        creating = { a: point, start: at, moved: false, clicks: 1 };
        const first = shapeFor(d.tool, base, point, point, d.style);
        setDraft(first.kind === 'path' ? { ...first, points: [point] } : first);
      }
      return true;
    };

    const onDown = (e: MouseEvent) => {
      const at = xyOf(e);
      const label = e.button === 0 && labelsMovable() ? primitive.labelAt(at.x, at.y) : null;
      if (label) {
        e.stopPropagation();
        e.preventDefault();
        labelDrag = { id: label.id, tipX: label.tipX, y: label.y, grab: { x: at.x - label.rect.x, y: at.y - label.rect.y }, start: at, moved: false };
        lock(true);
        return;
      }
      const hit = live.current.placing ? null : lineAt(yOf(e));
      if (!hit) {
        if (onDraw(e)) { e.stopPropagation(); e.preventDefault(); lock(true); }
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      drag = { ...hit, price: live.current.levels[hit.kind][hit.index].price };
      lock(true);
    };
    const onMoveMouse = (e: MouseEvent) => {
      if (labelDrag) {
        const at = xyOf(e);
        if (Math.hypot(at.x - labelDrag.start.x, at.y - labelDrag.start.y) > 2) labelDrag.moved = true;
        if (!labelDrag.moved) return;
        // Keep the label inside the price area.
        const hit = primitive.hits.find((h) => h.id === labelDrag!.id);
        const w = hit?.rect.w ?? 0;
        const h = hit?.rect.h ?? 0;
        const x = Math.min(Math.max(at.x - labelDrag.grab.x, 0), c.timeScale().width() - w);
        const y = Math.min(Math.max(at.y - labelDrag.grab.y, 0), el.clientHeight - c.timeScale().height() - h);
        primitive.offsets.set(labelDrag.id, { dx: x - labelDrag.tipX, dy: y - labelDrag.y });
        primitive.update();
        return;
      }
      if (creating || moving) {
        const at = xyOf(e);
        const point = drawings.fromXy(at);
        if (!point) return;
        if (creating) {
          const d = draft();
          const tool = live.current.draw?.tool;
          if (Math.hypot(at.x - creating.start.x, at.y - creating.start.y) > 4) creating.moved = true;
          if (d && tool === 'brush' && d.kind === 'path') {
            // Freehand: add a point whenever the mouse has moved a few pixels.
            const last = drawings.toXy(d.points[d.points.length - 1]);
            if (!last || Math.hypot(at.x - last.x, at.y - last.y) > 3) setDraft({ ...d, points: [...d.points, point] });
          } else if (d && tool && tool !== 'select') setDraft(shapeFor(tool, d, creating.a, point, live.current.draw!.style));
        } else if (moving) {
          if (Math.hypot(at.x - moving.start.x, at.y - moving.start.y) > 2) moving.moved = true;
          if (!moving.moved) return;
          const o = moving.original;
          const next = moving.handle
            ? moveHandle(o, moving.handle, point)
            : shiftDrawing(o, point.time - moving.from.time, point.price - moving.from.price);
          setDraft(next);
        }
        return;
      }
      if (!drag) {
        const at = xyOf(e);
        const d = live.current.draw;
        el.style.cursor = live.current.placing ? 'crosshair'
          : labelsMovable() && primitive.labelAt(at.x, at.y) ? 'move'
          : lineAt(at.y) ? 'ns-resize'
          : d && d.tool !== 'select' && inPane(at) ? 'crosshair'
          : d && inPane(at) && drawings.findAt(at) ? 'move' : '';
        return;
      }
      const price = series.coordinateToPrice(yOf(e));
      if (price === null) return;
      drag.price = price;
      lines.current.get(`${drag.kind}:${drag.index}`)?.applyOptions({ price });
    };
    const onUp = () => {
      if (labelDrag) {
        const { id, moved } = labelDrag;
        labelDrag = null;
        lock(false);
        const offset = primitive.offsets.get(id);
        if (moved && offset) window.journal.setMarkerLabel(id, { dx: Math.round(offset.dx), dy: Math.round(offset.dy) });
        return;
      }
      const d = live.current.draw;
      if (creating) {
        // A click without dragging starts a line; the next click finishes it. A brush stroke ends when you let go.
        const brushing = d?.tool === 'brush';
        if (!brushing && !creating.moved && creating.clicks < 2) return;
        if (brushing && !creating.moved) { creating = null; setDraft(null); lock(false); return; }
        const shape = draft();
        const creatingStart = creating.a.time;
        creating = null;
        setDraft(null);
        lock(false);
        if (shape && d) {
          const done = finishShape(shape, drawings.step * 1000);
          d.put({ ...done, day: d.dayFor(drawingStart(done) ?? creatingStart) });
          d.setSelected(shape.id);
          d.setTool('select');
        }
        return;
      }
      if (moving) {
        const shape = draft();
        const wasMoved = moving.moved;
        moving = null;
        setDraft(null);
        lock(false);
        if (wasMoved && shape && d) {
          const start = drawingStart(shape);
          if (shape.kind === 'hline') d.put({ ...shape, price: round2(shape.price) });
          else d.put(start === null ? shape : { ...shape, day: d.dayFor(start) });
        }
        return;
      }
      if (!drag) return;
      live.current.onMove(drag.kind, drag.index, drag.price);
      drag = null;
      c.applyOptions({ handleScroll: true, handleScale: true });
    };
    // Double-click a note to change its text.
    const onDouble = (e: MouseEvent) => {
      // Double-clicking a label you moved puts it back in its automatic spot.
      const at = xyOf(e);
      const label = labelsMovable() ? primitive.labelAt(at.x, at.y) : null;
      if (label && primitive.offsets.has(label.id)) {
        primitive.offsets.delete(label.id);
        primitive.update();
        window.journal.setMarkerLabel(label.id, null);
        return;
      }
      const d = live.current.draw;
      if (!d) return;
      const hit = drawings.findAt(xyOf(e));
      const note = hit && d.list.find((x) => x.id === hit.id);
      if (note?.kind === 'text') setEditing({ id: note.id, a: note.a, at: drawings.toXy(note.a) ?? xyOf(e), text: note.text });
    };
    // Delete removes the selected drawing; Esc puts the pointer back.
    const onKey = (e: KeyboardEvent) => {
      const d = live.current.draw;
      if (!d || (e.target as HTMLElement).closest?.('input, textarea, select')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && d.selected && d.list.some((x) => x.id === d.selected)) { e.preventDefault(); d.remove(d.selected); }
      else if (e.key === 'Escape') {
        if (creating) { creating = null; setDraft(null); lock(false); }
        d.setTool('select');
        d.setSelected(null);
      }
    };
    el.addEventListener('dblclick', onDouble);
    window.addEventListener('keydown', onKey);
    el.addEventListener('mousedown', onDown, true);
    el.addEventListener('mousemove', onMoveMouse);
    window.addEventListener('mousemove', onMoveMouse);
    window.addEventListener('mouseup', onUp);
    setBuilt((n) => n + 1);

    return () => {
      gone = true;
      stopStyles();
      el.removeEventListener('dblclick', onDouble);
      window.removeEventListener('keydown', onKey);
      el.removeEventListener('mousedown', onDown, true);
      el.removeEventListener('mousemove', onMoveMouse);
      window.removeEventListener('mousemove', onMoveMouse);
      window.removeEventListener('mouseup', onUp);
      c.remove();
      api.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      drawingsRef.current = null;
      lines.current.clear();
    };
  }, [chart, interval, trade.id]);

  // Stop and target lines, redrawn whenever they change.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of lines.current.values()) series.removePriceLine(line);
    lines.current.clear();
    for (const kind of ['stops', 'targets'] as const) {
      levels[kind].forEach((l, i) => {
        lines.current.set(`${kind}:${i}`, series.createPriceLine({
          price: l.price,
          color: kind === 'stops' ? colors().stop : colors().target,
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${kind === 'stops' ? 'Stop' : 'Target'} ×${l.contracts}`,
        }));
      });
    }
  }, [JSON.stringify(levels), built]);

  // Replay: redraw up to the current minute, keeping your zoom, and follow it off the right edge.
  const shownAt = useRef<number | null>(null);
  useEffect(() => {
    const c = api.current;
    const series = seriesRef.current;
    const primitive = markersRef.current;
    if (!c || !series || !primitive || replayAt === shownAt.current) return;
    shownAt.current = replayAt;
    const range = c.timeScale().getVisibleLogicalRange();
    const { candles, markers } = chartData(chart, trade, interval, replayAt, fillInfo);
    primitive.candles = candles;
    primitive.markers = markers;
    series.setData(candles.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
    if (!range) return;
    const last = candles.length - 1;
    const width = range.to - range.from;
    if (replayAt !== null && last > range.to - 3) c.timeScale().setVisibleLogicalRange({ from: last - width * 0.7, to: last + width * 0.3 });
    else c.timeScale().setVisibleLogicalRange(range);
  }, [replayAt, built]);

  // Drawings, redrawn whenever they or the selection change.
  useEffect(() => {
    const p = drawingsRef.current;
    if (!p) return;
    p.drawings = draw?.list ?? [];
    p.selected = draw?.selected ?? null;
    p.update();
  }, [draw?.list, draw?.selected, built]);

  function finishNote() {
    const e = editingRef.current;
    setEditing(null);
    if (!e || !draw) return;
    const old = draw.list.find((d) => d.id === e.id);
    if (!e.text.trim()) { if (old) draw.remove(e.id); return; }
    draw.put({ ...(old ?? { id: e.id, day: draw.dayFor(e.a.time), color: draw.color }), kind: 'text', a: e.a, text: e.text.trim() } as Drawing);
    draw.setSelected(e.id);
  }

  return (
    <div className="chart" ref={container}>
      {editing && (
        <textarea
          className="note-editor"
          autoFocus
          rows={Math.max(1, editing.text.split('\n').length)}
          style={{ left: editing.at.x, top: editing.at.y - 24 }}
          placeholder="Note… (Enter to save)"
          value={editing.text}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishNote(); }
            if (e.key === 'Escape') setEditing(null);
          }}
          onBlur={finishNote}
        />
      )}
    </div>
  );
}

/** Candles and fill markers for the chart, cut off at `until` during a replay. */
export interface FillInfo { entryIds: Set<string>; contract: Map<string, string> }

function chartData(chart: Extract<TradeChart, { status: 'ok' }>, trade: Trade, interval: Interval, until: number | null, info?: FillInfo) {
  const tz = chart.timeZone;
  const size = interval * 60_000;
  const bars = until === null ? chart.bars : chart.bars.filter((b) => b.time <= until);
  const candles = aggregate(bars, interval).map((b) => ({ ...b, time: chartTime(b.time, tz) as UTCTimestamp }));

  // Partial fills in the same second at the same price share one marker ("B 2 @ $79.00").
  const entrySide = trade.direction === 'LONG' ? 'BUY' : 'SELL';
  const groups = new Map<string, { id: string; time: number; isEntry: boolean; side: string; qty: number; optionPrice: number; underlying?: number; contract?: string }>();
  for (const f of trade.fills) {
    const point = chart.fills.find((p) => p.fillId === f.id);
    if (!point || (until !== null && !filledBy(point.time, until))) continue;
    const contract = info?.contract.get(f.id);
    const key = `${Math.floor(point.time / 1000)}|${f.side}|${f.price}|${contract ?? ''}`;
    const g = groups.get(key);
    if (g) g.qty += f.quantity;
    else groups.set(key, {
      id: f.id, time: point.time, isEntry: info ? info.entryIds.has(f.id) : f.side === entrySide, side: f.side, qty: f.quantity,
      optionPrice: f.price, underlying: point.underlyingPrice, contract,
    });
  }
  // Average entry price per contract, to tell exits in profit from exits at a loss.
  const entries = new Map<string, { side: 'BUY' | 'SELL'; cost: number; qty: number }>();
  for (const f of trade.fills) {
    if (!(info ? info.entryIds.has(f.id) : f.side === entrySide)) continue;
    const k = info?.contract.get(f.id) ?? '';
    const e = entries.get(k) ?? { side: f.side as 'BUY' | 'SELL', cost: 0, qty: 0 };
    e.cost += f.price * f.quantity;
    e.qty += f.quantity;
    entries.set(k, e);
  }
  const markers: FillMarker[] = [];
  for (const g of groups.values()) {
    const candleTime = chartTime(Math.floor(g.time / size) * size, tz) as UTCTimestamp;
    // Without an exact price, fall back to the close of the fill's candle.
    const price = g.underlying ?? candles.find((c) => c.time === candleTime)?.close;
    if (price === undefined) continue;
    const text = `${g.side === 'BUY' ? 'B' : 'S'} ${g.qty}${g.contract ? ` ${g.contract}` : ''} @ ${optionUsd(g.optionPrice)}${g.underlying === undefined ? ' (approx.)' : ''}`;
    const e = entries.get(g.contract ?? '');
    const style = g.isEntry ? 'entry' : exitKind(e?.side ?? (entrySide as 'BUY' | 'SELL'), e?.qty ? e.cost / e.qty : undefined, g.optionPrice);
    markers.push({ id: g.id, time: candleTime, price, kind: g.isEntry ? 'entry' : 'exit', style, text });
  }
  return { candles, markers };
}

const SPEEDS = [1, 2, 5, 10];

/** Controls under the chart during a replay, plus where you stood at that minute. */
function ReplayBar({ trade, chart, index, playing, speed, onPlay, onStep, onRestart, onSpeed, onSeek }: {
  trade: Trade;
  chart: Extract<TradeChart, { status: 'ok' }>;
  index: number;
  playing: boolean;
  speed: number;
  onPlay: () => void;
  onStep: (by: number) => void;
  onRestart: () => void;
  onSpeed: (speed: number) => void;
  onSeek: (index: number) => void;
}) {
  const bar = chart.bars[index];
  const fillTimes = new Map(chart.fills.map((f) => [f.fillId, f.time]));
  const pos = positionAt(trade, fillTimes, bar.time);
  const clock = new Date(bar.time).toLocaleTimeString('en-US', { timeZone: chart.timeZone, hour: 'numeric', minute: '2-digit' });
  return (
    <div className="replay-bar">
      <button onClick={onRestart} title="Back to the start">⏮</button>
      <button onClick={() => onStep(-1)} title="Back one minute (←)">◀</button>
      <button className="play" onClick={onPlay} title="Play or pause (space)">{playing ? '❚❚' : '▶'}</button>
      <button onClick={() => onStep(1)} title="Forward one minute (→)">▶|</button>
      <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))} title="Candles per second">
        {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
      </select>
      <input type="range" min={0} max={chart.bars.length - 1} value={index} onChange={(e) => onSeek(Number(e.target.value))} />
      <span className="replay-clock">{clock}</span>
      <span className="muted">{trade.underlying} <b className="underlying-price">{usd(bar.close)}</b></span>
      <span className="replay-pos">
        {!pos.started ? <span className="muted">Not in yet</span>
          : pos.held > 0 ? <>Holding <b>{pos.held}</b></>
          : <span className="muted">Out</span>}
        {pos.started && (pos.held === 0 || pos.realized !== 0) && (
          <> · <span className="muted">{pos.held > 0 ? 'Locked in' : 'Result'}</span> <b className={pnlClass(pos.realized)}>{signedUsd(pos.realized)}</b></>
        )}
      </span>
    </div>
  );
}

/** Side panel section for placing stops and targets and reading the R they give. */
function RiskPanel({ trade, levels, placing, onPlacing, onChange, canMeasure, rr, prices }: {
  trade: Trade;
  levels: Levels;
  placing: LevelKind | null;
  onPlacing: (kind: LevelKind | null) => void;
  onChange: (kind: LevelKind, index: number, patch: Partial<PriceLevel> | null) => void;
  canMeasure: boolean;
  rr: ReturnType<typeof riskReward>;
  prices: LevelPrices | null;
}) {
  // Only use prices that line up with the current lines (they arrive a moment after a change).
  const matched = prices && prices.stops.length === levels.stops.length && prices.targets.length === levels.targets.length ? prices : null;
  const dollars = matched ? dollarRiskReward(trade, levels.stops, matched.stops, levels.targets, matched.targets) : null;
  if (!canMeasure) return <div className="risk muted small">R needs the underlying's price at your entry, which isn't available for this trade.</div>;
  const losing = trade.status === 'CLOSED' && trade.netPnl < 0;
  return (
    <div className="risk">
      <div className="fill-list-head">Risk and reward</div>
      <div className="risk-buttons">
        {(['stops', 'targets'] as const).map((kind) => (
          <button key={kind} className={`${placing === kind ? 'active' : ''} ${kind}`} onClick={() => onPlacing(placing === kind ? null : kind)}>
            + {kind === 'stops' ? 'Stop' : 'Target'}
          </button>
        ))}
      </div>
      {(['stops', 'targets'] as const).flatMap((kind) => levels[kind].map((l, i) => (
        <div className={`level-row ${kind}`} key={`${kind}${i}`}>
          <span className="level-name">{kind === 'stops' ? 'Stop' : 'Target'}</span>
          <span className="level-price">
            {usd(l.price)}
            {matched?.[kind][i] && (
              <span
                className="level-option"
                title={matched[kind][i]!.source === 'market'
                  ? 'The option\'s real price when the underlying reached this line'
                  : 'Estimated with Black-Scholes from your entry\'s implied volatility, as if reached at your exit'}
              >
                {matched[kind][i]!.source === 'market' ? '' : '≈'}{optionUsd(matched[kind][i]!.optionPrice)}
              </span>
            )}
          </span>
          <input
            type="number"
            min={1}
            value={l.contracts}
            title="Contracts at this level"
            onChange={(e) => { const n = Math.max(1, Math.round(Number(e.target.value) || 1)); onChange(kind, i, { contracts: n }); }}
          />
          <span className="muted">ct</span>
          <button className="danger-link" aria-label="Remove" onClick={() => onChange(kind, i, null)}>×</button>
        </div>
      )))}
      {rr ? (
        <div className="rr-summary">
          <div><span className="muted">Risk</span> {usd(rr.risk)} <span className="muted">on {trade.underlying}</span></div>
          {rr.realizedR !== undefined && <div><span className="muted">Result</span> <b className={pnlClass(rr.realizedR)}>{formatR(rr.realizedR)}</b></div>}
          {rr.plannedR !== undefined && <div><span className="muted">Planned R:R</span> <b>1 : {rr.plannedR.toFixed(1)}</b></div>}
          {dollars?.risk !== undefined && (
            <div className="rr-dollars">
              <div>
                <span className="muted">Option risk</span> <b className="loss">{usd(dollars.risk)}</b>
                {dollars.reward !== undefined && <> · <span className="muted">reward</span> <b className={pnlClass(dollars.reward)}>{signedUsd(dollars.reward)}</b></>}
              </div>
              {dollars.ratio !== undefined && <div><span className="muted">Option R:R</span> <b>1 : {dollars.ratio.toFixed(1)}</b></div>}
            </div>
          )}
        </div>
      ) : levels.stops.length ? (
        <div className="muted small">That stop is on the winning side of your entry, so it doesn't measure risk. Drag it past your entry.</div>
      ) : (
        <div className="muted small">Add a stop to measure this trade in R.</div>
      )}
      {rr && losing && !levels.targets.length && <div className="muted small">Losing trade: add the target you were aiming for to see its planned R:R.</div>}
      {levels.stops.length + levels.targets.length > 0 && (
        <div className="muted small">Lines start at your actual exits: winners as targets, losers as stops. Drag a line on the chart to move it. Option prices marked ≈ are estimates; the rest are what the option traded at when the underlying got there.</div>
      )}
    </div>
  );
}
