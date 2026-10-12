import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Trade } from '../core/types';
import type { ImportResult, JournalData } from '../shared/api';
import { holdTime, longDate, pnlClass, shortDate, signedUsd, timeOf, usd } from './format';

export function App() {
  const [data, setData] = useState<JournalData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
        <button className="primary" onClick={importCsv}>Import thinkorswim CSV</button>
      </header>
      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}
      {!data ? null : data.trades.length === 0 ? <EmptyState onImport={importCsv} /> : (
        <>
          <SummaryBar data={data} />
          <TradeList trades={data.trades} />
        </>
      )}
    </div>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
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

/** Trades grouped by the day they closed (open positions sit under the day they opened). */
function TradeList({ trades }: { trades: Trade[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const days = useMemo(() => {
    const byDay = new Map<string, Trade[]>();
    for (const t of trades) {
      const day = (t.closeTime ?? t.openTime).slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), t]);
    }
    return [...byDay.entries()];
  }, [trades]);

  return (
    <section className="trades">
      <table>
        <thead>
          <tr>
            <th>Opened</th><th>Closed</th><th>Contract</th><th>Side</th><th className="num">Qty</th>
            <th className="num">Avg entry</th><th className="num">Avg exit</th><th className="num">Held</th>
            <th className="num">Fees</th><th className="num">Net P&L</th>
          </tr>
        </thead>
        <tbody>
          {days.map(([day, dayTrades]) => {
            const dayPnl = dayTrades.reduce((a, t) => a + t.netPnl, 0);
            const wins = dayTrades.filter((t) => t.netPnl > 0).length;
            return (
              <Fragment key={day}>
                <tr className="day-row">
                  <td colSpan={9}>{longDate(day)} <span className="muted">· {plural(dayTrades.length, 'trade')} · {plural(wins, 'win')}</span></td>
                  <td className={`num ${pnlClass(dayPnl)}`}>{signedUsd(Math.round(dayPnl * 100) / 100)}</td>
                </tr>
                {dayTrades.map((t) => (
                  <Fragment key={t.id}>
                    <tr className="trade-row" onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
                      <td>{timeOf(t.openTime)}</td>
                      <td>{t.closeTime ? timeOf(t.closeTime) : <span className="badge">OPEN</span>}</td>
                      <td className="contract">
                        <b>{t.underlying}</b> {t.strike}{t.putCall === 'CALL' ? 'C' : 'P'} <span className="muted">{shortDate(t.expiry)}</span>
                      </td>
                      <td>{t.direction === 'LONG' ? 'Long' : 'Short'}</td>
                      <td className="num">{t.maxContracts}</td>
                      <td className="num">{usd(t.avgEntry)}</td>
                      <td className="num">{t.avgExit === undefined ? '' : usd(t.avgExit)}</td>
                      <td className="num">{holdTime(t.openTime, t.closeTime)}</td>
                      <td className="num muted">{usd(t.fees)}</td>
                      <td className={`num ${pnlClass(t.netPnl)}`}>{signedUsd(t.netPnl)}</td>
                    </tr>
                    {expanded === t.id && (
                      <tr className="fills-row">
                        <td colSpan={10}>
                          {t.fills.map((f) => (
                            <div className="fill" key={f.id}>
                              <span>{f.execTime.replace('T', ' ')}</span>
                              <span className={f.side === 'BUY' ? 'win' : 'loss'}>{f.side === 'BUY' ? 'Bought' : 'Sold'} {f.quantity}</span>
                              <span>@ {usd(f.price * 100)}</span>
                              <span className="muted">{f.orderType === 'EXPIRED' ? 'Expired worthless' : `${f.orderType} ${f.spread !== 'SINGLE' ? f.spread : ''}`}</span>
                              <span className="muted">fees {usd(f.fees)}</span>
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
