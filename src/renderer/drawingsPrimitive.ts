// Draws your chart drawings (lines, boxes, fibs, positions, notes...) on a price chart, with the
// formatting they were given, and works out which one is under the mouse.

import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive,
  SeriesAttachedParameter, SeriesType, Time, UTCTimestamp,
} from 'lightweight-charts';
import { type ChartPoint, type Drawing, drawingHandles } from '../core/drawings';
import { chartTime, fromChartTime } from '../core/time';

export const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const HANDLE = 4;

export interface Xy { x: number; y: number }

/** What the mouse is over: a drawing, and which handle if it's on one. */
export interface Hit { id: string; handle?: string }

type Box = { x1: number; x2: number; y1: number; y2: number };

export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApiBase<Time> | null = null;
  series: ISeriesApi<SeriesType, Time> | null = null;
  drawings: Drawing[] = [];
  /** The shape being drawn right now, before it's saved. */
  preview: Drawing | null = null;
  selected: string | null = null;
  private views = [new PaneView(this)];
  private requestUpdate?: () => void;
  /** Where each note's text box was last drawn, for clicking on it. */
  textBoxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  width = 0;
  height = 0;

  /** `candles` are the chart's candle times (seconds on the chart's clock); `step` is one candle in seconds. */
  constructor(public candles: UTCTimestamp[], public step: number, public timeZone: string) {}

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.chart = chart;
    this.series = series;
    this.requestUpdate = requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
  }

  paneViews() {
    return this.views;
  }

  update() {
    this.requestUpdate?.();
  }

  /** Candle position (fractional) of an instant, so drawings sit between candles and past the ends. */
  private logical(ms: number): number {
    const t = chartTime(ms, this.timeZone);
    const c = this.candles;
    if (!c.length) return 0;
    if (t <= c[0]) return (t - c[0]) / this.step;
    if (t >= c[c.length - 1]) return c.length - 1 + (t - c[c.length - 1]) / this.step;
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= t) lo = mid; else hi = mid;
    }
    // Inside a gap (overnight), stay within a candle's width of the last one.
    return lo + Math.min(1, (t - c[lo]) / Math.min(this.step, c[hi] - c[lo]));
  }

  x(ms: number): number | null {
    return this.chart?.timeScale().logicalToCoordinate(this.logical(ms) as never) ?? null;
  }

  y(price: number): number | null {
    return this.series?.priceToCoordinate(price) ?? null;
  }

  toXy(p: ChartPoint): Xy | null {
    const x = this.x(p.time);
    const y = this.y(p.price);
    return x === null || y === null ? null : { x, y };
  }

  fromXy({ x, y }: Xy): ChartPoint | null {
    if (!this.chart || !this.series || !this.candles.length) return null;
    const logical = this.chart.timeScale().coordinateToLogical(x);
    const price = this.series.coordinateToPrice(y);
    if (logical === null || price === null) return null;
    const c = this.candles;
    const i = Math.floor(logical);
    let t: number;
    if (i < 0) t = c[0] + logical * this.step;
    else if (i >= c.length - 1) t = c[c.length - 1] + (logical - (c.length - 1)) * this.step;
    else t = c[i] + (logical - i) * Math.min(this.step, c[i + 1] - c[i]);
    return { time: fromChartTime(t, this.timeZone), price };
  }

  /** Fib level prices, from the first point (1) to the second (0) unless reversed. */
  fibPrice(d: Extract<Drawing, { kind: 'fib' }>, value: number) {
    const [from, to] = d.reverse ? [d.b, d.a] : [d.a, d.b];
    return to.price + (from.price - to.price) * value;
  }

  /** The area a drawing covers on screen, for clicking inside shapes. */
  box(d: Drawing): Box | null {
    const pts: (Xy | null)[] = [];
    switch (d.kind) {
      case 'fib': {
        const xs = [this.x(d.a.time), this.x(d.b.time)];
        const ys = d.levels.filter((l) => l.visible).map((l) => this.y(this.fibPrice(d, l.value)));
        if (xs.includes(null) || ys.includes(null) || !ys.length) return null;
        return { x1: d.extendLeft ? 0 : Math.min(...(xs as number[])), x2: d.extendRight ? this.width : Math.max(...(xs as number[])), y1: Math.min(...(ys as number[])), y2: Math.max(...(ys as number[])) };
      }
      case 'position': pts.push(this.toXy({ time: d.a.time, price: d.stop }), this.toXy({ time: d.end, price: d.target })); break;
      case 'channel': pts.push(this.toXy(d.a), this.toXy(d.b), this.toXy({ ...d.a, price: d.a.price + d.offset }), this.toXy({ ...d.b, price: d.b.price + d.offset })); break;
      case 'rect': case 'range': case 'ellipse': pts.push(this.toXy(d.a), this.toXy(d.b)); break;
      default: return null;
    }
    if (pts.some((p) => !p)) return null;
    const xs = (pts as Xy[]).map((p) => p.x);
    const ys = (pts as Xy[]).map((p) => p.y);
    return { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
  }

  /** The line a trend line covers on screen, stretched to the edges when it extends. */
  segment(a: Xy, b: Xy, left?: boolean, right?: boolean): [Xy, Xy] {
    const dx = b.x - a.x;
    if (Math.abs(dx) < 0.01) return [a, b];
    const slope = (b.y - a.y) / dx;
    const at = (x: number) => ({ x, y: a.y + slope * (x - a.x) });
    const [p, q] = a.x <= b.x ? [a, b] : [b, a];
    return [left ? at(Math.min(0, p.x)) : p, right ? at(Math.max(this.width, q.x)) : q];
  }

  /** The drawing under a point, if any. Handles of the selected drawing win. */
  findAt(at: Xy): Hit | null {
    const sel = this.drawings.find((d) => d.id === this.selected);
    if (sel) {
      for (const h of drawingHandles(sel)) {
        const p = this.toXy(h.point);
        if (p && Math.hypot(p.x - at.x, p.y - at.y) <= HANDLE + 3) return { id: sel.id, handle: h.key };
      }
    }
    const near = (a: Xy | null, b: Xy | null, left?: boolean, right?: boolean) => !!a && !!b && segmentDistance(at, ...this.segment(a, b, left, right)) <= 5;
    const inside = (b: Box | null) => !!b && at.x >= b.x1 - 4 && at.x <= b.x2 + 4 && at.y >= b.y1 - 4 && at.y <= b.y2 + 4;
    for (const d of [...this.drawings].reverse()) {
      let hit = false;
      switch (d.kind) {
        case 'hline': {
          const y = this.y(d.price);
          const from = d.from !== undefined ? this.x(d.from) : null;
          hit = y !== null && Math.abs(y - at.y) <= 5 && (from === null || at.x >= from - 4);
          break;
        }
        case 'vline': { const x = this.x(d.time); hit = x !== null && Math.abs(x - at.x) <= 5; break; }
        case 'text': {
          const b = this.textBoxes.get(d.id);
          hit = !!b && at.x >= b.x - 3 && at.x <= b.x + b.w + 3 && at.y >= b.y - 3 && at.y <= b.y + b.h + 3;
          break;
        }
        case 'trend': hit = near(this.toXy(d.a), this.toXy(d.b), d.extendLeft, d.extendRight); break;
        case 'path': {
          const pts = d.points.map((p) => this.toXy(p));
          hit = pts.some((p, i) => i > 0 && near(pts[i - 1], p)) || (!!d.closed && near(pts[pts.length - 1], pts[0]));
          break;
        }
        default: hit = inside(this.box(d));
      }
      if (hit) return { id: d.id };
    }
    return null;
  }
}

