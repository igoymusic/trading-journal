// Yogi's moon, rocket and astronaut pictures, one set per theme (the Default look uses the cartoon set).
// Each spot in the app gets one picture from its list, picked at random when the app opens and again
// on every theme switch, so the art changes from time to time.
const FILES = import.meta.glob('./stickers/*.webp', { eager: true, import: 'default' }) as Record<string, string>;

/** Where pictures go, and which of the theme's pictures can show there. */
const SPOTS = {
  mascot: ['astro-hips', 'astro-thumbs', 'astro-celebrate', 'astro-flag', 'astro-ride'],
  banner: ['rocket-side', 'astro-ride', 'rocket-launch'],
  goals: ['rocket-launch', 'rocket-side', 'astro-flag'],
  calendar: ['moon-crescent', 'moon-half', 'moon-full'],
  streaks: ['rocket-trail'],
  journal: ['astro-write'],
  empty: ['astro-thumbs', 'astro-hips', 'astro-ride', 'astro-write'],
  settings: ['moon-full', 'moon-crescent', 'moon-half'],
  trade: ['rocket-trail', 'rocket-launch', 'moon-crescent'],
  // One astronaut per page at the end of All trades, Reports, a day, and the Year tab.
  trades: ['astro-hips', 'astro-thumbs', 'astro-celebrate', 'astro-flag', 'astro-ride'],
  reports: ['astro-hips', 'astro-thumbs', 'astro-celebrate', 'astro-flag', 'astro-ride'],
  day: ['astro-hips', 'astro-thumbs', 'astro-celebrate', 'astro-flag', 'astro-ride'],
  year: ['astro-hips', 'astro-thumbs', 'astro-celebrate', 'astro-flag', 'astro-ride'],
} as const;
export type Spot = keyof typeof SPOTS;

const shown: Partial<Record<Spot, string>> = {};

function file(set: string, name: string) {
  return FILES[`./stickers/${set}-${name}.webp`] ?? FILES[`./stickers/cartoon-${name}.webp`];
}

/**
 * Picks a picture for every spot and returns them as CSS variables. Where there's a choice it avoids
 * the one shown there last time and anything another spot already got this round.
 */
export function pickStickers(themeId: string): Record<string, string> {
  const set = themeId === 'default' ? 'cartoon' : themeId;
  const vars: Record<string, string> = {};
  const used = new Set<string>();
  for (const [spot, names] of Object.entries(SPOTS) as [Spot, readonly string[]][]) {
    const fresh = names.filter((n) => n !== shown[spot] && !used.has(n));
    const choices = fresh.length ? fresh : names;
    const name = choices[Math.floor(Math.random() * choices.length)];
    shown[spot] = name;
    used.add(name);
    const url = file(set, name);
    if (url) vars[`--stk-${spot}`] = `url("${url}")`;
  }
  return vars;
}
