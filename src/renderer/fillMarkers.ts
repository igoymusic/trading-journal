// Draws trade executions the way trading platforms do: a small arrow beside the candle, pointing in
// at the exact price, with a label placed where it doesn't cover any candles.

import { markerStyles } from './markerStyles';
import type { MarkerKind } from '../core/markerStyles';
import type { LabelOffset } from '../shared/api';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive,
  SeriesAttachedParameter, SeriesType, Time, UTCTimestamp,
} from 'lightweight-charts';

export interface FillMarker {
  /** The first fill in the marker; dragged labels are saved under it. */
  id: string;
  /** Chart time of the candle the fill belongs to. */
  time: UTCTimestamp;
  price: number;
  /** Entries come in from the left, exits from the right. */
  kind: 'entry' | 'exit';
  /** Which style it's drawn in: entries, exits in profit, or exits at a loss. */
  style: MarkerKind;
  text: string;
}

export interface CandleBox {
  time: UTCTimestamp;
  high: number;
  low: number;
}

export interface Rect { x: number; y: number; w: number; h: number }

const ARROW = 11;
const GAP = 3;
const LABEL_H = 18;
const PAD_X = 6;
const DASHES = { solid: [], dashed: [6, 4], dotted: [2, 2] } as const;

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Picks a spot for each label: beside its arrow if that's clear, otherwise below the candles
 * (entries) or above them (exits), stepping further out until it clears candles and other labels.
 * A label you dragged stays where you put it, and the others keep clear of it.
 */
export function placeLabels(
  arrows: { tipX: number; y: number; kind: 'entry' | 'exit'; width: number; size?: number; fixed?: Rect }[],
  candles: Rect[],
  paneHeight: number,
): Rect[] {
  const placed: Rect[] = arrows.flatMap((a) => (a.fixed ? [a.fixed] : []));
  return arrows.map((a) => {
    if (a.fixed) return a.fixed;
    const size = a.size ?? ARROW;
    const x = a.kind === 'entry' ? a.tipX - size - GAP - a.width : a.tipX + size + GAP;
    let rect: Rect = { x, y: a.y - LABEL_H / 2, w: a.width, h: LABEL_H };
    const blocked = (r: Rect) => candles.some((c) => overlaps(r, c)) || placed.some((p) => overlaps(r, p));
    const step = a.kind === 'entry' ? 4 : -4;
    for (let i = 0; blocked(rect) && i < 200; i++) {
      const y = rect.y + step;
      if (y < 0 || y + LABEL_H > paneHeight) break;
      rect = { ...rect, y };
    }
    placed.push(rect);
    return rect;
  });
}

/**
 * Where the line from an arrow meets its label: the label's right side when the label is left of
 * the arrow, its left side when it's to the right. Null when the label sits right beside the arrow.
 */
export function leaderLine(tipX: number, y: number, size: number, kind: 'entry' | 'exit', label: Rect) {
  const dir = kind === 'entry' ? -1 : 1;
  const from = { x: tipX + dir * size, y };
  const midY = label.y + label.h / 2;
  const leftOfArrow = label.x + label.w / 2 < tipX;
  const to = { x: leftOfArrow ? label.x + label.w : label.x, y: midY };
  // Touching the arrow already: no line needed.
  if (Math.abs(midY - y) <= 1 && Math.abs(to.x - from.x) <= GAP + 1) return null;
  return { from, to };
}

/** Where each label was drawn, so it can be grabbed and dragged. */
export interface LabelHit { id: string; rect: Rect; tipX: number; y: number }

class Renderer implements IPrimitivePaneRenderer {
  constructor(private source: FillMarkersPrimitive) {}

