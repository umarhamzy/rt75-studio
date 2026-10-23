// Yunzii RT75 Pro (device ID 2865, qmk.top module ry5088_zmd_k982d_3m_8k_1k): everything RT75 Studio
// knows that is specific to this keyboard. The RY5088 protocol is in device.js, and src/model.js picks
// the model the app drives. Values are qmk.top/v4's for this keyboard (its device entry and module)
// unless a comment says otherwise; protocol-notes.md has the evidence.

// Key positions from qmk.top/v4 keyboard_81_rt75_keymappings_ui_info (pixel units);
// slot = index into the 128-slot key matrix, derived from the device default matrix.
const KEYS = [
  { code: "AudioVolumeDown", slot: 92, x: 721, y: 0, w: 17, h: 52, label: "AudioVolumeDown", knob: true },
  { code: "AudioVolumeMute", slot: 91, x: 738, y: 0, w: 18, h: 52, label: "AudioVolumeMute", knob: true },
  { code: "AudioVolumeUp", slot: 93, x: 756, y: 0, w: 17, h: 52, label: "AudioVolumeUp", knob: true },
  { code: "Escape", slot: 0, x: 1, y: 11, w: 40, h: 40, label: "Esc" },
  { code: "F1", slot: 12, x: 79, y: 11, w: 40, h: 40, label: "F1" },
  { code: "F2", slot: 18, x: 125, y: 11, w: 40, h: 40, label: "F2" },
  { code: "F3", slot: 24, x: 171, y: 11, w: 40, h: 40, label: "F3" },
  { code: "F4", slot: 30, x: 217, y: 11, w: 40, h: 40, label: "F4" },
  { code: "F5", slot: 36, x: 295, y: 11, w: 40, h: 40, label: "F5" },
  { code: "F6", slot: 42, x: 341, y: 11, w: 40, h: 40, label: "F6" },
  { code: "F7", slot: 48, x: 387, y: 11, w: 40, h: 40, label: "F7" },
  { code: "F8", slot: 54, x: 433, y: 11, w: 40, h: 40, label: "F8" },
  { code: "F9", slot: 60, x: 511, y: 11, w: 40, h: 40, label: "F9" },
  { code: "F10", slot: 66, x: 557, y: 11, w: 40, h: 40, label: "F10" },
  { code: "F11", slot: 72, x: 603, y: 11, w: 40, h: 40, label: "F11" },
  { code: "F12", slot: 78, x: 649, y: 11, w: 40, h: 40, label: "F12" },
  { code: "Backquote", slot: 1, x: 1, y: 66, w: 40, h: 40, label: "`~" },
  { code: "Digit1", slot: 7, x: 47, y: 66, w: 40, h: 40, label: "1!" },
  { code: "Digit2", slot: 13, x: 93, y: 66, w: 40, h: 40, label: "2@" },
  { code: "Digit3", slot: 19, x: 139, y: 66, w: 40, h: 40, label: "3#" },
  { code: "Digit4", slot: 25, x: 185, y: 66, w: 40, h: 40, label: "4$" },
  { code: "Digit5", slot: 31, x: 231, y: 66, w: 40, h: 40, label: "5%" },
  { code: "Digit6", slot: 37, x: 277, y: 66, w: 40, h: 40, label: "6^" },
  { code: "Digit7", slot: 43, x: 323, y: 66, w: 40, h: 40, label: "7&" },
  { code: "Digit8", slot: 49, x: 369, y: 66, w: 40, h: 40, label: "8*" },
  { code: "Digit9", slot: 55, x: 415, y: 66, w: 40, h: 40, label: "9(" },
  { code: "Digit0", slot: 61, x: 461, y: 66, w: 40, h: 40, label: "0)" },
  { code: "Minus", slot: 67, x: 507, y: 66, w: 40, h: 40, label: "-_" },
  { code: "Equal", slot: 73, x: 553, y: 66, w: 40, h: 40, label: "=+" },
  { code: "Backspace", slot: 79, x: 599, y: 66, w: 90, h: 40, label: "Backspace" },
  { code: "Delete", slot: 85, x: 727, y: 66, w: 40, h: 40, label: "Del" },
  { code: "Tab", slot: 2, x: 1, y: 112, w: 66, h: 40, label: "Tab" },
  { code: "KeyQ", slot: 8, x: 73, y: 112, w: 40, h: 40, label: "Q" },
  { code: "KeyW", slot: 14, x: 119, y: 112, w: 40, h: 40, label: "W" },
  { code: "KeyE", slot: 20, x: 165, y: 112, w: 40, h: 40, label: "E" },
  { code: "KeyR", slot: 26, x: 211, y: 112, w: 40, h: 40, label: "R" },
  { code: "KeyT", slot: 32, x: 257, y: 112, w: 40, h: 40, label: "T" },
  { code: "KeyY", slot: 38, x: 303, y: 112, w: 40, h: 40, label: "Y" },
  { code: "KeyU", slot: 44, x: 349, y: 112, w: 40, h: 40, label: "U" },
  { code: "KeyI", slot: 50, x: 395, y: 112, w: 40, h: 40, label: "I" },
  { code: "KeyO", slot: 56, x: 441, y: 112, w: 40, h: 40, label: "O" },
  { code: "KeyP", slot: 62, x: 487, y: 112, w: 40, h: 40, label: "P" },
  { code: "BracketLeft", slot: 68, x: 533, y: 112, w: 40, h: 40, label: "[{" },
  { code: "BracketRight", slot: 74, x: 579, y: 112, w: 40, h: 40, label: "]}" },
  { code: "Backslash", slot: 80, x: 625, y: 112, w: 64, h: 40, label: "\\|" },
  { code: "End", slot: 86, x: 727, y: 112, w: 40, h: 40, label: "End" },
  { code: "CapsLock", slot: 3, x: 1, y: 158, w: 72, h: 40, label: "Caps" },
  { code: "KeyA", slot: 9, x: 79, y: 158, w: 40, h: 40, label: "A" },
  { code: "KeyS", slot: 15, x: 125, y: 158, w: 40, h: 40, label: "S" },
  { code: "KeyD", slot: 21, x: 171, y: 158, w: 40, h: 40, label: "D" },
  { code: "KeyF", slot: 27, x: 217, y: 158, w: 40, h: 40, label: "F" },
  { code: "KeyG", slot: 33, x: 263, y: 158, w: 40, h: 40, label: "G" },
  { code: "KeyH", slot: 39, x: 309, y: 158, w: 40, h: 40, label: "H" },
  { code: "KeyJ", slot: 45, x: 355, y: 158, w: 40, h: 40, label: "J" },
  { code: "KeyK", slot: 51, x: 401, y: 158, w: 40, h: 40, label: "K" },
  { code: "KeyL", slot: 57, x: 447, y: 158, w: 40, h: 40, label: "L" },
  { code: "Semicolon", slot: 63, x: 493, y: 158, w: 40, h: 40, label: ";:" },
  { code: "Quote", slot: 69, x: 539, y: 158, w: 40, h: 40, label: "‘”" },
  { code: "Enter", slot: 81, x: 585, y: 158, w: 104, h: 40, label: "Enter" },
  { code: "PageUp", slot: 87, x: 727, y: 158, w: 40, h: 40, label: "PgUp" },
  { code: "ShiftLeft", slot: 4, x: 1, y: 204, w: 93, h: 40, label: "Shift" },
  { code: "KeyZ", slot: 16, x: 100, y: 204, w: 40, h: 40, label: "Z" },
  { code: "KeyX", slot: 22, x: 146, y: 204, w: 40, h: 40, label: "X" },
  { code: "KeyC", slot: 28, x: 192, y: 204, w: 40, h: 40, label: "C" },
  { code: "KeyV", slot: 34, x: 238, y: 204, w: 40, h: 40, label: "V" },
  { code: "KeyB", slot: 40, x: 284, y: 204, w: 40, h: 40, label: "B" },
  { code: "KeyN", slot: 46, x: 330, y: 204, w: 40, h: 40, label: "N" },
  { code: "KeyM", slot: 52, x: 376, y: 204, w: 40, h: 40, label: "M" },
  { code: "Comma", slot: 58, x: 422, y: 204, w: 40, h: 40, label: ",<" },
  { code: "Period", slot: 64, x: 468, y: 204, w: 40, h: 40, label: ".>" },
  { code: "Slash", slot: 70, x: 514, y: 204, w: 40, h: 40, label: "/?" },
  { code: "ShiftRight", slot: 76, x: 560, y: 204, w: 99, h: 40, label: "Shift" },
  { code: "PageDown", slot: 88, x: 727, y: 204, w: 40, h: 40, label: "PgDn" },
  { code: "ArrowUp", slot: 82, x: 673, y: 212, w: 40, h: 40, label: "↑" },
  { code: "ControlLeft", slot: 5, x: 1, y: 250, w: 48, h: 40, label: "Ctrl" },
  { code: "MetaLeft", slot: 11, x: 55, y: 250, w: 48, h: 40, label: "Win" },
  { code: "AltLeft", slot: 17, x: 109, y: 250, w: 48, h: 40, label: "Alt" },
  { code: "Space", slot: 41, x: 163, y: 250, w: 312, h: 40, label: "Space" },
  { code: "AltRight", slot: 59, x: 481, y: 250, w: 40, h: 40, label: "Alt" },
  { code: "Fn", slot: 65, x: 527, y: 250, w: 40, h: 40, label: "Fn" },
  { code: "ControlRight", slot: 71, x: 573, y: 250, w: 40, h: 40, label: "Ctrl" },
  { code: "ArrowLeft", slot: 77, x: 627, y: 258, w: 40, h: 40, label: "←" },
  { code: "ArrowDown", slot: 83, x: 673, y: 258, w: 40, h: 40, label: "↓" },
  { code: "ArrowRight", slot: 89, x: 719, y: 258, w: 40, h: 40, label: "→" },
];

