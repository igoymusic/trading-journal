import { describe, expect, it } from 'vitest';
import { leaderLine, placeLabels } from '../src/renderer/fillMarkers';
import { readableText } from '../src/renderer/colors';
import { cleanMarkerStyles, DEFAULT_MARKER_STYLES, exitKind } from '../src/core/markerStyles';

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

  it('leaves a dragged label where you put it and keeps others clear of it', () => {
    const fixed = { x: 100, y: 40, w: 60, h: 18 };
    const [a, b] = placeLabels([
      { tipX: 50, y: 50, kind: 'exit', width: 60, fixed },
      { tipX: 90, y: 50, kind: 'exit', width: 60 },
    ], [], 400);
    expect(a).toEqual(fixed);
    expect(b.y + b.h).toBeLessThanOrEqual(fixed.y);
  });

  it('attaches the line to whichever side of the label faces the arrow', () => {
    const left = leaderLine(200, 50, 11, 'exit', { x: 60, y: 100, w: 60, h: 18 });
    expect(left?.to).toEqual({ x: 120, y: 109 });
    const right = leaderLine(200, 50, 11, 'exit', { x: 260, y: 100, w: 60, h: 18 });
    expect(right?.to).toEqual({ x: 260, y: 109 });
    expect(right?.from).toEqual({ x: 211, y: 50 });
    // Right beside the arrow: no line.
    expect(leaderLine(200, 50, 11, 'exit', { x: 214, y: 41, w: 60, h: 18 })).toBeNull();
  });

  it('tells winning exits from losing ones and cleans saved styles', () => {
    expect(exitKind('BUY', 4, 5)).toBe('profit');
    expect(exitKind('BUY', 4, 3)).toBe('loss');
    expect(exitKind('SELL', 4, 3)).toBe('profit');
    expect(exitKind('SELL', 4, 5)).toBe('loss');
    const s = cleanMarkerStyles({ entry: { color: 'red', size: 99, lineWidth: 2, dash: 'solid' } });
    expect(s.entry).toEqual({ color: DEFAULT_MARKER_STYLES.entry.color, size: 30, lineWidth: 2, dash: 'solid' });
    expect(s.loss).toEqual(DEFAULT_MARKER_STYLES.loss);
  });

  it('switches label text to dark on light colors', () => {
    expect(readableText('#2962ff')).toBe('#ffffff');
    expect(readableText('#ef5350')).toBe('#ffffff');
    expect(readableText('#ffeb3b')).toBe('#131722');
    expect(readableText('#ffffff')).toBe('#131722');
  });
});
