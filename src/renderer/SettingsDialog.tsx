import { useEffect, useState } from 'react';
import type { Goals } from '../core/goals';
import type { PlaybookRule } from '../core/types';
import type { SettingsView, SyncResult } from '../shared/api';
import { BrokersSettings } from './BrokersSettings';
import { NO_ACCOUNT } from './AccountPicker';
import { SchwabSettings } from './SchwabSettings';
import { newId, SETUP_COLORS, useJournal } from './journal';

const TIME_ZONES = [
  ['America/New_York', 'Eastern'],
  ['America/Chicago', 'Central'],
  ['America/Denver', 'Mountain'],
  ['America/Phoenix', 'Arizona'],
  ['America/Los_Angeles', 'Pacific'],
];

export function SettingsDialog({ onClose, onSynced }: { onClose: () => void; onSynced: (result: SyncResult) => void }) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [keyId, setKeyId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<string | null>(null);

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

  async function removeImported() {
    if (!confirm('Remove all trades imported from thinkorswim CSV files? This can\'t be undone, but you can import the files again.')) return;
    setBusy(true);
    const { removed, sync } = await window.journal.removeImported();
    setBusy(false);
    setRemoved(`Removed ${removed} imported fills.${sync ? ` ${sync.added} fills synced from your brokers.` : ''}`);
    if (sync) onSynced(sync);
    else onSynced({ added: 0, accounts: 0, errors: [] });
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

        <BrokersSettings onSynced={onSynced} />
        <SchwabSettings onSynced={onSynced} />

        <h3>Market data (Alpaca)</h3>
        <p className="muted">
          Used to draw the underlying's chart and find its exact price at each of your fills.
          A free Alpaca account works. Keys are stored encrypted on this computer only.
        </p>
        {!settings?.hasAlpacaKey && <AlpacaSteps />}
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

        {settings && <GoalsEditor initial={settings.goals} />}

        <SetupsEditor />
        <MistakesEditor />

        <AccountTrades onChanged={() => onSynced({ added: 0, accounts: 0, errors: [] })} />

        <h3>Imported files</h3>
        <p className="muted">
          Remove every trade imported from thinkorswim CSV files. If a broker is connected, its full history is synced
          again right after. Your setups, mistakes and goals stay.
        </p>
        <button disabled={busy} onClick={removeImported}>Remove imported CSV trades</button>
        {removed && <p className="win">{removed}</p>}

        <h3>Time zone of your broker exports</h3>
        <p className="muted">thinkorswim exports times in your computer's time zone without saying which one.</p>
        <select value={settings?.timeZone ?? 'America/New_York'} onChange={(e) => changeZone(e.target.value)}>
          {TIME_ZONES.map(([tz, name]) => <option key={tz} value={tz}>{name} ({tz})</option>)}
        </select>
      </div>
    </div>
  );
}

const GOAL_FIELDS: { key: keyof Goals; label: string; hint: string; dollars: boolean }[] = [
  { key: 'dailyTarget', label: 'Daily profit target', hint: 'A day at or above this counts as hitting your target.', dollars: true },
  { key: 'dailyMaxLoss', label: 'Max loss per day', hint: 'Days that lose more than this get flagged.', dollars: true },
  { key: 'maxTradesPerDay', label: 'Max trades per day', hint: 'Days with more trades than this get flagged.', dollars: false },
  { key: 'monthlyTarget', label: 'Monthly profit target', hint: 'Shown as a progress bar on Home.', dollars: true },
];

/** Goals and limits, saved as you type. Leave a box empty to not track that goal. */
function GoalsEditor({ initial }: { initial: Goals }) {
  const [goals, setGoals] = useState<Record<string, string>>(
    Object.fromEntries(GOAL_FIELDS.map((f) => [f.key, initial[f.key] === undefined ? '' : String(initial[f.key])])),
  );
  function change(key: keyof Goals, text: string) {
    const next = { ...goals, [key]: text };
    setGoals(next);
    const parsed: Goals = {};
    for (const f of GOAL_FIELDS) {
      const n = Number(next[f.key]);
      if (next[f.key].trim() !== '' && Number.isFinite(n) && n > 0) parsed[f.key] = f.dollars ? n : Math.round(n);
    }
    window.journal.setGoals(parsed);
  }
  return (
    <>
      <h3>Goals</h3>
      <p className="muted">Targets and limits for your trading. Home shows how this month is going, and the calendar marks days that hit the target or broke a limit. Leave a box empty to skip it.</p>
      <div className="goal-fields">
        {GOAL_FIELDS.map((f) => (
          <label key={f.key} title={f.hint}>
            {f.label}
            <span className="goal-input">
              {f.dollars && <span className="muted">$</span>}
              <input type="number" min={0} step={f.dollars ? 10 : 1} value={goals[f.key]} onChange={(e) => change(f.key, e.target.value)} />
            </span>
          </label>
        ))}
      </div>
    </>
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

/** How to get a free Alpaca key, for people setting up the app for the first time. */
export function AlpacaSteps() {
  return (
    <ol className="setup-steps">
      <li>
        Make a free account at <a href="https://app.alpaca.markets/signup" target="_blank" rel="noreferrer">alpaca.markets</a>.
        You don't need to fund it or trade there.
      </li>
      <li>On your Alpaca home page, find <b>API Keys</b> on the right and click <b>Generate New Keys</b>.</li>
      <li>Copy the <b>Key</b> and the <b>Secret</b> into the two boxes below and click <b>Connect</b>. Alpaca only shows the Secret once.</li>
    </ol>
  );
}

/** Every account with trades in the journal, each with a button to remove its trades. */
function AccountTrades({ onChanged }: { onChanged: () => void }) {
  const [counts, setCounts] = useState<{ account: string | null; fills: number }[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = () => window.journal.accountFillCounts().then(setCounts);
  useEffect(() => { load(); }, []);

  async function remove(account: string | null) {
    const name = account ?? NO_ACCOUNT;
    if (!confirm(`Remove all ${name} trades from your journal? If this account is still connected, its trades come back on the next sync, so disconnect it at your broker first.`)) return;
    const removed = await window.journal.removeAccount(account);
    setMessage(`Removed ${removed} fills from ${name}.`);
    load();
    onChanged();
  }

  if (!counts?.length) return null;
  return (
    <>
      <h3>Trades by account</h3>
      <p className="muted">Remove the trades of an account you no longer use, for example one you disconnected.</p>
      <ul className="broker-accounts">
        {counts.map((c) => (
          <li key={c.account ?? ''} className="row">
            <span>{c.account ?? NO_ACCOUNT} <span className="muted">({c.fills} fills)</span></span>
            <button onClick={() => remove(c.account)}>Remove trades</button>
          </li>
        ))}
      </ul>
      {message && <p className="win">{message}</p>}
    </>
  );
}
