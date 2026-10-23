// Backlight settings. The effects (list, order, per-effect controls) and the brightness and speed
// range are the model's (src/models/).
//
// Packet (setLightSetting / getLightSetting, 0x07 / 0x87):
//   [cmd, effect id, 4 - speed, brightness, option << 4 | colour mode, r, g, b, checksum]
// Writes use the Bit8 checksum: byte 8 = 255 - (sum(bytes 0..7) & 0xFF). Colour mode 7 = the
// colour in bytes 5–7, 8 = rainbow ("dazzle"); 0–6 appear only in reads (preset colours).

import { MODEL } from './model.js';

export const MAX_LEVEL = MODEL.lighting.maxLevel;
export const EFFECTS = MODEL.lighting.effects;
export const effectById = id => EFFECTS.find(e => e.id === id);
export const isOffered = e => !!e && e.offered !== false;

const CUSTOM = 13, MUSIC = 22, SCREEN = 21;
const NORMAL = 7, DAZZLE = 8;
// Colours behind the read-only modes 0–6 (qmk.top COMMONCOLOR).
export const PRESET_COLORS = [0xff0000, 0xff8000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff];
// qmk.top writes white as FAFFFA and shows FAFFFA as white.
const WHITE = 0xffffff, WHITE_ON_WIRE = 0xfafffa;

const rgbOf = n => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

// Reply to 0x87 → { effect, speed, brightness, option, rainbow, color }, or undefined.
export function decodeLighting(r) {
  if (!r || r[0] !== 0x87) return undefined;
  const effect = r[1], nib = r[4] & 15;
  let color = (r[5] << 16) | (r[6] << 8) | r[7];
  if (effect !== MUSIC && effect !== SCREEN && nib < PRESET_COLORS.length) color = PRESET_COLORS[nib];
  if (color === WHITE_ON_WIRE) color = WHITE;
  return {
    effect,
    speed: Math.max(0, MAX_LEVEL - r[2]),
    brightness: r[3],
    option: r[4] >> 4,
    rainbow: effect === MUSIC || effect === SCREEN ? nib === 0 : nib === DAZZLE,
    color,
  };
}

// Packet bytes 0..7 for a lighting setting (the checksum is added by the caller).
export function lightingBytes(l) {
  const b = [0x07, l.effect, MAX_LEVEL - l.speed, l.brightness, 0, 0, 0, 0];
  if (l.effect === CUSTOM) {
    b[4] = l.option << 4;
    b.splice(5, 3, 0, 200, 200);
  } else {
    // Effects without colour controls (Spectrum Cycle) go out as mode 7, as in qmk.top.
    const rainbow = l.rainbow && (effectById(l.effect)?.color ?? true);
    b[4] = (l.option << 4) | (rainbow ? DAZZLE : NORMAL);
    b.splice(5, 3, ...rgbOf(l.color === WHITE ? WHITE_ON_WIRE : l.color));
  }
  return b;
}

// Returns the setting normalised for an effect: options in range, speed 0 where it has none.
// The colour choice is kept (and ignored) on effects without colour, so it survives switching.
export function normalizeLighting(l) {
  const e = effectById(l.effect);
  const out = { ...l };
  if (!e) return out;
  if (!e.options || l.option >= e.options.length) out.option = 0;
  if (!e.speed) out.speed = 0;
  return out;
}

// Fields that matter when comparing two settings for this effect.
export function lightingFields(l) {
  const e = effectById(l.effect);
  const f = ['effect', 'brightness'];
  if (!e || e.speed) f.push('speed');
  if (!e || e.options) f.push('option');
  if (!e || e.color) f.push('rainbow');
  if ((!e || e.color) && !l.rainbow) f.push('color');
  return f;
}

// Fields of b that differ from a. A field the old effect didn't use counts as changed.
export function lightingDiff(a, b) {
  if (!a || !b) return [];
  const had = new Set(lightingFields(a));
  return lightingFields(b).filter(f => !had.has(f) || a[f] !== b[f]);
}

export const hex = n => '#' + n.toString(16).padStart(6, '0');
