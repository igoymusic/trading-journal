// The theme's banner scene behind the app, faded. Panels sit on top, so it shows in the open spaces.

import { activeTheme } from './colors';

export function ThemeArt() {
  if (!activeTheme().art) return null;
  return (
    <div className="theme-art" aria-hidden>
      <i className="art-scene" />
    </div>
  );
}
