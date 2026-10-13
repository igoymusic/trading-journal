// Lines, boxes and notes you draw on a chart. They belong to a ticker and a day, so the day's
// chart and every trade chart for that ticker that day show the same drawings.

export interface ChartPoint {
  /** Epoch milliseconds. */
  time: number;
  price: number;
}

interface DrawingBase {
  id: string;
  /** The trading day it was drawn on, "YYYY-MM-DD" (New York). */
  day: string;
  color: string;
}

export type Drawing = DrawingBase & (
  /** A price level across the whole chart. `keep` shows it on later days too. */
  | { kind: 'hline'; price: number; keep?: boolean; label?: string }
  | { kind: 'trend'; a: ChartPoint; b: ChartPoint }
  | { kind: 'rect'; a: ChartPoint; b: ChartPoint }
  | { kind: 'text'; a: ChartPoint; text: string }
);

export type DrawingKind = Drawing['kind'];

/** Index options share drawings with their index: SPXW trades see SPX drawings and the other way round. */
export function drawingSymbol(underlying: string): string {
  const roots: Record<string, string> = { SPXW: 'SPX', NDXP: 'NDX', RUTW: 'RUT', XSP: 'SPX' };
  return roots[underlying] ?? underlying;
}

/** The New York calendar day of an instant. */
export const nyDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** Every day from `from` to `to` ("YYYY-MM-DD"), inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/** Moves a drawing by a change in time and price (for dragging). */
export function shiftDrawing(d: Drawing, dt: number, dp: number): Drawing {
  const move = (p: ChartPoint) => ({ time: p.time + dt, price: p.price + dp });
  switch (d.kind) {
    case 'hline': return { ...d, price: d.price + dp };
    case 'text': return { ...d, a: move(d.a) };
    default: return { ...d, a: move(d.a), b: move(d.b) };
  }
}

// ---- Pasting drawings copied in TradingView ----

export type PastedDrawing = { kind: 'hline'; price: number; color?: string; label?: string }
  | { kind: 'trend' | 'rect'; a: ChartPoint; b: ChartPoint; color?: string }
  | { kind: 'text'; a: ChartPoint; text: string; color?: string };

const KINDS: Record<string, 'hline' | 'trend' | 'rect' | 'text'> = {
  LineToolHorzLine: 'hline', LineToolHorzRay: 'hline', LineToolPriceLabel: 'hline',
  LineToolTrendLine: 'trend', LineToolRay: 'trend', LineToolExtended: 'trend', LineToolArrow: 'trend', LineToolInfoLine: 'trend', LineToolTrendAngle: 'trend',
  LineToolRectangle: 'rect',
  LineToolText: 'text', LineToolTextAbsolute: 'text', LineToolNote: 'text', LineToolNoteAbsolute: 'text', LineToolCallout: 'text', LineToolBalloon: 'text', LineToolComment: 'text',
};

/** "rgba(41, 98, 255, 1)" or "#2962ff" -> "#2962ff". */
function toHex(c: unknown): string | undefined {
  if (typeof c !== 'string') return undefined;
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : undefined;
}

function point(p: any): ChartPoint | null {
  const t = p?.time_t ?? p?.time ?? p?.timestamp;
  const price = Number(p?.price);
  if (t === undefined || !Number.isFinite(price)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  // TradingView counts seconds; anything this large is already milliseconds.
  return { time: n > 1e11 ? n : n * 1000, price };
}

function fromSource(s: any): PastedDrawing | null {
  const kind = KINDS[s?.type];
  if (!kind) return null;
  const state = s.state ?? {};
  const pts = (s.points ?? s.positions ?? []).map(point).filter(Boolean) as ChartPoint[];
  const color = toHex(state.linecolor ?? state.color ?? state.textColor ?? state.backgroundColor);
  if (kind === 'hline') {
    const price = pts[0]?.price ?? Number(state.price);
    return Number.isFinite(price) ? { kind, price, color, ...(state.text ? { label: String(state.text) } : {}) } : null;
  }
  if (kind === 'text') return pts[0] ? { kind, a: pts[0], text: String(state.text ?? s.text ?? ''), color } : null;
  return pts.length >= 2 ? { kind, a: pts[0], b: pts[1], color } : null;
}

/** Everything that looks like a TradingView drawing anywhere inside a parsed JSON value. */
function collect(v: unknown, out: PastedDrawing[], depth = 0) {
  if (!v || typeof v !== 'object' || depth > 12) return;
  if (Array.isArray(v)) { for (const x of v) collect(x, out, depth + 1); return; }
  const d = fromSource(v);
  if (d) { out.push(d); return; }
  for (const x of Object.values(v)) {
    // Some apps store nested JSON as a string.
    if (typeof x === 'string' && /^\s*[[{]/.test(x) && x.includes('LineTool')) { try { collect(JSON.parse(x), out, depth + 1); } catch { /* not JSON */ } }
    else collect(x, out, depth + 1);
  }
}

/** The JSON values hidden in clipboard text or HTML, however TradingView wraps them. */
function jsonCandidates(raw: string): unknown[] {
  const text = raw.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
  const out: unknown[] = [];
  for (const s of [raw, text]) {
    try { out.push(JSON.parse(s)); continue; } catch { /* look inside */ }
    for (let i = s.indexOf('{'); i >= 0 && out.length < 50; i = s.indexOf('{', i + 1)) {
      // Find the matching brace, then try it as JSON.
      let depth = 0;
      let inStr = false;
      for (let j = i; j < s.length; j++) {
        const ch = s[j];
        if (inStr) { if (ch === '\\') j++; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
          try { out.push(JSON.parse(s.slice(i, j + 1))); i = j; } catch { /* keep looking */ }
          break;
        }
      }
    }
  }
  return out;
}

/** Drawings found in what TradingView put on the clipboard; empty when there are none. */
export function parseTradingViewClipboard(...texts: (string | undefined)[]): PastedDrawing[] {
  const found: PastedDrawing[] = [];
  for (const t of texts) if (t && t.includes('LineTool')) for (const v of jsonCandidates(t)) collect(v, found);
  // The same drawing can show up in both the text and the HTML.
  const seen = new Set<string>();
  return found.filter((d) => { const k = JSON.stringify(d); if (seen.has(k)) return false; seen.add(k); return true; });
}
