import { describe, expect, it } from 'vitest';
import { placeLabels } from '../src/renderer/fillMarkers';

describe('marker labels', () => {
  it('sits beside the arrow when nothing is in the way', () => {
    const [r] = placeLabels([{ tipX: 100, y: 50, kind: 'exit', width: 60 }], [], 400);
    expect(r).toMatchObject({ x: 114, y: 41 });
  });

  it('moves entries down and exits up until clear of candles', () => {
    const candle = { x: 70, y: 30, w: 100, h: 60 };
    const [entry, exit] = placeLabels([
      { tipX: 200, y: 50, kind: 'entry', width: 60 },
      { tipX: 50, y: 50, kind: 'exit', width: 60 },
    ], [candle], 400);
    expect(entry.y).toBeGreaterThanOrEqual(candle.y + candle.h);
    expect(exit.y + exit.h).toBeLessThanOrEqual(candle.y);
  });

  it('keeps labels from stacking on each other', () => {
    const [a, b] = placeLabels([
      { tipX: 100, y: 50, kind: 'entry', width: 60 },
      { tipX: 100, y: 52, kind: 'entry', width: 60 },
    ], [], 400);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.h);
  });
});
