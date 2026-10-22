// The app's colors, which you can change in Settings. Screens read them as CSS variables; charts
// read them from `colors()` when they're drawn.

import type { ColorScheme } from '../shared/api';

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

export const colors = () => current;

/** Uses these colors from now on (missing ones fall back to the defaults). */
export function applyColors(saved: Partial<ColorScheme> | undefined) {
  current = { ...DEFAULT_COLORS, ...saved };
  const root = document.documentElement.style;
  root.setProperty('--green', current.win);
  root.setProperty('--red', current.loss);
  root.setProperty('--blue', current.accent);
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
