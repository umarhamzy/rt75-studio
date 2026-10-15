// Key actions: the 4 bytes stored per key in the key matrix and Fn layers.
// Encodings come from qmk.top/v4 (gi.configToMatrix / changeArrToConfig and its K0 / h5 tables):
//   [0, 0, 0, 0] or [0, 0, 3, 0]  disabled
//   [0, a, b, c]                   key combo: up to three HID codes (modifiers are HID 224–231),
//                                  e.g. A = [0,0,4,0], Win+L = [0,0,227,15], Ctrl+Shift+Esc = [0,224,225,41]
//   [1, 0, code, x]                mouse button / wheel
//   [2|3|6|8|10|13|14|18|19, …]   named functions (FUNCTIONS below)
//   [9, mode, index, 0]            macro
//   [24, tap, hold, time/10]       mod-tap

export const HID_NAMES = {
  40: 'Enter', 41: 'Esc', 42: 'Backspace', 43: 'Tab', 44: 'Space', 45: '-', 46: '=', 47: '[', 48: ']', 49: '\\',
  50: '#', 51: ';', 52: "'", 53: '`', 54: ',', 55: '.', 56: '/', 57: 'Caps Lock', 70: 'Print Screen', 71: 'Scroll Lock',
  72: 'Pause', 73: 'Insert', 74: 'Home', 75: 'Page Up', 76: 'Delete', 77: 'End', 78: 'Page Down', 79: 'Right', 80: 'Left',
  81: 'Down', 82: 'Up', 83: 'Num Lock', 84: 'Num /', 85: 'Num *', 86: 'Num -', 87: 'Num +', 88: 'Num Enter',
  99: 'Num .', 100: 'ISO \\', 101: 'Menu',
  224: 'Left Ctrl', 225: 'Left Shift', 226: 'Left Alt', 227: 'Left Win', 228: 'Right Ctrl', 229: 'Right Shift', 230: 'Right Alt', 231: 'Right Win',
};
for (let i = 0; i < 26; i++) HID_NAMES[4 + i] = String.fromCharCode(65 + i);
for (let i = 0; i < 9; i++) HID_NAMES[30 + i] = String(i + 1);
HID_NAMES[39] = '0';
for (let i = 0; i < 12; i++) HID_NAMES[58 + i] = 'F' + (i + 1);
for (let i = 0; i < 12; i++) HID_NAMES[104 + i] = 'F' + (i + 13);
for (let i = 0; i < 9; i++) HID_NAMES[89 + i] = 'Num ' + (i + 1);
HID_NAMES[98] = 'Num 0';

const SHORT = {
  'Left Ctrl': 'Ctrl', 'Left Shift': 'Shift', 'Left Alt': 'Alt', 'Left Win': 'Win', 'Right Ctrl': 'RCtrl', 'Right Shift': 'RShift',
  'Right Alt': 'RAlt', 'Right Win': 'RWin', 'Print Screen': 'PrtSc', 'Scroll Lock': 'ScrLk', 'Page Up': 'PgUp', 'Page Down': 'PgDn',
  'Caps Lock': 'Caps', Backspace: 'Bksp', Delete: 'Del', Insert: 'Ins', Right: '→', Left: '←', Down: '↓', Up: '↑', Enter: 'Enter',
};
export const MODIFIERS = [224, 225, 226, 227, 228, 229, 230, 231];

