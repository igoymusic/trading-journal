// Every column the trade table can show. People pick which ones appear and in what order.

import type { ReactNode } from 'react';
import { playbookScore, type Setup, type Trade } from '../core/types';
import { holdTime, pnlClass, shortDate, contractUsd, signedUsd, timeOf, usd } from './format';
import { formatR, riskReward } from '../core/rr';
import { MistakeNames, PositiveNames, RulesCell, SetupBadge, Stars } from './journal';
import type { SortValue } from './sorting';

export interface Column {
  id: string;
  label: string;
  numeric?: boolean;
  render(t: Trade): ReactNode;
  /** What the column sorts by when its header is clicked (setups are passed to sort by name). */
  sort(t: Trade, setups: Setup[]): SortValue;
  /** How to show the cell when the table is sorted and no longer grouped by day. */
  renderFlat?(t: Trade): ReactNode;
}

const contractsTraded = (t: Trade) => t.fills.reduce((a, f) => a + (f.side === (t.direction === 'LONG' ? 'BUY' : 'SELL') ? f.quantity : 0), 0);

/** Days from the entry date to expiration (0 = traded on expiration day). */
function dteAtEntry(t: Trade) {
  return Math.round((Date.parse(t.expiry) - Date.parse(t.openTime.slice(0, 10))) / 86400_000);
}

/** Net P&L as a percentage of the money paid to open (or received, for short trades). */
function returnPct(t: Trade) {
  const basis = t.avgEntry * contractsTraded(t);
  return basis ? (t.netPnl / basis) * 100 : 0;
}

