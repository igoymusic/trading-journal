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
  /** Line color, "#rrggbb" or with opacity "#rrggbbaa". */
  color: string;
  /** Line width in pixels (default 1.5). */
  width?: number;
  dash?: 'solid' | 'dotted' | 'dashed';
  /** Fill for shapes, usually see-through ("#rrggbbaa"). */
  fill?: string;
  textColor?: string;
  fontSize?: number;
  extendLeft?: boolean;
  extendRight?: boolean;
}

export interface FibLevel { value: number; color: string; visible: boolean }

/** TradingView's default retracement levels. */
export const FIB_LEVELS: FibLevel[] = [
  { value: 0, color: '#787b86' }, { value: 0.236, color: '#f23645' }, { value: 0.382, color: '#ff9800' }, { value: 0.5, color: '#4caf50' },
  { value: 0.618, color: '#089981' }, { value: 0.786, color: '#00bcd4' }, { value: 1, color: '#787b86' },
  { value: 1.618, color: '#2962ff' }, { value: 2.618, color: '#f23645' }, { value: 3.618, color: '#9c27b0' }, { value: 4.236, color: '#e91e63' },
].map((l) => ({ ...l, visible: l.value <= 1 }));

export type Drawing = DrawingBase & (
  /** A price level across the chart (or from a time onward, for a ray). `keep` shows it on later days too. */
  | { kind: 'hline'; price: number; keep?: boolean; label?: string; from?: number }
  | { kind: 'vline'; time: number }
  /** A line between two points; `arrow` puts an arrowhead at the end. */
  | { kind: 'trend'; a: ChartPoint; b: ChartPoint; arrow?: boolean }
  | { kind: 'rect'; a: ChartPoint; b: ChartPoint; label?: string }
  /** A box that measures the move between two points. */
  | { kind: 'range'; a: ChartPoint; b: ChartPoint; measure: 'price' | 'date' | 'both' }
  | { kind: 'text'; a: ChartPoint; text: string }
  | { kind: 'fib'; a: ChartPoint; b: ChartPoint; levels: FibLevel[]; reverse?: boolean }
  /** A long or short position: entry at `a`, out to `end`, with stop and target prices. */
  | { kind: 'position'; side: 'long' | 'short'; a: ChartPoint; end: number; stop: number; target: number; stopFill?: string; targetFill?: string }
  /** Two parallel lines: a-b, and the same line moved by `offset` in price. */
  | { kind: 'channel'; a: ChartPoint; b: ChartPoint; offset: number }
  | { kind: 'path'; points: ChartPoint[]; closed?: boolean }
  | { kind: 'ellipse'; a: ChartPoint; b: ChartPoint }
);

export type DrawingKind = Drawing['kind'];

/** Every point a drawing has, for working out its day and moving it. */
export function drawingPoints(d: Drawing): ChartPoint[] {
  switch (d.kind) {
    case 'hline': return [{ time: d.from ?? 0, price: d.price }];
    case 'vline': return [{ time: d.time, price: 0 }];
    case 'text': return [d.a];
    case 'path': return d.points;
    case 'position': return [d.a, { time: d.end, price: d.a.price }];
    default: return [d.a, d.b];
  }
}

/** The earliest moment a drawing covers (none for a plain price line). */
export function drawingStart(d: Drawing): number | null {
  if (d.kind === 'hline') return d.from ?? null;
  return Math.min(...drawingPoints(d).map((p) => p.time));
}

/** The points you can grab to reshape a drawing. */
export function drawingHandles(d: Drawing): { key: string; point: ChartPoint }[] {
  switch (d.kind) {
    case 'hline': case 'vline': case 'text': return [];
    case 'path': return d.points.map((point, i) => ({ key: String(i), point }));
    case 'position': return [
      { key: 'a', point: d.a },
      { key: 'stop', point: { time: d.a.time, price: d.stop } },
      { key: 'target', point: { time: d.a.time, price: d.target } },
      { key: 'end', point: { time: d.end, price: d.a.price } },
    ];
    case 'channel': return [{ key: 'a', point: d.a }, { key: 'b', point: d.b }, { key: 'offset', point: { time: (d.a.time + d.b.time) / 2, price: (d.a.price + d.b.price) / 2 + d.offset } }];
    default: return [{ key: 'a', point: d.a }, { key: 'b', point: d.b }];
  }
}

