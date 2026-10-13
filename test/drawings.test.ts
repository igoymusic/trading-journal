import { describe, expect, it } from 'vitest';
import { daysBetween, drawingSymbol, parseTradingViewClipboard, shiftDrawing } from '../src/core/drawings';
import { chartTime, fromChartTime } from '../src/core/time';

describe('drawings', () => {
  it('reads TradingView drawings from copied JSON, wherever they sit', () => {
    const copied = JSON.stringify({ sources: [
      { type: 'LineToolHorzLine', points: [{ time_t: 1791556200, price: 6750.5 }], state: { linecolor: 'rgba(41, 98, 255, 1)', text: 'PDH' } },
      { type: 'LineToolTrendLine', points: [{ time_t: 1791556200, price: 6740 }, { time_t: 1791559800, price: 6790 }], state: { linecolor: '#ff9800' } },
      { type: 'LineToolRectangle', points: [{ time_t: 1791556200, price: 6740 }, { time_t: 1791559800, price: 6760 }], state: {} },
      { type: 'LineToolText', points: [{ time_t: 1791556200, price: 6800 }], state: { text: 'Open drive' } },
      { type: 'LineToolFibRetracement', points: [] },
    ] });
    const html = `<meta charset="utf-8"><span data-tv="${copied.replace(/"/g, '&quot;')}"></span>`;
    expect(parseTradingViewClipboard(`tradingview:${copied}`, html)).toEqual([
      { kind: 'hline', price: 6750.5, color: '#2962ff', label: 'PDH' },
      { kind: 'trend', a: { time: 1791556200000, price: 6740 }, b: { time: 1791559800000, price: 6790 }, color: '#ff9800' },
      { kind: 'rect', a: { time: 1791556200000, price: 6740 }, b: { time: 1791559800000, price: 6760 }, color: undefined },
      { kind: 'text', a: { time: 1791556200000, price: 6800 }, text: 'Open drive', color: undefined },
    ]);
    expect(parseTradingViewClipboard('just some text')).toEqual([]);
  });

  it('shares index drawings and lists days', () => {
    expect(drawingSymbol('SPXW')).toBe('SPX');
    expect(daysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('moves a drawing and converts chart times back', () => {
    const d = shiftDrawing({ id: 'x', day: '2026-10-09', color: '#fff', kind: 'trend', a: { time: 0, price: 1 }, b: { time: 10, price: 2 } }, 5, 1);
    expect(d).toMatchObject({ a: { time: 5, price: 2 }, b: { time: 15, price: 3 } });
    const ms = Date.parse('2026-10-09T14:31:00Z');
    expect(fromChartTime(chartTime(ms, 'America/New_York'), 'America/New_York')).toBe(ms);
  });
});
