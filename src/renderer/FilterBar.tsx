import { useEffect, useRef, useState } from 'react';
import { DTE_BUCKETS, EMPTY_FILTER, isFiltering, type TradeFilter } from '../core/reports';
import type { Trade } from '../core/types';
import { useJournal } from './journal';

/** Filters shared by the All trades and Reports tabs. */
export function FilterBar({ trades, filter, onChange, shown }: {
  trades: Trade[];
  filter: TradeFilter;
  onChange: (f: TradeFilter) => void;
  /** How many trades pass, shown next to the controls. */
  shown: number;
}) {
  const { setups, mistakes, positives } = useJournal();
  const set = (patch: Partial<TradeFilter>) => onChange({ ...filter, ...patch });
  const symbols = [...new Set(trades.map((t) => t.underlying))].sort();

  return (
    <div className="filter-bar">
      <label className="filter-dates">
        <span>From</span>
        <input type="date" value={filter.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
        <span>to</span>
        <input type="date" value={filter.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
      </label>
      <MultiPick label="Symbol" options={symbols.map((s) => ({ id: s, name: s }))} value={filter.symbols} onChange={(symbols) => set({ symbols })} />
      <MultiPick label="Setup" options={[...setups, { id: 'none', name: 'No setup' }]} value={filter.setups} onChange={(s) => set({ setups: s })} />
      <MultiPick label="Did well" options={[{ id: 'none', name: 'No positive tags' }, ...positives]} value={filter.positives ?? []} onChange={(p) => set({ positives: p })} />
      <MultiPick label="Mistake" options={[{ id: 'none', name: 'No mistakes' }, ...mistakes]} value={filter.mistakes} onChange={(m) => set({ mistakes: m })} />
      <MultiPick label="DTE" options={DTE_BUCKETS.map((b) => ({ id: b.key, name: b.label }))} value={filter.dte} onChange={(dte) => set({ dte })} />
      <Toggle options={[['CALL', 'Calls'], ['PUT', 'Puts']]} value={filter.putCall} onChange={(putCall) => set({ putCall })} />
      <Toggle options={[['LONG', 'Long'], ['SHORT', 'Short']]} value={filter.direction} onChange={(direction) => set({ direction })} />
      <Toggle options={[['win', 'Winners'], ['loss', 'Losers']]} value={filter.result} onChange={(result) => set({ result })} />
      {isFiltering(filter) && (
        <>
          <span className="muted">{shown} of {trades.length} trades</span>
          <button className="link-button" onClick={() => onChange(EMPTY_FILTER)}>Clear filters</button>
        </>
      )}
    </div>
  );
}

/** A row of buttons where clicking the active one turns it back off. */
function Toggle<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T | undefined; onChange: (v: T | undefined) => void }) {
  return (
    <div className="toggle">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? 'active' : ''} onClick={() => onChange(value === v ? undefined : v)}>{label}</button>
      ))}
    </div>
  );
}

/** A button that opens a checklist. Nothing checked means "any". */
function MultiPick({ label, options, value, onChange }: {
  label: string;
  options: { id: string; name: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const picked = options.filter((o) => value.includes(o.id));
  const summary = picked.length === 0 ? 'Any' : picked.length === 1 ? picked[0].name : `${picked.length} picked`;
  return (
    <div className="multi-pick" ref={box}>
      <button className={picked.length ? 'active' : ''} onClick={() => setOpen(!open)}>
        <span className="muted">{label}:</span> {summary} <span className="caret">▾</span>
      </button>
      {open && (
        <div className="multi-pick-menu">
          {options.length === 0 && <div className="muted">None yet</div>}
          {options.map((o) => (
            <label key={o.id}>
              <input
                type="checkbox"
                checked={value.includes(o.id)}
                onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))}
              />
              {o.name}
            </label>
          ))}
          {value.length > 0 && <button className="link-button" onClick={() => onChange([])}>Any {label.toLowerCase()}</button>}
        </div>
      )}
    </div>
  );
}
