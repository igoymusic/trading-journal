import { useEffect, useMemo, useReducer, useState } from 'react';
import { statsByDay, tradeDay } from '../core/calendar';
import type { Goals } from '../core/goals';
import { applyFilter, EMPTY_FILTER, type TradeFilter } from '../core/reports';
import { type Summary, summarizeTrades } from '../core/trades';
import { formatR, riskReward } from '../core/rr';
import type { Trade } from '../core/types';
import type { ImportResult, JournalData, SyncResult } from '../shared/api';
import { DayView } from './DayView';
import { FilterBar } from './FilterBar';
import { GoalsCard } from './GoalsCard';
import { JournalContext, type JournalContextValue, TradeJournalEditor } from './journal';
import { pnlClass, signedUsd, usd } from './format';
import { MonthView } from './MonthView';
import { PnlChart } from './PnlChart';
import { ReportsView } from './ReportsView';
import { AccountPicker, accountOf, accountsIn } from './AccountPicker';
import { describeSync } from './BrokersSettings';
import { applyColors } from './colors';
import { applyMarkerStyles } from './markerStyles';
import { applyIndicators } from './indicatorsStore';
import { setOptionPriceDisplay } from './format';
import { SettingsDialog } from './SettingsDialog';
import { ErrorBoundary } from './ErrorBoundary';
import { TradePanel } from './TradePanel';
import { type ActiveTab, initialTabs, monthKey, tabsReducer } from './tabs';
import { TradeTable } from './TradeTable';
import { YearView } from './YearView';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function App() {
  const [allData, setData] = useState<JournalData | null>(null);
  // Accounts left out of every number on screen, from the picker next to the app name.
  const [hiddenAccounts, setHiddenAccounts] = useState<string[]>([]);
  useEffect(() => { window.journal.getSettings().then((s) => setHiddenAccounts(s.hiddenAccounts)); }, []);
  // Your colors; charts redraw (the view remounts) when they change.
  const [colorsVersion, setColorsVersion] = useState(0);
  useEffect(() => { window.journal.getSettings().then((s) => { applyColors(s.colors); applyMarkerStyles(s.markerStyles); setOptionPriceDisplay(s.optionPriceDisplay); applyIndicators(s.indicators); setColorsVersion((v) => v + 1); }); }, []);
  const accounts = useMemo(() => accountsIn(allData?.trades ?? []), [allData]);
  const data = useMemo(() => {
    if (!allData || !hiddenAccounts.length) return allData;
    const trades = allData.trades.filter((t) => !hiddenAccounts.includes(accountOf(t)));
    return { ...allData, trades, summary: summarizeTrades(trades) };
  }, [allData, hiddenAccounts]);
  function changeHiddenAccounts(names: string[]) {
    setHiddenAccounts(names);
    window.journal.setHiddenAccounts(names);
  }
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
    positives: data?.positives ?? [],
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
    savePositives(positives) {
      const ids = new Set(positives.map((x) => x.id));
      setData((d) => d && {
        ...d,
        positives,
        trades: d.trades.map((t) => (t.journal?.positives ? { ...t, journal: { ...t.journal, positives: t.journal.positives.filter((p) => ids.has(p)) } } : t)),
      });
      window.journal.savePositives(positives);
    },
  }), [data?.setups, data?.mistakes, data?.positives]);

  function saveDayNote(date: string, notes: string) {
    setData((d) => d && { ...d, dayNotes: { ...d.dayNotes, [date]: notes } });
    window.journal.saveDayNote(date, notes);
  }
  useEffect(() => { load(); }, []);

  // Broker sync: once on the first open each day, and whenever Refresh is pressed.
  const [brokerConnected, setBrokerConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const afterSync = (result: SyncResult) => {
    if (result.added || result.retimed || result.errors.length) setNotice(describeSync(result));
    load();
  };
  async function syncBrokers(force: boolean) {
    setSyncing(true);
    try {
      const result = force ? await window.journal.syncBrokers() : await window.journal.syncBrokersIfDue();
      if (result) afterSync(result);
      if (force && result && !result.added && !result.retimed && !result.errors.length) setNotice(describeSync(result));
    } catch (err) {
      setNotice(`Broker sync failed: ${(err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);
    }
    setSyncing(false);
  }
  useEffect(() => {
    Promise.all([window.journal.brokerStatus(), window.journal.schwabStatus('trading'), window.journal.schwabStatus('marketData')]).then(([s, schwab, data]) => {
      const connected = s.connected || schwab.signedIn;
      setBrokerConnected(connected);
      if (connected) syncBrokers(false);
      // Schwab's sign-in only lasts a week, so say when it needs doing again.
      const expired = [schwab.configured && !schwab.signedIn && 'Trading', data.configured && !data.signedIn && 'Market Data'].filter(Boolean);
      if (expired.length) setNotice(`Your Schwab sign-in has run out for the ${expired.join(' and ')} app (Schwab makes it last 7 days). Open Settings to sign in again.`);
    });
  }, [settingsVersion]);

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
  // The trades the numbers across the top cover.
  const scopedTrades = useMemo(() => {
    if (!data) return null;
    const pick = (prefix: string) => data.trades.filter((t) => tradeDay(t).startsWith(prefix));
    if (tabs.active === 'year') return pick(String(tabs.year));
    if (activeMonth) return pick(monthKey(activeMonth.year, activeMonth.month));
    if (activeDay) return pick(activeDay);
    if (tabs.active === 'trades' || tabs.active === 'reports') return filtered;
    return data.trades;
  }, [data, tabs, filtered]);
  const scoped = useMemo(() => (scopedTrades ? summarizeTrades(scopedTrades) : null), [scopedTrades]);

  const hasTrades = !!data && data.trades.length > 0;
  // Net P&L shown on each Month and Day tab.
  const dayPnl = useMemo(() => statsByDay(data?.trades ?? []), [data]);
  const monthPnl = (key: string) => Math.round([...dayPnl.values()].filter((d) => d.date.startsWith(key)).reduce((a, d) => a + d.netPnl, 0) * 100) / 100;

  return (
    <JournalContext.Provider value={journalApi}>
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <h1>Moon Journal</h1>
          {accounts.length > 1 && <AccountPicker accounts={accounts} hidden={hiddenAccounts} onChange={changeHiddenAccounts} />}
        </div>
        <div className="topbar-actions">
          {brokerConnected && (
            <button disabled={syncing} onClick={() => syncBrokers(true)} title="Bring in new trades from your brokers">
              {syncing ? 'Syncing…' : '↻ Refresh'}
            </button>
          )}
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
      {!data ? null : !hasTrades ? <EmptyState onImport={importCsv} onOpenSettings={() => setShowSettings(true)} /> : (
        <main className="view" key={colorsVersion}>
          {filterTab && <FilterBar trades={data.trades} filter={filter} onChange={setFilter} shown={filtered.length} />}
          {scoped && <SummaryBar s={scoped} trades={scopedTrades ?? []} day={!!activeDay} />}
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
                  <ErrorBoundary key={`${selected.id}:${settingsVersion}`} label="this trade" onClose={() => setSelectedId(null)}>
                    <TradePanel trade={selected} onClose={() => setSelectedId(null)} onOpenSettings={() => setShowSettings(true)} />
                  </ErrorBoundary>
                  <TradeJournalEditor key={selected.id} trade={selected} />
                </div>
              )}
              <TradeTable trades={filtered} selectedId={selectedId} onSelect={(id) => setSelectedId(id === selectedId ? null : id)} />
            </>
          )}
        </main>
      )}
      {showSettings && <SettingsDialog onSynced={afterSync} onColorsChanged={() => setColorsVersion((v) => v + 1)} onClose={() => { setShowSettings(false); setSettingsVersion((v) => v + 1); }} />}
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

function EmptyState({ onImport, onOpenSettings }: { onImport: () => void; onOpenSettings: () => void }) {
  return (
    <div className="empty">
      <h2>Welcome to Moon Journal</h2>
      <h3>1. Bring in your trades</h3>
      <p>Open <b>Settings</b> and click <b>Connect a broker</b>, then sign in to your broker. Your option trades come in on their own from then on.</p>
      <button className="primary" onClick={onOpenSettings}>Open Settings</button>
      <details>
        <summary>Or import a thinkorswim file instead</summary>
        <ol>
          <li>In thinkorswim, open <b>Monitor</b> then <b>Account Statement</b>.</li>
          <li>Pick a date range and click <b>Apply</b>.</li>
          <li>Click the menu icon at the top right and choose <b>Export to File</b>.</li>
        </ol>
        <button onClick={onImport}>Choose the CSV file</button>
      </details>
      <h3>2. Turn on charts</h3>
      <p>Charts use free market data from Alpaca. Settings walks you through getting a key; it takes a couple of minutes.</p>
    </div>
  );
}

/** Realized R from the trades that have a stop: their total, and the average per trade. */
function realizedRTile(trades: Trade[]) {
  const rs = trades.map((t) => riskReward(t, t.journal)?.realizedR).filter((r): r is number => r !== undefined);
  if (!rs.length) return { label: 'Realized R', value: '—', sub: 'Add a stop to a trade to measure R' };
  const total = rs.reduce((a, r) => a + r, 0);
  return { label: 'Realized R', value: formatR(total), tone: pnlClass(total), sub: `avg ${formatR(total / rs.length)} over ${rs.length} trade${rs.length === 1 ? '' : 's'}` };
}

/** The numbers across the top. On a single day, realized R takes the place of profit factor. */
function SummaryBar({ s, trades, day }: { s: Summary; trades: Trade[]; day: boolean }) {
  const tiles: { label: string; value: string; tone?: string; sub?: string }[] = [
    { label: 'Net P&L', value: signedUsd(s.netPnl), tone: pnlClass(s.netPnl), sub: `${usd(s.fees)} fees` },
    { label: 'Win rate', value: `${(s.winRate * 100).toFixed(1)}%`, sub: `${s.wins} W / ${s.losses} L` },
    // Total won ÷ total lost. With wins and no losses it's unlimited, not zero. A single day shows R instead.
    ...(day ? [] : [s.losses === 0 && s.wins > 0
      ? { label: 'Profit factor', value: '∞', tone: 'win' }
      : { label: 'Profit factor', value: s.profitFactor.toFixed(2), tone: s.profitFactor >= 1 ? 'win' : 'loss' }]),
    realizedRTile(trades),
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
