import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { Trade } from '../core/types';
import { COLUMNS, DEFAULT_COLUMNS, moveColumn, resolveColumns } from './columns';
import { longDate, pnlClass, signedUsd } from './format';

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Trades grouped by the day they closed (open positions sit under the day they opened). */
export function TradeTable({ trades, selectedId, onSelect }: { trades: Trade[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [columnIds, setColumnIds] = useState<string[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

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
  const days = useMemo(() => {
    const byDay = new Map<string, Trade[]>();
    for (const t of trades) {
      const day = (t.closeTime ?? t.openTime).slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), t]);
    }
    return [...byDay.entries()];
  }, [trades]);

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
          <tr>
            {columns.map((c) => (
              <th key={c.id} className={`${c.numeric ? 'num' : ''} ${dragging === c.id ? 'dragging' : ''}`} title="Drag to move" {...dragProps(c.id)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map(([day, dayTrades]) => {
            const dayPnl = Math.round(dayTrades.reduce((a, t) => a + t.netPnl, 0) * 100) / 100;
            const wins = dayTrades.filter((t) => t.netPnl > 0).length;
            return (
              <Fragment key={day}>
                <tr className="day-row">
                  <td colSpan={Math.max(1, pnlAt)}>
                    {longDate(day)} <span className="muted">· {plural(dayTrades.length, 'trade')} · {plural(wins, 'win')}</span>
                  </td>
                  <td className={`num ${pnlClass(dayPnl)}`}>{signedUsd(dayPnl)}</td>
                  {pnlAt < columns.length - 1 && <td colSpan={columns.length - 1 - pnlAt} />}
                </tr>
                {dayTrades.map((t) => (
                  <tr key={t.id} className={`trade-row ${t.id === selectedId ? 'selected' : ''}`} onClick={() => onSelect(t.id)}>
                    {columns.map((c) => <td key={c.id} className={c.numeric ? 'num' : ''}>{c.render(t)}</td>)}
                  </tr>
                ))}
              </Fragment>
            );
          })}
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
