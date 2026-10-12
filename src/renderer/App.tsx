import { useEffect, useMemo, useState } from 'react';
import { tradeDay } from '../core/calendar';
import { type Summary, summarizeTrades } from '../core/trades';
import type { ImportResult, JournalData } from '../shared/api';
import { DayView } from './DayView';
import { pnlClass, signedUsd, usd } from './format';
import { MonthView } from './MonthView';
import { SettingsDialog } from './SettingsDialog';
import { TradePanel } from './TradePanel';
import { TradeTable } from './TradeTable';

type Tab = 'month' | 'day' | 'trades';

export function App() {
  const [data, setData] = useState<JournalData | null>(null);
  const [tab, setTab] = useState<Tab>('month');
  // The month and day being looked at start on the most recent trading day.
  const [month, setMonth] = useState<{ year: number; month: number } | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // Bumped when Settings closes so an open chart reloads with new keys or time zone.
  const [settingsVersion, setSettingsVersion] = useState(0);
  const selected = data?.trades.find((t) => t.id === selectedId) ?? null;

  const load = () => window.journal.getJournal().then((d) => {
    setData(d);
    const latest = d.trades.map(tradeDay).sort().at(-1);
    if (latest) {
      setDay((cur) => cur ?? latest);
      setMonth((cur) => cur ?? { year: Number(latest.slice(0, 4)), month: Number(latest.slice(5, 7)) });
    }
  });
  useEffect(() => { load(); }, []);

  function openDay(date: string) {
    setDay(date);
    setMonth({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });
    setTab('day');
  }

  // The summary tiles follow the tab: the month shown, the day shown, or everything.
  const scoped = useMemo(() => {
    if (!data) return null;
    if (tab === 'month' && month) {
      const prefix = `${month.year}-${String(month.month).padStart(2, '0')}`;
      return summarizeTrades(data.trades.filter((t) => tradeDay(t).startsWith(prefix)));
    }
    if (tab === 'day' && day) return summarizeTrades(data.trades.filter((t) => tradeDay(t) === day));
    return data.summary;
  }, [data, tab, month, day]);

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
        <div className="brand">
          <h1>Moon Journal</h1>
          {data && data.trades.length > 0 && (
            <nav className="tabs">
              {([['month', 'Month'], ['day', 'Day'], ['trades', 'All trades']] as const).map(([id, label]) => (
                <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
              ))}
            </nav>
          )}
        </div>
        <div className="topbar-actions">
          <button onClick={() => setShowSettings(true)}>Settings</button>
          <button className="primary" onClick={importCsv}>Import thinkorswim CSV</button>
        </div>
      </header>
      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}
      {!data ? null : data.trades.length === 0 ? <EmptyState onImport={importCsv} /> : (
        <main className="view">
          {scoped && <SummaryBar s={scoped} />}
          {tab === 'month' && month && (
            <MonthView trades={data.trades} year={month.year} month={month.month} onMonthChange={(year, m) => setMonth({ year, month: m })} onOpenDay={openDay} />
          )}
          {tab === 'day' && day && (
            <DayView trades={data.trades} date={day} chartVersion={settingsVersion} onDayChange={openDay} onOpenSettings={() => setShowSettings(true)} />
          )}
          {tab === 'trades' && (
            <>
              {selected && <TradePanel key={`${selected.id}:${settingsVersion}`} trade={selected} onClose={() => setSelectedId(null)} onOpenSettings={() => setShowSettings(true)} />}
              <TradeTable trades={data.trades} selectedId={selectedId} onSelect={(id) => setSelectedId(id === selectedId ? null : id)} />
            </>
          )}
        </main>
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

function SummaryBar({ s }: { s: Summary }) {
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
