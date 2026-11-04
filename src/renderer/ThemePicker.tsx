// The theme cards in Settings > Display. Picking one changes the look right away; your own colors
// stay saved with the Default theme.

import { useState } from 'react';
import { applyTheme } from './colors';
import defaultLogo from './logo.png';
import { THEMES } from './themes';

export function ThemePicker({ initial, onChange }: { initial?: string; onChange: () => void }) {
  const [picked, setPicked] = useState(initial ?? 'default');
  function pick(id: string) {
    setPicked(id);
    applyTheme(id);
    window.journal.setTheme(id === 'default' ? null : id);
    onChange();
  }
  return (
    <div className="theme-grid">
      {THEMES.map((t) => (
        <button key={t.id} className={`theme-card${picked === t.id ? ' active' : ''}`} onClick={() => pick(t.id)}
          style={{ background: t.surface.bg, color: t.surface.text, fontFamily: t.fonts.body, borderRadius: Math.min(t.radius, 12) }}>
          <span className="theme-card-art" style={{ backgroundImage: t.art ? `linear-gradient(90deg, ${t.surface.bg} 20%, transparent), url("${t.art.scene}")` : undefined }}>
            <img src={t.art?.logo ?? defaultLogo} alt="" />
          </span>
          <span className="theme-card-name" style={{ fontFamily: t.fonts.head }}>{t.name}</span>
          <span className="theme-swatches">
            {[t.surface.panel, t.colors.accent, t.colors.win, t.colors.loss].map((c, i) => <i key={i} style={{ background: c }} />)}
          </span>
        </button>
      ))}
    </div>
  );
}
