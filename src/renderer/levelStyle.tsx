// How the stop and target lines and the trade's position box look on trade charts. Saved on this
// computer; charts redraw when it changes.

import { useEffect, useState } from 'react';
import { activeTheme, colors, themed } from './colors';

export interface LevelStyle {
  /** "#rrggbb", or empty to use the stop and target colors from Settings. */
  stopColor: string;
  targetColor: string;
  lineOpacity: number;
  width: number;
  dash: 'solid' | 'dashed' | 'dotted';
  /** Draw a long or short position box (once) when a trade gets a stop and a target. */
  showBox: boolean;
  /** Fill opacity the box starts with. */
  boxOpacity: number;
}

const DEFAULTS: LevelStyle = { stopColor: '', targetColor: '', lineOpacity: 1, width: 2, dash: 'dashed', showBox: true, boxOpacity: 0.15 };
const KEY = 'levelStyle';
const EVENT = 'level-style-changed';

let current: LevelStyle = (() => {
  try { const v = localStorage.getItem(KEY); return v ? { ...DEFAULTS, ...JSON.parse(v) } : DEFAULTS; } catch { return DEFAULTS; }
})();

export const levelStyle = () => current;
// A theme's stop and target colors win over the ones picked here, which come back with Default.
export const stopColor = () => (!themed() && current.stopColor) || colors().stop;
export const targetColor = () => (!themed() && current.targetColor) || colors().target;

function apply(next: LevelStyle) {
  current = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not remembered; fine */ }
  window.dispatchEvent(new Event(EVENT));
}

export function onLevelStyleChange(callback: () => void) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

/** The popover for the stop and target lines and the position box. */
export function LevelStyleEditor() {
  const [style, setStyle] = useState(current);
  useEffect(() => onLevelStyleChange(() => setStyle(current)), []);
  const set = (patch: Partial<LevelStyle>) => apply({ ...current, ...patch });
  return (
    <div className="level-style">
      <div className="fill-list-head">Stop and target lines</div>
      {themed() ? <p className="muted small">Colors come from the {activeTheme().name} theme.</p> : (
        <div className="draw-style-row position-colors">
          <label>Stop <input type="color" value={stopColor().slice(0, 7)} onChange={(e) => set({ stopColor: e.target.value })} /></label>
          <label>Target <input type="color" value={targetColor().slice(0, 7)} onChange={(e) => set({ targetColor: e.target.value })} /></label>
        </div>
      )}
      <label>Line opacity <input type="range" min={0.1} max={1} step={0.05} value={style.lineOpacity} onChange={(e) => set({ lineOpacity: Number(e.target.value) })} /></label>
      <div className="draw-style-row">
        {[1, 2, 3, 4].map((w) => (
          <button key={w} className={style.width === w ? 'active' : ''} title={`${w}px line`} onClick={() => set({ width: w })}>
            <span className="line-sample" style={{ borderTopWidth: w }} />
          </button>
        ))}
      </div>
      <div className="draw-style-row">
        {(['solid', 'dashed', 'dotted'] as const).map((d) => (
          <button key={d} className={style.dash === d ? 'active' : ''} title={d} onClick={() => set({ dash: d })}>
            <span className="line-sample" style={{ borderTopStyle: d }} />
          </button>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={style.showBox} onChange={(e) => set({ showBox: e.target.checked })} /> Draw a position box</label>
      {style.showBox && <p className="muted small">Drawn once a trade has a stop and a target. After that it's a normal drawing: click it to move it or change its colors and labels.</p>}
      {!themed() && (style.stopColor || style.targetColor) && (
        <button className="link" onClick={() => set({ stopColor: '', targetColor: '' })}>Use the colors from Settings</button>
      )}
    </div>
  );
}