  draw(target: CanvasRenderingTarget2D) {
    const { chart, series, markers, candles, offsets } = this.source;
    if (!chart || !series) return;
    const styles = markerStyles();
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const timeScale = chart.timeScale();
      const halfBar = Math.max(2, timeScale.options().barSpacing * 0.4);
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

      const candleRects: Rect[] = [];
      for (const c of candles) {
        const x = timeScale.timeToCoordinate(c.time);
        const top = series.priceToCoordinate(c.high);
        const bottom = series.priceToCoordinate(c.low);
        if (x === null || top === null || bottom === null || x < -50 || x > mediaSize.width + 50) continue;
        candleRects.push({ x: x - halfBar - 1, y: top - 1, w: halfBar * 2 + 2, h: bottom - top + 2 });
      }

      const arrows = [];
      for (const m of markers) {
        const x = timeScale.timeToCoordinate(m.time);
        const y = series.priceToCoordinate(m.price);
        if (x === null || y === null) continue;
        // The arrow's point lands on the middle of the candle.
        const tipX = x;
        const width = ctx.measureText(m.text).width + PAD_X * 2;
        const off = offsets.get(m.id);
        // A label you moved stays put, but never off the chart.
        const fixed = off ? {
          x: Math.min(Math.max(tipX + off.dx, 0), mediaSize.width - width),
          y: Math.min(Math.max(y + off.dy, 0), mediaSize.height - LABEL_H),
          w: width, h: LABEL_H,
        } : undefined;
        arrows.push({ tipX, y, kind: m.kind, width, size: styles[m.style].size, fixed, marker: m });
      }
      // The arrows themselves count as obstacles for labels.
      const arrowRects = arrows.map((a) => ({ x: a.kind === 'entry' ? a.tipX - a.size : a.tipX, y: a.y - a.size / 2, w: a.size, h: a.size }));
      const labels = placeLabels(arrows, [...candleRects, ...arrowRects], mediaSize.height);
      this.source.hits = arrows.map((a, i) => ({ id: a.marker.id, rect: labels[i], tipX: a.tipX, y: a.y }));

      arrows.forEach((a, i) => {
        const style = styles[a.marker.style];
        const color = style.color;
        const label = labels[i];
        const dir = a.kind === 'entry' ? -1 : 1;
        const size = style.size;

        // Line to the label when it isn't right beside its arrow.
        const line = leaderLine(a.tipX, a.y, size, a.kind, label);
        if (line) {
          ctx.strokeStyle = color;
          ctx.lineWidth = style.lineWidth;
          ctx.globalAlpha = 0.85;
          ctx.setLineDash([...DASHES[style.dash]].map((n) => n * Math.max(1, style.lineWidth * 0.75)));
          ctx.beginPath();
          ctx.moveTo(line.from.x, line.from.y);
          ctx.lineTo(line.to.x, line.to.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }

        // Arrow pointing in toward the candle.
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(a.tipX, a.y);
        ctx.lineTo(a.tipX + dir * size, a.y - size / 2 - 1);
        ctx.lineTo(a.tipX + dir * size, a.y + size / 2 + 1);
        ctx.closePath();
        ctx.fill();

        // Label pill.
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(label.x, label.y, label.w, label.h, 3);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.marker.text, label.x + PAD_X, label.y + label.h / 2 + 0.5);
      });
    });
  }
}

class PaneView implements IPrimitivePaneView {
  private paneRenderer: Renderer;
  constructor(source: FillMarkersPrimitive) {
    this.paneRenderer = new Renderer(source);
  }
  zOrder() {
    return 'top' as const;
  }
  renderer() {
    return this.paneRenderer;
  }
}

export class FillMarkersPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApiBase<Time> | null = null;
  series: ISeriesApi<SeriesType, Time> | null = null;
  private views: PaneView[];
  private requestUpdate?: () => void;
  /** Labels you dragged, by marker id. */
  offsets = new Map<string, LabelOffset>();
  hits: LabelHit[] = [];

  constructor(public markers: FillMarker[], public candles: CandleBox[]) {
    this.views = [new PaneView(this)];
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.chart = chart;
    this.series = series;
    this.requestUpdate = requestUpdate;
  }

  update() {
    this.requestUpdate?.();
  }

  /** The label under this point, topmost first. */
  labelAt(x: number, y: number): LabelHit | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const r = this.hits[i].rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return this.hits[i];
    }
    return null;
  }

  detached() {
    this.chart = null;
    this.series = null;
  }

  paneViews() {
    return this.views;
  }
}
