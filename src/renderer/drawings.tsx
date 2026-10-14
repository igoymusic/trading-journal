// The drawing tools: which drawings a chart shows, the toolbar, and pasting from TradingView.

import { MarkerStyleEditor } from './MarkerStyleEditor';
import { IndicatorsEditor } from './IndicatorsEditor';
import { useEffect, useMemo, useState } from 'react';
import { screenshotsChanged } from './Screenshots';
import {
  type ChartPoint, type Drawing, type PastedDrawing, FIB_LEVELS, daysBetween, drawingStart, drawingSymbol, nyDay, toolName,
} from '../core/drawings';
import { opacityOf, withOpacity } from './drawingsPrimitive';

export type Tool = 'select' | 'hline' | 'vline' | 'trend' | 'arrow' | 'brush' | 'rect' | 'range' | 'fib' | 'long' | 'short' | 'text';

/** Formatting for new drawings (and the selected one). */
export interface DrawStyle { width: number; dash: 'solid' | 'dotted' | 'dashed'; opacity: number; fillOpacity: number }

const COLORS = ['#2962ff', '#f5c542', '#ff9800', '#e040fb', '#00bcd4', '#089981', '#f23645', '#ffffff'];
const DEFAULT_STYLE: DrawStyle = { width: 1.5, dash: 'solid', opacity: 1, fillOpacity: 0.15 };
const CHANGED = 'drawings-changed';

export interface DrawingState {
  symbol: string;
  list: Drawing[];
  tool: Tool;
  setTool: (t: Tool) => void;
  /** The color for new drawings, "#rrggbb". */
  color: string;
  setColor: (c: string) => void;
  /** Style for new drawings, as drawing fields. */
  style: Partial<Drawing>;
  styleSettings: DrawStyle;
  setStyle: (patch: Partial<DrawStyle>) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  put: (d: Drawing) => void;
  remove: (id: string) => void;
  /** The chart day an instant belongs to (instants outside the chart go to its first or last day). */
  dayFor: (ms: number) => string;
  newId: () => string;
}

function remembered<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } : fallback; } catch { return fallback; }
}

