import { useEffect, useRef, useState } from 'react';
import type { Trade } from '../core/types';

/** What trades without a known account (older thinkorswim imports) are listed as. */
export const NO_ACCOUNT = 'thinkorswim import';

export const accountOf = (t: Trade) => t.account ?? NO_ACCOUNT;

/** Every account in the journal, most-traded first. */
export function accountsIn(trades: Trade[]): string[] {
  const counts = new Map<string, number>();
  for (const t of trades) counts.set(accountOf(t), (counts.get(accountOf(t)) ?? 0) + 1);
  return [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
}

/** Dropdown next to the app name: which accounts the journal's numbers include. */
export function AccountPicker({ accounts, hidden, onChange }: { accounts: string[]; hidden: string[]; onChange: (hidden: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const shown = accounts.filter((a) => !hidden.includes(a));
  const label = shown.length === accounts.length ? 'All accounts'
    : shown.length === 0 ? 'No accounts'
    : shown.length === 1 ? shown[0]
    : `${shown.length} of ${accounts.length} accounts`;
  const toggle = (a: string) => onChange(hidden.includes(a) ? hidden.filter((h) => h !== a) : [...hidden, a]);

  return (
    <div className="account-picker" ref={box}>
      <button onClick={() => setOpen(!open)} title="Choose which accounts to include">{label} ▾</button>
      {open && (
        <div className="account-menu">
          <div className="account-menu-actions">
            <button onClick={() => onChange([])}>Select all</button>
            <button onClick={() => onChange([...accounts])}>Deselect all</button>
          </div>
          {accounts.map((a) => (
            <label key={a}>
              <input type="checkbox" checked={!hidden.includes(a)} onChange={() => toggle(a)} />
              {a}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