// Named functions, grouped for the picker. Names translated from qmk.top's K0 / h5 tables.
export const FUNCTIONS = [
  ['Media', 'Play / Pause', [3, 0, 205, 0]], ['Media', 'Next track', [3, 0, 181, 0]], ['Media', 'Previous track', [3, 0, 182, 0]],
  ['Media', 'Stop', [3, 0, 183, 0]], ['Media', 'Mute', [3, 0, 226, 0]], ['Media', 'Volume up', [3, 0, 233, 0]],
  ['Media', 'Volume down', [3, 0, 234, 0]], ['Media', 'Media player', [3, 0, 131, 1]], ['Media', 'Screen brightness up', [3, 0, 111, 0]],
  ['Media', 'Screen brightness down', [3, 0, 112, 0]],
  ['Apps', 'Mail', [3, 0, 138, 1]], ['Apps', 'Calculator', [3, 0, 146, 1]], ['Apps', 'My computer', [3, 0, 148, 1]],
  ['Apps', 'Web search', [3, 0, 33, 2]], ['Apps', 'Web home', [3, 0, 35, 2]], ['Apps', 'Web back', [3, 0, 36, 2]],
  ['Apps', 'Web forward', [3, 0, 37, 2]], ['Apps', 'Web refresh', [3, 0, 39, 2]], ['Apps', 'Web favourites', [3, 0, 42, 2]],
  ['Apps', 'Launchpad (Mac)', [3, 0, 160, 2]], ['Apps', 'Task view', [3, 0, 159, 2]], ['Apps', 'Siri (Mac)', [18, 0, 227, 44]],
  ['System', 'System sleep', [2, 130, 0, 0]], ['System', 'System wake', [2, 131, 0, 0]], ['System', 'System power', [2, 129, 0, 0]],
  ['Keyboard', 'Fn', [10, 1, 0, 0]], ['Keyboard', 'Win key lock', [10, 3, 0, 0]], ['Keyboard', 'Switch to Windows', [10, 5, 0, 0]],
  ['Keyboard', 'Switch to Mac', [10, 5, 1, 0]], ['Keyboard', 'Switch OS (cycle)', [10, 5, 3, 0]], ['Keyboard', 'Keyboard lock', [10, 7, 0, 0]],
  ['Keyboard', 'Check battery', [10, 8, 0, 0]], ['Keyboard', 'WASD ↔ arrows', [10, 10, 0, 0]], ['Keyboard', 'Power saving', [10, 12, 0, 0]],
  ['Keyboard', 'Fn lock', [10, 13, 0, 0]], ['Keyboard', 'Volume ↔ keyboard brightness', [10, 15, 0, 0]], ['Keyboard', 'Alt+Tab', [10, 20, 0, 0]],
  ['Keyboard', 'Reset to factory', [10, 2, 0, 0]],
  ['Profile', 'Next profile', [8, 0, 1, 0]], ['Profile', 'Previous profile', [8, 0, 2, 0]], ['Profile', 'Cycle profiles', [8, 0, 3, 0]],
  ['Profile', 'Profile 1', [8, 0, 4, 0]], ['Profile', 'Profile 2', [8, 0, 4, 1]], ['Profile', 'Profile 3', [8, 0, 4, 2]],
  ['Profile', 'Profile 4', [8, 0, 4, 3]],
  ['Connection', 'Bluetooth 1', [14, 0, 0, 0]], ['Connection', 'Bluetooth 2', [14, 0, 1, 0]], ['Connection', 'Bluetooth 3', [14, 0, 2, 0]],
  ['Connection', '2.4G', [14, 0, 5, 0]], ['Connection', 'Wired', [14, 0, 6, 0]], ['Connection', 'Cycle connection', [14, 0, 255, 0]],
  ['Lighting', 'Lighting on/off', [13, 0, 0, 0]], ['Lighting', 'Next effect', [13, 1, 0, 0]], ['Lighting', 'Previous effect', [13, 1, 2, 0]],
  ['Lighting', 'Brightness up', [13, 2, 1, 0]], ['Lighting', 'Brightness down', [13, 2, 2, 0]], ['Lighting', 'Speed up', [13, 3, 1, 0]],
  ['Lighting', 'Speed down', [13, 3, 2, 0]], ['Lighting', 'Next colour', [13, 5, 1, 0]], ['Lighting', 'Direction', [13, 5, 0, 0]],
  ['Lighting', 'Side light effect', [13, 8, 0, 0]],
];
// Keycap-sized names (the full name stays in tooltips and the side panel).
const FN_SHORT = {
  'Play / Pause': 'Play', 'Next track': 'Next', 'Previous track': 'Prev', Stop: 'Stop', Mute: 'Mute', 'Volume up': 'Vol +',
  'Volume down': 'Vol −', 'Media player': 'Player', 'Screen brightness up': 'Scr +', 'Screen brightness down': 'Scr −',
  Mail: 'Mail', Calculator: 'Calc', 'My computer': 'PC', 'Web search': 'Search', 'Web home': 'Home', 'Web back': 'Back',
  'Web forward': 'Fwd', 'Web refresh': 'Reload', 'Web favourites': 'Fav', 'Launchpad (Mac)': 'Launch', 'Task view': 'Tasks',
  'Siri (Mac)': 'Siri', 'System sleep': 'Sleep', 'System wake': 'Wake', 'System power': 'Power', Fn: 'Fn', 'Win key lock': 'Win lock',
  'Switch to Windows': 'Win OS', 'Switch to Mac': 'Mac OS', 'Switch OS (cycle)': 'OS', 'Keyboard lock': 'KB lock',
  'Check battery': 'Battery', 'WASD ↔ arrows': 'WASD', 'Power saving': 'Eco', 'Fn lock': 'Fn lock', 'Volume ↔ keyboard brightness': 'Vol⇄Bri',
  'Alt+Tab': 'Alt+Tab', 'Reset to factory': 'Reset', 'Next profile': 'Prof +', 'Previous profile': 'Prof −',
  'Cycle profiles': 'Prof', 'Profile 1': 'P1', 'Profile 2': 'P2', 'Profile 3': 'P3', 'Profile 4': 'P4', 'Bluetooth 1': 'BT 1',
  'Bluetooth 2': 'BT 2', 'Bluetooth 3': 'BT 3', '2.4G': '2.4G', Wired: 'USB', 'Cycle connection': 'Conn', 'Lighting on/off': 'Light',
  'Next effect': 'FX +', 'Previous effect': 'FX −', 'Brightness up': 'Bri +', 'Brightness down': 'Bri −', 'Speed up': 'Spd +',
  'Speed down': 'Spd −', 'Next colour': 'Colour', Direction: 'Dir', 'Side light effect': 'Side FX',
};