/** Drawings for a ticker over a chart's days. Every chart of that ticker stays in step. */
export function useDrawings(underlying: string, firstMs: number | undefined, lastMs: number | undefined): DrawingState | null {
  const symbol = drawingSymbol(underlying);
  const days = useMemo(() => (firstMs === undefined || lastMs === undefined ? [] : daysBetween(nyDay(firstMs), nyDay(lastMs))), [firstMs, lastMs]);
  const daysKey = days.join(',');
  const [list, setList] = useState<Drawing[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [color, setColorState] = useState(() => { try { return localStorage.getItem('drawColor') ?? COLORS[0]; } catch { return COLORS[0]; } });
  const [styleSettings, setStyleState] = useState<DrawStyle>(() => remembered('drawStyle', DEFAULT_STYLE));

  useEffect(() => {
    if (!days.length) return;
    let current = true;
    const load = () => window.journal.getDrawings(symbol, days).then((l) => { if (current) setList(l); });
    load();
    const onChange = (e: Event) => { if ((e as CustomEvent).detail === symbol) load(); };
    window.addEventListener(CHANGED, onChange);
    return () => { current = false; window.removeEventListener(CHANGED, onChange); };
  }, [symbol, daysKey]);

  if (!days.length) return null;
  const changed = () => window.dispatchEvent(new CustomEvent(CHANGED, { detail: symbol }));
  const sel = list.find((d) => d.id === selected);
  const style: Partial<Drawing> = {
    color: withOpacity(color, styleSettings.opacity),
    width: styleSettings.width,
    ...(styleSettings.dash !== 'solid' ? { dash: styleSettings.dash } : {}),
    fill: withOpacity(color, styleSettings.fillOpacity),
  };
  return {
    symbol, list, tool, setTool, color, selected, setSelected, style, styleSettings,
    setColor: (c) => {
      setColorState(c);
      try { localStorage.setItem('drawColor', c); } catch { /* not remembered; fine */ }
      // Changing the color while a drawing is selected recolors it, keeping its opacity.
      if (sel) put({ ...sel, color: withOpacity(c, opacityOf(sel.color)), ...(sel.fill ? { fill: withOpacity(c, opacityOf(sel.fill)) } : {}) } as Drawing);
    },
    setStyle: (patch) => {
      const next = { ...styleSettings, ...patch };
      setStyleState(next);
      try { localStorage.setItem('drawStyle', JSON.stringify(next)); } catch { /* fine */ }
      if (!sel) return;
      const base = sel.color.slice(0, 7);
      const updated: Drawing = { ...sel };
      if (patch.width !== undefined) updated.width = patch.width;
      if (patch.dash !== undefined) updated.dash = patch.dash;
      if (patch.opacity !== undefined) updated.color = withOpacity(base, patch.opacity);
      if (patch.fillOpacity !== undefined) updated.fill = withOpacity((sel.fill ?? base).slice(0, 7), patch.fillOpacity);
      put(updated);
    },
    put,
    remove: (id) => {
      setList((l) => l.filter((d) => d.id !== id));
      if (selected === id) setSelected(null);
      window.journal.deleteDrawing(symbol, id).then(changed);
    },
    dayFor: (ms) => {
      const d = nyDay(ms);
      return d < days[0] ? days[0] : d > days[days.length - 1] ? days[days.length - 1] : d;
    },
    newId: () => crypto.randomUUID(),
  };

  function put(d: Drawing) {
    setList((l) => [...l.filter((x) => x.id !== d.id), d]);
    window.journal.putDrawing(symbol, d).then(changed);
  }
}

type Base = { id: string; day: string; color: string };

/** The shape a two-point tool makes while you drag from `a` to `b`. */
export function shapeFor(tool: Exclude<Tool, 'select'>, base: Base, a: ChartPoint, b: ChartPoint, style: Partial<Drawing>): Drawing {
  const b0 = { id: base.id, day: base.day, color: base.color };
  const s = { ...style, ...b0 } as Base & Partial<Drawing>;
  switch (tool) {
    case 'rect': return { ...s, kind: 'rect', a, b } as Drawing;
    case 'arrow': return { ...s, fill: undefined, kind: 'arrow', a, b } as Drawing;
    case 'brush': return { ...s, fill: undefined, kind: 'path', brush: true, points: [a, b] } as Drawing;
    case 'range': return { ...s, kind: 'range', a, b, measure: 'price' } as Drawing;
    case 'fib': return { ...s, kind: 'fib', a, b, levels: FIB_LEVELS, fill: '#ffffff1a' } as Drawing;
    case 'long': case 'short': {
      // Drag from the entry to the target; the stop starts the same distance the other way.
      const target = b.price;
      return { ...s, fill: undefined, kind: 'position', side: tool, a, end: b.time, target, stop: 2 * a.price - target } as Drawing;
    }
    case 'vline': return { ...s, kind: 'vline', time: a.time } as Drawing;
    case 'hline': return { ...s, kind: 'hline', price: a.price } as Drawing;
    case 'text': return { ...s, kind: 'text', a, text: '' } as Drawing;
    default: return { ...s, fill: undefined, kind: 'trend', a, b } as Drawing;
  }
}

/** Fills in a shape that was clicked rather than dragged, so it isn't zero-sized. */
export function finishShape(d: Drawing, candleMs: number): Drawing {
  if (d.kind === 'position' && d.target === d.a.price) {
    const dir = d.side === 'long' ? 1 : -1;
    const move = d.a.price * 0.002;
    return { ...d, target: d.a.price + dir * move, stop: d.a.price - dir * move, end: Math.max(d.end, d.a.time + 30 * candleMs) };
  }
  if (d.kind === 'position' && d.end <= d.a.time) return { ...d, end: d.a.time + 30 * candleMs };
  return d;
}

/**
 * Saves drawings pasted from TradingView under the ticker and day they were drawn on (price lines
 * go on this chart's day). Returns a message saying where they went.
 */
export async function addPasted(draw: DrawingState, pasted: PastedDrawing[], fallbackMs: number): Promise<string> {
  const bySymbol = new Map<string, Drawing[]>();
  const days = new Set<string>();
  for (const { symbol: from, ...p } of pasted) {
    const symbol = from ? drawingSymbol(from) : draw.symbol;
    const start = drawingStart({ ...p, id: '', day: '', color: '' } as Drawing);
    const day = start === null ? draw.dayFor(fallbackMs) : nyDay(start);
    days.add(day);
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), { ...p, id: draw.newId(), day, color: p.color ?? draw.color } as Drawing]);
  }
  for (const [symbol, list] of bySymbol) {
    await window.journal.putDrawings(symbol, list);
    window.dispatchEvent(new CustomEvent(CHANGED, { detail: symbol }));
  }
  const n = pasted.length;
  const symbols = [...bySymbol.keys()];
  const when = [...days].sort().map((d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
  const where = `${symbols.join(', ')} ${when.length > 3 ? `${when[0]} to ${when[when.length - 1]}` : when.join(', ')}`;
  const elsewhere = !symbols.includes(draw.symbol) ? ` They show on ${symbols.join(', ')} charts, not this ${draw.symbol} one.` : '';
  return `Added ${n} drawing${n === 1 ? '' : 's'} from TradingView (${where}).${elsewhere}`;
}

/** "Fib Channel ×2, Gann Fan" for the types that couldn't be pasted. */
function skippedText(types: string[]) {
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([t, n]) => `${toolName(t)}${n > 1 ? ` ×${n}` : ''}`).join(', ');
}

