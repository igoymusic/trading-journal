import { useEffect, useState } from 'react';
import type { SchwabSlot, SchwabStatus, SyncResult } from '../shared/api';
import { describeSync } from './BrokersSettings';

const clean = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const SLOTS: Record<SchwabSlot, { title: string; about: string; product: string }> = {
  trading: {
    title: 'Schwab trades (exact times)',
    about: 'Optional, for Schwab accounts. Gives the exact second each trade filled, which SnapTrade can\'t get from Schwab. Read-only.',
    product: 'Accounts and Trading Production',
  },
  marketData: {
    title: 'Schwab market data (real SPX charts)',
    about: 'Optional. Charts SPX and SPXW trades on the real index instead of an estimate from SPY.',
    product: 'Market Data Production',
  },
};

/** Settings section for one of your own Schwab developer apps. */
export function SchwabSettings({ slot, onSynced }: { slot: SchwabSlot; onSynced: (result: SyncResult) => void }) {
  const info = SLOTS[slot];
  const [status, setStatus] = useState<SchwabStatus | null>(null);
  const [appKey, setAppKey] = useState('');
  const [secret, setSecret] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('https://127.0.0.1');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const s = await window.journal.schwabStatus(slot);
    setStatus(s);
    if (s.callbackUrl) setCallbackUrl(s.callbackUrl);
  }
  useEffect(() => { load(); }, []);

  async function signIn() {
    setBusy('connect');
    setMessage(null);
    try {
      const result = await window.journal.connectSchwab(slot);
      if (result) {
        setMessage({ ok: !result.errors.length, text: slot === 'trading' ? `Signed in to Schwab. ${describeSync(result)}` : 'Signed in to Schwab. SPX charts now use the real index.' });
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
      await window.journal.saveSchwabApp(slot, { appKey, secret, callbackUrl });
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
    await window.journal.disconnectSchwab(slot);
    setMessage({ ok: true, text: 'Schwab keys removed.' });
    load();
  }

  const expires = status?.signInExpires ? new Date(status.signInExpires) : null;
  return (
    <>
      <h3>{info.title}</h3>
      <p className="muted">{info.about}</p>
      {status?.configured ? (
        <>
          <p>
            {status.signedIn
              ? <><span className="win">●</span> Signed in. Schwab asks you to sign in again every 7 days{expires ? `; this one lasts until ${expires.toLocaleString()}` : ''}.</>
              : <><span className="loss">●</span> Not signed in{expires ? ` (the last sign-in ran out ${expires.toLocaleString()})` : ''}.</>}
          </p>
          {status.signedIn && status.marketDataOnly && (
            <p className="muted small">
              This app only has Market Data, so it can't read your trades. Remove it here and enter your app with
              Accounts and Trading Production instead.
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
          <p className="muted small">Copy these from your app with <b>{info.product}</b> on developer.schwab.com (Dashboard, View Details). They're stored encrypted on this computer.</p>
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
