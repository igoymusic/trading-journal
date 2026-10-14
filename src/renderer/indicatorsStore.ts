// The indicators shown on every chart. Charts redraw them when the list changes.

import { useEffect, useState } from 'react';
import type { Indicator } from '../core/indicators';

let current: Indicator[] = [];
const EVENT = 'indicators-changed';

export const indicators = () => current;

/** Uses this list from now on and tells the charts. */
export function applyIndicators(list: Indicator[]) {
  current = list;
  window.dispatchEvent(new Event(EVENT));
}

export function onIndicatorsChange(callback: () => void) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

export function useIndicators(): Indicator[] {
  const [list, setList] = useState(current);
  useEffect(() => onIndicatorsChange(() => setList(current)), []);
  return list;
}
