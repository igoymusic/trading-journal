// Draws trade executions the way trading platforms do: a small arrow beside the candle, pointing in
// at the exact price, with a label placed where it doesn't cover any candles.

import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive,
  SeriesAttachedParameter, SeriesType, Time, UTCTimestamp,
} from 'lightweight-charts';

export interface FillMarker {
  /** Chart time of the candle the fill belongs to. */
  time: UTCTimestamp;
  price: number;
  /** Entries come in from the left, exits from the right. */
  kind: 'entry' | 'exit';
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
const COLORS = { entry: '#2962ff', exit: '#ff9800' };

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Picks a spot for each label: beside its arrow if that's clear, otherwise below the candles
 * (entries) or above them (exits), stepping further out until it clears candles and other labels.
 */
export function placeLabels(
  arrows: { tipX: number; y: number; kind: 'entry' | 'exit'; width: number }[],
  candles: Rect[],
  paneHeight: number,
): Rect[] {
  const placed: Rect[] = [];
  for (const a of arrows) {
    const x = a.kind === 'entry' ? a.tipX - ARROW - GAP - a.width : a.tipX + ARROW + GAP;
    let rect: Rect = { x, y: a.y - LABEL_H / 2, w: a.width, h: LABEL_H };
    const blocked = (r: Rect) => candles.some((c) => overlaps(r, c)) || placed.some((p) => overlaps(r, p));
    const step = a.kind === 'entry' ? 4 : -4;
    for (let i = 0; blocked(rect) && i < 200; i++) {
      const y = rect.y + step;
      if (y < 0 || y + LABEL_H > paneHeight) break;
      rect = { ...rect, y };
    }
    placed.push(rect);
  }
  return placed;
}

class Renderer implements IPrimitivePaneRenderer {
  constructor(private source: FillMarkersPrimitive) {}

  draw(target: CanvasRenderingTarget2D) {
    const { chart, series, markers, candles } = this.source;
    if (!chart || !series) return;
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
        const tipX = m.kind === 'entry' ? x - halfBar - GAP : x + halfBar + GAP;
        arrows.push({ tipX, y, kind: m.kind, width: ctx.measureText(m.text).width + PAD_X * 2, marker: m });
      }
      // The arrows themselves count as obstacles for labels.
      const arrowRects = arrows.map((a) => ({ x: a.kind === 'entry' ? a.tipX - ARROW : a.tipX, y: a.y - ARROW / 2, w: ARROW, h: ARROW }));
      const labels = placeLabels(arrows, [...candleRects, ...arrowRects], mediaSize.height);

      arrows.forEach((a, i) => {
        const color = COLORS[a.kind];
        const label = labels[i];
        const dir = a.kind === 'entry' ? -1 : 1;

        // Leader line when the label had to move away from its arrow.
        const labelMidY = label.y + label.h / 2;
        if (Math.abs(labelMidY - a.y) > 1) {
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.8;
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(a.tipX + dir * ARROW, a.y);
          ctx.lineTo(a.kind === 'entry' ? label.x + label.w : label.x, labelMidY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }

        // Arrow pointing in toward the candle.
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(a.tipX, a.y);
        ctx.lineTo(a.tipX + dir * ARROW, a.y - ARROW / 2 - 1);
        ctx.lineTo(a.tipX + dir * ARROW, a.y + ARROW / 2 + 1);
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

  constructor(public markers: FillMarker[], public candles: CandleBox[]) {
    this.views = [new PaneView(this)];
  }

  attached({ chart, series }: SeriesAttachedParameter<Time>) {
    this.chart = chart;
    this.series = series;
  }

  detached() {
    this.chart = null;
    this.series = null;
  }

  paneViews() {
    return this.views;
  }
}