// Factory key matrix, 4 bytes per slot.
const DEFAULT_MATRIX = [0,0,41,0,0,0,53,0,0,0,43,0,0,0,57,0,0,0,225,0,0,0,224,0,0,0,0,0,0,0,30,0,0,0,20,0,0,0,4,0,0,0,0,0,0,0,227,0,0,0,58,0,0,0,31,0,0,0,26,0,0,0,22,0,0,0,29,0,0,0,226,0,0,0,59,0,0,0,32,0,0,0,8,0,0,0,7,0,0,0,27,0,0,0,0,0,0,0,60,0,0,0,33,0,0,0,21,0,0,0,9,0,0,0,6,0,0,0,0,0,0,0,61,0,0,0,34,0,0,0,23,0,0,0,10,0,0,0,25,0,0,0,0,0,0,0,62,0,0,0,35,0,0,0,28,0,0,0,11,0,0,0,5,0,0,0,44,0,0,0,63,0,0,0,36,0,0,0,24,0,0,0,13,0,0,0,17,0,0,0,0,0,0,0,64,0,0,0,37,0,0,0,12,0,0,0,14,0,0,0,16,0,0,0,0,0,0,0,65,0,0,0,38,0,0,0,18,0,0,0,15,0,0,0,54,0,0,0,230,0,0,0,66,0,0,0,39,0,0,0,19,0,0,0,51,0,0,0,55,0,10,1,0,0,0,0,67,0,0,0,45,0,0,0,47,0,0,0,52,0,0,0,56,0,0,0,228,0,0,0,68,0,0,0,46,0,0,0,48,0,0,0,0,0,0,0,229,0,0,0,80,0,0,0,69,0,0,0,42,0,0,0,49,0,0,0,40,0,0,0,82,0,0,0,81,0,0,0,0,0,0,0,76,0,0,0,77,0,0,0,75,0,0,0,78,0,0,0,79,0,0,0,0,0,3,0,226,0,3,0,234,0,3,0,233,0,13,2,1,0,13,2,2,0,13,3,1,0,13,3,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];