/**
 * Reads the clipboard into the chart: TradingView drawings become drawings, a picture becomes a
 * screenshot on the trade. Returns a short message saying what happened.
 */
export async function pasteIntoChart(draw: DrawingState | null, fallbackMs: number, tradeId?: string): Promise<string> {
  const r = await window.journal.readPaste();
  const skipped = r.skipped.length ? ` Not supported yet: ${skippedText(r.skipped)}.` : '';
  if (r.drawings.length && draw) return (await addPasted(draw, r.drawings, fallbackMs)) + skipped;
  if (r.hasImage) {
    if (!tradeId) return 'Open a trade to add a screenshot to it.';
    await window.journal.pasteScreenshot(tradeId);
    screenshotsChanged(tradeId);
    return 'Screenshot added to this trade.';
  }
  if (skipped) return `None of those TradingView drawings can be shown here yet.${skipped} A copy was saved so they can be added.`;
  if (r.sampleSaved) return 'No TradingView drawings found on the clipboard. A copy was saved as clipboard-sample.json in the Moon Journal data folder so support can be added.';
  return 'No TradingView drawings or pictures on the clipboard.';
}

const TOOLS: { tool: Tool; icon: string; title: string }[] = [
  { tool: 'select', icon: '↖', title: 'Select and move (Esc)' },
  { tool: 'hline', icon: '─', title: 'Price line' },
  { tool: 'trend', icon: '╱', title: 'Trend line' },
  { tool: 'arrow', icon: '➚', title: 'Arrow marker' },
  { tool: 'brush', icon: '✎', title: 'Brush (draw freehand)' },
  { tool: 'rect', icon: '▭', title: 'Box' },
  { tool: 'range', icon: '↕', title: 'Price range' },
  { tool: 'fib', icon: 'φ', title: 'Fib retracement' },
  { tool: 'long', icon: '▲', title: 'Long position' },
  { tool: 'short', icon: '▼', title: 'Short position' },
  { tool: 'vline', icon: '│', title: 'Vertical line' },
  { tool: 'text', icon: 'T', title: 'Note' },
];

const HAS_FILL = new Set(['rect', 'range', 'fib', 'ellipse', 'channel', 'path']);

