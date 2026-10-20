// Where each report section sits on the Reports page: two columns that stack sections tightly,
// in an order you set by dragging, plus which sections are collapsed. Saved in settings.

export interface ReportsLayout {
  columns: string[][];
  collapsed: string[];
  /** Table sections switched to their chart view. */
  charts?: string[];
}

/**
 * Makes a saved layout fit the sections that exist now: drops ones that are gone and adds new ones
 * to whichever column is shorter. With nothing saved, sections alternate between the columns.
 * New sections listed in `leading` go to the top of their column instead of the bottom.
 */
export function normalizeLayout(saved: ReportsLayout | undefined, keys: string[], columns = 2, leading: string[] = []): ReportsLayout {
  const cols: string[][] = Array.from({ length: columns }, (_, i) => (saved?.columns[i] ?? []).filter((k) => keys.includes(k)));
  // Anything saved in a column that no longer exists moves into the last one.
  for (const extra of saved?.columns.slice(columns) ?? []) cols[columns - 1].push(...extra.filter((k) => keys.includes(k)));
  const placed = new Set(cols.flat());
  const onTop = cols.map(() => 0);
  for (const k of keys) {
    if (placed.has(k)) continue;
    const shortest = cols.reduce((best, c, i) => (c.length < cols[best].length ? i : best), 0);
    if (leading.includes(k)) cols[shortest].splice(onTop[shortest]++, 0, k);
    else cols[shortest].push(k);
  }
  return {
    columns: cols,
    collapsed: (saved?.collapsed ?? []).filter((k) => keys.includes(k)),
    charts: (saved?.charts ?? []).filter((k) => keys.includes(k)),
  };
}

/** Moves a section to `index` within `column` (positions counted without the moved section). */
export function moveSection(layout: ReportsLayout, key: string, column: number, index: number): ReportsLayout {
  const columns = layout.columns.map((c) => c.filter((k) => k !== key));
  const target = columns[column];
  target.splice(Math.max(0, Math.min(index, target.length)), 0, key);
  return { ...layout, columns };
}

export function toggleCollapsed(layout: ReportsLayout, key: string): ReportsLayout {
  const collapsed = layout.collapsed.includes(key) ? layout.collapsed.filter((k) => k !== key) : [...layout.collapsed, key];
  return { ...layout, collapsed };
}

export function toggleChart(layout: ReportsLayout, key: string): ReportsLayout {
  const charts = layout.charts ?? [];
  return { ...layout, charts: charts.includes(key) ? charts.filter((k) => k !== key) : [...charts, key] };
}
