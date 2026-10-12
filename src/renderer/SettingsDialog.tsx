import { useEffect, useState } from 'react';
import type { SettingsView } from '../shared/api';

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

        <h3>Time zone of your broker exports</h3>
        <p className="muted">thinkorswim exports times in your computer's time zone without saying which one.</p>
        <select value={settings?.timeZone ?? 'America/New_York'} onChange={(e) => changeZone(e.target.value)}>
          {TIME_ZONES.map(([tz, name]) => <option key={tz} value={tz}>{name} ({tz})</option>)}
        </select>
      </div>
    </div>
  );
}
