// The theme's art behind the app: the banner scene, a big moon in one corner, a rocket in the
// other, the ground along the bottom, and little stars scattered around. Panels sit on top, so it
// shows in the open spaces.

import { activeTheme } from './colors';

// Where the little stars go (percent of the window) and how big they are, so they land the same
// way every time.
const STARS = [
  [6, 14, 14], [22, 9, 9], [37, 27, 7], [48, 12, 12], [63, 22, 8], [78, 8, 13], [91, 31, 9], [14, 46, 8], [31, 61, 12],
  [55, 49, 7], [71, 58, 10], [86, 69, 8], [9, 79, 11], [44, 84, 9], [62, 91, 7], [96, 52, 12],
];

export function ThemeArt() {
  if (!activeTheme().art) return null;
  return (
    <div className="theme-art" aria-hidden>
      <i className="art-scene" />
      <i className="art-ground" />
      <i className="art-moon" />
      <i className="art-rocket" />
      {STARS.map(([x, y, size], i) => (
        <i key={i} className="art-star" style={{ left: `${x}%`, top: `${y}%`, width: size, height: size, opacity: 0.35 + (i % 4) * 0.12 }} />
      ))}
    </div>
  );
}