/** Moves one handle of a drawing to a new point. */
export function moveHandle(d: Drawing, key: string, p: ChartPoint): Drawing {
  switch (d.kind) {
    case 'path': return { ...d, points: d.points.map((x, i) => (String(i) === key ? p : x)) };
    case 'position':
      if (key === 'a') {
        // Moving the entry keeps the stop and target the same distance away.
        const dp = p.price - d.a.price;
        return { ...d, a: p, stop: d.stop + dp, target: d.target + dp };
      }
      if (key === 'stop') return { ...d, stop: p.price };
      if (key === 'target') return { ...d, target: p.price };
      return { ...d, end: p.time };
    case 'channel':
      if (key === 'offset') return { ...d, offset: p.price - (d.a.price + d.b.price) / 2 };
      return { ...d, [key]: p };
    case 'hline': case 'vline': case 'text': return d;
    default: return { ...d, [key]: p };
  }
}

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
    case 'hline': return { ...d, price: d.price + dp, ...(d.from !== undefined ? { from: d.from + dt } : {}) };
    case 'vline': return { ...d, time: d.time + dt };
    case 'text': return { ...d, a: move(d.a) };
    case 'path': return { ...d, points: d.points.map(move) };
    case 'position': return { ...d, a: move(d.a), end: d.end + dt, stop: d.stop + dp, target: d.target + dp };
    default: return { ...d, a: move(d.a), b: move(d.b) };
  }
}

// ---- Pasting drawings copied in TradingView ----

type Unplaced<T> = T extends Drawing ? Omit<T, 'id' | 'day' | 'color'> & { color?: string; symbol?: string } : never;
/** A drawing read from TradingView, with the ticker it was drawn on when TradingView says. */
export type PastedDrawing = Unplaced<Drawing>;

