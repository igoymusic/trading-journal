import { type ReactNode, useEffect, useState } from 'react';
import { type CustomGoal, describeGoal, GOAL_METRICS, type Goals } from '../core/goals';
import type { PlaybookRule } from '../core/types';
import type { BackupStatus, ColorScheme, SettingsView, SyncResult } from '../shared/api';
import { type OptionPriceDisplay, setOptionPriceDisplay } from './format';
import { MarkerStyleEditor } from './MarkerStyleEditor';
import { activeTheme, applyColors, COLOR_LABELS, DEFAULT_COLORS, themed } from './colors';
import { ThemePicker } from './ThemePicker';
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

export function SettingsDialog({ onClose, onSynced, onColorsChanged }: { onClose: () => void; onSynced: (result: SyncResult) => void; onColorsChanged: () => void }) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [keyId, setKeyId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<string | null>(null);
  // The tab and section open last time.
  const [place, setPlace] = useState<{ tab: string; section: string }>(() => {
    try { return JSON.parse(localStorage.getItem('settingsPlace') ?? '') as { tab: string; section: string }; } catch { return { tab: '', section: '' }; }
  });

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

  const resync = () => onSynced({ added: 0, accounts: 0, errors: [] });
  // Category tabs across the top, each with its sections down the left (like thinkorswim's settings).
  const tabs: { name: string; sections: { name: string; body: ReactNode }[] }[] = [
    {
      name: 'Connections',
      sections: [
        { name: 'Brokers', body: <BrokersSettings onSynced={onSynced} /> },
        { name: 'Schwab trading', body: <SchwabSettings slot="trading" onSynced={onSynced} /> },
        { name: 'Schwab market data', body: <SchwabSettings slot="marketData" onSynced={onSynced} /> },
        {
          name: 'Market data (Alpaca)',
          body: (
            <>
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
            </>
          ),
        },
      ],
    },
    {
      name: 'Journal',
      sections: [
        { name: 'Goals', body: settings && <GoalsEditor initial={settings.goals} /> },
        { name: 'Setups', body: <SetupsEditor /> },
        {
          name: 'Tags',
          body: (
            <>
              <h3>Tags</h3>
              <p className="muted">Labels you put on trades for what went well and what went wrong. Reports show what each one is worth.</p>
              <div className="settings-card"><TagsEditor kind="positive" /></div>
              <div className="settings-card"><TagsEditor kind="mistake" /></div>
            </>
          ),
        },
      ],
    },
    {
      name: 'Display',
      sections: [
        {
          name: 'Theme',
          body: settings && (
            <>
              <h3>Theme</h3>
              <p className="muted">Changes the whole look: colors, fonts, art, the charts in Home and Reports, the stop and target lines, and the entry and exit markers. Candles stay as they are.</p>
              <ThemePicker initial={settings.theme} onChange={onColorsChanged} />
            </>
          ),
        },
        {
          name: 'Numbers and calendar',
          body: settings && (
            <>
              <h3>Numbers and calendar</h3>
              <div className="settings-card">
                <ColorsEditor group="Numbers and calendar" initial={settings.colors} onChange={onColorsChanged} />
              </div>
            </>
          ),
        },
        {
          name: 'Charts',
          body: settings && (
            <>
              <h3>Charts</h3>
              <div className="settings-card">
                <h4>Colors</h4>
                <ColorsEditor group="Charts" initial={settings.colors} onChange={onColorsChanged} />
              </div>
              <div className="settings-card">
                <h4>Entry and exit markers</h4>
                <MarkerStyleEditor />
              </div>
              <div className="settings-card">
                <h4>Option prices</h4>
                <OptionPriceToggle initial={settings.optionPriceDisplay} onChange={onColorsChanged} />
              </div>
            </>
          ),
        },
      ],
    },
    {
      name: 'Data',
      sections: [
        { name: 'Trades by account', body: <AccountTrades onChanged={resync} /> },
        {
          name: 'Imported files',
          body: (
            <>
              <h3>Imported files</h3>
              <p className="muted">
                Remove every trade imported from thinkorswim CSV files. If a broker is connected, its full history is synced
                again right after. Your setups, tags and goals stay.
              </p>
              <button disabled={busy} onClick={removeImported}>Remove imported CSV trades</button>
              {removed && <p className="win">{removed}</p>}
            </>
          ),
        },
        {
          name: 'Time zone',
          body: (
            <>
              <h3>Time zone of your broker exports</h3>
              <p className="muted">thinkorswim exports times in your computer's time zone without saying which one.</p>
              <select value={settings?.timeZone ?? 'America/New_York'} onChange={(e) => changeZone(e.target.value)}>
                {TIME_ZONES.map(([tz, name]) => <option key={tz} value={tz}>{name} ({tz})</option>)}
              </select>
            </>
          ),
        },
        { name: 'Backups', body: <BackupsSection /> },
      ],
    },
  ];
  const tab = tabs.find((t) => t.name === place.tab) ?? tabs[0];
  const section = tab.sections.find((s) => s.name === place.section) ?? tab.sections[0];
  function go(tabName: string, sectionName?: string) {
    const next = { tab: tabName, section: sectionName ?? tabs.find((t) => t.name === tabName)!.sections[0].name };
    setPlace(next);
    try { localStorage.setItem('settingsPlace', JSON.stringify(next)); } catch { /* not remembered; fine */ }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="settings-tabs">
          {tabs.map((t) => <button key={t.name} className={t === tab ? 'active' : ''} onClick={() => go(t.name)}>{t.name}</button>)}
        </div>
        <div className="settings-body">
          <nav className="settings-nav">
            {tab.sections.map((s) => <button key={s.name} className={s === section ? 'active' : ''} onClick={() => go(tab.name, s.name)}>{s.name}</button>)}
          </nav>
          <div className="settings-page" key={`${tab.name}/${section.name}`}>{section.body}</div>
        </div>
      </div>
    </div>
  );
}

