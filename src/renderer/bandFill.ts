// Shades the area between two lines, like the background between Bollinger Bands.

import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive,
  SeriesAttachedParameter, SeriesType, Time, UTCTimestamp,
} from 'lightweight-charts';

export interface BandPoint { time: UTCTimestamp; upper: number; lower: number }

class Renderer implements IPrimitivePaneRenderer {
  constructor(private source: BandFill) {}
  draw(target: CanvasRenderingTarget2D) {
    const { chart, series, points, color } = this.source;
    if (!chart || !series || points.length < 2) return;
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const ts = chart.timeScale();
      const top: [number, number][] = [];
      const bottom: [number, number][] = [];
      for (const p of points) {
        const x = ts.timeToCoordinate(p.time);
        const u = series.priceToCoordinate(p.upper);
        const l = series.priceToCoordinate(p.lower);
        if (x === null || u === null || l === null) continue;
        top.push([x, u]);
        bottom.push([x, l]);
      }
      if (top.length < 2) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      top.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      for (let i = bottom.length - 1; i >= 0; i--) ctx.lineTo(bottom[i][0], bottom[i][1]);
      ctx.closePath();
      ctx.fill();
    });
  }
}

class PaneView implements IPrimitivePaneView {
  private r: Renderer;
  constructor(source: BandFill) { this.r = new Renderer(source); }
  zOrder() { return 'bottom' as const; }
  renderer() { return this.r; }
}

export class BandFill implements ISeriesPrimitive<Time> {
  chart: IChartApiBase<Time> | null = null;
  series: ISeriesApi<SeriesType, Time> | null = null;
  private views = [new PaneView(this)];
  constructor(public points: BandPoint[], public color: string) {}
  attached({ chart, series }: SeriesAttachedParameter<Time>) { this.chart = chart; this.series = series; }
  detached() { this.chart = null; this.series = null; }
  paneViews() { return this.views; }
}
