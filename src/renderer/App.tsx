import { useEffect, useState } from 'react';
import type { ImportResult, JournalData } from '../shared/api';
import { pnlClass, signedUsd, usd } from './format';
import { SettingsDialog } from './SettingsDialog';
import { TradePanel } from './TradePanel';
import { TradeTable } from './TradeTable';

export function App() {
  const [data, setData] = useState<JournalData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // Bumped when Settings closes so an open chart reloads with new keys or time zone.
  const [settingsVersion, setSettingsVersion] = useState(0);
  const selected = data?.trades.find((t) => t.id === selectedId) ?? null;

  const load = () => window.journal.getJournal().then(setData);
  useEffect(() => { load(); }, []);

  async function importCsv() {
    try {
      const result = await window.journal.importThinkorswim();
      if (!result) return;
      setNotice(describeImport(result));
      await load();
    } catch (err) {
      setNotice(`Import failed: ${(err as Error).message}`);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Trading Journal</h1>
        <div className="topbar-actions">
          <button onClick={() => setShowSettings(true)}>Settings</button>
          <button className="primary" onClick={importCsv}>Import thinkorswim CSV</button>
        </div>
      </header>
      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}
      {!data ? null : data.trades.length === 0 ? <EmptyState onImport={importCsv} /> : (
        <>
          <SummaryBar data={data} />
          {selected && <TradePanel key={`${selected.id}:${settingsVersion}`} trade={selected} onClose={() => setSelectedId(null)} onOpenSettings={() => setShowSettings(true)} />}
          <TradeTable trades={data.trades} selectedId={selectedId} onSelect={(id) => setSelectedId(id === selectedId ? null : id)} />
        </>
      )}
      {showSettings && <SettingsDialog onClose={() => { setShowSettings(false); setSettingsVersion((v) => v + 1); }} />}
    </div>
  );
}

function describeImport(r: ImportResult): string {
  const parts = [`${r.file}: ${r.added} new fills imported`];
  if (r.duplicates) parts.push(`${r.duplicates} already in your journal`);
  if (r.skipped) parts.push(`${r.skipped} rows skipped`);
  if (r.unmatchedFees) parts.push(`${r.unmatchedFees} fills without fee info`);
  return parts.join(' · ');
}

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="empty">
      <h2>Import your trades</h2>
      <ol>
        <li>In thinkorswim, open <b>Monitor</b> then <b>Account Statement</b>.</li>
        <li>Pick a date range and click <b>Apply</b>.</li>
        <li>Click the menu icon at the top right and choose <b>Export to File</b>.</li>
      </ol>
      <button className="primary" onClick={onImport}>Choose the CSV file</button>
    </div>
  );
}

function SummaryBar({ data }: { data: JournalData }) {
  const s = data.summary;
  const tiles: { label: string; value: string; tone?: string; sub?: string }[] = [
    { label: 'Net P&L', value: signedUsd(s.netPnl), tone: pnlClass(s.netPnl), sub: `${usd(s.fees)} fees` },
    { label: 'Win rate', value: `${(s.winRate * 100).toFixed(1)}%`, sub: `${s.wins} W / ${s.losses} L` },
    { label: 'Profit factor', value: s.profitFactor.toFixed(2), tone: s.profitFactor >= 1 ? 'win' : 'loss' },
    { label: 'Avg win', value: signedUsd(s.avgWin), tone: 'win' },
    { label: 'Avg loss', value: signedUsd(s.avgLoss), tone: 'loss' },
    { label: 'Trades', value: String(s.trades) },
  ];
  return (
    <section className="summary">
      {tiles.map((t) => (
        <div className="tile" key={t.label}>
          <div className="tile-label">{t.label}</div>
          <div className={`tile-value ${t.tone ?? ''}`}>{t.value}</div>
          {t.sub && <div className="tile-sub">{t.sub}</div>}
        </div>
      ))}
    </section>
  );
}
