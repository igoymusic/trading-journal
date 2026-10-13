import { useEffect, useMemo, useReducer, useState } from 'react';
import { statsByDay, tradeDay } from '../core/calendar';
import type { Goals } from '../core/goals';
import { applyFilter, EMPTY_FILTER, type TradeFilter } from '../core/reports';
import { type Summary, summarizeTrades } from '../core/trades';
import type { ImportResult, JournalData } from '../shared/api';
import { DayView } from './DayView';
import { FilterBar } from './FilterBar';
import { GoalsCard } from './GoalsCard';
import { JournalContext, type JournalContextValue, TradeJournalEditor } from './journal';
import { pnlClass, signedUsd, usd } from './format';
import { MonthView } from './MonthView';
import { PnlChart } from './PnlChart';
import { ReportsView } from './ReportsView';
import { SettingsDialog } from './SettingsDialog';
import { TradePanel } from './TradePanel';
import { type ActiveTab, initialTabs, monthKey, tabsReducer } from './tabs';
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
  const [goals, setGoals] = useState<Goals>({});
  useEffect(() => { window.journal.getSettings().then((s) => setGoals(s.goals)); }, [settingsVersion]);
  // Which trades have their chart open on each day, so a Day tab remembers it while you switch tabs.
  const [openCharts, setOpenCharts] = useState<Record<string, string[]>>({});
  // Filters shared by the All trades and Reports tabs.
  const [filter, setFilter] = useState<TradeFilter>(EMPTY_FILTER);
  const filtered = useMemo(() => applyFilter(data?.trades ?? [], filter), [data, filter]);
  const filterTab = tabs.active === 'trades' || tabs.active === 'reports';
  const selected = data?.trades.find((t) => t.id === selectedId) ?? null;
  const activeDay = tabs.active.startsWith('day:') ? tabs.active.slice(4) : null;
  const activeMonth = tabs.active.startsWith('month:')
    ? { year: Number(tabs.active.slice(6, 10)), month: Number(tabs.active.slice(11, 13)) }
    : null;

  const load = () => window.journal.getJournal().then(setData);

  // Journal edits show at once and save in the background.
  const journalApi = useMemo<JournalContextValue>(() => ({
    setups: data?.setups ?? [],
    mistakes: data?.mistakes ?? [],
    saveTrade(tradeId, journal) {
      setData((d) => d && { ...d, trades: d.trades.map((t) => (t.id === tradeId ? { ...t, journal } : t)) });
      window.journal.saveTradeJournal(tradeId, journal);
    },
    saveSetups(setups) {
      const ids = new Set(setups.map((x) => x.id));
      setData((d) => d && {
        ...d,
        setups,
        trades: d.trades.map((t) => (t.journal?.setupId && !ids.has(t.journal.setupId) ? { ...t, journal: { ...t.journal, setupId: null } } : t)),
      });
      window.journal.saveSetups(setups);
    },
    saveMistakes(mistakes) {
      const ids = new Set(mistakes.map((x) => x.id));
      setData((d) => d && {
        ...d,
        mistakes,
        trades: d.trades.map((t) => (t.journal ? { ...t, journal: { ...t.journal, mistakes: t.journal.mistakes.filter((m) => ids.has(m)) } } : t)),
      });
      window.journal.saveMistakes(mistakes);
    },
  }), [data?.setups, data?.mistakes]);

  function saveDayNote(date: string, notes: string) {
    setData((d) => d && { ...d, dayNotes: { ...d.dayNotes, [date]: notes } });
    window.journal.saveDayNote(date, notes);
  }
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
    if (activeMonth) return pick(monthKey(activeMonth.year, activeMonth.month));
    if (activeDay) return pick(activeDay);
    if (tabs.active === 'trades' || tabs.active === 'reports') return summarizeTrades(filtered);
    return data.summary;
  }, [data, tabs, filtered]);

  const hasTrades = !!data && data.trades.length > 0;
  // Net P&L shown on each Month and Day tab.
  const dayPnl = useMemo(() => statsByDay(data?.trades ?? []), [data]);
  const monthPnl = (key: string) => Math.round([...dayPnl.values()].filter((d) => d.date.startsWith(key)).reduce((a, d) => a + d.netPnl, 0) * 100) / 100;

  return (
    <JournalContext.Provider value={journalApi}>
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
          <Tab active={tabs.active === 'reports'} onClick={() => dispatch({ type: 'show', tab: 'reports' })}>Reports</Tab>
          <span className="tab-gap" />
          <Tab active={tabs.active === 'year'} onClick={() => dispatch({ type: 'show', tab: 'year' })}>{tabs.year}</Tab>
          {tabs.months.map((m) => {
            const tab: ActiveTab = `month:${monthKey(m.year, m.month)}`;
            return (
              <Tab key={tab} active={tabs.active === tab} pinned={m.pinned} pnl={monthPnl(monthKey(m.year, m.month))} onClick={() => dispatch({ type: 'show', tab })}
                onPin={() => dispatch({ type: 'togglePin', tab })} onClose={() => dispatch({ type: 'closeTab', tab })}>
                {MONTH_SHORT[m.month - 1]} {m.year}
              </Tab>
            );
          })}
          {tabs.days.map((d) => {
            const tab: ActiveTab = `day:${d.date}`;
            return (
              <Tab key={tab} active={tabs.active === tab} pinned={d.pinned} pnl={dayPnl.get(d.date)?.netPnl ?? 0} onClick={() => dispatch({ type: 'show', tab })}
                onPin={() => dispatch({ type: 'togglePin', tab })} onClose={() => dispatch({ type: 'closeTab', tab })}>
                {MONTH_SHORT[Number(d.date.slice(5, 7)) - 1]} {Number(d.date.slice(8))}
              </Tab>
            );
          })}
        </nav>
      )}
      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}
      {!data ? null : !hasTrades ? <EmptyState onImport={importCsv} /> : (
        <main className="view">
          {filterTab && <FilterBar trades={data.trades} filter={filter} onChange={setFilter} shown={filtered.length} />}
          {scoped && <SummaryBar s={scoped} />}
          {tabs.active === 'home' && (
            <div className="home">
              <PnlChart trades={data.trades} />
              <div className="home-side">
              <div className="card">
                <MonthView
                  compact
                  goals={goals}
                  trades={data.trades}
                  year={homeMonth.year}
                  month={homeMonth.month}
                  onMonthChange={(year, month) => setHomeMonth({ year, month })}
                  onOpenDay={(date) => dispatch({ type: 'openDayFromHome', date })}
                />
              </div>
              <GoalsCard trades={data.trades} goals={goals} year={homeMonth.year} month={homeMonth.month} onOpenSettings={() => setShowSettings(true)} />
              </div>
            </div>
          )}
          {tabs.active === 'year' && (
            <YearView
              trades={data.trades}
              year={tabs.year}
              openMonths={tabs.months}
              onSelectYear={(year) => dispatch({ type: 'selectYear', year })}
              onOpenMonth={(year, month) => dispatch({ type: 'openMonth', year, month })}
            />
          )}
          {activeMonth && (
            <MonthView
              trades={data.trades}
              goals={goals}
              year={activeMonth.year}
              month={activeMonth.month}
              onMonthChange={(year, month) => dispatch({ type: 'openMonth', year, month })}
              onOpenDay={(date) => dispatch({ type: 'openDay', date })}
            />
          )}
          {activeDay && (
            <DayView
              key={activeDay}
              trades={data.trades}
              date={activeDay}
              dayNote={data.dayNotes[activeDay] ?? ''}
              onSaveDayNote={saveDayNote}
              chartVersion={settingsVersion}
              expanded={new Set(openCharts[activeDay] ?? [])}
              onToggle={(id) => setOpenCharts((all) => {
                const cur = all[activeDay] ?? [];
                return { ...all, [activeDay]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
              })}
              onOpenSettings={() => setShowSettings(true)}
            />
          )}
          {tabs.active === 'reports' && <ReportsView trades={filtered} />}
          {tabs.active === 'trades' && (
            <>
              {selected && (
                <div className="selected-trade">
                  <TradePanel key={`${selected.id}:${settingsVersion}`} trade={selected} onClose={() => setSelectedId(null)} onOpenSettings={() => setShowSettings(true)} />
                  <TradeJournalEditor key={selected.id} trade={selected} />
                </div>
              )}
              <TradeTable trades={filtered} selectedId={selectedId} onSelect={(id) => setSelectedId(id === selectedId ? null : id)} />
            </>
          )}
        </main>
      )}
      {showSettings && <SettingsDialog onClose={() => { setShowSettings(false); setSettingsVersion((v) => v + 1); }} />}
    </div>
    </JournalContext.Provider>
  );
}

function Tab({ active, pinned, pnl, onClick, onPin, onClose, children }: {
  active: boolean;
  pinned?: boolean;
  /** Net P&L shown after the label, colored green or red. */
  pnl?: number;
  onClick: () => void;
  onPin?: () => void;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`tab ${active ? 'active' : ''} ${pinned ? 'pinned' : ''}`} onClick={onClick}>
      <span>{children}</span>
      {pnl !== undefined && <span className={`tab-pnl ${pnlClass(pnl)}`}>{signedUsd(pnl)}</span>}
      {onPin && (
        <button className="tab-pin" title={pinned ? 'Unpin: let this tab close when you pick another month' : 'Pin: keep this tab open'}
          aria-label={pinned ? 'Unpin tab' : 'Pin tab'} onClick={(e) => { e.stopPropagation(); onPin(); }}>
          <PinIcon filled={!!pinned} />
        </button>
      )}
      {onClose && (
        <button className="tab-close" aria-label="Close tab" onClick={(e) => { e.stopPropagation(); onClose(); }}>×</button>
      )}
    </div>
  );
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6z" />
      <path d="M12 15v6" strokeLinecap="round" />
    </svg>
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