// Functions too disruptive to assign casually; the picker marks them.
export const RISKY = new Set(['Reset to factory', 'Keyboard lock', 'System power']);

const FN_BY_BYTES = new Map(FUNCTIONS.map(([group, name, b]) => [b.join(','), { group, name }]));

// Functions whose name comes only from qmk.top's tables and whose effect on the RT75 isn't confirmed.
export const FN_NOTES = {
  'Volume ↔ keyboard brightness': 'qmk.top’s name for it (音量<->键盘亮度). What it does on the RT75 Pro isn’t confirmed: it doesn’t switch the knob, which changes mode by holding it down.',
};
const MOUSE = { 240: 'Left click', 241: 'Right click', 242: 'Middle click', 243: 'Mouse back', 244: 'Mouse forward', 245: 'Wheel', 246: 'Wheel', 247: 'Wheel', 248: 'Wheel' };

export const keyName = code => HID_NAMES[code] ?? `Key 0x${code.toString(16)}`;
const shortName = code => { const n = keyName(code); return SHORT[n] ?? n; };
const macName = n => n.replace(/Win/g, 'Cmd').replace(/Alt/g, 'Opt');
// Keycap symbols on Mac layers (the side panel keeps the words).
const MAC_SYMBOLS = { Win: '⌘', RWin: '⌘', Alt: '⌥', RAlt: '⌥', Shift: '⇧', RShift: '⇧', Ctrl: '⌃', RCtrl: '⌃' };

