// How entry and exit markers look on the charts: one style for entries, one for exits that made
// money and one for exits that lost it.

export type MarkerKind = 'entry' | 'profit' | 'loss';

export interface MarkerStyle {
  color: string;
  /** Arrow size in pixels. */
  size: number;
  /** Width of the line from the arrow to its label. */
  lineWidth: number;
  dash: 'solid' | 'dashed' | 'dotted';
}

export type MarkerStyles = Record<MarkerKind, MarkerStyle>;

export const MARKER_KINDS: { kind: MarkerKind; label: string }[] = [
  { kind: 'entry', label: 'Entries' },
  { kind: 'profit', label: 'Exits in profit' },
  { kind: 'loss', label: 'Exits at a loss' },
];

export const DEFAULT_MARKER_STYLES: MarkerStyles = {
  entry: { color: '#2962ff', size: 11, lineWidth: 1, dash: 'dotted' },
  profit: { color: '#26a69a', size: 11, lineWidth: 1, dash: 'dotted' },
  loss: { color: '#ef5350', size: 11, lineWidth: 1, dash: 'dotted' },
};

export const MARKER_SIZE = { min: 6, max: 30 };

/** Fills in defaults and drops anything that isn't a real setting. */
export function cleanMarkerStyles(saved: unknown): MarkerStyles {
  const out = {} as MarkerStyles;
  for (const { kind } of MARKER_KINDS) {
    const s = (saved && typeof saved === 'object' ? (saved as Record<string, unknown>)[kind] : undefined) as Partial<MarkerStyle> | undefined;
    const d = DEFAULT_MARKER_STYLES[kind];
    const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
    out[kind] = {
      color: typeof s?.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : d.color,
      size: num(s?.size, MARKER_SIZE.min, MARKER_SIZE.max, d.size),
      lineWidth: num(s?.lineWidth, 1, 4, d.lineWidth),
      dash: s?.dash === 'solid' || s?.dash === 'dashed' || s?.dash === 'dotted' ? s.dash : d.dash,
    };
  }
  return out;
}

/** Whether an exit made money, given the average price of the entries it closes. */
export function exitKind(entrySide: 'BUY' | 'SELL', avgEntry: number | undefined, exitPrice: number): MarkerKind {
  if (avgEntry === undefined) return 'profit';
  const gain = entrySide === 'BUY' ? exitPrice - avgEntry : avgEntry - exitPrice;
  return gain < 0 ? 'loss' : 'profit';
}
