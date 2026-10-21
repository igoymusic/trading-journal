// A small ⓘ that shows a note while you hover over it, for explanations that don't need to stay on screen.

import { type ReactNode, useState } from 'react';

export function InfoTip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: 6, verticalAlign: 'middle' }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span aria-label="More info" style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: '50%',
        border: '1px solid var(--muted)', color: 'var(--muted)', fontSize: 10, fontStyle: 'italic', fontFamily: 'Georgia, serif', cursor: 'help', lineHeight: 1,
      }}>i</span>
      {open && (
        <span role="tooltip" style={{
          position: 'absolute', top: 20, left: -8, width: 260, zIndex: 20, padding: '8px 10px', borderRadius: 4,
          background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, fontWeight: 400,
          lineHeight: 1.4, textTransform: 'none', letterSpacing: 'normal', whiteSpace: 'normal', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>{children}</span>
      )}
    </span>
  );
}
