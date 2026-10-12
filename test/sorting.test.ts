import { describe, expect, it } from 'vitest';
import { nextSort, sortRows } from '../src/renderer/sorting';

describe('click-to-sort', () => {
  it('cycles greatest to least, least to greatest, then back to normal', () => {
    const first = nextSort(null, 'net');
    expect(first).toEqual({ id: 'net', dir: 'desc' });
    const second = nextSort(first, 'net');
    expect(second).toEqual({ id: 'net', dir: 'asc' });
    expect(nextSort(second, 'net')).toBeNull();
    // Clicking another column starts over on that column.
    expect(nextSort(second, 'fees')).toEqual({ id: 'fees', dir: 'desc' });
  });

  it('sorts numbers and text, keeps blanks last and ties in their normal order', () => {
    const rows = [{ n: 'a', v: 2 }, { n: 'b', v: null }, { n: 'c', v: 10 }, { n: 'd', v: 2 }, { n: 'e', v: -5 }];
    expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.n)).toEqual(['c', 'a', 'd', 'e', 'b']);
    expect(sortRows(rows, (r) => r.v, 'asc').map((r) => r.n)).toEqual(['e', 'a', 'd', 'c', 'b']);
    expect(sortRows(['SPY', 'AAPL', 'TSLA'], (s) => s, 'asc')).toEqual(['AAPL', 'SPY', 'TSLA']);
  });
});
