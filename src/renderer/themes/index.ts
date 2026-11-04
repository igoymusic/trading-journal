// The looks you can pick in Settings. Each theme brings its own colors, fonts and art (cut from the
// Moon Journal banners). "Default" is the original look and keeps the colors you set yourself.

import type { ColorScheme } from '../../shared/api';
import type { MarkerKind } from '../../core/markerStyles';
import './fonts';

export type ThemeId = 'default' | 'cartoon' | 'minimal' | 'pro' | 'retro' | 'neon' | 'gold' | 'deco' | 'pixel' | 'ink';

/** The screen's colors, set as CSS variables. */
export interface Surface {
  bg: string;
  panel: string;
  panel2: string;
  border: string;
  /** Lines between table rows. */
  line: string;
  hover: string;
  selected: string;
  text: string;
  muted: string;
  /** Text on the accent color (buttons that are on). */
  onAccent: string;
  /** Chart tooltips. */
  tip: string;
  /** Filled rating stars, and the empty ones. */
  star: string;
  starOff: string;
  /** Middling scores (between good and bad). */
  warn: string;
}

/** How the entry and exit arrows and their labels are drawn on trade charts. */
export interface MarkerLook {
  /** Label corner rounding. */
  radius: number;
  /** Canvas font for the label text. */
  font: string;
  /** A thin outline around arrows and labels. */
  outline?: string;
  /** A soft glow (neon). */
  glow?: boolean;
  /** Stair-stepped arrows (pixel art). */
  pixel?: boolean;
}

export interface Theme {
  id: ThemeId;
  name: string;
  light?: boolean;
  surface: Surface;
  /** Profit, loss, buttons, chart lines, and stop and target colors. Candles keep your own colors. */
  colors: Omit<ColorScheme, 'candleUp' | 'candleDown'>;
  /** Colors for chart slices and bars that are just categories (setups, call vs put...). */
  series: string[];
  markers: Record<MarkerKind, string>;
  markerLook: MarkerLook;
  fonts: { body: string; head: string };
  /** Corner rounding of panels and buttons, in pixels. */
  radius: number;
  /** Little decorations: a star or sparkle in this theme's style, as an SVG drawing in one color. */
  ornament: (color: string) => string;
  /** The art, from the banners: the whole scene, the moon, a rocket (or star), moon phases, and the ground. */
  art?: { scene: string; moon: string; rocket: string; phases: string; ground: string; logo: string };
}

