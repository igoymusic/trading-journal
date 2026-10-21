import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { formatR, riskReward } from '../core/rr';
import type { Trade } from '../core/types';
import { COLUMNS, DEFAULT_COLUMNS, moveColumn, resolveColumns } from './columns';
import { longDate, pnlClass, signedUsd } from './format';
import { useJournal } from './journal';
import { nextSort, sortArrow, sortRows, type SortState } from './sorting';

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Trades grouped by the day they closed (open positions sit under the day they opened).
 * Clicking a header sorts by that column; across several days that makes one list without day groups.
 * With `renderDetail`, each row expands to show that content underneath when its id is in `expanded`.
 */
export function TradeTable({ trades, selectedId, onSelect, expanded, renderDetail }: {
  trades: Trade[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  expanded?: ReadonlySet<string>;
  renderDetail?: (t: Trade) => ReactNode;
}) {
  const [columnIds, setColumnIds] = useState<string[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState | null>(null);
  const { setups } = useJournal();

  useEffect(() => {
    window.journal.getSettings().then((s) => setColumnIds(resolveColumns(s.tradeColumns).map((c) => c.id)));
  }, []);

  function saveColumns(ids: string[] | null) {
    setColumnIds(ids ?? DEFAULT_COLUMNS);
    window.journal.setTradeColumns(ids);
  }

  const columns = resolveColumns(columnIds ?? undefined);
  // The day's total sits under the Net P&L column, or at the far right if that column is hidden.
  const netIndex = columns.findIndex((c) => c.id === 'net');
  const pnlAt = netIndex > 0 ? netIndex : columns.length - 1;
  // Expandable tables get a narrow arrow column on the left.
  const lead = renderDetail ? 1 : 0;
  const days = useMemo(() => {
    const byDay = new Map<string, Trade[]>();
    for (const t of trades) {
      const day = (t.closeTime ?? t.openTime).slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), t]);
    }
    return [...byDay.entries()];
  }, [trades]);
  const sortColumn = sort && columns.find((c) => c.id === sort.id);
  const sorted = useMemo(
    () => (sortColumn ? sortRows(trades, (t) => sortColumn.sort(t, setups), sort!.dir) : null),
    [trades, sortColumn, sort, setups],
  );

  // Dragging a header onto another header moves it there.
  const dragProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { setDragging(id); e.dataTransfer.effectAllowed = 'move'; },
    onDragOver: (e: React.DragEvent) => { if (dragging) e.preventDefault(); },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragging && dragging !== id) saveColumns(moveColumn(columns.map((c) => c.id), dragging, id));
      setDragging(null);
    },
    onDragEnd: () => setDragging(null),
  });

  function dayBar(day: string, dayTrades: Trade[]) {
    const dayPnl = Math.round(dayTrades.reduce((a, t) => a + t.netPnl, 0) * 100) / 100;
    const wins = dayTrades.filter((t) => t.netPnl > 0).length;
    const rs = dayTrades.map((t) => riskReward(t, t.journal)?.realizedR).filter((r): r is number => r !== undefined);
    const dayR = rs.reduce((a, r) => a + r, 0);
    return (
      <tr className="day-row" key={`bar:${day}`}>
        <td colSpan={Math.max(1, pnlAt + lead)}>
          {longDate(day)} <span className="muted">· {plural(dayTrades.length, 'trade')} · {plural(wins, 'win')}</span>
          {rs.length > 0 && <span className={pnlClass(dayR)} title={`Realized R over ${plural(rs.length, 'trade')} with a stop`}> · {formatR(dayR)}</span>}
        </td>
        <td className={`num ${pnlClass(dayPnl)}`}>{signedUsd(dayPnl)}</td>
        {pnlAt < columns.length - 1 && <td colSpan={columns.length - 1 - pnlAt} />}
      </tr>
    );
  }

  /** `flat`: shown outside its day group, so times also show the date. */
  function row(t: Trade, flat: boolean) {
    const open = !!expanded?.has(t.id);
    return (
      <Fragment key={t.id}>
        <tr className={`trade-row ${t.id === selectedId || open ? 'selected' : ''}`} onClick={() => onSelect(t.id)}>
          {lead > 0 && <td className="chev-col muted">{open ? '▾' : '▸'}</td>}
          {columns.map((c) => <td key={c.id} className={c.numeric ? 'num' : ''}>{flat && c.renderFlat ? c.renderFlat(t) : c.render(t)}</td>)}
        </tr>
        {open && renderDetail && (
          <tr className="detail-row">
            <td colSpan={columns.length + lead}>{renderDetail(t)}</td>
          </tr>
        )}
      </Fragment>
    );
  }

  return (
    <section className="trades">
      <div className="table-tools">
        <span className="muted">{plural(trades.length, 'trade')}</span>
        <div className="picker-anchor">
          <button onClick={() => setPickerOpen(!pickerOpen)}>Columns</button>
          {pickerOpen && (
            <ColumnPicker
              visible={columns.map((c) => c.id)}
              onChange={saveColumns}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      </div>
      <table>
        <thead>
          {/* A single day's summary bar sits above the column labels. Several days each get one in the list, or none when sorted. */}
          {days.length === 1 && dayBar(days[0][0], days[0][1])}
          <tr>
            {lead > 0 && <th className="chev-col" />}
            {columns.map((c) => (
              <th
                key={c.id}
                className={`sortable ${c.numeric ? 'num' : ''} ${dragging === c.id ? 'dragging' : ''} ${sort?.id === c.id ? 'sorted' : ''}`}
                title="Click to sort, drag to move"
                onClick={() => setSort(nextSort(sort, c.id))}
                {...dragProps(c.id)}
              >
                {c.label}{sortArrow(sort, c.id)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted && days.length > 1 ? sorted.map((t) => row(t, true)) : days.map(([day, dayTrades]) => (
            <Fragment key={day}>
              {days.length > 1 && dayBar(day, dayTrades)}
              {(sorted ?? dayTrades).map((t) => row(t, false))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Checklist of every column: tick to show, drag the handle to reorder. */
function ColumnPicker({ visible, onChange, onClose }: { visible: string[]; onChange: (ids: string[] | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);

  // Shown columns first, in their order, then the hidden ones.
  const ordered = [...visible, ...COLUMNS.map((c) => c.id).filter((id) => !visible.includes(id))];
  const label = new Map(COLUMNS.map((c) => [c.id, c.label]));

  function toggle(id: string) {
    if (visible.includes(id)) {
      if (visible.length > 1) onChange(visible.filter((x) => x !== id));
    } else {
      onChange([...visible, id]);
    }
  }

  return (
    <div className="column-picker" ref={ref}>
      {ordered.map((id) => (
        <div
          key={id}
          className={`picker-row ${dragging === id ? 'dragging' : ''}`}
          draggable={visible.includes(id)}
          onDragStart={() => setDragging(id)}
          onDragOver={(e) => { if (dragging && visible.includes(id)) e.preventDefault(); }}
          onDrop={() => { if (dragging && dragging !== id) onChange(moveColumn(visible, dragging, id)); setDragging(null); }}
          onDragEnd={() => setDragging(null)}
        >
          <span className={`handle ${visible.includes(id) ? '' : 'hidden'}`}>⋮⋮</span>
          <label>
            <input type="checkbox" checked={visible.includes(id)} onChange={() => toggle(id)} /> {label.get(id)}
          </label>
        </div>
      ))}
      <button className="link" onClick={() => onChange(null)}>Reset to default</button>
    </div>
  );
}