// Returns { kind, label, short, editable } for 4 action bytes.
// mac: name modifier keys as a Mac keyboard does (Win → Cmd, Alt → Opt).
export function decodeAction(b, { mac = false } = {}) {
  const key = b.join(',');
  if (key === '0,0,0,0' || key === '0,0,3,0') return { kind: 'disabled', label: 'Disabled', short: '—', editable: true };
  const fn = FN_BY_BYTES.get(key);
  if (fn) return { kind: 'function', label: fn.name, short: FN_SHORT[fn.name] ?? fn.name, group: fn.group, note: FN_NOTES[fn.name], editable: true };
  if (b[0] === 0) {
    const codes = b.slice(1).filter(Boolean);
    const name = mac ? c => macName(keyName(c)) : keyName;
    const short = mac ? c => MAC_SYMBOLS[shortName(c)] ?? macName(shortName(c)) : shortName;
    // Keycaps: Mac symbols sit directly against the key; Space shortens to Spc inside a combo.
    const joiner = mac ? '' : '+';
    const cap = c => (codes.length > 1 && c === 44 ? 'Spc' : short(c));
    return { kind: codes.length === 1 ? 'key' : 'combo', codes, label: codes.map(name).join(' + '), short: codes.map(cap).join(joiner), editable: true };
  }
  if (b[0] === 1) return { kind: 'mouse', label: MOUSE[b[2]] ?? 'Mouse action', short: MOUSE[b[2]] ?? 'Mouse', editable: false };
  if (b[0] === 9) return { kind: 'macro', label: `Macro ${b[2] + 1}`, short: `M${b[2] + 1}`, editable: false };
  if (b[0] === 24) return { kind: 'modtap', label: `Mod-tap: ${keyName(b[1])} / ${keyName(b[2])}`, short: 'MT', editable: false };
  // qmk.top shows anything it can't identify as a protected "System Key" (系统按键); so do we.
  return { kind: 'unknown', label: 'System key', short: 'System', raw: b.map(x => x.toString(16).padStart(2, '0')).join(' '), editable: false };
}

// One main key plus up to two modifiers, in qmk.top's combo layout:
// [0,0,k,0] · [0,0,mod,k] · [0,mod1,mod2,k]
export function encodeKey(main, mods = []) {
  const m = [...new Set(mods)].filter(x => MODIFIERS.includes(x) && x !== main).slice(0, 2);
  if (!m.length) return [0, 0, main, 0];
  if (m.length === 1) return [0, 0, m[0], main];
  return [0, m[0], m[1], main];
}

// Splits a key/combo action back into { main, mods } for the editor.
export function splitKey(b) {
  const codes = b.slice(1).filter(Boolean);
  const mods = codes.filter(c => MODIFIERS.includes(c));
  const main = codes.filter(c => !MODIFIERS.includes(c)).pop() ?? mods.pop();
  return { main, mods: mods.filter(c => c !== main) };
}

export const DISABLED = [0, 0, 0, 0];

// Browser KeyboardEvent.code → HID usage, for "press a key" capture.
export const CODE_TO_HID = {
  Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44, Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48,
  Backslash: 49, Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56, CapsLock: 57,
  PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74, PageUp: 75, Delete: 76, End: 77, PageDown: 78,
  ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82, NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85,
  NumpadSubtract: 86, NumpadAdd: 87, NumpadEnter: 88, Numpad0: 98, NumpadDecimal: 99, IntlBackslash: 100, ContextMenu: 101,
  ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227, ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
};
for (let i = 0; i < 26; i++) CODE_TO_HID['Key' + String.fromCharCode(65 + i)] = 4 + i;
for (let i = 1; i <= 9; i++) CODE_TO_HID['Digit' + i] = 29 + i;
CODE_TO_HID.Digit0 = 39;
for (let i = 1; i <= 12; i++) CODE_TO_HID['F' + i] = 57 + i;
for (let i = 13; i <= 24; i++) CODE_TO_HID['F' + i] = 91 + i;
for (let i = 1; i <= 9; i++) CODE_TO_HID['Numpad' + i] = 88 + i;

// Keys offered in the "choose a key" list, in a sensible order.
export const KEY_CHOICES = [
  ...Array.from({ length: 26 }, (_, i) => 4 + i), ...Array.from({ length: 10 }, (_, i) => 30 + i),
  40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56, 57,
  ...Array.from({ length: 24 }, (_, i) => (i < 12 ? 58 + i : 92 + i)),
  70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82,
  83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
  224, 225, 226, 227, 228, 229, 230, 231,
];
