// The drawing tools: which drawings a chart shows, the toolbar, and pasting from TradingView.

import { useEffect, useMemo, useState } from 'react';
import { screenshotsChanged } from './Screenshots';
import { type Drawing, type PastedDrawing, daysBetween, drawingSymbol, nyDay } from '../core/drawings';

export type Tool = 'select' | 'hline' | 'trend' | 'rect' | 'text';

const COLORS = ['#2962ff', '#f5c542', '#ff9800', '#e040fb', '#00bcd4', '#ffffff'];
const CHANGED = 'drawings-changed';

export interface DrawingState {
  symbol: string;
  list: Drawing[];
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  put: (d: Drawing) => void;
  remove: (id: string) => void;
  /** The chart day an instant belongs to (instants outside the chart go to its first or last day). */
  dayFor: (ms: number) => string;
  newId: () => string;
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
  return {
    symbol, list, tool, setTool, color, selected, setSelected,
    setColor: (c) => {
      setColorState(c);
      try { localStorage.setItem('drawColor', c); } catch { /* not remembered; fine */ }
      // Changing the color while a drawing is selected recolors it.
      const sel = list.find((d) => d.id === selected);
      if (sel) put({ ...sel, color: c });
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

/** Turns drawings pasted from TradingView into this chart's drawings. */
export function addPasted(draw: DrawingState, pasted: PastedDrawing[], fallbackMs: number) {
  for (const p of pasted) {
    const at = p.kind === 'hline' ? fallbackMs : p.a.time;
    draw.put({ ...p, id: draw.newId(), day: draw.dayFor(at), color: p.color ?? draw.color } as Drawing);
  }
}

/**
 * Reads the clipboard into the chart: TradingView drawings become drawings, a picture becomes a
 * screenshot on the trade. Returns a short message saying what happened.
 */
export async function pasteIntoChart(draw: DrawingState | null, fallbackMs: number, tradeId?: string): Promise<string> {
  const r = await window.journal.readPaste();
  if (r.drawings.length && draw) {
    addPasted(draw, r.drawings, fallbackMs);
    return `Added ${r.drawings.length} drawing${r.drawings.length === 1 ? '' : 's'} from TradingView.`;
  }
  if (r.hasImage) {
    if (!tradeId) return 'Open a trade to add a screenshot to it.';
    await window.journal.pasteScreenshot(tradeId);
    screenshotsChanged(tradeId);
    return 'Screenshot added to this trade.';
  }
  if (r.sampleSaved) return 'No TradingView drawings found on the clipboard. A copy was saved as clipboard-sample.json in the Moon Journal data folder so support can be added.';
  return 'The clipboard is empty.';
}

const TOOLS: { tool: Tool; icon: string; title: string }[] = [
  { tool: 'select', icon: '↖', title: 'Select and move (Esc)' },
  { tool: 'hline', icon: '─', title: 'Price line' },
  { tool: 'trend', icon: '╱', title: 'Trend line' },
  { tool: 'rect', icon: '▭', title: 'Box' },
  { tool: 'text', icon: 'T', title: 'Note' },
];

/** The strip of drawing tools down the left side of a chart. */
export function DrawToolbar({ draw, onPaste }: { draw: DrawingState; onPaste: () => void }) {
  const [picking, setPicking] = useState(false);
  const sel = draw.list.find((d) => d.id === draw.selected);
  return (
    <div className="draw-tools" onMouseDown={(e) => e.stopPropagation()}>
      {TOOLS.map((t) => (
        <button key={t.tool} className={draw.tool === t.tool ? 'active' : ''} title={t.title} onClick={() => draw.setTool(t.tool)}>{t.icon}</button>
      ))}
      <div className="draw-color-wrap">
        <button className="draw-color" title="Color" onClick={() => setPicking((p) => !p)}><span style={{ background: sel?.color ?? draw.color }} /></button>
        {picking && (
          <div className="draw-colors">
            {COLORS.map((c) => <button key={c} style={{ background: c }} title={c} onClick={() => { draw.setColor(c); setPicking(false); }} />)}
            <input type="color" value={draw.color} title="Any color" onChange={(e) => draw.setColor(e.target.value)} />
          </div>
        )}
      </div>
      {sel?.kind === 'hline' && (
        <button className={sel.keep ? 'active' : ''} title={sel.keep ? 'Shown on later days too (click to show only on this day)' : 'Show this line on later days too'}
          onClick={() => draw.put({ ...sel, keep: !sel.keep })}>📌</button>
      )}
      {sel && <button title="Delete (Del)" onClick={() => draw.remove(sel.id)}>🗑</button>}
      <span className="draw-spacer" />
      <button title="Paste drawings copied in TradingView, or a screenshot (Ctrl+V)" onClick={onPaste}>📋</button>
    </div>
  );
}
