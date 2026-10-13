// Draws your chart drawings (price lines, trend lines, boxes, notes) on a price chart, and works
// out which one is under the mouse.

import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive,
  SeriesAttachedParameter, SeriesType, Time, UTCTimestamp,
} from 'lightweight-charts';
import type { ChartPoint, Drawing } from '../core/drawings';
import { chartTime, fromChartTime } from '../core/time';

export const FONT = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const HANDLE = 4;

export interface Xy { x: number; y: number }

/** What the mouse is over: a drawing, and which of its points if it's on a handle. */
export interface Hit { id: string; point?: 'a' | 'b' }

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

  toXy(p: ChartPoint): Xy | null {
    if (!this.chart || !this.series) return null;
    const x = this.chart.timeScale().logicalToCoordinate(this.logical(p.time) as never);
    const y = this.series.priceToCoordinate(p.price);
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

  /** The drawing under a point, if any. Handles of the selected drawing win. */
  findAt(at: Xy): Hit | null {
    const near = (p: Xy | null) => p && Math.hypot(p.x - at.x, p.y - at.y) <= HANDLE + 3;
    const sel = this.drawings.find((d) => d.id === this.selected);
    if (sel && sel.kind !== 'hline' && sel.kind !== 'text') {
      if (near(this.toXy(sel.a))) return { id: sel.id, point: 'a' };
      if (near(this.toXy(sel.b))) return { id: sel.id, point: 'b' };
    }
    for (const d of [...this.drawings].reverse()) {
      if (d.kind === 'hline') {
        const y = this.series?.priceToCoordinate(d.price);
        if (y != null && Math.abs(y - at.y) <= 5) return { id: d.id };
      } else if (d.kind === 'text') {
        const box = this.textBoxes.get(d.id);
        if (box && at.x >= box.x - 3 && at.x <= box.x + box.w + 3 && at.y >= box.y - 3 && at.y <= box.y + box.h + 3) return { id: d.id };
      } else {
        const a = this.toXy(d.a);
        const b = this.toXy(d.b);
        if (!a || !b) continue;
        if (d.kind === 'trend' && segmentDistance(at, a, b) <= 5) return { id: d.id };
        if (d.kind === 'rect') {
          const [x1, x2, y1, y2] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
          if (at.x >= x1 - 4 && at.x <= x2 + 4 && at.y >= y1 - 4 && at.y <= y2 + 4) return { id: d.id };
        }
      }
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

/** "#rrggbb" with some transparency. */
const fade = (hex: string, alpha: number) => `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;

class Renderer implements IPrimitivePaneRenderer {
  constructor(private source: DrawingsPrimitive) {}

  draw(target: CanvasRenderingTarget2D) {
    const src = this.source;
    const series = src.series;
    if (!src.chart || !series) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.font = FONT;
      ctx.lineWidth = 1.5;
      src.textBoxes.clear();
      const list = src.preview ? [...src.drawings.filter((d) => d.id !== src.preview!.id), src.preview] : src.drawings;
      for (const d of list) {
        const selected = d.id === src.selected;
        ctx.strokeStyle = d.color;
        ctx.fillStyle = d.color;
        ctx.lineWidth = selected ? 2.5 : 1.5;
        const handles: Xy[] = [];
        if (d.kind === 'hline') {
          const y = series.priceToCoordinate(d.price);
          if (y === null) continue;
          ctx.setLineDash(d.keep ? [] : [6, 4]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(mediaSize.width, y);
          ctx.stroke();
          ctx.setLineDash([]);
          if (d.label) {
            ctx.textBaseline = 'bottom';
            ctx.fillText(d.label, 6, y - 3);
          }
        } else if (d.kind === 'text') {
          const p = src.toXy(d.a);
          if (!p) continue;
          const lines = (d.text || ' ').split('\n');
          const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 10;
          const h = lines.length * 15 + 6;
          src.textBoxes.set(d.id, { x: p.x, y: p.y - h, w, h });
          ctx.fillStyle = 'rgba(19, 23, 34, 0.75)';
          ctx.beginPath();
          ctx.roundRect(p.x, p.y - h, w, h, 3);
          ctx.fill();
          if (selected) { ctx.lineWidth = 1; ctx.stroke(); }
          ctx.fillStyle = d.color;
          ctx.textBaseline = 'top';
          lines.forEach((l, i) => ctx.fillText(l, p.x + 5, p.y - h + 4 + i * 15));
        } else {
          const a = src.toXy(d.a);
          const b = src.toXy(d.b);
          if (!a || !b) continue;
          if (d.kind === 'trend') {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          } else {
            ctx.fillStyle = fade(d.color, 0.15);
            ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
            ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          }
          if (selected) handles.push(a, b);
        }
        for (const h of handles) {
          ctx.fillStyle = '#131722';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(h.x, h.y, HANDLE, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    });
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
