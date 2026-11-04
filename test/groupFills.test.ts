import { describe, expect, it } from 'vitest';
import { groupFills } from '../src/core/fills';

const f = (id: string, side: 'BUY' | 'SELL', price: number, execTime: string, quantity = 1) =>
  ({ id, side, price, quantity, execTime, orderType: 'LIMIT', timeExact: true });

describe('groupFills', () => {
  it('shows fills on the same side, second and price as one row', () => {
    const rows = groupFills([
      f('a', 'BUY', 7.9, '2026-11-03 10:58:20'),
      f('b', 'BUY', 7.9, '2026-11-03 10:58:20'),
      f('c', 'SELL', 8.5, '2026-11-03 10:59:44'),
      f('d', 'SELL', 7.9, '2026-11-03 11:04:37'),
    ], []);
    expect(rows.map((r) => `${r.fill.side} ${r.fill.quantity} @ ${r.fill.price}`)).toEqual(['BUY 2 @ 7.9', 'SELL 1 @ 8.5', 'SELL 1 @ 7.9']);
  });

  it('keeps fills apart when the price, time or side differs, or the time is unknown', () => {
    const rows = groupFills([
      f('a', 'BUY', 7.9, '2026-11-03 10:58:20'),
      f('b', 'BUY', 7.95, '2026-11-03 10:58:20'),
      f('c', 'BUY', 7.95, '2026-11-03 10:58:21'),
      { ...f('d', 'BUY', 7.95, '2026-11-03 10:58:21'), timeExact: false },
    ], []);
    expect(rows).toHaveLength(4);
  });

  it('adds up contracts closed without an opening fill', () => {
    const rows = groupFills([f('a', 'BUY', 5, '2026-11-03 10:00:00', 2), f('b', 'BUY', 5, '2026-11-03 10:00:00', 1)], [{ id: 'a', quantity: 1 }, { id: 'b', quantity: 1 }]);
    expect(rows).toEqual([{ fill: expect.objectContaining({ quantity: 3 }), added: 1 }]);
  });
});
