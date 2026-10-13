import { useEffect, useState } from 'react';
import type { BrokerAccount, BrokerStatus, SyncResult } from '../shared/api';

/** Settings section for connecting brokerage accounts through SnapTrade. */
export function BrokersSettings({ onSynced }: { onSynced: (result: SyncResult) => void }) {
  const [status, setStatus] = useState<BrokerStatus | null>(null);
  const [accounts, setAccounts] = useState<BrokerAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [relay, setRelay] = useState('');

  async function load() {
    const s = await window.journal.brokerStatus();
    setStatus(s);
    setRelay(s.relayUrl);
    setAccounts(null);
    if (s.connected) window.journal.brokerAccounts().then(setAccounts, () => setAccounts([]));
  }
  useEffect(() => { load(); }, []);

  async function run(label: string, action: () => Promise<SyncResult | null>) {
    setBusy(label);
    setMessage(null);
    try {
      const result = await action();
      if (result) {
        setMessage({ ok: !result.errors.length, text: describeSync(result) });
        onSynced(result);
      }
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
    }
    setBusy(null);
    load();
  }

  async function disconnect() {
    if (!confirm('Disconnect all brokers? Moon Journal stops syncing and loses access to them. Trades already brought in stay in your journal.')) return;
    setBusy('disconnect');
    try {
      await window.journal.disconnectBrokers();
      let text = 'Brokers disconnected.';
      if (confirm('Also remove the trades your brokers brought in? Your notes and trades imported from CSV files stay.')) {
        const removed = await window.journal.removeSynced();
        text += ` Removed ${removed} synced fills.`;
        onSynced({ added: 0, accounts: 0, errors: [] });
      }
      setMessage({ ok: true, text });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
    }
    setBusy(null);
    load();
  }

  return (
    <>
      <h3>Brokers</h3>
      <p className="muted">
        Sign in to your broker once and your option trades come in by themselves: the first time you open the app
        each day, or when you press Refresh. Moon Journal can only read your trades; it can never place orders.
      </p>
      {status?.connected && (
        <ul className="broker-accounts">
          {accounts === null && <li className="muted">Loading accounts…</li>}
          {accounts?.length === 0 && <li className="muted">No accounts yet. Connect a broker to add one.</li>}
          {accounts?.map((a) => <li key={a.id}><span className="win">●</span> {a.name}</li>)}
        </ul>
      )}
      <div className="row broker-actions">
        <button className="primary" disabled={!!busy || !status?.relayUrl} onClick={() => run('connect', () => window.journal.connectBroker())}>
          {busy === 'connect' ? 'Waiting for sign-in…' : status?.connected ? 'Add another broker' : 'Connect a broker'}
        </button>
        {status?.connected && (
          <>
            <button disabled={!!busy} onClick={() => run('sync', () => window.journal.syncBrokers())}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
            <button disabled={!!busy} onClick={disconnect}>Disconnect</button>
          </>
        )}
      </div>
      {status?.connected && (
        <p className="muted small">
          Some brokers, like Schwab, only report the day of each trade, not the time. For exact times (needed for
          charts and R), sign in to Schwab below, or import a thinkorswim Account Statement CSV now and then.
        </p>
      )}
      {status?.lastSync && <p className="muted">Last synced {new Date(status.lastSync).toLocaleString()}</p>}
      {message && <p className={message.ok ? 'win' : 'loss'}>{message.text}</p>}
      <details className="advanced">
        <summary>Relay address</summary>
        <p className="muted">The small cloud service that holds the SnapTrade key. Leave it as it came unless you were told to change it.</p>
        <div className="row">
          <input value={relay} onChange={(e) => setRelay(e.target.value)} placeholder="https://moon-relay.example.workers.dev" spellCheck={false} />
          <button disabled={relay === status?.relayUrl} onClick={async () => { await window.journal.setRelayUrl(relay); load(); }}>Save</button>
        </div>
      </details>
    </>
  );
}

export function describeSync(r: SyncResult): string {
  const parts = [r.added ? `${r.added} new fills from your broker${r.accounts === 1 ? '' : 's'}` : 'Broker sync: no new trades'];
  if (r.retimed) parts.push(`exact times for ${r.retimed} fill${r.retimed === 1 ? '' : 's'} from Schwab`);
  for (const e of r.errors) parts.push(`couldn't read ${e}`);
  return parts.join(' · ');
}
