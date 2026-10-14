// Settings for how entry and exit markers look: color, arrow size and the line to the label,
// separately for entries, exits in profit and exits at a loss. Changes show on the charts right away.

import { useRef } from 'react';
import { DEFAULT_MARKER_STYLES, MARKER_KINDS, MARKER_SIZE, type MarkerKind, type MarkerStyle } from '../core/markerStyles';
import { applyMarkerStyles, markerStyles, useMarkerStyles } from './markerStyles';

export function MarkerStyleEditor() {
  const styles = useMarkerStyles();
  const saving = useRef<number>();
  const save = (next: typeof styles) => {
    applyMarkerStyles(next);
    // Sliders send lots of changes; save once they settle.
    window.clearTimeout(saving.current);
    saving.current = window.setTimeout(() => {
      const isDefault = JSON.stringify(markerStyles()) === JSON.stringify(DEFAULT_MARKER_STYLES);
      window.journal.setMarkerStyles(isDefault ? null : markerStyles());
    }, 300);
  };
  const set = (kind: MarkerKind, change: Partial<MarkerStyle>) => save({ ...styles, [kind]: { ...styles[kind], ...change } });
  const changed = JSON.stringify(styles) !== JSON.stringify(DEFAULT_MARKER_STYLES);
  return (
    <div className="marker-styles">
      {MARKER_KINDS.map(({ kind, label }) => {
        const s = styles[kind];
        return (
          <div key={kind} className="marker-style">
            <div className="marker-style-head">
              <input type="color" value={s.color} title="Color" onChange={(e) => set(kind, { color: e.target.value })} />
              <span>{label}</span>
              <span className={`marker-sample ${kind === 'entry' ? '' : 'flip'}`} style={{ borderLeftColor: s.color, borderWidth: `${s.size / 2 + 1}px 0 ${s.size / 2 + 1}px ${s.size}px` }} />
            </div>
            <label>Arrow size <input type="range" min={MARKER_SIZE.min} max={MARKER_SIZE.max} step={1} value={s.size} onChange={(e) => set(kind, { size: Number(e.target.value) })} /></label>
            <div className="draw-style-row">
              {[1, 2, 3, 4].map((w) => (
                <button key={w} className={s.lineWidth === w ? 'active' : ''} title={`${w}px line`} onClick={() => set(kind, { lineWidth: w })}>
                  <span className="line-sample" style={{ borderTopWidth: w, borderTopStyle: s.dash }} />
                </button>
              ))}
            </div>
            <div className="draw-style-row">
              {(['solid', 'dashed', 'dotted'] as const).map((d) => (
                <button key={d} className={s.dash === d ? 'active' : ''} title={`${d} line`} onClick={() => set(kind, { dash: d })}>
                  <span className="line-sample" style={{ borderTopStyle: d, borderTopWidth: Math.max(2, s.lineWidth) }} />
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <p className="muted small">Drag a label to move it. Double-click it to put it back.</p>
      <button disabled={!changed} onClick={() => save(DEFAULT_MARKER_STYLES)}>Reset markers</button>
    </div>
  );
}