/** The strip of drawing tools down the left side of a chart. */
export function DrawToolbar({ draw, onPaste }: { draw: DrawingState; onPaste: () => void }) {
  const [picking, setPicking] = useState(false);
  const [markers, setMarkers] = useState(false);
  const [studies, setStudies] = useState(false);
  const sel = draw.list.find((d) => d.id === draw.selected);
  // Show the selected drawing's formatting, or what new drawings will get.
  const shown: DrawStyle = sel
    ? { width: sel.width ?? 1.5, dash: sel.dash ?? 'solid', opacity: opacityOf(sel.color), fillOpacity: sel.fill ? opacityOf(sel.fill) : draw.styleSettings.fillOpacity }
    : draw.styleSettings;
  const color = sel ? sel.color.slice(0, 7) : draw.color;
  const fillable = sel ? HAS_FILL.has(sel.kind) : ['rect', 'range', 'fib'].includes(draw.tool);
  return (
    <div className="draw-tools" onMouseDown={(e) => e.stopPropagation()}>
      {TOOLS.map((t) => (
        <button key={t.tool} className={draw.tool === t.tool ? 'active' : ''} title={t.title} onClick={() => draw.setTool(t.tool)}>{t.icon}</button>
      ))}
      <div className="draw-color-wrap">
        <button className="draw-color" title="Color and line style" onClick={() => setPicking((p) => !p)}><span style={{ background: sel?.color ?? draw.color }} /></button>
        {picking && (
          <div className="draw-style">
            <div className="draw-colors">
              {COLORS.map((c) => <button key={c} style={{ background: c }} title={c} onClick={() => draw.setColor(c)} />)}
              <input type="color" value={color} title="Any color" onChange={(e) => draw.setColor(e.target.value)} />
            </div>
            <label>Line opacity <input type="range" min={0.1} max={1} step={0.05} value={shown.opacity} onChange={(e) => draw.setStyle({ opacity: Number(e.target.value) })} /></label>
            {fillable && (
              <label>Fill opacity <input type="range" min={0} max={0.8} step={0.05} value={shown.fillOpacity} onChange={(e) => draw.setStyle({ fillOpacity: Number(e.target.value) })} /></label>
            )}
            <div className="draw-style-row">
              {[1, 2, 3, 4].map((w) => (
                <button key={w} className={Math.round(shown.width) === w ? 'active' : ''} title={`${w}px line`} onClick={() => draw.setStyle({ width: w })}>
                  <span className="line-sample" style={{ borderTopWidth: w }} />
                </button>
              ))}
            </div>
            <div className="draw-style-row">
              {(['solid', 'dashed', 'dotted'] as const).map((d) => (
                <button key={d} className={shown.dash === d ? 'active' : ''} title={d} onClick={() => draw.setStyle({ dash: d })}>
                  <span className="line-sample" style={{ borderTopStyle: d }} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {sel?.kind === 'hline' && (
        <button className={sel.keep ? 'active' : ''} title={sel.keep ? 'Shown on later days too (click to show only on this day)' : 'Show this line on later days too'}
          onClick={() => draw.put({ ...sel, keep: !sel.keep })}>📌</button>
      )}
      {sel && <button title="Delete (Del)" onClick={() => draw.remove(sel.id)}>🗑</button>}
      <span className="draw-spacer" />
      <div className="draw-color-wrap">
        <button className={studies ? 'active' : ''} title="Indicators: moving averages, Bollinger Bands, VWAP" onClick={() => { setStudies((s) => !s); setMarkers(false); }}>ƒ</button>
        {studies && <div className="draw-style indicators-pop"><IndicatorsEditor /></div>}
      </div>
      <div className="draw-color-wrap">
        <button className={markers ? 'active' : ''} title="Entry and exit markers: colors, sizes and lines" onClick={() => { setMarkers((m) => !m); setStudies(false); }}>➤</button>
        {markers && <div className="draw-style markers-pop"><MarkerStyleEditor /></div>}
      </div>
      <button title="Paste drawings copied in TradingView, or a screenshot (Ctrl+V)" onClick={onPaste}>📋</button>
    </div>
  );
}
