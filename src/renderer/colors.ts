// The app's colors, which you can change in Settings, and the theme picked there. Screens read them
// as CSS variables; charts read them from `colors()` when they're drawn.

import type { ColorScheme } from '../shared/api';
import { type Theme, themeById } from './themes';
import { pickStickers } from './themes/stickers';

export const DEFAULT_COLORS: ColorScheme = {
  win: '#26a69a',
  loss: '#ef5350',
  accent: '#2962ff',
  chart: '#4c9aff',
  candleUp: '#26a69a',
  candleDown: '#ef5350',
  entry: '#2962ff',
  exit: '#ff9800',
  stop: '#ef5350',
  target: '#26a69a',
};

export const COLOR_LABELS: { key: keyof ColorScheme; label: string; group: string }[] = [
  { key: 'win', label: 'Profit', group: 'Numbers and calendar' },
  { key: 'loss', label: 'Loss', group: 'Numbers and calendar' },
  { key: 'accent', label: 'Buttons and highlights', group: 'Numbers and calendar' },
  { key: 'chart', label: 'Score and P&L lines', group: 'Charts' },
  { key: 'candleUp', label: 'Up candles', group: 'Charts' },
  { key: 'candleDown', label: 'Down candles', group: 'Charts' },
  { key: 'stop', label: 'Stop lines', group: 'Charts' },
  { key: 'target', label: 'Target lines', group: 'Charts' },
];

let current: ColorScheme = DEFAULT_COLORS;
// Your own colors belong to the default look; themes bring their own (except the candles).
let yours: Partial<ColorScheme> = {};
let theme: Theme = themeById('default');
/** The moon, rocket and astronaut pictures picked for this session (new ones on each theme switch). */
let stickers = pickStickers('default');

export const colors = () => current;
export const activeTheme = () => theme;
/** Whether a theme other than Default is on. */
export const themed = () => theme.id !== 'default';

/** Uses these colors from now on (missing ones fall back to the defaults). */
export function applyColors(saved: Partial<ColorScheme> | undefined) {
  yours = saved ?? {};
  refresh();
}

/** Switches to this theme (an id from THEMES; anything else is the default look). */
export function applyTheme(id: string | undefined) {
  theme = themeById(id);
  stickers = pickStickers(theme.id);
  refresh();
}

function refresh() {
  current = themed()
    ? { ...DEFAULT_COLORS, candleUp: yours.candleUp ?? DEFAULT_COLORS.candleUp, candleDown: yours.candleDown ?? DEFAULT_COLORS.candleDown, ...theme.colors }
    : { ...DEFAULT_COLORS, ...yours };
  const html = document.documentElement;
  const root = html.style;
  const s = theme.surface;
  const vars: Record<string, string> = {
    '--bg': s.bg, '--panel': s.panel, '--panel-2': s.panel2, '--border': s.border, '--line': s.line, '--hover': s.hover,
    '--selected': s.selected, '--text': s.text, '--muted': s.muted, '--on-accent': s.onAccent, '--tip': s.tip,
    '--star': s.star, '--star-off': s.starOff, '--warn': s.warn,
    '--green': current.win, '--red': current.loss, '--blue': current.accent, '--chart': current.chart,
    '--font': theme.fonts.body, '--font-head': theme.fonts.head, '--radius': `${theme.radius}px`,
    '--ornament': `url("data:image/svg+xml,${encodeURIComponent(theme.ornament(s.star))}")`,
    '--ornament-muted': `url("data:image/svg+xml,${encodeURIComponent(theme.ornament(s.muted))}")`,
  };
  for (const [k, v] of Object.entries(theme.art ?? {})) vars[`--art-${k}`] = `url("${v}")`;
  Object.assign(vars, stickers);
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
  if (!theme.art) for (const k of ['scene', 'moon', 'rocket', 'phases', 'ground', 'logo']) root.removeProperty(`--art-${k}`);
  html.dataset.theme = theme.id;
  html.style.colorScheme = theme.light ? 'light' : 'dark';
}

/** Colors for the Home and Reports charts' gridlines, labels and category slices. */
export function chartTones() {
  const s = theme.surface;
  return { grid: s.panel2, zero: s.border, ink: s.text, muted: s.muted, other: s.muted, warn: s.warn, series: theme.series };
}

/** "#26a69a" at 35% opacity, for chart fills. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Dark or white text, whichever reads better on this "#rrggbb" background. */
export function readableText(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // White suits the mid-tone reds, greens and blues; light colors get dark text.
  return lum > 0.4 ? '#131722' : '#ffffff';
}
