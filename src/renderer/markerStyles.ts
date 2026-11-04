// The entry and exit marker styles in use. Charts read them when they draw, and redraw when they change.

import { useEffect, useState } from 'react';
import { DEFAULT_MARKER_STYLES, MARKER_KINDS, type MarkerStyles } from '../core/markerStyles';
import { activeTheme, themed } from './colors';

let current: MarkerStyles = DEFAULT_MARKER_STYLES;
const EVENT = 'marker-styles-changed';

export const markerStyles = () => current;

/** The styles as drawn: a theme swaps in its own colors, keeping your sizes and lines. */
export function shownMarkerStyles(): MarkerStyles {
  if (!themed()) return current;
  const colors = activeTheme().markers;
  return Object.fromEntries(MARKER_KINDS.map(({ kind }) => [kind, { ...current[kind], color: colors[kind] }])) as MarkerStyles;
}

/** Uses these styles from now on and tells the charts to redraw. */
export function applyMarkerStyles(styles: MarkerStyles) {
  current = styles;
  window.dispatchEvent(new Event(EVENT));
}

/** Calls back whenever the marker styles change. */
export function onMarkerStylesChange(callback: () => void) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

export function useMarkerStyles(): MarkerStyles {
  const [styles, setStyles] = useState(current);
  useEffect(() => onMarkerStylesChange(() => setStyles(current)), []);
  return styles;
}