const GOAL_FIELDS: { key: 'dailyTarget' | 'dailyMaxLoss' | 'maxTradesPerDay' | 'maxLossesPerDay' | 'monthlyTarget'; label: string; hint: string; dollars: boolean }[] = [
  { key: 'dailyTarget', label: 'Daily profit target', hint: 'A day at or above this counts as hitting your target.', dollars: true },
  { key: 'dailyMaxLoss', label: 'Max loss per day', hint: 'Days that lose more than this get flagged.', dollars: true },
  { key: 'maxTradesPerDay', label: 'Max trades per day', hint: 'Days with more trades than this get flagged.', dollars: false },
  { key: 'maxLossesPerDay', label: 'Max losing trades per day', hint: 'Days with more losing trades than this get flagged.', dollars: false },
  { key: 'monthlyTarget', label: 'Monthly profit target', hint: 'Shown as a progress bar on Home.', dollars: true },
];

/** Goals and limits, saved as you type. Leave a box empty to not track that goal. */
function GoalsEditor({ initial }: { initial: Goals }) {
  const [goals, setGoals] = useState<Record<string, string>>(
    Object.fromEntries(GOAL_FIELDS.map((f) => [f.key, initial[f.key] === undefined ? '' : String(initial[f.key])])),
  );
  const [custom, setCustom] = useState<CustomGoal[]>(initial.custom ?? []);
  function persist(fields: Record<string, string>, customGoals: CustomGoal[]) {
    const parsed: Goals = {};
    for (const f of GOAL_FIELDS) {
      const n = Number(fields[f.key]);
      if (fields[f.key].trim() !== '' && Number.isFinite(n) && n > 0) (parsed as Record<string, number>)[f.key] = f.dollars ? n : Math.round(n);
    }
    const valid = customGoals.filter((g) => Number.isFinite(g.value));
    if (valid.length) parsed.custom = valid;
    window.journal.setGoals(parsed);
  }
  function change(key: keyof Goals, text: string) {
    const next = { ...goals, [key]: text };
    setGoals(next);
    persist(next, custom);
  }
  function changeCustom(list: CustomGoal[]) {
    setCustom(list);
    persist(goals, list);
  }
  const patch = (id: string, p: Partial<CustomGoal>) => changeCustom(custom.map((g) => (g.id === id ? { ...g, ...p } : g)));
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
      <h4>Your own goals</h4>
      <p className="muted small">Pick what to measure, the target, and whether it's per day, week or month.</p>
      {custom.map((g) => {
        const unit = GOAL_METRICS.find((m) => m.key === g.metric)!.unit;
        return (
          <div className="custom-goal" key={g.id}>
            <input className="custom-goal-name" placeholder={describeGoal({ ...g, name: '' })} value={g.name} onChange={(e) => patch(g.id, { name: e.target.value })} />
            <div className="row">
              <select value={g.metric} onChange={(e) => patch(g.id, { metric: e.target.value as CustomGoal['metric'] })}>
                {GOAL_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
              <select value={g.op} onChange={(e) => patch(g.id, { op: e.target.value as CustomGoal['op'] })}>
                <option value="atLeast">at least</option>
                <option value="atMost">at most</option>
              </select>
              <span className="goal-input">
                {unit === '$' && <span className="muted">$</span>}
                <input type="number" min={0} value={g.value} onChange={(e) => patch(g.id, { value: Number(e.target.value) })} />
                {unit === '%' && <span className="muted">%</span>}
              </span>
              <select value={g.period} onChange={(e) => patch(g.id, { period: e.target.value as CustomGoal['period'] })}>
                <option value="day">per day</option>
                <option value="week">per week</option>
                <option value="month">per month</option>
              </select>
              <button className="danger-link" onClick={() => changeCustom(custom.filter((x) => x.id !== g.id))}>Delete</button>
            </div>
          </div>
        );
      })}
      <button onClick={() => changeCustom([...custom, { id: newId(), name: '', metric: 'winRate', op: 'atLeast', value: 60, period: 'week' }])}>+ Add a goal</button>
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

/** One tag list (positive tags or mistakes): rename, delete or add. Deleting one takes it off every trade. */
function TagsEditor({ kind }: { kind: 'positive' | 'mistake' }) {
  const j = useJournal();
  const tags = kind === 'positive' ? j.positives : j.mistakes;
  const save = kind === 'positive' ? j.savePositives : j.saveMistakes;
  const [name, setName] = useState('');
  const add = () => {
    if (!name.trim()) return;
    save([...tags, { id: newId(), name: name.trim() }]);
    setName('');
  };
  return (
    <details className="tags-editor">
      <summary>{kind === 'positive' ? 'Did well' : 'Mistakes'} <span className="muted">({tags.length})</span></summary>
      {tags.map((m) => (
        <div className="list-row" key={m.id}>
          <RenameInput value={m.name} onSave={(v) => save(tags.map((x) => (x.id === m.id ? { ...x, name: v } : x)))} />
          <button className="danger-link" onClick={() => save(tags.filter((x) => x.id !== m.id))}>Delete</button>
        </div>
      ))}
      <div className="list-row">
        <input placeholder={kind === 'positive' ? 'New tag, e.g. Waited for my level' : 'New mistake, e.g. Traded the open'}
          value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button onClick={add} disabled={!name.trim()}>Add</button>
      </div>
    </details>
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

/** Back up the journal, back it up daily to a folder, or restore it on a new computer. */
function BackupsSection() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { window.journal.backupStatus().then(setStatus); }, []);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (err) {
      setMessage({ text: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), ok: false });
    } finally {
      setBusy(false);
    }
  }
  const save = () => run(async () => {
    const r = await window.journal.saveBackup();
    if (r) setMessage({ text: `Saved ${r.file} (${(r.size / 1_048_576).toFixed(1)} MB).`, ok: true });
  });
  const choose = () => run(async () => setStatus(await window.journal.chooseBackupFolder()));
  const restore = () => run(async () => { await window.journal.restoreBackup(); });

  return (
    <>
      <h3>Backups and moving computers</h3>
      <p className="muted">
        A backup is one file with everything: trades, notes, tags, setups, goals, drawings, screenshots and settings.
        To move to a new computer, install Moon Journal there, click Restore and pick your latest backup. Your Alpaca key
        and broker sign-ins aren't in backups (Windows locks them to this computer), so add those again after restoring.
      </p>
      <div className="row backup-buttons">
        <button disabled={busy} onClick={save}>Back up now…</button>
        <button disabled={busy} onClick={restore}>Restore from a backup…</button>
      </div>
      <p className="muted backup-auto">
        {status?.folder ? (
          <>
            Daily backups go to <b className="path">{status.folder}</b>
            {status.latest && <> · last one {new Date(status.latest.when).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</>}
            . The last 14 are kept.{' '}
            <button className="link" disabled={busy} onClick={choose}>Change folder</button>{' · '}
            <button className="link" disabled={busy} onClick={() => run(async () => setStatus(await window.journal.stopAutoBackup()))}>Turn off</button>
          </>
        ) : (
          <>
            Daily backup is off. Pick a folder in OneDrive, Google Drive or Dropbox and a backup is saved there each day
            you open the app, so it's safe even if this computer isn't.{' '}
            <button className="link" disabled={busy} onClick={choose}>Turn on daily backup…</button>
          </>
        )}
      </p>
      {message && <p className={message.ok ? 'win' : 'loss'}>{message.text}</p>}
    </>
  );
}

/** Whether option prices show as quoted ($0.15) or as paid per contract ($15.00). */
function OptionPriceToggle({ initial, onChange }: { initial: OptionPriceDisplay; onChange: () => void }) {
  const [mode, setMode] = useState(initial);
  const pick = (next: OptionPriceDisplay) => {
    setMode(next);
    setOptionPriceDisplay(next);
    window.journal.setOptionPriceDisplay(next);
    onChange();
  };
  return (
    <>
      <div className="toggle">
        <button className={mode === 'quote' ? 'active' : ''} onClick={() => pick('quote')}>Option price ($0.15)</button>
        <button className={mode === 'contract' ? 'active' : ''} onClick={() => pick('contract')}>Price paid ($15.00)</button>
      </div>
      <p className="muted small">Used for fills, chart labels, stop and target prices, and the Avg entry and Avg exit columns.</p>
    </>
  );
}

/** One group of your colors (numbers and calendar, or charts); each change shows right away. */
function ColorsEditor({ group, initial, onChange }: { group: string; initial?: Partial<ColorScheme>; onChange: () => void }) {
  const [custom, setCustom] = useState<Partial<ColorScheme>>(initial ?? {});
  const value = { ...DEFAULT_COLORS, ...custom };
  function save(next: Partial<ColorScheme>) {
    setCustom(next);
    applyColors(next);
    window.journal.setColors(Object.keys(next).length ? next : null);
    onChange();
  }
  const set = (key: keyof ColorScheme, color: string) => {
    const next = { ...custom, [key]: color };
    if (color.toLowerCase() === DEFAULT_COLORS[key].toLowerCase()) delete next[key];
    save(next);
  };
  const labels = COLOR_LABELS.filter((c) => c.group === group);
  const changed = labels.some((c) => custom[c.key]);
  const reset = () => {
    const next = { ...custom };
    for (const c of labels) delete next[c.key];
    save(next);
  };
  return (
    <>
      {themed() && <p className="muted small">These are your colors for the Default theme. The {activeTheme().name} theme uses its own{group === 'Charts' ? ', except for the candles' : ''}.</p>}
      <div className="color-grid">
        {labels.map((c) => (
          <label key={c.key} className="color-pick">
            <input type="color" value={value[c.key]} onChange={(e) => set(c.key, e.target.value)} />
            {c.label}
          </label>
        ))}
      </div>
      <button disabled={!changed} onClick={reset}>Reset these colors</button>
    </>
  );
}

