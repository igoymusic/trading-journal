// Every column the trade table can show. People pick which ones appear and in what order.

import type { ReactNode } from 'react';
import type { Trade } from '../core/types';
import { holdTime, pnlClass, shortDate, signedUsd, timeOf, usd } from './format';
import { formatR, riskReward } from '../core/rr';
import { MistakeNames, SetupBadge, Stars } from './journal';

export interface Column {
  id: string;
  label: string;
  numeric?: boolean;
  render(t: Trade): ReactNode;
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
  { id: 'opened', label: 'Opened', render: (t) => timeOf(t.openTime) },
  { id: 'closed', label: 'Closed', render: (t) => (t.closeTime ? timeOf(t.closeTime) : <span className="badge">OPEN</span>) },
  { id: 'openDate', label: 'Date', render: (t) => shortDate(t.openTime.slice(0, 10)) },
  {
    id: 'contract', label: 'Contract',
    render: (t) => <span className="contract"><b>{t.underlying}</b> {t.strike}{t.putCall === 'CALL' ? 'C' : 'P'} <span className="muted">{shortDate(t.expiry)}</span></span>,
  },
  { id: 'symbol', label: 'Symbol', render: (t) => <b>{t.underlying}</b> },
  { id: 'strike', label: 'Strike', numeric: true, render: (t) => t.strike },
  { id: 'type', label: 'Call/Put', render: (t) => (t.putCall === 'CALL' ? 'Call' : 'Put') },
  { id: 'expiry', label: 'Expiration', render: (t) => shortDate(t.expiry) },
  { id: 'dte', label: 'DTE', numeric: true, render: (t) => dteAtEntry(t) },
  { id: 'side', label: 'Side', render: (t) => (t.direction === 'LONG' ? 'Long' : 'Short') },
  { id: 'qty', label: 'Max qty', numeric: true, render: (t) => t.maxContracts },
  { id: 'contracts', label: 'Contracts traded', numeric: true, render: (t) => contractsTraded(t) },
  { id: 'fills', label: 'Fills', numeric: true, render: (t) => t.fills.length },
  { id: 'avgEntry', label: 'Avg entry', numeric: true, render: (t) => usd(t.avgEntry) },
  { id: 'avgExit', label: 'Avg exit', numeric: true, render: (t) => (t.avgExit === undefined ? '' : usd(t.avgExit)) },
  { id: 'held', label: 'Held', numeric: true, render: (t) => holdTime(t.openTime, t.closeTime) },
  { id: 'gross', label: 'Gross P&L', numeric: true, render: (t) => <span className={pnlClass(t.grossPnl)}>{signedUsd(t.grossPnl)}</span> },
  { id: 'fees', label: 'Fees', numeric: true, render: (t) => <span className="muted">{usd(t.fees)}</span> },
  { id: 'returnPct', label: 'Return %', numeric: true, render: (t) => { const r = returnPct(t); return <span className={pnlClass(r)}>{r > 0 ? '+' : ''}{r.toFixed(1)}%</span>; } },
  { id: 'setup', label: 'Setup', render: (t) => <SetupBadge id={t.journal?.setupId} /> },
  { id: 'mistakes', label: 'Mistakes', render: (t) => <MistakeNames ids={t.journal?.mistakes} /> },
  { id: 'rating', label: 'Rating', render: (t) => (t.journal?.rating ? <Stars value={t.journal.rating} size="small" /> : null) },
  {
    id: 'r', label: 'R', numeric: true,
    render: (t) => { const r = riskReward(t, t.journal)?.realizedR; return r === undefined ? null : <span className={pnlClass(r)}>{formatR(r)}</span>; },
  },
  {
    id: 'plannedRR', label: 'Planned R:R', numeric: true,
    render: (t) => { const r = riskReward(t, t.journal)?.plannedR; return r === undefined ? null : `1 : ${r.toFixed(1)}`; },
  },
  { id: 'notes', label: 'Notes', render: (t) => (t.journal?.notes ? <span className="muted" title={t.journal.notes}>✎</span> : null) },
  { id: 'net', label: 'Net P&L', numeric: true, render: (t) => <span className={pnlClass(t.netPnl)}>{signedUsd(t.netPnl)}</span> },
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