function segmentDistance(p: Xy, a: Xy, b: Xy) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A color at some opacity: "#rrggbb" plus alpha, keeping any opacity it already has. */
export function withOpacity(color: string, alpha: number) {
  const base = color.slice(0, 7);
  const had = color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1;
  return `${base}${Math.round(had * alpha * 255).toString(16).padStart(2, '0')}`;
}

/** How see-through a fill is, 0-1. */
export const opacityOf = (color?: string) => (color && color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1);

const fmt = (n: number) => n.toFixed(2);

class Renderer implements IPrimitivePaneRenderer {
  constructor(private source: DrawingsPrimitive) {}

  draw(target: CanvasRenderingTarget2D) {
    const src = this.source;
    if (!src.chart || !src.series) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      src.width = mediaSize.width;
      src.height = mediaSize.height;
      src.textBoxes.clear();
      const list = src.preview ? [...src.drawings.filter((d) => d.id !== src.preview!.id), src.preview] : src.drawings;
      for (const d of list) {
        ctx.save();
        try {
          this.drawOne(ctx, d, d.id === src.selected, mediaSize.width, mediaSize.height);
        } finally {
          ctx.restore();
        }
      }
    });
  }

  private drawOne(ctx: CanvasRenderingContext2D, d: Drawing, selected: boolean, width: number, height: number) {
    const src = this.source;
    const stroke = (color = d.color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = (d.width ?? 1.5) + (selected ? 1 : 0);
      ctx.setLineDash(d.dash === 'dotted' ? [2, 3] : d.dash === 'dashed' ? [6, 4] : []);
    };
    const line = (a: Xy, b: Xy) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    const fontSize = d.fontSize ?? 12;
    ctx.font = `${fontSize}px ${FONT}`;
    const label = (text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left', base: CanvasTextBaseline = 'bottom') => {
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = base;
      ctx.fillText(text, x, y);
    };
    const pill = (text: string, cx: number, cy: number, bg: string) => {
      ctx.font = `11px ${FONT}`;
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - 9, w, 18, 3);
      ctx.fill();
      label(text, cx, cy + 0.5, '#ffffff', 'center', 'middle');
    };

    switch (d.kind) {
      case 'hline': {
        const y = src.y(d.price);
        if (y === null) return;
        const from = d.from !== undefined ? src.x(d.from) ?? 0 : 0;
        stroke();
        line({ x: from, y }, { x: width, y });
        if (d.label) label(d.label, from + 6, y - 3, d.textColor ?? d.color);
        break;
      }
      case 'vline': {
        const x = src.x(d.time);
        if (x === null) return;
        stroke();
        line({ x, y: 0 }, { x, y: height });
        break;
      }
      case 'text': {
        const p = src.toXy(d.a);
        if (!p) return;
        const lines = (d.text || ' ').split('\n');
        const lh = fontSize + 3;
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 10;
        const h = lines.length * lh + 6;
        src.textBoxes.set(d.id, { x: p.x, y: p.y - h, w, h });
        ctx.fillStyle = 'rgba(19, 23, 34, 0.6)';
        ctx.beginPath();
        ctx.roundRect(p.x, p.y - h, w, h, 3);
        ctx.fill();
        if (selected) { ctx.strokeStyle = d.color; ctx.lineWidth = 1; ctx.stroke(); }
        lines.forEach((l, i) => label(l, p.x + 5, p.y - h + 4 + i * lh, d.textColor ?? d.color, 'left', 'top'));
        break;
      }
      case 'trend': {
        const a = src.toXy(d.a);
        const b = src.toXy(d.b);
        if (!a || !b) return;
        stroke();
        const [p, q] = src.segment(a, b, d.extendLeft, d.extendRight);
        line(p, q);
        if (d.arrow) {
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          ctx.setLineDash([]);
          ctx.beginPath();
          for (const s of [-1, 1]) { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - 10 * Math.cos(ang + s * 0.45), b.y - 10 * Math.sin(ang + s * 0.45)); }
          ctx.stroke();
        }
        if (selected) this.handles(ctx, d);
        break;
      }
      case 'rect': case 'range': case 'ellipse': {
        const a = src.toXy(d.a);
        const b = src.toXy(d.b);
        if (!a || !b) return;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        const fill = d.fill ?? withOpacity(d.color, 0.15);
        ctx.beginPath();
        if (d.kind === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        else ctx.rect(x, y, w, h);
        ctx.fillStyle = fill;
        ctx.fill();
        stroke();
        ctx.stroke();
        if (d.kind === 'rect' && d.label) label(d.label, x + 4, y - 3, d.textColor ?? d.color);
        if (d.kind === 'range') {
          // An arrow across the box and what it measures.
          ctx.setLineDash([]);
          const up = d.b.price >= d.a.price;
          const vertical = d.measure !== 'date';
          const [p, q] = vertical ? [{ x: x + w / 2, y: a.y }, { x: x + w / 2, y: b.y }] : [{ x: a.x, y: y + h / 2 }, { x: b.x, y: y + h / 2 }];
          line(p, q);
          const parts: string[] = [];
          if (d.measure !== 'date') {
            const diff = d.b.price - d.a.price;
            parts.push(`${diff >= 0 ? '+' : ''}${fmt(diff)} (${((diff / d.a.price) * 100).toFixed(2)}%)`);
          }
          if (d.measure !== 'price') {
            const mins = Math.round(Math.abs(d.b.time - d.a.time) / 60_000);
            parts.push(mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`);
          }
          pill(parts.join(' · '), x + w / 2, vertical ? (up ? y - 12 : y + h + 12) : y + h + 12, withOpacity(d.color.slice(0, 7), 0.9));
        }
        if (selected) this.handles(ctx, d);
        break;
      }
      case 'path': {
        const pts = d.points.map((p) => src.toXy(p)).filter(Boolean) as Xy[];
        if (pts.length < 2) return;
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        if (d.closed) ctx.closePath();
        if (d.fill && d.closed) { ctx.fillStyle = d.fill; ctx.fill(); }
        stroke();
        ctx.stroke();
        if (selected) this.handles(ctx, d);
        break;
      }
      case 'channel': {
        const a = src.toXy(d.a);
        const b = src.toXy(d.b);
        const a2 = src.toXy({ ...d.a, price: d.a.price + d.offset });
        const b2 = src.toXy({ ...d.b, price: d.b.price + d.offset });
        if (!a || !b || !a2 || !b2) return;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(a2.x, a2.y); ctx.closePath();
        ctx.fillStyle = d.fill ?? withOpacity(d.color, 0.12);
        ctx.fill();
        stroke();
        line(a, b);
        line(a2, b2);
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        line({ x: a.x, y: (a.y + a2.y) / 2 }, { x: b.x, y: (b.y + b2.y) / 2 });
        if (selected) this.handles(ctx, d);
        break;
      }
      case 'fib': {
        const xa = src.x(d.a.time);
        const xb = src.x(d.b.time);
        if (xa === null || xb === null) return;
        const x1 = d.extendLeft ? 0 : Math.min(xa, xb);
        const x2 = d.extendRight ? width : Math.max(xa, xb);
        const levels = d.levels.filter((l) => l.visible).map((l) => ({ ...l, y: src.y(src.fibPrice(d, l.value)) })).filter((l) => l.y !== null) as { value: number; color: string; y: number }[];
        levels.sort((p, q) => p.value - q.value);
        // Shading between neighbouring levels, in the lower level's color.
        const fillAlpha = d.fill ? opacityOf(d.fill) : 0;
        if (fillAlpha > 0) {
          for (let i = 1; i < levels.length; i++) {
            ctx.fillStyle = withOpacity(levels[i].color.slice(0, 7), fillAlpha);
            ctx.fillRect(x1, Math.min(levels[i - 1].y, levels[i].y), x2 - x1, Math.abs(levels[i].y - levels[i - 1].y));
          }
        }
        for (const l of levels) {
          stroke(l.color);
          line({ x: x1, y: l.y }, { x: x2, y: l.y });
          ctx.font = `11px ${FONT}`;
          label(`${l.value} (${fmt(src.fibPrice(d, l.value))})`, x1 + 4, l.y - 2, l.color);
        }
        // The line between the two points it was drawn from.
        const pa = src.toXy(d.a);
        const pb = src.toXy(d.b);
        if (pa && pb && opacityOf(d.color) > 0) {
          stroke(d.color);
          ctx.setLineDash([4, 4]);
          line(pa, pb);
        }
        if (selected) this.handles(ctx, d);
        break;
      }
      case 'position': {
        const x1 = src.x(d.a.time);
        const x2 = src.x(d.end);
        const ye = src.y(d.a.price);
        const ys = src.y(d.stop);
        const yt = src.y(d.target);
        if (x1 === null || x2 === null || ye === null || ys === null || yt === null) return;
        const left = Math.min(x1, x2);
        const w = Math.abs(x2 - x1);
        ctx.fillStyle = d.targetFill ?? '#08998133';
        ctx.fillRect(left, Math.min(ye, yt), w, Math.abs(yt - ye));
        ctx.fillStyle = d.stopFill ?? '#f2364533';
        ctx.fillRect(left, Math.min(ye, ys), w, Math.abs(ys - ye));
        stroke(d.color.length >= 7 && opacityOf(d.color) > 0.1 ? d.color : '#787b86');
        line({ x: left, y: ye }, { x: left + w, y: ye });
        const risk = Math.abs(d.a.price - d.stop);
        const reward = Math.abs(d.target - d.a.price);
        const cx = left + w / 2;
        const pct = (p: number) => `${((Math.abs(p - d.a.price) / d.a.price) * 100).toFixed(2)}%`;
        pill(`Target ${fmt(d.target)} (${fmt(reward)}, ${pct(d.target)})`, cx, yt + (yt < ye ? -12 : 12), '#089981');
        pill(`Stop ${fmt(d.stop)} (${fmt(risk)}, ${pct(d.stop)})`, cx, ys + (ys > ye ? 12 : -12), '#f23645');
        pill(`${d.side === 'long' ? 'Long' : 'Short'} ${fmt(d.a.price)} · R:R ${risk ? (reward / risk).toFixed(2) : '–'}`, cx, ye, '#5d606b');
        if (selected) this.handles(ctx, d);
        break;
      }
    }
  }

  private handles(ctx: CanvasRenderingContext2D, d: Drawing) {
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = d.color.slice(0, 7);
    for (const h of drawingHandles(d)) {
      const p = this.source.toXy(h.point);
      if (!p) continue;
      ctx.fillStyle = '#131722';
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

class PaneView implements IPrimitivePaneView {
  private paneRenderer: Renderer;
  constructor(source: DrawingsPrimitive) {
    this.paneRenderer = new Renderer(source);
  }
  renderer() {
    return this.paneRenderer;
  }
}
