// The entry and exit marker styles in use. Charts read them when they draw, and redraw when they change.

import { useEffect, useState } from 'react';
import { DEFAULT_MARKER_STYLES, type MarkerStyles } from '../core/markerStyles';

let current: MarkerStyles = DEFAULT_MARKER_STYLES;
const EVENT = 'marker-styles-changed';

export const markerStyles = () => current;

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
