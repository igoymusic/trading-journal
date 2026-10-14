// Adding and setting up chart indicators: moving averages, Bollinger Bands and VWAP. Changes show
// on the charts right away and are saved for every chart.

import { useRef, useState } from 'react';
import { type Indicator, type IndicatorKind, indicatorName, MA_TYPES, newIndicator, type PriceSource, SOURCES, TIMEFRAMES } from '../core/indicators';
import { applyIndicators, indicators, useIndicators } from './indicatorsStore';

const KINDS: { kind: IndicatorKind; label: string }[] = [
  { kind: 'ma', label: 'Moving average' }, { kind: 'bb', label: 'Bollinger Bands' }, { kind: 'vwap', label: 'VWAP' },
];

export function IndicatorsEditor() {
  const list = useIndicators();
  const [open, setOpen] = useState<string | null>(null);
  const saving = useRef<number>();
  const save = (next: Indicator[]) => {
    applyIndicators(next);
    // Typing and sliders send lots of changes; save once they settle.
    window.clearTimeout(saving.current);
    saving.current = window.setTimeout(() => window.journal.setIndicators(indicators()), 300);
  };
  const change = (id: string, patch: Partial<Indicator>) => save(list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const add = (kind: IndicatorKind) => {
    const ind = newIndicator(kind, crypto.randomUUID());
    save([...list, ind]);
    setOpen(ind.id);
  };
  return (
    <div className="indicators">
      <div className="indicator-add">
        {KINDS.map((k) => <button key={k.kind} onClick={() => add(k.kind)}>+ {k.label}</button>)}
      </div>
      {!list.length && <p className="muted small">No indicators yet.</p>}
      {list.map((i) => (
        <div key={i.id} className={`indicator ${i.visible ? '' : 'hidden'}`}>
          <div className="indicator-head">
            <input type="color" value={i.color} title="Color" onChange={(e) => change(i.id, { color: e.target.value })} />
            <button className="indicator-name" onClick={() => setOpen(open === i.id ? null : i.id)} title="Settings">{indicatorName(i)} {open === i.id ? '▴' : '▾'}</button>
            <button title={i.visible ? 'Hide' : 'Show'} onClick={() => change(i.id, { visible: !i.visible })}>{i.visible ? '👁' : '◌'}</button>
            <button title="Remove" onClick={() => save(list.filter((x) => x.id !== i.id))}>🗑</button>
          </div>
          {open === i.id && <IndicatorInputs ind={i} onChange={(p) => change(i.id, p)} />}
        </div>
      ))}
    </div>
  );
}

function IndicatorInputs({ ind, onChange }: { ind: Indicator; onChange: (patch: Partial<Indicator>) => void }) {
  const tfValue = String(ind.timeframe);
  return (
    <div className="indicator-inputs">
      {ind.kind !== 'vwap' && (
        <>
          <label>Length <input type="number" min={1} max={500} value={ind.length} onChange={(e) => onChange({ length: Math.max(1, Math.min(500, Math.round(Number(e.target.value) || 1))) })} /></label>
          <label>Source
            <select value={ind.source} onChange={(e) => onChange({ source: e.target.value as PriceSource })}>
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>{ind.kind === 'bb' ? 'Basis type' : 'Type'}
            <select value={ind.maType} onChange={(e) => onChange({ maType: e.target.value as Indicator['maType'] })}>
              {MA_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          {ind.kind === 'bb' && (
            <label>Std. deviations <input type="number" min={0.1} max={10} step={0.1} value={ind.mult} onChange={(e) => onChange({ mult: Math.max(0.1, Math.min(10, Number(e.target.value) || 2)) })} /></label>
          )}
          <label>Timeframe
            <select value={tfValue} onChange={(e) => {
              const v = e.target.value;
              onChange({ timeframe: v === 'chart' || v === 'D' ? v : (Number(v) as Indicator['timeframe']) });
            }}>
              {TIMEFRAMES.map((t) => <option key={String(t.value)} value={String(t.value)}>{t.label}</option>)}
            </select>
          </label>
          {ind.timeframe !== 'chart' && (
            <label className="check"><input type="checkbox" checked={ind.waitForClose} onChange={(e) => onChange({ waitForClose: e.target.checked })} /> Wait for timeframe closes</label>
          )}
        </>
      )}
      <div className="draw-style-row" title="Line width">
        {[1, 2, 3, 4].map((w) => (
          <button key={w} className={Math.round(ind.width) === w ? 'active' : ''} onClick={() => onChange({ width: w })}>
            <span className="line-sample" style={{ borderTopWidth: w }} />
          </button>
        ))}
      </div>
      {ind.kind === 'bb' && (
        <label>Background <input type="range" min={0} max={0.5} step={0.02} value={ind.fillOpacity} onChange={(e) => onChange({ fillOpacity: Number(e.target.value) })} /></label>
      )}
      {ind.kind === 'vwap' && <p className="muted small">Standard VWAP: price × volume from each day's start.</p>}
    </div>
  );
}
