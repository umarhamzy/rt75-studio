// Custom lighting patterns: per-key colours for the Custom effect (protocol-notes.md, "Custom
// lighting"). A pattern is 384 bytes, R, G, B per key-matrix slot (the keyboard stores 378).
// Saved designs live in this browser, like the macro library: { id, name, colors (384 numbers) }.

import { KEYS, LAYOUT_WIDTH } from './layout.js';

export const PATTERN_BYTES = 384;
const MAGNETIC = KEYS.filter(k => !k.knob);
const storageKey = demo => `rt75-studio-patterns-${demo ? 'demo-' : ''}2865`;

export function loadPatternLibrary(demo) {
  try {
    const list = JSON.parse(localStorage.getItem(storageKey(demo)) ?? '[]');
    return Array.isArray(list) ? list.filter(e => e && typeof e.id === 'string' && Array.isArray(e.colors) && e.colors.length === PATTERN_BYTES) : [];
  } catch { return []; }
}

export function savePatternLibrary(list, demo) {
  try { localStorage.setItem(storageKey(demo), JSON.stringify(list)); return true; } catch { return false; }
}

export const toHex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
export const fromHex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const keyColor = (colors, slot) => toHex(colors[slot * 3], colors[slot * 3 + 1], colors[slot * 3 + 2]);

export function setKeyColor(colors, slot, hex) {
  const next = [...colors];
  next.splice(slot * 3, 3, ...fromHex(hex));
  return next;
}

// Number of keys whose colour differs between two patterns.
export const keysChanged = (a, b) => MAGNETIC.filter(k => [0, 1, 2].some(i => a[k.slot * 3 + i] !== b[k.slot * 3 + i])).length;

const mix = (a, b, t) => toHex(...fromHex(a).map((v, i) => Math.round(v + (fromHex(b)[i] - v) * t)));
const hsv = h => { const f = n => { const k = (n + h / 60) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))); }; return toHex(f(5), f(3), f(1)); };
const centre = k => (k.x + k.w / 2) / LAYOUT_WIDTH;
const isWasd = k => ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(k.code);

// Quick fills. Each gets the two picked colours (a = base, b = second / highlight).
export const FILLS = [
  { id: 'solid', name: 'Solid', color: () => a => a },
  { id: 'gradient', name: 'Gradient', color: k => (a, b) => mix(a, b, centre(k)) },
  { id: 'rows', name: 'Rainbow rows', color: k => () => hsv((Math.round(k.y / 46) * 55) % 360) },
  { id: 'sweep', name: 'Rainbow sweep', color: k => () => hsv(centre(k) * 300) },
  { id: 'wasd', name: 'Highlight WASD', color: k => (a, b) => (isWasd(k) ? b : a) },
];

// Applies a fill to every key, keeping the bytes of slots that aren't keys.
export function applyFill(colors, fillId, a, b) {
  const fill = FILLS.find(f => f.id === fillId);
  let next = [...colors];
  for (const k of MAGNETIC) next = setKeyColor(next, k.slot, fill.color(k)(a, b));
  return next;
}
