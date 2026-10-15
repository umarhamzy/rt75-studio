// Keyboard macros (RY5088). A key runs macro slot N when its action is [9, mode, N, 0]; the
// macro's steps live in a separate 256-byte buffer per slot (qmk.top maxMacro = 50).
//
// Buffer: [repeat count u16 LE] then records until four zero bytes:
//   key / mouse button  [code, flag]               short delay: flag = delay (1–127) | 0x80 if press
//                       [code, flag, delay u16 LE] long delay: flag = 0x80 if press, low 7 bits 0
//   mouse move          [0xF9, d, dx, dy] (+ [delay u16 LE] when d = 0)
// Codes 4–239 are HID keys (224–231 modifiers); 240–244 are mouse left, right, middle, back,
// forward. The delay is the wait after that step.
//
// The keyboard can't be trusted to give macro steps back (protocol-notes.md, "Macros"), so, like
// qmk.top, RT75 Studio keeps its own library of named macros and only writes them; it never reads
// macro slots. decodeMacro mirrors qmk.top's buffToMacroEvents and is used to check the encoder.

export const MAX_MACROS = 50;
export const MACRO_MODES = {
  0: { name: 'Loop count', hint: 'Plays the set number of times' },
  2: { name: 'Hold to play', hint: 'Plays while the key is held (qmk.top calls it “Press to Play”)' },
  1: { name: 'Toggle playback', hint: 'Press the key to start, press again to stop' },
};
export const MOUSE_BUTTONS = { 240: 'Left mouse button', 241: 'Right mouse button', 242: 'Middle mouse button', 243: 'Mouse Back', 244: 'Mouse Forward' };

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const s8 = v => (v > 127 ? v - 256 : v);
const isZero4 = (b, i) => b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 0 && b[i + 3] === 0;

// Bytes → { repeat, steps: [{ kind: 'key'|'mouse'|'move', code?, down?, dx?, dy?, delay }] }.
export function decodeMacro(buf) {
  const b = Array.from(buf);
  // A slot that was never written reads back as erased flash (all 0xFF): treat it as empty.
  if (b.length >= 6 && b.slice(0, 6).every(v => v === 0xff)) return { repeat: 0, steps: [], erased: true };
  const repeat = u16(b, 0);
  const steps = [];
  let s = 2;
  let n = b.slice(s, s + 4);
  s += 4;
  if (n.length < 4 || isZero4(n, 0)) return { repeat, steps };
  while (s < b.length && n.length === 4) {
    if (n[0] === 0xf9) {
      let delay;
      if (n[1] !== 0) delay = n[1] >> 1;
      else { delay = u16(b, s); s += 2; }
      steps.push({ kind: 'move', dx: s8(n[2]), dy: s8(n[3]), delay });
    } else {
      const down = n[1] > 127;
      let delay;
      if (n[1] & 0x7f) { delay = n[1] & 0x7f; s -= 2; } else delay = u16(n, 2);
      if (n[0] >= 4 && n[0] <= 239) steps.push({ kind: 'key', code: n[0], down, delay });
      else if (MOUSE_BUTTONS[n[0]]) steps.push({ kind: 'mouse', code: n[0], down, delay });
      else steps.push({ kind: 'unknown', code: n[0], down, delay });
    }
    n = b.slice(s, s + 4);
    if (n.length < 4 || isZero4(n, 0)) break;
    s += 4;
  }
  return { repeat, steps };
}

export function stepLabel(step, keyName) {
  if (step.kind === 'move') return `Move mouse ${step.dx >= 0 ? '+' : ''}${step.dx}, ${step.dy >= 0 ? '+' : ''}${step.dy}`;
  const what = step.kind === 'key' ? keyName(step.code) : step.kind === 'mouse' ? MOUSE_BUTTONS[step.code] : `Code ${step.code}`;
  return `${step.down ? 'Press' : 'Release'} ${what}`;
}

