// A small ⓘ that shows a note while you hover over it, for explanations that don't need to stay on screen.

import { type ReactNode, useState } from 'react';

export function InfoTip({ children }: { children: ReactNode }) {
  // Placed on the page itself, so a scrolling side panel can't cut it off; kept inside the window.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: 6, verticalAlign: 'middle' }}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 280)) });
      }} onMouseLeave={() => setAt(null)}>
      <span aria-label="More info" style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: '50%',
        border: '1px solid var(--muted)', color: 'var(--muted)', fontSize: 10, fontStyle: 'italic', fontFamily: 'Georgia, serif', cursor: 'help', lineHeight: 1,
      }}>i</span>
      {at && (
        <span role="tooltip" style={{
          position: 'fixed', top: at.top, left: at.left, width: 260, zIndex: 1000, padding: '8px 10px', borderRadius: 4,
          background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, fontWeight: 400,
          lineHeight: 1.4, textTransform: 'none', letterSpacing: 'normal', whiteSpace: 'normal', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>{children}</span>
      )}
    </span>
  );
}
