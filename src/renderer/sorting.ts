// Click-to-sort for table headers: first click sorts greatest to least, the second least to
// greatest, the third goes back to the table's normal order.

export type SortValue = number | string | null | undefined;
export interface SortState { id: string; dir: 'desc' | 'asc' }

export function nextSort(cur: SortState | null, id: string): SortState | null {
  if (cur?.id !== id) return { id, dir: 'desc' };
  return cur.dir === 'desc' ? { id, dir: 'asc' } : null;
}

/** Sorts a copy of `rows`; blanks always go last, and ties keep their normal order. */
export function sortRows<T>(rows: T[], value: (row: T) => SortValue, dir: 'desc' | 'asc'): T[] {
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((a, b) => {
      const blankA = a.v === null || a.v === undefined || a.v === '';
      const blankB = b.v === null || b.v === undefined || b.v === '';
      if (blankA || blankB) return blankA === blankB ? a.i - b.i : blankA ? 1 : -1;
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true });
      return c ? sign * c : a.i - b.i;
    })
    .map((x) => x.row);
}

/** Arrow shown next to a sorted header. */
export function sortArrow(s: SortState | null, id: string): string {
  return s?.id === id ? (s.dir === 'desc' ? ' ▼' : ' ▲') : '';
}