// One-line summary: the pressed keys and buttons in order.
export function macroSummary(m, keyName) {
  const pressed = m.steps.filter(s => s.down && s.kind !== 'move').map(s => (s.kind === 'key' ? keyName(s.code) : MOUSE_BUTTONS[s.code] ?? `Code ${s.code}`));
  if (!pressed.length) return m.steps.length ? `${m.steps.length} steps` : 'Empty';
  return pressed.length > 6 ? `${pressed.slice(0, 6).join(' → ')} → … (+${pressed.length - 6})` : pressed.join(' → ');
}

// ---------- Writing ----------
// encodeMacro mirrors qmk.top's macroEventToByte for keys and mouse buttons. It refuses what
// qmk.top would encode badly: zero delays (a short record with delay 0 decodes as a long one) and
// mouse moves (qmk.top writes the short delay as d but reads it back as d >> 1).
export const MAX_DELAY = 65535;
export const MAX_REPEAT = 65535;
export const MACRO_BYTES = 256;
export const MACRO_CHUNK = 56; // data bytes per 0x0B packet

// Bytes a step takes in the buffer.
export const stepSize = s => (s.delay <= 127 ? 2 : 4);
// Buffer bytes used: repeat count + records + the 00 00 00 00 end marker.
export const macroSize = m => 2 + m.steps.reduce((t, s) => t + stepSize(s), 0) + 4;

export function macroProblem(m, validKey) {
  if (!Number.isInteger(m.repeat) || m.repeat < 1 || m.repeat > MAX_REPEAT) return `Repeat count must be 1–${MAX_REPEAT}.`;
  for (const [i, s] of m.steps.entries()) {
    const where = `Step ${i + 1}`;
    if (s.kind === 'move') return `${where}: mouse moves can’t be written (qmk.top reads their delays back differently).`;
    if (s.kind === 'key' && !validKey(s.code)) return `${where}: unsupported key.`;
    if (s.kind === 'mouse' && !MOUSE_BUTTONS[s.code]) return `${where}: unsupported mouse button.`;
    if (s.kind !== 'key' && s.kind !== 'mouse') return `${where}: unsupported step.`;
    if (!Number.isInteger(s.delay) || s.delay < 1 || s.delay > MAX_DELAY) return `${where}: the delay must be 1–${MAX_DELAY} ms.`;
  }
  if (macroSize(m) > MACRO_BYTES) return `Too long: ${macroSize(m)} of ${MACRO_BYTES} bytes.`;
  return null;
}

// { repeat, steps } → 256-byte buffer. Throws if macroProblem() finds anything.
export function encodeMacro(m, validKey) {
  const why = macroProblem(m, validKey);
  if (why) throw new Error(why);
  const b = new Uint8Array(MACRO_BYTES);
  b[0] = m.repeat & 255; b[1] = m.repeat >> 8;
  let i = 2;
  for (const s of m.steps) {
    if (s.delay <= 127) { b[i++] = s.code; b[i++] = (s.down ? 0x80 : 0) | s.delay; }
    else { b[i++] = s.code; b[i++] = s.down ? 0x80 : 0; b[i++] = s.delay & 255; b[i++] = s.delay >> 8; }
  }
  return b; // the rest stays zero, which includes the end marker
}

export const sameMacro = (a, b) => !!a && !!b && a.repeat === b.repeat && a.steps.length === b.steps.length &&
  a.steps.every((s, i) => { const t = b.steps[i]; return s.kind === t.kind && s.code === t.code && !!s.down === !!t.down && s.delay === t.delay && s.dx === t.dx && s.dy === t.dy; });

// Keys or buttons still held when the macro ends.
export function heldAtEnd(m) {
  const held = new Map();
  for (const s of m.steps) {
    if (s.kind === 'move') continue;
    const k = `${s.kind}:${s.code}`;
    if (s.down) held.set(k, s); else held.delete(k);
  }
  return [...held.values()];
}

// Macro indices referenced by [9, mode, index, 0] actions in 512-byte key-map arrays.
export function macroRefs(...layers) {
  const refs = new Set();
  for (const arr of layers) {
    if (!arr) continue;
    for (let i = 0; i + 3 < arr.length; i += 4) if (arr[i] === 9 && arr[i + 2] < MAX_MACROS) refs.add(arr[i + 2]);
  }
  return [...refs].sort((a, b) => a - b);
}
