// RT75 Pro backlight effects. The list, order and per-effect controls are qmk.top/v4's
// lightLayout for this keyboard (the shared layout `v` its RT75PRO entry points at); the ids are
// the RY5088 LightList and the English names are qmk.top's own. Brightness and speed are 0–4.
//
// Packet (setLightSetting / getLightSetting, 0x07 / 0x87):
//   [cmd, effect id, 4 - speed, brightness, option << 4 | colour mode, r, g, b, checksum]
// Writes use the Bit8 checksum: byte 8 = 255 - (sum(bytes 0..7) & 0xFF). Colour mode 7 = the
// colour in bytes 5–7, 8 = rainbow ("dazzle"); 0–6 appear only in reads (preset colours).

export const MAX_LEVEL = 4;

export const EFFECTS = [
  { id: 4, key: 'LightWave', name: 'Flowing Light', speed: true, color: true, options: ['Right', 'Left', 'Down', 'Up'], motion: 'wave' },
  { id: 5, key: 'LightRipple', name: 'Water Ripple', speed: true, color: true, motion: 'react' },
  { id: 6, key: 'LightRaindrop', name: 'Star Dots', speed: true, color: true, motion: 'twinkle' },
  { id: 7, key: 'LightSnake', name: 'Flow', speed: true, color: true, options: ['Zigzag', 'Spiral'], motion: 'wave' },
  { id: 8, key: 'LightPressAction', name: 'Shadow', speed: true, color: true, motion: 'react' },
  { id: 9, key: 'LightConverage', name: 'Layers', speed: true, color: true, motion: 'rows' },
  { id: 10, key: 'LightSineWave', name: 'Sine Wave', speed: true, color: true, motion: 'wave' },
  { id: 11, key: 'LightKaleidoscope', name: 'Color Spring', speed: true, color: true, options: ['Outward', 'Inward'], motion: 'radial' },
  { id: 19, key: 'LightPressActionOff', name: 'Silent Snow', speed: true, color: true, motion: 'react' },
  { id: 12, key: 'LightLineWave', name: 'Neon', speed: true, color: true, options: ['Right', 'Left'], motion: 'wave' },
  { id: 14, key: 'LightLaser', name: 'Radiant', speed: true, color: true, motion: 'react' },
  { id: 15, key: 'LightCircleWave', name: 'Loop', speed: true, color: true, options: ['Counter-clockwise', 'Clockwise'], motion: 'spin' },
  { id: 16, key: 'LightDazzing', name: 'Color Grid', speed: true, color: true, motion: 'twinkle' },
  { id: 17, key: 'LightRainDown', name: 'Snowfall', speed: true, color: true, motion: 'fall' },
  { id: 18, key: 'LightMeteor', name: 'Meteor', speed: true, color: true, motion: 'fall' },
  { id: 1, key: 'LightAlwaysOn', name: 'Constant Light', speed: false, color: true, motion: 'none' },
  { id: 2, key: 'LightBreath', name: 'Breathing', speed: true, color: true, motion: 'breathe' },
  { id: 3, key: 'LightNeon', name: 'Spectrum Cycle', speed: true, color: false, motion: 'cycle' },
  { id: 13, key: 'LightUserPicture', name: 'Custom', speed: false, color: false, options: ['Pattern 1', 'Pattern 2', 'Pattern 3', 'Pattern 4', 'Pattern 5'], motion: 'none' },
  // These two are driven by qmk.top's music and screen sync, so RT75 Studio shows them but doesn't set them.
  { id: 22, key: 'LightMusicFollow2', name: 'Music Sync', speed: false, color: true, options: ['Upright', 'Separate', 'Intersect'], motion: 'none', offered: false },
  { id: 21, key: 'LightScreenColor', name: 'Light Shadow', speed: false, color: false, motion: 'none', offered: false },
];
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
