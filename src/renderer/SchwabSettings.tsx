import { useEffect, useState } from 'react';
import type { SchwabStatus, SyncResult } from '../shared/api';
import { describeSync } from './BrokersSettings';

const clean = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Settings section for your own Schwab developer app: exact fill times and real index prices. */
export function SchwabSettings({ onSynced }: { onSynced: (result: SyncResult) => void }) {
  const [status, setStatus] = useState<SchwabStatus | null>(null);
  const [appKey, setAppKey] = useState('');
  const [secret, setSecret] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('https://127.0.0.1');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const s = await window.journal.schwabStatus();
    setStatus(s);
    if (s.callbackUrl) setCallbackUrl(s.callbackUrl);
  }
  useEffect(() => { load(); }, []);

  async function signIn() {
    setBusy('connect');
    setMessage(null);
    try {
      const result = await window.journal.connectSchwab();
      if (result) {
        setMessage({ ok: !result.errors.length, text: `Signed in to Schwab. ${describeSync(result)}` });
        onSynced(result);
      }
    } catch (err) {
      setMessage({ ok: false, text: clean(err) });
    }
    setBusy(null);
    load();
  }

  async function save() {
    setMessage(null);
    try {
      await window.journal.saveSchwabApp({ appKey, secret, callbackUrl });
      setAppKey('');
      setSecret('');
      await load();
      await signIn();
    } catch (err) {
      setMessage({ ok: false, text: clean(err) });
    }
  }

  async function remove() {
    if (!confirm('Remove your Schwab app keys and sign-in from Moon Journal? Trades already in your journal stay.')) return;
    await window.journal.disconnectSchwab();
    setMessage({ ok: true, text: 'Schwab keys removed.' });
    load();
  }

  const expires = status?.signInExpires ? new Date(status.signInExpires) : null;
  return (
    <>
      <h3>Schwab (exact times)</h3>
      <p className="muted">
        Optional, for Schwab accounts. Schwab's own connection gives the exact second each trade filled, and real
        SPX prices for SPX and SPXW charts. It uses your own app from developer.schwab.com and is read-only.
      </p>
      {status?.configured ? (
        <>
          <p>
            {status.signedIn
              ? <><span className="win">●</span> Signed in. Schwab asks you to sign in again every 7 days{expires ? `; this one lasts until ${expires.toLocaleString()}` : ''}.</>
              : <><span className="loss">●</span> Not signed in{expires ? ` (the last sign-in ran out ${expires.toLocaleString()})` : ''}.</>}
          </p>
          {status.signedIn && status.marketDataOnly && (
            <p className="muted small">
              Your Schwab app only has Market Data, so it gives real SPX charts but not trade times. For exact times, add
              the "Accounts and Trading Production" product to your app on developer.schwab.com, then sign in again here
              once Schwab approves it.
            </p>
          )}
          <div className="row broker-actions">
            <button className="primary" disabled={!!busy} onClick={signIn}>
              {busy === 'connect' ? 'Waiting for sign-in…' : status.signedIn ? 'Sign in again' : 'Sign in to Schwab'}
            </button>
            <button disabled={!!busy} onClick={remove}>Remove Schwab keys</button>
          </div>
          {status.lastSync && <p className="muted">Last read from Schwab {new Date(status.lastSync).toLocaleString()}</p>}
        </>
      ) : (
        <>
          <p className="muted small">Copy these from your app on developer.schwab.com (Dashboard, View Details). They're stored encrypted on this computer.</p>
          <label>App Key<input value={appKey} onChange={(e) => setAppKey(e.target.value)} spellCheck={false} autoComplete="off" /></label>
          <label>Secret<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} spellCheck={false} autoComplete="off" /></label>
          <label>Callback URL<input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} spellCheck={false} /></label>
          <div className="row broker-actions">
            <button className="primary" disabled={!!busy || !appKey.trim() || !secret.trim() || !callbackUrl.trim()} onClick={save}>
              {busy === 'connect' ? 'Waiting for sign-in…' : 'Save and sign in to Schwab'}
            </button>
          </div>
        </>
      )}
      {message && <p className={message.ok ? 'win' : 'loss'}>{message.text}</p>}
    </>
  );
}
