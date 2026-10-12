import { useEffect, useMemo, useReducer, useState } from 'react';
import { tradeDay } from '../core/calendar';
import { type Summary, summarizeTrades } from '../core/trades';
import type { ImportResult, JournalData } from '../shared/api';
import { DayView } from './DayView';
import { pnlClass, signedUsd, usd } from './format';
import { MonthView } from './MonthView';
import { PnlChart } from './PnlChart';
import { SettingsDialog } from './SettingsDialog';
import { TradePanel } from './TradePanel';
import { initialTabs, tabsReducer } from './tabs';
import { TradeTable } from './TradeTable';
import { YearView } from './YearView';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function App() {
  const [data, setData] = useState<JournalData | null>(null);
  const [tabs, dispatch] = useReducer(tabsReducer, new Date(), initialTabs);
  // The Home calendar starts on this month and can be paged on its own.
  const [homeMonth, setHomeMonth] = useState(() => ({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 }));
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // Bumped when Settings closes so an open chart reloads with new keys or time zone.
  const [settingsVersion, setSettingsVersion] = useState(0);
  const selected = data?.trades.find((t) => t.id === selectedId) ?? null;
  const activeDay = tabs.active.startsWith('day:') ? tabs.active.slice(4) : null;

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

  // The summary tiles follow the tab: everything, the year, the month, or the day.
  const scoped = useMemo(() => {
    if (!data) return null;
    const pick = (prefix: string) => summarizeTrades(data.trades.filter((t) => tradeDay(t).startsWith(prefix)));
    if (tabs.active === 'year') return pick(String(tabs.year));
    if (tabs.active === 'month' && tabs.month) return pick(`${tabs.month.year}-${String(tabs.month.month).padStart(2, '0')}`);
    if (activeDay) return pick(activeDay);
    return data.summary;
  }, [data, tabs, activeDay]);

  const hasTrades = !!data && data.trades.length > 0;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Moon Journal</h1>
        <div className="topbar-actions">
          <button onClick={() => setShowSettings(true)}>Settings</button>
          <button className="primary" onClick={importCsv}>Import thinkorswim CSV</button>
        </div>
      </header>
      {hasTrades && (
        <nav className="tab-bar">
          <Tab active={tabs.active === 'home'} onClick={() => dispatch({ type: 'show', tab: 'home' })}>Home</Tab>
          <Tab active={tabs.active === 'trades'} onClick={() => dispatch({ type: 'show', tab: 'trades' })}>All trades</Tab>
          <span className="tab-gap" />
          <Tab active={tabs.active === 'year'} onClick={() => dispatch({ type: 'show', tab: 'year' })}>{tabs.year}</Tab>
          {tabs.month && (
            <Tab active={tabs.active === 'month'} onClick={() => dispatch({ type: 'show', tab: 'month' })} onClose={() => dispatch({ type: 'closeMonth' })}>
              {MONTH_SHORT[tabs.month.month - 1]} {tabs.month.year}
            </Tab>
          )}
          {tabs.days.map((d) => (
            <Tab key={d} active={activeDay === d} onClick={() => dispatch({ type: 'show', tab: `day:${d}` })} onClose={() => dispatch({ type: 'closeDay', date: d })}>
              {MONTH_SHORT[Number(d.slice(5, 7)) - 1]} {Number(d.slice(8))}
            </Tab>
          ))}
        </nav>
      )}
      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}
      {!data ? null : !hasTrades ? <EmptyState onImport={importCsv} /> : (
        <main className="view">
          {scoped && <SummaryBar s={scoped} />}
          {tabs.active === 'home' && (
            <div className="home">
              <PnlChart trades={data.trades} />
              <div className="card">
                <MonthView
                  compact
                  trades={data.trades}
                  year={homeMonth.year}
                  month={homeMonth.month}
                  onMonthChange={(year, month) => setHomeMonth({ year, month })}
                  onOpenDay={(date) => dispatch({ type: 'openDayFromHome', date })}
                />
              </div>
            </div>
          )}
          {tabs.active === 'year' && (
            <YearView
              trades={data.trades}
              year={tabs.year}
              openMonth={tabs.month}
              onSelectYear={(year) => dispatch({ type: 'selectYear', year })}
              onOpenMonth={(year, month) => dispatch({ type: 'openMonth', year, month })}
            />
          )}
          {tabs.active === 'month' && tabs.month && (
            <MonthView
              trades={data.trades}
              year={tabs.month.year}
              month={tabs.month.month}
              onMonthChange={(year, month) => dispatch({ type: 'openMonth', year, month })}
              onOpenDay={(date) => dispatch({ type: 'openDay', date })}
            />
          )}
          {activeDay && (
            <DayView key={activeDay} trades={data.trades} date={activeDay} chartVersion={settingsVersion} onOpenSettings={() => setShowSettings(true)} />
          )}
          {tabs.active === 'trades' && (
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

function Tab({ active, onClick, onClose, children }: { active: boolean; onClick: () => void; onClose?: () => void; children: React.ReactNode }) {
  return (
    <div className={`tab ${active ? 'active' : ''}`} onClick={onClick}>
      <span>{children}</span>
      {onClose && (
        <button className="tab-close" aria-label="Close tab" onClick={(e) => { e.stopPropagation(); onClose(); }}>×</button>
      )}
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
