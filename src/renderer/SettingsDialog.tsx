import { useEffect, useState } from 'react';
import type { PlaybookRule } from '../core/types';
import type { SettingsView } from '../shared/api';
import { newId, SETUP_COLORS, useJournal } from './journal';

const TIME_ZONES = [
  ['America/New_York', 'Eastern'],
  ['America/Chicago', 'Central'],
  ['America/Denver', 'Mountain'],
  ['America/Phoenix', 'Arizona'],
  ['America/Los_Angeles', 'Pacific'],
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [keyId, setKeyId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => window.journal.getSettings().then(setSettings);
  useEffect(() => { load(); }, []);

  async function saveKeys() {
    setBusy(true);
    setStatus(null);
    const result = await window.journal.saveAlpacaKeys({ keyId, secretKey });
    setBusy(false);
    setStatus(result);
    if (result.ok) {
      setKeyId('');
      setSecretKey('');
      load();
    }
  }

  async function removeKeys() {
    setStatus(await window.journal.saveAlpacaKeys(null));
    load();
  }

  async function changeZone(tz: string) {
    await window.journal.setTimeZone(tz);
    load();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>

        <h3>Market data (Alpaca)</h3>
        <p className="muted">
          Used to draw the underlying's chart and find its exact price at each of your fills.
          A free Alpaca account works. Keys are stored encrypted on this computer only.
        </p>
        {settings?.hasAlpacaKey ? (
          <div className="row">
            <span className="win">● Connected</span>
            <button onClick={removeKeys}>Remove keys</button>
          </div>
        ) : (
          <>
            <label>API Key ID<input value={keyId} onChange={(e) => setKeyId(e.target.value)} spellCheck={false} /></label>
            <label>Secret Key<input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} spellCheck={false} /></label>
            <button className="primary" disabled={busy || !keyId || !secretKey} onClick={saveKeys}>{busy ? 'Checking…' : 'Connect'}</button>
          </>
        )}
        {status && <p className={status.ok ? 'win' : 'loss'}>{status.message}</p>}

        <SetupsEditor />
        <MistakesEditor />

        <h3>Time zone of your broker exports</h3>
        <p className="muted">thinkorswim exports times in your computer's time zone without saying which one.</p>
        <select value={settings?.timeZone ?? 'America/New_York'} onChange={(e) => changeZone(e.target.value)}>
          {TIME_ZONES.map(([tz, name]) => <option key={tz} value={tz}>{name} ({tz})</option>)}
        </select>
      </div>
    </div>
  );
}

/** Your setups: rename, recolor or delete. Deleting one clears it from its trades. */
function SetupsEditor() {
  const { setups, saveSetups } = useJournal();
  const [name, setName] = useState('');
  const [openRules, setOpenRules] = useState<string | null>(null);
  const setRules = (id: string, rules: PlaybookRule[]) => saveSetups(setups.map((x) => (x.id === id ? { ...x, rules } : x)));
  const add = () => {
    if (!name.trim()) return;
    saveSetups([...setups, { id: newId(), name: name.trim(), color: SETUP_COLORS[setups.length % SETUP_COLORS.length] }]);
    setName('');
  };
  return (
    <>
      <h3>Setups</h3>
      <p className="muted">
        The kinds of trades you take. Pick one on each trade to see later which setups make money. Give a setup a
        playbook (the rules you mean to follow every time) and you can tick off which ones you followed on each trade.
      </p>
      {setups.map((s) => (
        <div key={s.id}>
          <div className="list-row">
            <input type="color" value={s.color} onChange={(e) => saveSetups(setups.map((x) => (x.id === s.id ? { ...x, color: e.target.value } : x)))} />
            <RenameInput value={s.name} onSave={(v) => saveSetups(setups.map((x) => (x.id === s.id ? { ...x, name: v } : x)))} />
            <button className={openRules === s.id ? 'active' : ''} onClick={() => setOpenRules(openRules === s.id ? null : s.id)}>
              Playbook ({s.rules?.length ?? 0})
            </button>
            <button className="danger-link" onClick={() => saveSetups(setups.filter((x) => x.id !== s.id))}>Delete</button>
          </div>
          {openRules === s.id && <RulesEditor rules={s.rules ?? []} onChange={(rules) => setRules(s.id, rules)} />}
        </div>
      ))}
      <div className="list-row">
        <input placeholder="New setup, e.g. Opening range breakout" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button onClick={add} disabled={!name.trim()}>Add</button>
      </div>
    </>
  );
}

function RulesEditor({ rules, onChange }: { rules: PlaybookRule[]; onChange: (rules: PlaybookRule[]) => void }) {
  const [text, setText] = useState('');
  const add = () => {
    if (!text.trim()) return;
    onChange([...rules, { id: newId(), text: text.trim() }]);
    setText('');
  };
  return (
    <div className="rules-editor">
      {rules.map((r, i) => (
        <div className="list-row" key={r.id}>
          <span className="muted rule-num">{i + 1}.</span>
          <RenameInput value={r.text} onSave={(v) => onChange(rules.map((x) => (x.id === r.id ? { ...x, text: v } : x)))} />
          <button className="danger-link" onClick={() => onChange(rules.filter((x) => x.id !== r.id))}>Delete</button>
        </div>
      ))}
      <div className="list-row">
        <input autoFocus placeholder="New rule, e.g. Wait for the first 5-minute candle to close" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button onClick={add} disabled={!text.trim()}>Add rule</button>
      </div>
    </div>
  );
}

function MistakesEditor() {
  const { mistakes, saveMistakes } = useJournal();
  const [name, setName] = useState('');
  const add = () => {
    if (!name.trim()) return;
    saveMistakes([...mistakes, { id: newId(), name: name.trim() }]);
    setName('');
  };
  return (
    <>
      <h3>Mistakes</h3>
      <p className="muted">Labels you can put on trades. Deleting one takes it off every trade.</p>
      {mistakes.map((m) => (
        <div className="list-row" key={m.id}>
          <RenameInput value={m.name} onSave={(v) => saveMistakes(mistakes.map((x) => (x.id === m.id ? { ...x, name: v } : x)))} />
          <button className="danger-link" onClick={() => saveMistakes(mistakes.filter((x) => x.id !== m.id))}>Delete</button>
        </div>
      ))}
      <div className="list-row">
        <input placeholder="New mistake, e.g. Traded the open" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button onClick={add} disabled={!name.trim()}>Add</button>
      </div>
    </>
  );
}

/** A name you can edit in place; it saves when you leave the box or press Enter. */
function RenameInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => { if (text.trim() && text.trim() !== value) onSave(text.trim()); else setText(value); };
  return <input value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}
