import { describe, expect, it } from 'vitest';
import { daysBetween, drawingSymbol, parseTradingViewClipboard, shiftDrawing } from '../src/core/drawings';
import { chartTime, fromChartTime } from '../src/core/time';

describe('drawings', () => {
  it('reads TradingView drawings from copied JSON, wherever they sit', () => {
    const copied = JSON.stringify({ sources: [
      { type: 'LineToolHorzLine', points: [{ time_t: 1791556200, price: 6750.5 }], state: { linecolor: 'rgba(41, 98, 255, 1)', text: 'PDH', linestyle: 2, linewidth: 2 } },
      { type: 'LineToolRay', points: [{ time_t: 1791556200, price: 6740 }, { time_t: 1791559800, price: 6790 }], state: { linecolor: '#ff9800' } },
      { type: 'LineToolRectangle', points: [{ time_t: 1791556200, price: 6740 }, { time_t: 1791559800, price: 6760 }], state: { color: 'rgba(156, 39, 176, 1)', backgroundColor: 'rgba(156, 39, 176, 0.2)' } },
      { type: 'LineToolText', points: [{ time_t: 1791556200, price: 6800 }], state: { text: 'Open drive', color: '#ffffff', fontsize: 14 } },
      { type: 'LineToolGannFan', points: [{ time_t: 1791556200, price: 1 }, { time_t: 1791556260, price: 2 }] },
    ] });
    const html = `<meta charset="utf-8"><span data-tv="${copied.replace(/"/g, '&quot;')}"></span>`;
    const { drawings, skipped } = parseTradingViewClipboard(`tradingview:${copied}`, html);
    expect(drawings).toEqual([
      { kind: 'hline', price: 6750.5, label: 'PDH', color: '#2962ff', width: 2, dash: 'dashed' },
      { kind: 'trend', a: { time: 1791556200000, price: 6740 }, b: { time: 1791559800000, price: 6790 }, color: '#ff9800', extendRight: true },
      { kind: 'rect', a: { time: 1791556200000, price: 6740 }, b: { time: 1791559800000, price: 6760 }, fill: '#9c27b033', color: '#9c27b0' },
      { kind: 'text', a: { time: 1791556200000, price: 6800 }, text: 'Open drive', fontSize: 14, color: '#ffffff' },
    ]);
    expect(skipped).toEqual(['LineToolGannFan']);
    expect(parseTradingViewClipboard('just some text').drawings).toEqual([]);
  });

  it('reads TradingView\'s HTML clip, with points placed bars past a candle', () => {
    const clip = { sources: [
      { type: 'drawing', geometry: [], source: { type: 'LineToolTrendLine', id: 'a', state: { linecolor: 'rgba(0, 188, 212, 0.77)', symbol: 'AMEX:SPY' },
        points: [{ time_t: 1791918840, offset: 0, price: 778.5, interval: '1' }, { time_t: 1791918840, offset: 5, price: 776, interval: '5' }] } },
      { type: 'drawing', geometry: [], source: { type: 'LineToolPriceRange', id: 'b', state: { symbol: 'AMEX:SPY', backgroundColor: 'rgba(33, 150, 243, 0.2)' },
        points: [{ time_t: 1791918840, offset: 0, price: 778, interval: '1' }, { time_t: 1791918900, offset: 0, price: 777, interval: '1' }] } },
      { type: 'drawing', source: { type: 'LineToolFibRetracement', state: { symbol: 'AMEX:SPY', transparency: 80, level1: { coeff: 0, color: '#787b86', visible: true }, level2: [0.5, 'rgba(76, 175, 80, 1)', true, ''], level3: { coeff: 1, color: '#787b86', visible: false }, trendline: { visible: true, color: '#787b86' } },
        points: [{ time_t: 1791918840, price: 770 }, { time_t: 1791918900, price: 780 }] } },
      { type: 'drawing', source: { type: 'LineToolRiskRewardLong', state: { symbol: 'AMEX:SPY', stopLevel: 150, profitLevel: 300, profitBackground: 'rgba(8, 153, 129, 0.2)', stopBackground: 'rgba(242, 54, 69, 0.2)' },
        points: [{ time_t: 1791918840, price: 777 }, { time_t: 1791920040, price: 777 }] } },
    ] };
    const enc = JSON.stringify(clip).replace(/"/g, '&#34;');
    const html = `<meta charset="utf-8"><span data-tradingview-clip="${enc}"></span>`;
    const { drawings } = parseTradingViewClipboard('Drawings', html);
    expect(drawings[0]).toEqual({ kind: 'trend', a: { time: 1791918840000, price: 778.5 }, b: { time: 1791918840000 + 25 * 60_000, price: 776 }, color: '#00bcd4c4', symbol: 'SPY' });
    expect(drawings[1]).toMatchObject({ kind: 'range', measure: 'price', fill: '#2196f333', symbol: 'SPY' });
    expect(drawings[2]).toMatchObject({ kind: 'fib', levels: [{ value: 0, color: '#787b86', visible: true }, { value: 0.5, color: '#4caf50', visible: true }, { value: 1, color: '#787b86', visible: false }], fill: '#ffffff33' });
    expect(drawings[3]).toMatchObject({ kind: 'position', side: 'long', end: 1791920040000, stop: 775.5, target: 780, targetFill: '#08998133', stopFill: '#f2364533' });
  });

  it('reads brushes, arrow markers and arrow marks', () => {
    const pt = (t: number, price: number) => ({ time_t: t, price });
    const copied = JSON.stringify({ sources: [
      { type: 'LineToolBrush', points: [pt(1791556200, 10), pt(1791556260, 11), pt(1791556320, 10.5)], state: { linecolor: '#2962ff', linewidth: 2 } },
      { type: 'LineToolArrowMarker', points: [pt(1791556200, 10), pt(1791556320, 12)], state: { backgroundColor: '#f23645', text: 'Go' } },
      { type: 'LineToolArrowMarkDown', points: [pt(1791556200, 12)], state: { arrowColor: '#f23645', text: 'Top' } },
    ] });
    const { drawings, skipped } = parseTradingViewClipboard(`tradingview:${copied}`);
    expect(skipped).toEqual([]);
    expect(drawings[0]).toMatchObject({ kind: 'path', brush: true });
    expect((drawings[0] as { points: unknown[] }).points).toHaveLength(3);
    expect(drawings[1]).toMatchObject({ kind: 'arrow', a: { price: 10 }, b: { price: 12 } });
    expect(drawings[2]).toMatchObject({ kind: 'mark', dir: 'down', a: { price: 12 } });
  });

  it('shares index drawings and lists days', () => {
    expect(drawingSymbol('SPXW')).toBe('SPX');
    expect(daysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('moves a drawing and converts chart times back', () => {
    const d = shiftDrawing({ id: 'x', day: '2026-10-09', color: '#fff', kind: 'trend', a: { time: 0, price: 1 }, b: { time: 10, price: 2 } }, 5, 1);
    expect(shiftDrawing({ id: 'p', day: '', color: '', kind: 'position', side: 'long', a: { time: 0, price: 10 }, end: 10, stop: 9, target: 12 }, 5, 1)).toMatchObject({ a: { time: 5, price: 11 }, end: 15, stop: 10, target: 13 });
    expect(d).toMatchObject({ a: { time: 5, price: 2 }, b: { time: 15, price: 3 } });
    const ms = Date.parse('2026-10-09T14:31:00Z');
    expect(fromChartTime(chartTime(ms, 'America/New_York'), 'America/New_York')).toBe(ms);
  });
});