/** "rgba(41, 98, 255, 0.5)" or "#2962ff" -> "#2962ff" / "#2962ff80". `alpha` multiplies the opacity. */
export function toHex(c: unknown, alpha = 1): string | undefined {
  if (typeof c !== 'string') return undefined;
  let rgb: number[];
  let a = 1;
  const hex = c.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  const rgba = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?/i);
  if (hex) {
    rgb = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
    if (hex[2]) a = parseInt(hex[2], 16) / 255;
  } else if (rgba) {
    rgb = [rgba[1], rgba[2], rgba[3]].map(Number);
    if (rgba[4] !== undefined) a = Number(rgba[4]);
  } else return undefined;
  a = Math.max(0, Math.min(1, a * alpha));
  const two = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${rgb.map(two).join('')}${a < 0.995 ? two(a * 255) : ''}`;
}

/** TradingView's line styles: 0 solid, 1 dotted, 2 dashed, 3 long dashes. */
const DASH: Record<number, 'solid' | 'dotted' | 'dashed'> = { 0: 'solid', 1: 'dotted', 2: 'dashed', 3: 'dashed' };

/** Minutes in a TradingView interval ("1", "15", "60", "D"...), for points placed bars past a time. */
function intervalMinutes(i: unknown): number {
  const n = Number(i);
  if (Number.isFinite(n) && n > 0) return n;
  return ({ D: 1440, '1D': 1440, W: 10080, '1W': 10080 } as Record<string, number>)[String(i)] ?? 1;
}

function point(p: any): ChartPoint | null {
  const t = p?.time_t ?? p?.time ?? p?.timestamp;
  const price = Number(p?.price);
  if (t === undefined || !Number.isFinite(price)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  // TradingView counts seconds; anything this large is already milliseconds.
  const ms = n > 1e11 ? n : n * 1000;
  // A point past the last candle is stored as a candle time plus a number of bars.
  const offset = Number(p?.offset) || 0;
  return { time: ms + offset * intervalMinutes(p?.interval) * 60_000, price };
}

/** "AMEX:SPY" -> "SPY". */
const plainSymbol = (s: unknown) => (typeof s === 'string' && s ? s.split(':').pop()!.trim().toUpperCase() : undefined);

const TREND = new Set(['LineToolTrendLine', 'LineToolRay', 'LineToolExtended', 'LineToolArrow', 'LineToolInfoLine', 'LineToolTrendAngle', 'LineToolCrossLine']);
const TEXT = new Set(['LineToolText', 'LineToolTextAbsolute', 'LineToolNote', 'LineToolNoteAbsolute', 'LineToolCallout', 'LineToolBalloon', 'LineToolComment', 'LineToolSignpost', 'LineToolFlagMark', 'LineToolPriceNote']);
const PATH = new Set(['LineToolPath', 'LineToolPolyline', 'LineToolBrush', 'LineToolHighlighter', 'LineToolTriangle']);
const FIB = new Set(['LineToolFibRetracement', 'LineToolFibChannel', 'LineToolFibTimeZone', 'LineToolFibSpeedResistanceFan', 'LineToolTrendBasedFibExtension']);

/** The opacity TradingView's 0-100 "transparency" leaves. */
const opacity = (t: unknown) => (Number.isFinite(Number(t)) ? 1 - Number(t) / 100 : 1);

/** A shape's fill: its background color, faded by its transparency unless the color says how see-through it is. */
function fillOf(state: any): string | undefined {
  if (state.fillBackground === false) return undefined;
  const bg = state.backgroundColor ?? state.fillColor;
  if (typeof bg !== 'string') return undefined;
  const hasAlpha = /rgba\([^)]*,[^)]*,[^)]*,/.test(bg) || /^#[0-9a-f]{8}$/i.test(bg);
  return toHex(bg, hasAlpha ? 1 : opacity(state.transparency ?? 80));
}

/** One TradingView drawing, or the name of its type when Moon Journal can't draw it. */
function fromSource(s: any): PastedDrawing | string | null {
  const type: unknown = s?.type;
  if (typeof type !== 'string' || !type.startsWith('LineTool')) return null;
  const state = s.state ?? {};
  const pts = (s.points ?? s.positions ?? []).map(point).filter(Boolean) as ChartPoint[];
  const symbol = plainSymbol(state.symbol);
  const style = {
    color: toHex(state.linecolor ?? state.color ?? state.bordercolor ?? state.textcolor),
    ...(Number(state.linewidth) > 0 ? { width: Number(state.linewidth) } : {}),
    ...(DASH[state.linestyle] && DASH[state.linestyle] !== 'solid' ? { dash: DASH[state.linestyle] } : {}),
    ...(toHex(state.textcolor ?? state.textColor) ? { textColor: toHex(state.textcolor ?? state.textColor) } : {}),
    ...(Number(state.fontsize ?? state.fontSize) > 0 ? { fontSize: Number(state.fontsize ?? state.fontSize) } : {}),
    ...(state.extendLeft ? { extendLeft: true } : {}),
    ...(state.extendRight ? { extendRight: true } : {}),
    ...(symbol ? { symbol } : {}),
  };
  const [a, b, c] = pts;
  const text = typeof state.text === 'string' && state.text ? state.text : undefined;

  if (type === 'LineToolHorzLine' || type === 'LineToolHorzRay' || type === 'LineToolPriceLabel') {
    const price = a?.price ?? Number(state.price);
    if (!Number.isFinite(price)) return null;
    return { kind: 'hline', price, ...(text ? { label: text } : {}), ...(type === 'LineToolHorzRay' && a ? { from: a.time } : {}), ...style };
  }
  if (type === 'LineToolVertLine') return a ? { kind: 'vline', time: a.time, ...style } : null;
  if (TEXT.has(type)) return a ? { kind: 'text', a, text: text ?? String(s.text ?? ''), ...style, color: toHex(state.textcolor ?? state.color) ?? style.color } : null;
  if (PATH.has(type)) {
    return pts.length >= 2 ? { kind: 'path', points: pts, ...(type === 'LineToolTriangle' ? { closed: true } : {}), ...(fillOf(state) ? { fill: fillOf(state) } : {}), ...style } : null;
  }
  if (!a || !b) return FIB.has(type) || type.includes('RiskReward') ? type : null;

  if (TREND.has(type)) {
    return {
      kind: 'trend', a, b, ...style,
      ...(type === 'LineToolRay' ? { extendRight: true } : {}),
      ...(type === 'LineToolExtended' ? { extendLeft: true, extendRight: true } : {}),
      ...(type === 'LineToolArrow' || state.rightEnd === 1 ? { arrow: true } : {}),
    };
  }
  if (type === 'LineToolRectangle') return { kind: 'rect', a, b, ...(fillOf(state) ? { fill: fillOf(state) } : {}), ...(text ? { label: text } : {}), ...style };
  if (type === 'LineToolPriceRange' || type === 'LineToolDateRange' || type === 'LineToolDateAndPriceRange') {
    const measure = type === 'LineToolPriceRange' ? 'price' : type === 'LineToolDateRange' ? 'date' : 'both';
    return { kind: 'range', a, b, measure, ...(fillOf(state) ? { fill: fillOf(state) } : {}), ...style };
  }
  if (type === 'LineToolEllipse' || type === 'LineToolCircle') {
    // A circle is its center and a point on its edge; turn it into the box around it.
    const box = type === 'LineToolCircle' ? { a: { time: 2 * a.time - b.time, price: 2 * a.price - b.price }, b } : { a, b };
    return { kind: 'ellipse', ...box, ...(fillOf(state) ? { fill: fillOf(state) } : {}), ...style };
  }
  if (type === 'LineToolParallelChannel' && c) {
    // The third point sets how far the second line is from the first.
    const slope = b.time === a.time ? 0 : (b.price - a.price) / (b.time - a.time);
    return { kind: 'channel', a, b, offset: c.price - (a.price + slope * (c.time - a.time)), ...(fillOf(state) ? { fill: fillOf(state) } : {}), ...style };
  }
  if (type === 'LineToolFibRetracement') {
    const levels: FibLevel[] = [];
    for (let i = 1; i <= 30; i++) {
      // Each level is { coeff, color, visible } or, in newer copies, [coeff, color, visible, text].
      const raw = state[`level${i}`];
      const l = Array.isArray(raw) ? { coeff: raw[0], color: raw[1], visible: raw[2] } : raw;
      if (l && Number.isFinite(Number(l.coeff))) levels.push({ value: Number(l.coeff), color: toHex(l.color) ?? '#787b86', visible: l.visible !== false });
    }
    const trend = state.trendline;
    const ls = state.levelsStyle ?? {};
    return {
      kind: 'fib', a, b, levels: levels.length ? levels : FIB_LEVELS,
      ...(state.reverse ? { reverse: true } : {}),
      ...style,
      color: toHex(trend?.color) ?? style.color ?? '#787b86',
      ...(trend?.visible === false ? { color: '#00000000' } : {}),
      ...(Number(ls.linewidth) > 0 ? { width: Number(ls.linewidth) } : {}),
      ...(DASH[ls.linestyle] && DASH[ls.linestyle] !== 'solid' ? { dash: DASH[ls.linestyle] } : {}),
      // Fib fills are each level's color, this see-through.
      ...(state.fillBackground !== false ? { fill: toHex('#ffffff', opacity(state.transparency ?? 80)) } : {}),
      ...(state.extendLines || state.extendLinesRight ? { extendRight: true } : {}),
      ...(state.extendLinesLeft ? { extendLeft: true } : {}),
    };
  }
  if (type === 'LineToolRiskRewardLong' || type === 'LineToolRiskRewardShort') {
    const long = type === 'LineToolRiskRewardLong';
    const dir = long ? 1 : -1;
    // Newer copies say the prices; older ones say distances in ticks.
    const tick = 0.01;
    const stop = Number.isFinite(Number(state.stopPrice)) ? Number(state.stopPrice) : a.price - dir * Number(state.stopLevel ?? 0) * tick;
    const target = Number.isFinite(Number(state.targetPrice)) ? Number(state.targetPrice) : a.price + dir * Number(state.profitLevel ?? 0) * tick;
    return {
      kind: 'position', side: long ? 'long' : 'short', a, end: b.time, stop, target, ...style,
      ...(toHex(state.stopBackground, opacity(state.stopBackgroundTransparency ?? 0)) ? { stopFill: toHex(state.stopBackground, /rgba/.test(String(state.stopBackground)) ? 1 : opacity(state.stopBackgroundTransparency ?? 80)) } : {}),
      ...(toHex(state.profitBackground) ? { targetFill: toHex(state.profitBackground, /rgba/.test(String(state.profitBackground)) ? 1 : opacity(state.profitBackgroundTransparency ?? 80)) } : {}),
    };
  }
  return type;
}

/** Everything that looks like a TradingView drawing anywhere inside a parsed JSON value. */
function collect(v: unknown, out: PastedDrawing[], skipped: string[], depth = 0) {
  if (!v || typeof v !== 'object' || depth > 12) return;
  if (Array.isArray(v)) { for (const x of v) collect(x, out, skipped, depth + 1); return; }
  const d = fromSource(v);
  if (typeof d === 'string') { skipped.push(d); return; }
  if (d) { out.push(d); return; }
  for (const x of Object.values(v)) {
    // Some apps store nested JSON as a string.
    if (typeof x === 'string' && /^\s*[[{]/.test(x) && x.includes('LineTool')) { try { collect(JSON.parse(x), out, skipped, depth + 1); } catch { /* not JSON */ } }
    else collect(x, out, skipped, depth + 1);
  }
}

/** The JSON values hidden in clipboard text or HTML, however TradingView wraps them. */
function jsonCandidates(raw: string): unknown[] {
  const isHtml = /<[a-z!]/i.test(raw);
  // In HTML, TradingView keeps the data in a tag's attribute, so keep attribute values and decode them.
  const text = isHtml ? decodeEntities(raw.replace(/<[^>]*>/g, (tag) => ` ${[...tag.matchAll(/="([^"]*)"/g)].map((m) => m[1]).join(' ')} `)) : raw;
  const out: unknown[] = [];
  for (const s of isHtml ? [text] : [raw]) {
    try { out.push(JSON.parse(s)); continue; } catch { /* look inside */ }
    for (let i = s.indexOf('{'); i >= 0 && out.length < 10_000; i = s.indexOf('{', i + 1)) {
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

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

/** TradingView's name for a drawing type, in plain words ("LineToolGannFan" -> "Gann Fan"). */
export const toolName = (type: string) => type.replace(/^LineTool/, '').replace(/([a-z])([A-Z])/g, '$1 $2');

/**
 * Drawings found in what TradingView put on the clipboard, and the types of any it held that
 * can't be drawn here.
 */
export function parseTradingViewClipboard(...texts: (string | undefined)[]): { drawings: PastedDrawing[]; skipped: string[] } {
  const found: PastedDrawing[] = [];
  let skipped: string[] = [];
  for (const t of texts) {
    if (!t || !t.includes('LineTool')) continue;
    const before = found.length;
    const missed: string[] = [];
    for (const v of jsonCandidates(t)) collect(v, found, missed);
    // Each format holds the same copy, so count what was skipped once.
    if (found.length > before || missed.length > skipped.length) skipped = missed;
  }
  // The same drawing can show up in both the text and the HTML.
  const seen = new Set<string>();
  const drawings = found.filter((d) => { const k = JSON.stringify(d); if (seen.has(k)) return false; seen.add(k); return true; });
  return { drawings, skipped };
}
