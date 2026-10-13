// Journaling pieces: the setup, tags (positive and mistakes), rating and notes you record for each trade, and the
// daily note. Changes save as you make them.

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { EMPTY_JOURNAL, type MistakeTag, playbookScore, type Setup, type Trade, type TradeJournal } from '../core/types';

export interface JournalContextValue {
  setups: Setup[];
  mistakes: MistakeTag[];
  positives: MistakeTag[];
  saveTrade(tradeId: string, journal: TradeJournal): void;
  saveSetups(setups: Setup[]): void;
  saveMistakes(mistakes: MistakeTag[]): void;
  savePositives(positives: MistakeTag[]): void;
}

export const JournalContext = createContext<JournalContextValue>({
  setups: [], mistakes: [], positives: [], saveTrade() {}, saveSetups() {}, saveMistakes() {}, savePositives() {},
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

export function PositiveNames({ ids }: { ids: string[] | undefined }) {
  const names = useJournal().positives.filter((m) => ids?.includes(m.id)).map((m) => m.name);
  return names.length ? <span className="win">{names.join(', ')}</span> : null;
}

/** "3/4" rules followed, green when all of them. */
export function RulesCell({ trade }: { trade: Trade }) {
  const score = playbookScore(trade, useJournal().setups);
  if (!score) return null;
  return <span className={score.followed === score.total ? 'win' : 'muted'} title={score.broken.length ? `Broke: ${score.broken.map((r) => r.text).join('; ')}` : 'Followed every rule'}>
    {score.followed}/{score.total}
  </span>;
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
  const { setups, mistakes, positives, saveTrade, saveSetups, saveMistakes, savePositives } = useJournal();
  const journal = trade.journal ?? EMPTY_JOURNAL;
  const [notes, setNotes] = useState(journal.notes);
  const [adding, setAdding] = useState<'setup' | 'mistake' | 'positive' | null>(null);
  const [tagsOpen, setTagsOpen] = useState(() => { try { return localStorage.getItem('tagsOpen') === '1'; } catch { return false; } });
  const toggleTags = () => {
    setTagsOpen(!tagsOpen);
    try { localStorage.setItem('tagsOpen', tagsOpen ? '0' : '1'); } catch { /* not saved */ }
  };
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

  const chosen = { mistake: journal.mistakes, positive: journal.positives ?? [] };
  const toggleTag = (kind: 'mistake' | 'positive', id: string) => {
    const list = chosen[kind];
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    update(kind === 'mistake' ? { mistakes: next } : { positives: next });
  };

  function addTag(kind: 'mistake' | 'positive', name: string) {
    const all = kind === 'mistake' ? mistakes : positives;
    const existing = all.find((m) => m.name.toLowerCase() === name.toLowerCase());
    const tag = existing ?? { id: newId(), name };
    if (!existing) (kind === 'mistake' ? saveMistakes : savePositives)([...all, tag]);
    if (!chosen[kind].includes(tag.id)) toggleTag(kind, tag.id);
    setAdding(null);
  }

  const tagGroup = (kind: 'mistake' | 'positive', title: string, all: MistakeTag[]) => (
    <div className={`tag-group ${kind}`}>
      <div className="tag-group-title">{title}</div>
      <div className="chips">
        {all.map((t) => (
          <button key={t.id} className={`tag-toggle${chosen[kind].includes(t.id) ? ' on' : ''}`} onClick={() => toggleTag(kind, t.id)}>
            {t.name}
          </button>
        ))}
        {adding === kind
          ? <QuickAdd placeholder={kind === 'mistake' ? 'New mistake' : 'New positive tag'} onAdd={(n) => addTag(kind, n)} onCancel={() => setAdding(null)} />
          : <button className="tag-toggle add" onClick={() => setAdding(kind)}>+ New</button>}
      </div>
    </div>
  );
  const picked = [
    ...chosen.positive.map((id) => ({ id, kind: 'positive' as const, tag: positives.find((x) => x.id === id) })),
    ...chosen.mistake.map((id) => ({ id, kind: 'mistake' as const, tag: mistakes.find((x) => x.id === id) })),
  ].filter((p) => p.tag);
  const setup = setups.find((s) => s.id === journal.setupId);
  const score = playbookScore(trade, setups);
  const followed = new Set(journal.rulesFollowed ?? []);
  const toggleRule = (id: string) =>
    update({ rulesFollowed: followed.has(id) ? [...followed].filter((x) => x !== id) : [...followed, id] });

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
          <span>Tags</span>
          <div className="chips">
            <button className={`tags-button${tagsOpen ? ' active' : ''}`} onClick={toggleTags}>
              {tagsOpen ? '▾' : '▸'} Tags
            </button>
            {picked.map((p) => (
              <span key={p.id} className={`chip ${p.kind}`}>
                {p.tag!.name}
                <button aria-label={`Remove ${p.tag!.name}`} onClick={() => toggleTag(p.kind, p.id)}>×</button>
              </span>
            ))}
          </div>
        </div>
      </div>
      {tagsOpen && (
        <div className="tags-panel">
          {tagGroup('positive', 'Did well', positives)}
          {tagGroup('mistake', 'Mistakes', mistakes)}
        </div>
      )}
      {setup && score && (
        <div className="playbook">
          <div className="playbook-head">
            <span>{setup.name} playbook</span>
            <span className={score.followed === score.total ? 'win' : 'muted'}>{score.followed} of {score.total} rules followed</span>
          </div>
          {setup.rules!.map((r) => (
            <label key={r.id} className={followed.has(r.id) ? 'followed' : ''}>
              <input type="checkbox" checked={followed.has(r.id)} onChange={() => toggleRule(r.id)} />
              {r.text}
            </label>
          ))}
        </div>
      )}
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