// Factory Fn layers (Windows and Mac), from the same qmk.top device module. Slots with
// [0,0,0,0] have no Fn action.
const DEFAULT_FN_MATRIX = [10,2,0,0,0,0,0,0,10,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,10,3,0,0,3,0,148,1,14,0,1,0,0,0,0,0,0,0,0,0,8,0,4,0,0,0,0,0,3,0,35,2,14,0,2,0,0,0,0,0,0,0,0,0,8,0,4,1,0,0,0,0,3,0,138,1,14,0,5,0,0,0,0,0,0,0,0,0,8,0,4,2,0,0,0,0,3,0,146,1,0,0,0,0,0,0,0,0,0,0,0,0,8,0,4,3,0,0,0,0,3,0,131,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,183,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,182,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,205,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,10,15,0,0,3,0,181,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,226,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,10,8,0,0,3,0,234,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,13,3,1,0,3,0,233,0,10,12,0,0,13,1,0,0,13,5,1,0,13,2,1,0,13,2,2,0,0,0,0,0,0,0,70,0,0,0,71,0,0,0,73,0,0,0,74,0,13,3,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
const DEFAULT_FN_MAC_MATRIX = [10,2,0,0,0,0,0,0,10,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,112,0,14,0,1,0,0,0,0,0,0,0,0,0,8,0,4,0,0,0,0,0,3,0,111,0,14,0,2,0,0,0,0,0,0,0,0,0,8,0,4,1,0,0,0,0,3,0,159,2,14,0,5,0,0,0,0,0,0,0,0,0,8,0,4,2,0,0,0,0,3,0,160,2,0,0,0,0,0,0,0,0,0,0,0,0,8,0,4,3,0,0,0,0,18,0,227,44,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,227,44,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,182,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,205,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,10,15,0,0,3,0,181,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,226,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,10,8,0,0,3,0,234,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,13,3,1,0,3,0,233,0,10,12,0,0,13,1,0,0,13,5,1,0,13,2,1,0,13,2,2,0,0,0,0,0,0,0,70,0,0,0,71,0,0,0,73,0,0,0,74,0,13,3,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];

// Backlight effects: qmk.top/v4's lightLayout for this keyboard (the shared layout `v` its RT75PRO entry
// points at), in its order with its per-effect controls; the ids are the RY5088 LightList and the
// English names are qmk.top's own. lighting.js has the packet format.
const EFFECTS = [
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

export default {
  id: 2865,
  module: 'ry5088_zmd_k982d_3m_8k_1k',
  maker: 'Yunzii',
  name: 'RT75 Pro',
  // Wired, and the 2.4G dongle (its vendor interface relays to the keyboard; device.js Transport).
  usb: { vendorId: 0x3151, productId: 0x5030, productName: 'YUNZII RT75 PRO Keyboard', dongleProductIds: [0x5037, 0x5038, 0x503d] },
  layout: { width: 773, height: 299, keys: KEYS },
  factory: { base: DEFAULT_MATRIX, fnWin: DEFAULT_FN_MATRIX, fnMac: DEFAULT_FN_MAC_MATRIX },
  // qmk.top's "Profile 1–4" are the device's key layers (deviceType.layer = 4).
  profiles: 4,
  // Setting ranges in mm: actuation/release 0.1 to 3.3, Rapid Trigger sensitivity one step (0.005)
  // to 2.0, top and bottom dead zone 0 to 1.
  limits: {
    travel: { min: 0.1, max: 3.3 },
    rt: { max: 2.0 },
    deadZone: { min: 0, max: 1 },
    mtTime: { min: 10, max: 1000, default: 200 }, // mod-tap hold time in ms, stored ÷ 10 (qmk.top's 按键时间)
    dks: { min: 0.5, max: 2.5, default: 0.7, bottom: 3.2 }, // DKS trigger point in mm (qmk.top's 触发行程, 最大行程)
  },
  // Switch-type bytes (magnet param 252) this keyboard offers: qmk.top/v4's enum for its
  // supportedSwitchTypes, in qmk.top's order.
  switchTypes: [0, 1, 2, 3, 4, 5, 46],
  // Its USB and dongle filters declare reportRate 8000, so every rate is offered.
  reportRates: [8000, 4000, 2000, 1000, 500, 250, 125],
  // Seconds: backlight-off 0 (never) to 18 h; BT deep sleep 10 s to 18 h. 2.4G deep sleep isn't
  // offered for this keyboard, so it's left out (written back unchanged).
  sleepLimits: { time_bt: [0, 64800], time_24: [0, 64800], deepTime_bt: [10, 64800] },
  // Main backlight only (a lightLayout, no sideLightLayout); brightness and speed 0–4.
  lighting: { maxLevel: 4, effects: EFFECTS },
  // The Custom effect's five per-key colour patterns: 378 bytes each (R, G, B for 126 slots).
  customPatterns: { count: 5, bytes: 378 },
};
