// Custom lighting patterns: per-key colours for the Custom effect (protocol-notes.md, "Custom
// lighting"). A pattern is 384 bytes, R, G, B per key-matrix slot (the keyboard stores 378).
// Saved designs live in this browser, like the macro library: { id, name, colors (384 numbers) }.

import { KEYS, LAYOUT_WIDTH, LAYOUT_HEIGHT } from './layout.js';

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

// Designs that come with RT75 Studio: shown first in the library, and can't be deleted.
const blank = () => new Array(PATTERN_BYTES).fill(0);
export const BUILT_IN_DESIGNS = [
  { id: 'builtin-sunset', name: 'Sunset', builtIn: true, colors: applyFill(blank(), 'gradient', '#ff3b30', '#bf5af2') },
];

// Per-key colours from a picture. img: { data (RGBA), width, height }, already scaled to the
// keyboard's layout (LAYOUT_WIDTH × LAYOUT_HEIGHT pixels, or any size with the same proportions).
// Each key takes the average colour of the pixels under it (a little inset from its edges, so the
// gap between keys doesn't count). vivid: stronger, brighter colours, which LEDs need to look like
// the picture. Slots that aren't keys keep their bytes.
export function colorsFromImage(colors, img, { vivid = false } = {}) {
  const sx = img.width / LAYOUT_WIDTH, sy = img.height / LAYOUT_HEIGHT;
  let next = [...colors];
  for (const k of MAGNETIC) {
    const x0 = Math.floor((k.x + 3) * sx), x1 = Math.max(x0 + 1, Math.ceil((k.x + k.w - 3) * sx));
    const y0 = Math.floor((k.y + 3) * sy), y1 = Math.max(y0 + 1, Math.ceil((k.y + k.h - 3) * sy));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) {
        const i = (y * img.width + x) * 4, a = img.data[i + 3] / 255;
        r += img.data[i] * a; g += img.data[i + 1] * a; b += img.data[i + 2] * a; n++;
      }
    }
    let c = n ? [r / n, g / n, b / n] : [0, 0, 0];
    if (vivid) c = vividColor(c);
    next = setKeyColor(next, k.slot, toHex(...c.map(v => Math.round(Math.max(0, Math.min(255, v))))));
  }
  return next;
}

// More saturated and a little brighter: LEDs wash pastel and dark colours out.
function vividColor([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === 0) return [0, 0, 0];
  const s = Math.min(1, ((max - min) / max) * 1.4), v = 255 * Math.pow(max / 255, 0.8);
  const scale = c => v * (1 - s * (1 - (c - min) / ((max - min) || 1)));
  return max === min ? [v, v, v] : [scale(r), scale(g), scale(b)];
}