const art = import.meta.glob('./art/*', { eager: true, import: 'default' }) as Record<string, string>;
const artFor = (id: string) => {
  const get = (name: string) => art[`./art/${id}-${name}.webp`] ?? art[`./art/${id}-${name}.png`];
  return { scene: get('scene'), moon: get('moon'), rocket: get('rocket'), phases: get('phases'), ground: get('ground'), logo: get('logo') };
};

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`;
/** An n-pointed star with these outer and inner sizes (out of 12). */
const starPoints = (n: number, outer: number, inner: number) => Array.from({ length: n * 2 }, (_, i) => {
  const r = i % 2 ? inner : outer;
  const a = (Math.PI * i) / n - Math.PI / 2;
  return `${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`;
}).join(' ');

const ORNAMENTS = {
  star5: (c: string) => svg(`<polygon points="${starPoints(5, 11, 4.6)}" fill="${c}" stroke="#00000055" stroke-width="0.8" stroke-linejoin="round"/>`),
  sparkle: (c: string) => svg(`<path d="M12 1C13 9 15 11 23 12C15 13 13 15 12 23C11 15 9 13 1 12C9 11 11 9 12 1Z" fill="${c}"/>`),
  thin8: (c: string) => svg(`<polygon points="${starPoints(8, 11.5, 2.2)}" fill="${c}"/>`),
  burst: (c: string) => svg(`<polygon points="${starPoints(12, 11.5, 5)}" fill="${c}"/>`),
  glow: (c: string) => svg(`<g stroke="${c}" stroke-linecap="round"><path d="M12 1V23M1 12H23" stroke-width="1.4"/><path d="M5 5L19 19M19 5L5 19" stroke-width="0.8"/></g><circle cx="12" cy="12" r="2" fill="${c}"/>`),
  rays: (c: string) => svg(`<g stroke="${c}" stroke-width="0.9" stroke-linecap="round">${Array.from({ length: 12 }, (_, i) => {
    const a = (Math.PI * i) / 6; const r = i % 2 ? 7 : 11;
    return `<line x1="12" y1="12" x2="${(12 + r * Math.cos(a)).toFixed(2)}" y2="${(12 + r * Math.sin(a)).toFixed(2)}"/>`;
  }).join('')}</g><circle cx="12" cy="12" r="1.6" fill="${c}"/>`),
  fan: (c: string) => svg(`<g fill="none" stroke="${c}" stroke-width="1"><path d="M2 20A10 10 0 0 1 22 20Z"/><path d="M6 20A6 6 0 0 1 18 20"/>${[30, 60, 90, 120, 150].map((d) => {
    const a = (Math.PI * d) / 180; return `<line x1="12" y1="20" x2="${(12 - 10 * Math.cos(a)).toFixed(2)}" y2="${(20 - 10 * Math.sin(a)).toFixed(2)}"/>`;
  }).join('')}</g>`),
  pixel: (c: string) => svg(`<g fill="${c}" shape-rendering="crispEdges"><rect x="10" y="2" width="4" height="20"/><rect x="2" y="10" width="20" height="4"/><rect x="6" y="6" width="4" height="4" opacity=".6"/><rect x="14" y="14" width="4" height="4" opacity=".6"/><rect x="14" y="6" width="4" height="4" opacity=".6"/><rect x="6" y="14" width="4" height="4" opacity=".6"/></g>`),
  inked: (c: string) => svg(`<g stroke="${c}" stroke-width="1.3" stroke-linecap="round"><path d="M12 2.5L12.3 21.5"/><path d="M2.8 11.6L21.4 12.4"/><path d="M5.2 5.1L18.6 18.9"/><path d="M18.9 5.4L5.3 18.6"/></g><circle cx="12" cy="12" r="1.8" fill="${c}"/>`),
};

const SYSTEM = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const THEMES: Theme[] = [
  {
    id: 'default', name: 'Default',
    surface: {
      bg: '#131722', panel: '#1e222d', panel2: '#2a2e39', border: '#363a45', line: '#22262f', hover: '#1a1e28', selected: '#1c2333',
      text: '#d1d4dc', muted: '#787b86', onAccent: '#ffffff', tip: '#0f121a', star: '#fdd835', starOff: '#4a4e59', warn: '#c98500',
    },
    // Filled in from your own colors (see applyTheme).
    colors: { win: '#26a69a', loss: '#ef5350', accent: '#2962ff', chart: '#4c9aff', entry: '#2962ff', exit: '#ff9800', stop: '#ef5350', target: '#26a69a' },
    series: ['#3987e5', '#d95926', '#9085e9', '#c98500', '#d55181'],
    markers: { entry: '#2962ff', profit: '#26a69a', loss: '#ef5350' },
    markerLook: { radius: 3, font: `11px ${SYSTEM}` },
    fonts: { body: SYSTEM, head: SYSTEM },
    radius: 4,
    ornament: ORNAMENTS.sparkle,
  },
  {
    id: 'cartoon', name: 'Cartoon',
    surface: {
      bg: '#1e2558', panel: '#283070', panel2: '#333c85', border: '#4652a0', line: '#2f3878', hover: '#2d3679', selected: '#39438f',
      text: '#fbf3df', muted: '#aab1de', onAccent: '#1e2558', tip: '#161c47', star: '#f6c945', starOff: '#4a54a0', warn: '#f6a945',
    },
    colors: { win: '#5fd08f', loss: '#ff6b4a', accent: '#f6c945', chart: '#f6c945', entry: '#7fb3ff', exit: '#ff8a5c', stop: '#ff6b4a', target: '#5fd08f' },
    series: ['#f6c945', '#7fb3ff', '#ff8a5c', '#5fd08f', '#c79bff'],
    markers: { entry: '#7fb3ff', profit: '#5fd08f', loss: '#ff6b4a' },
    markerLook: { radius: 9, font: "700 11px Nunito, sans-serif", outline: '#141a45' },
    fonts: { body: "Nunito, sans-serif", head: "Fredoka, Nunito, sans-serif" },
    radius: 12,
    ornament: ORNAMENTS.star5,
    art: artFor('cartoon'),
  },
  {
    id: 'minimal', name: 'Minimalist', light: true,
    surface: {
      bg: '#efebf4', panel: '#fbfaff', panel2: '#f0edf7', border: '#dcd6ea', line: '#e8e4f1', hover: '#f4f1fb', selected: '#e6e1f5',
      text: '#2b2d5c', muted: '#7c7ea8', onAccent: '#ffffff', tip: '#ffffff', star: '#e9a86f', starOff: '#d5d0e4', warn: '#d39a3c',
    },
    colors: { win: '#2f9e8a', loss: '#e06c50', accent: '#5d60a8', chart: '#5d60a8', entry: '#5d60a8', exit: '#e9a27a', stop: '#e06c50', target: '#2f9e8a' },
    series: ['#5d60a8', '#e9a27a', '#2f9e8a', '#a58cc8', '#e06c50'],
    // Trade charts stay dark, so the entry marker is a lighter indigo than the buttons.
    markers: { entry: '#9497e6', profit: '#2fb59c', loss: '#e8735a' },
    markerLook: { radius: 10, font: "600 11px Manrope, sans-serif" },
    fonts: { body: "Manrope, sans-serif", head: "Manrope, sans-serif" },
    radius: 10,
    ornament: ORNAMENTS.sparkle,
    art: artFor('minimal'),
  },
  {
    id: 'pro', name: 'Professional',
    surface: {
      bg: '#111833', panel: '#18213f', panel2: '#212c50', border: '#2f3b62', line: '#1d2647', hover: '#1c2547', selected: '#25315a',
      text: '#e8e3d6', muted: '#8b94b3', onAccent: '#ffffff', tip: '#0d1329', star: '#f1d29a', starOff: '#3a4568', warn: '#d9a95b',
    },
    colors: { win: '#4aa8d8', loss: '#e07a62', accent: '#5f86c4', chart: '#f1d29a', entry: '#f1d29a', exit: '#e07a62', stop: '#e07a62', target: '#4aa8d8' },
    series: ['#6f93c9', '#f1d29a', '#e07a62', '#7cc1b4', '#a79bd4'],
    markers: { entry: '#f1d29a', profit: '#4aa8d8', loss: '#e07a62' },
    markerLook: { radius: 2, font: "500 11px 'IBM Plex Sans', sans-serif" },
    fonts: { body: "'IBM Plex Sans', sans-serif", head: "'Source Serif 4', Georgia, serif" },
    radius: 4,
    ornament: ORNAMENTS.thin8,
    art: artFor('pro'),
  },
  {
    id: 'retro', name: 'Retro',
    surface: {
      bg: '#2a2731', panel: '#34303b', panel2: '#3f3a47', border: '#57505c', line: '#3a3541', hover: '#3a3642', selected: '#474150',
      text: '#f1e4c6', muted: '#b0a288', onAccent: '#2a2731', tip: '#221f28', star: '#e3884a', starOff: '#57505c', warn: '#e3b04a',
    },
    colors: { win: '#5bb3a5', loss: '#e5533d', accent: '#e3884a', chart: '#e3884a', entry: '#f1e4c6', exit: '#e3884a', stop: '#e5533d', target: '#5bb3a5' },
    series: ['#e3884a', '#5bb3a5', '#f1e4c6', '#c96a8a', '#8fa7c9'],
    markers: { entry: '#f1e4c6', profit: '#5bb3a5', loss: '#e5533d' },
    markerLook: { radius: 10, font: "700 11px 'Work Sans', sans-serif", outline: '#2a2731' },
    fonts: { body: "'Work Sans', sans-serif", head: "'Alfa Slab One', Georgia, serif" },
    radius: 8,
    ornament: ORNAMENTS.burst,
    art: artFor('retro'),
  },
  {
    id: 'neon', name: 'Neon',
    surface: {
      bg: '#0c0a1d', panel: '#141130', panel2: '#1d1844', border: '#352a6e', line: '#1a1640', hover: '#191538', selected: '#261f55',
      text: '#ece9ff', muted: '#8e88c4', onAccent: '#0c0a1d', tip: '#0a0818', star: '#2fe0ff', starOff: '#352a6e', warn: '#ffd84f',
    },
    colors: { win: '#39f5b0', loss: '#ff5a4f', accent: '#2fe0ff', chart: '#2fe0ff', entry: '#ff4fd8', exit: '#ffd84f', stop: '#ff5a4f', target: '#39f5b0' },
    series: ['#2fe0ff', '#ff4fd8', '#39f5b0', '#ffd84f', '#9f7bff'],
    markers: { entry: '#ff4fd8', profit: '#39f5b0', loss: '#ff5a4f' },
    markerLook: { radius: 4, font: "600 11px 'Exo 2', sans-serif", glow: true },
    fonts: { body: "'Exo 2', sans-serif", head: "Orbitron, 'Exo 2', sans-serif" },
    radius: 6,
    ornament: ORNAMENTS.glow,
    art: artFor('neon'),
  },
  {
    id: 'gold', name: 'Gold',
    surface: {
      bg: '#0f1b28', panel: '#142232', panel2: '#1b2c40', border: '#4a4636', line: '#1a2838', hover: '#182839', selected: '#223349',
      text: '#efe2c6', muted: '#a09780', onAccent: '#0f1b28', tip: '#0b1520', star: '#d8b679', starOff: '#3a3f47', warn: '#d8b679',
    },
    colors: { win: '#67c2a3', loss: '#e07b5c', accent: '#d8b679', chart: '#d8b679', entry: '#d8b679', exit: '#e07b5c', stop: '#e07b5c', target: '#67c2a3' },
    series: ['#d8b679', '#67c2a3', '#e07b5c', '#8fb0d8', '#c9a0c8'],
    markers: { entry: '#d8b679', profit: '#67c2a3', loss: '#e07b5c' },
    markerLook: { radius: 2, font: "600 11px 'Nunito Sans', sans-serif", outline: '#d8b679' },
    fonts: { body: "'Nunito Sans', sans-serif", head: "Cinzel, Georgia, serif" },
    radius: 2,
    ornament: ORNAMENTS.rays,
    art: artFor('gold'),
  },
  {
    id: 'deco', name: 'Art deco',
    surface: {
      bg: '#1c1b21', panel: '#25242b', panel2: '#302e37', border: '#6b5c45', line: '#2d2b33', hover: '#2b2a31', selected: '#36343e',
      text: '#efe4cf', muted: '#a69c88', onAccent: '#1c1b21', tip: '#16151a', star: '#d7b88e', starOff: '#45413b', warn: '#d7b88e',
    },
    colors: { win: '#5ea893', loss: '#d9714f', accent: '#d7b88e', chart: '#d7b88e', entry: '#d7b88e', exit: '#d9714f', stop: '#d9714f', target: '#5ea893' },
    series: ['#d7b88e', '#5ea893', '#d9714f', '#7d9cb8', '#b08cb0'],
    markers: { entry: '#d7b88e', profit: '#5ea893', loss: '#d9714f' },
    markerLook: { radius: 0, font: "500 11px Jost, sans-serif", outline: '#1c1b21' },
    fonts: { body: "Jost, sans-serif", head: "'Poiret One', Jost, sans-serif" },
    radius: 0,
    ornament: ORNAMENTS.fan,
    art: artFor('deco'),
  },
  {
    id: 'pixel', name: 'Pixel',
    surface: {
      bg: '#221f45', panel: '#2c2957', panel2: '#38356a', border: '#55519a', line: '#312e60', hover: '#302d5e', selected: '#3d3a74',
      text: '#f7e7cf', muted: '#aaa4d8', onAccent: '#221f45', tip: '#1a1838', star: '#f3c38c', starOff: '#4a4688', warn: '#f3c38c',
    },
    colors: { win: '#6fd19a', loss: '#f06a5a', accent: '#f3c38c', chart: '#f3c38c', entry: '#7fb0e8', exit: '#e88fa0', stop: '#f06a5a', target: '#6fd19a' },
    series: ['#f3c38c', '#7fb0e8', '#e88fa0', '#6fd19a', '#b49af0'],
    markers: { entry: '#7fb0e8', profit: '#6fd19a', loss: '#f06a5a' },
    markerLook: { radius: 0, font: "500 12px 'Pixelify Sans', monospace", pixel: true, outline: '#1a1838' },
    fonts: { body: "'Pixelify Sans', monospace", head: "'Press Start 2P', monospace" },
    radius: 0,
    ornament: ORNAMENTS.pixel,
    art: artFor('pixel'),
  },
  {
    id: 'ink', name: 'Ink', light: true,
    surface: {
      bg: '#ece6d8', panel: '#f7f3e9', panel2: '#ebe5d6', border: '#b9b1a0', line: '#ddd6c6', hover: '#f0eadc', selected: '#e4dccb',
      text: '#1e1c19', muted: '#6d675c', onAccent: '#f7f3e9', tip: '#f7f3e9', star: '#2a2723', starOff: '#c9c1b0', warn: '#a87a2a',
    },
    colors: { win: '#2e7d62', loss: '#c2462c', accent: '#2a2723', chart: '#2a2723', entry: '#2a2723', exit: '#9a7a4a', stop: '#c2462c', target: '#2e7d62' },
    series: ['#2a2723', '#2e7d62', '#c2462c', '#5a6f9a', '#9a7a4a'],
    // Trade charts stay dark, so the markers use lighter inks than the page.
    markers: { entry: '#efe8d8', profit: '#45a985', loss: '#e0603f' },
    markerLook: { radius: 3, font: "600 11px Lora, Georgia, serif", outline: '#1e1c19' },
    fonts: { body: "Lora, Georgia, serif", head: "'Libre Baskerville', Georgia, serif" },
    radius: 3,
    ornament: ORNAMENTS.inked,
    art: artFor('ink'),
  },
];

export const themeById = (id: string | undefined) => THEMES.find((t) => t.id === id) ?? THEMES[0];
