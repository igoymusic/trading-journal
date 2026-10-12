// Journaling pieces: the setup, mistakes, rating and notes you record for each trade, and the
// daily note. Changes save as you make them.

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { EMPTY_JOURNAL, type MistakeTag, type Setup, type Trade, type TradeJournal } from '../core/types';

export interface JournalContextValue {
  setups: Setup[];
  mistakes: MistakeTag[];
  saveTrade(tradeId: string, journal: TradeJournal): void;
  saveSetups(setups: Setup[]): void;
  saveMistakes(mistakes: MistakeTag[]): void;
}

export const JournalContext = createContext<JournalContextValue>({
  setups: [], mistakes: [], saveTrade() {}, saveSetups() {}, saveMistakes() {},
});

export const useJournal = () => useContext(JournalContext);

/** Colors handed to new setups in turn; each can be changed in Settings. */
export const SETUP_COLORS = ['#2962ff', '#26a69a', '#ff9800', '#ab47bc', '#ef5350', '#00bcd4', '#fdd835', '#8d6e63'];

export const newId = () => crypto.randomUUID();

/** Saves `value` a moment after it stops changing, and right away when the component goes away. */
export function useAutosave(value: string, save: (v: string) => void, delay = 600) {
  const latest = useRef({ value, save, saved: value });
  latest.current.value = value;
  latest.current.save = save;
  useEffect(() => {
    if (value === latest.current.saved) return;
    const timer = setTimeout(() => { latest.current.saved = value; save(value); }, delay);
    return () => clearTimeout(timer);
  }, [value]);
  useEffect(() => () => {
    const l = latest.current;
    if (l.value !== l.saved) l.save(l.value);
  }, []);
}

export function SetupBadge({ id }: { id: string | null | undefined }) {
  const setup = useJournal().setups.find((s) => s.id === id);
  if (!setup) return null;
  return <span className="setup-badge" style={{ '--c': setup.color } as React.CSSProperties}>{setup.name}</span>;
}

export function MistakeNames({ ids }: { ids: string[] | undefined }) {
  const names = useJournal().mistakes.filter((m) => ids?.includes(m.id)).map((m) => m.name);
  return names.length ? <span className="loss">{names.join(', ')}</span> : null;
}

export function Stars({ value, onChange, size = 'normal' }: { value: number | null; onChange?: (v: number | null) => void; size?: 'small' | 'normal' }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <span className={`stars ${size} ${onChange ? 'editable' : ''}`} onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={n <= shown ? 'on' : ''}
          onMouseEnter={onChange ? () => setHover(n) : undefined}
          // Clicking the current rating clears it.
          onClick={onChange ? (e) => { e.stopPropagation(); onChange(value === n ? null : n); } : undefined}
        >★</span>
      ))}
    </span>
  );
}

/** Small "type a name, press Enter" box used to add a setup or mistake on the spot. */
function QuickAdd({ placeholder, onAdd, onCancel }: { placeholder: string; onAdd: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  return (
    <input
      autoFocus
      className="quick-add"
      placeholder={placeholder}
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && name.trim()) onAdd(name.trim());
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={() => (name.trim() ? onAdd(name.trim()) : onCancel())}
    />
  );
}

/** The journal strip under a trade's chart. */
export function TradeJournalEditor({ trade }: { trade: Trade }) {
  const { setups, mistakes, saveTrade, saveSetups, saveMistakes } = useJournal();
  const journal = trade.journal ?? EMPTY_JOURNAL;
  const [notes, setNotes] = useState(journal.notes);
  const [adding, setAdding] = useState<'setup' | 'mistake' | null>(null);
  // Always build on the newest saved entry, since notes save on a delay.
  const current = useRef(journal);
  current.current = trade.journal ?? EMPTY_JOURNAL;

  const update = (patch: Partial<TradeJournal>) => saveTrade(trade.id, { ...current.current, notes, ...patch });
  useAutosave(notes, (v) => saveTrade(trade.id, { ...current.current, notes: v }));

  function addSetup(name: string) {
    const setup = { id: newId(), name, color: SETUP_COLORS[setups.length % SETUP_COLORS.length] };
    saveSetups([...setups, setup]);
    update({ setupId: setup.id });
    setAdding(null);
  }

  function addMistake(name: string) {
    const existing = mistakes.find((m) => m.name.toLowerCase() === name.toLowerCase());
    const tag = existing ?? { id: newId(), name };
    if (!existing) saveMistakes([...mistakes, tag]);
    if (!journal.mistakes.includes(tag.id)) update({ mistakes: [...journal.mistakes, tag.id] });
    setAdding(null);
  }

  const unused = mistakes.filter((m) => !journal.mistakes.includes(m.id));

  return (
    <div className="journal-editor" onClick={(e) => e.stopPropagation()}>
      <div className="journal-row">
        <label className="journal-field">
          <span>Setup</span>
          {adding === 'setup' ? <QuickAdd placeholder="New setup name" onAdd={addSetup} onCancel={() => setAdding(null)} /> : (
            <select
              value={journal.setupId ?? ''}
              onChange={(e) => (e.target.value === '+new' ? setAdding('setup') : update({ setupId: e.target.value || null }))}
            >
              <option value="">No setup</option>
              {setups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="+new">+ New setup…</option>
            </select>
          )}
        </label>

        <div className="journal-field">
          <span>Rating</span>
          <Stars value={journal.rating} onChange={(rating) => update({ rating })} />
        </div>

        <div className="journal-field grow">
          <span>Mistakes</span>
          <div className="chips">
            {journal.mistakes.map((id) => {
              const m = mistakes.find((x) => x.id === id);
              return m && (
                <span key={id} className="chip">
                  {m.name}
                  <button aria-label={`Remove ${m.name}`} onClick={() => update({ mistakes: journal.mistakes.filter((x) => x !== id) })}>×</button>
                </span>
              );
            })}
            {adding === 'mistake' ? <QuickAdd placeholder="New mistake" onAdd={addMistake} onCancel={() => setAdding(null)} /> : (
              <select
                className="chip-add"
                value=""
                onChange={(e) => (e.target.value === '+new' ? setAdding('mistake') : e.target.value && update({ mistakes: [...journal.mistakes, e.target.value] }))}
              >
                <option value="">+ Add mistake</option>
                {unused.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                <option value="+new">New mistake…</option>
              </select>
            )}
          </div>
        </div>
      </div>
      <textarea
        className="notes"
        placeholder="Notes on this trade: why you took it, how you managed it, what you'd do differently…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
    </div>
  );
}

/** "How did today go?" note at the top of a Day tab. */
export function DayNote({ date, initial, onSave }: { date: string; initial: string; onSave: (date: string, notes: string) => void }) {
  const [text, setText] = useState(initial);
  useAutosave(text, (v) => onSave(date, v));
  return (
    <textarea
      className="notes day-note"
      placeholder="How did today go? Market conditions, your mindset, what worked and what didn't…"
      value={text}
      onChange={(e) => setText(e.target.value)}
    />
  );
}