export const COLUMNS: Column[] = [
  { id: 'opened', label: 'Opened', sort: (t) => t.openTime, renderFlat: (t) => `${shortDate(t.openTime.slice(0, 10))} ${timeOf(t.openTime)}`, render: (t) => timeOf(t.openTime) },
  { id: 'closed', label: 'Closed', sort: (t) => t.closeTime, renderFlat: (t) => (t.closeTime ? `${shortDate(t.closeTime.slice(0, 10))} ${timeOf(t.closeTime)}` : <span className="badge">OPEN</span>), render: (t) => (t.closeTime ? timeOf(t.closeTime) : <span className="badge">OPEN</span>) },
  { id: 'openDate', label: 'Date', sort: (t) => t.openTime, render: (t) => shortDate(t.openTime.slice(0, 10)) },
  {
    id: 'contract', label: 'Contract', sort: (t) => `${t.underlying} ${t.expiry} ${String(t.strike).padStart(8, '0')} ${t.putCall}`,
    render: (t) => <span className="contract"><b>{t.underlying}</b> {t.strike}{t.putCall === 'CALL' ? 'C' : 'P'} <span className="muted">{shortDate(t.expiry)}</span></span>,
  },
  { id: 'symbol', label: 'Symbol', sort: (t) => t.underlying, render: (t) => <b>{t.underlying}</b> },
  { id: 'strike', label: 'Strike', sort: (t) => t.strike, numeric: true, render: (t) => t.strike },
  { id: 'type', label: 'Call/Put', sort: (t) => t.putCall, render: (t) => (t.putCall === 'CALL' ? 'Call' : 'Put') },
  { id: 'expiry', label: 'Expiration', sort: (t) => t.expiry, render: (t) => shortDate(t.expiry) },
  { id: 'dte', label: 'DTE', sort: (t) => dteAtEntry(t), numeric: true, render: (t) => dteAtEntry(t) },
  { id: 'side', label: 'Side', sort: (t) => t.direction, render: (t) => (t.direction === 'LONG' ? 'Long' : 'Short') },
  { id: 'qty', label: 'Max qty', sort: (t) => t.maxContracts, numeric: true, render: (t) => t.maxContracts },
  { id: 'contracts', label: 'Contracts traded', sort: (t) => contractsTraded(t), numeric: true, render: (t) => contractsTraded(t) },
  { id: 'fills', label: 'Fills', sort: (t) => t.fills.length, numeric: true, render: (t) => t.fills.length },
  { id: 'avgEntry', label: 'Avg entry', sort: (t) => t.avgEntry, numeric: true, render: (t) => contractUsd(t.avgEntry) },
  { id: 'avgExit', label: 'Avg exit', sort: (t) => t.avgExit, numeric: true, render: (t) => (t.avgExit === undefined ? '' : contractUsd(t.avgExit)) },
  { id: 'held', label: 'Held', sort: (t) => (t.closeTime ? Date.parse(t.closeTime) - Date.parse(t.openTime) : null), numeric: true, render: (t) => holdTime(t.openTime, t.closeTime) },
  { id: 'gross', label: 'Gross P&L', sort: (t) => t.grossPnl, numeric: true, render: (t) => <span className={pnlClass(t.grossPnl)}>{signedUsd(t.grossPnl)}</span> },
  { id: 'fees', label: 'Fees', sort: (t) => t.fees, numeric: true, render: (t) => <span className="muted">{usd(t.fees)}</span> },
  { id: 'returnPct', label: 'Return %', sort: (t) => returnPct(t), numeric: true, render: (t) => { const r = returnPct(t); return <span className={pnlClass(r)}>{r > 0 ? '+' : ''}{r.toFixed(1)}%</span>; } },
  { id: 'setup', label: 'Setup', sort: (t, setups) => setups.find((x) => x.id === t.journal?.setupId)?.name, render: (t) => <SetupBadge id={t.journal?.setupId} /> },
  { id: 'positives', label: 'Did well', sort: (t) => t.journal?.positives?.length || null, render: (t) => <PositiveNames ids={t.journal?.positives} /> },
  { id: 'mistakes', label: 'Mistakes', sort: (t) => t.journal?.mistakes.length || null, render: (t) => <MistakeNames ids={t.journal?.mistakes} /> },
  { id: 'rating', label: 'Rating', sort: (t) => t.journal?.rating, render: (t) => (t.journal?.rating ? <Stars value={t.journal.rating} size="small" /> : null) },
  {
    id: 'r', label: 'R', sort: (t) => riskReward(t, t.journal)?.realizedR, numeric: true,
    render: (t) => { const r = riskReward(t, t.journal)?.realizedR; return r === undefined ? null : <span className={pnlClass(r)}>{formatR(r)}</span>; },
  },
  {
    id: 'plannedRR', label: 'Planned R:R', sort: (t) => riskReward(t, t.journal)?.plannedR, numeric: true,
    render: (t) => { const r = riskReward(t, t.journal)?.plannedR; return r === undefined ? null : `1 : ${r.toFixed(1)}`; },
  },
  {
    id: 'rules', label: 'Rules', numeric: true,
    sort: (t, setups) => { const p = playbookScore(t, setups); return p ? p.followed / p.total : null; },
    render: (t) => <RulesCell trade={t} />,
  },
  { id: 'notes', label: 'Notes', sort: (t) => t.journal?.notes.length || null, render: (t) => (t.journal?.notes ? <span className="muted" title={t.journal.notes}>✎</span> : null) },
  { id: 'net', label: 'Net P&L', sort: (t) => t.netPnl, numeric: true, render: (t) => <span className={pnlClass(t.netPnl)}>{signedUsd(t.netPnl)}</span> },
];

export const DEFAULT_COLUMNS = ['opened', 'closed', 'contract', 'setup', 'side', 'qty', 'avgEntry', 'avgExit', 'held', 'fees', 'rating', 'r', 'net'];

const byId = new Map(COLUMNS.map((c) => [c.id, c]));

/** Resolves saved column ids, dropping any that no longer exist. */
export function resolveColumns(ids: string[] | undefined): Column[] {
  const cols = (ids ?? DEFAULT_COLUMNS).map((id) => byId.get(id)).filter((c): c is Column => !!c);
  return cols.length ? cols : DEFAULT_COLUMNS.map((id) => byId.get(id)!);
}

/** Moves `id` to sit just before `beforeId` (or to the end when beforeId is null). */
export function moveColumn(ids: string[], id: string, beforeId: string | null): string[] {
  const rest = ids.filter((x) => x !== id);
  const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
  rest.splice(at < 0 ? rest.length : at, 0, id);
  return rest;
}
