// DKS (dynamic keystroke) trigger patterns for the editor (protocol-notes.md, "DKS").
// Each action has four moments in one press, in bit order: 0 pressing past the trigger point,
// 1 reaching the bottom, 2 leaving the bottom, 3 releasing past the trigger point. Each moment
// holds 0 nothing, 1 a tap, 2 press here and release at the next moment, 3 press here and stay
// held past the next one (which then holds 2 or 3 to say where the hold ends), as qmk.top's
// editor makes them.

export const MOMENT_NAMES = ['press', 'bottom', 'lift', 'release'];

export const unpack = byte => [0, 2, 4, 6].map(s => (byte >> s) & 3);
export const pack = c => (c[0] | (c[1] << 2) | (c[2] << 4) | (c[3] << 6)) & 0xff;
// The trigger table keeps one byte per action, action 1 lowest (device.js packs the four).
export const actionByte = (quad, i) => (quad >>> (i * 8)) & 0xff;
export const setActionByte = (quad, i, byte) => ((quad & ~(0xff << (i * 8))) | (byte << (i * 8))) >>> 0;

// A new DKS key holds action 1 from press to release: it behaves like a normal key until changed.
export const DEFAULT_TRIGGERS = pack([3, 3, 2, 0]);

// The holds in a pattern: [{ start, end }], held from moment start until moment end.
export function holds(c) {
  const out = [];
  for (let s = 0; s < 3; s++) {
    if (c[s] < 2 || out.some(h => s > h.start && s < h.end)) continue; // inside an earlier hold
    let k = s;
    while (k < 2 && c[k] === 3) k++;
    out.push({ start: s, end: k + 1 });
  }
  return out;
}

// Taps: moments with a 1 that isn't inside a hold.
export const taps = c => [0, 1, 2, 3].filter(i => c[i] === 1 && !holds(c).some(h => i > h.start && i < h.end));

function clearHold(c, h) {
  const n = [...c];
  for (let i = h.start; i < h.end; i++) n[i] = 0;
  return n;
}

// Holds from moment s for len moments (s + len ≤ 3), replacing any hold that started there.
function setHold(c, s, len) {
  const own = holds(c).find(h => h.start === s);
  const n = own ? clearHold(c, own) : [...c];
  for (let i = s; i < s + len - 1; i++) n[i] = 3;
  n[s + len - 1] = 2;
  return n;
}

// Clicking a moment's dot: nothing → tap → hold to the next moment → hold one further … → nothing.
// A dot inside a hold ends the hold there.
export function cycleMoment(c, i) {
  const all = holds(c);
  const inside = all.find(h => i > h.start && i < h.end);
  if (inside) return setHold(c, inside.start, i - inside.start);
  const own = all.find(h => h.start === i);
  if (own) return own.end < 3 ? setHold(c, i, own.end - own.start + 1) : clearHold(c, own);
  const n = [...c];
  if (c[i] === 0) n[i] = 1;
  else if (c[i] === 1) return i < 3 ? setHold(c, i, 1) : (n[i] = 0, n);
  else n[i] = 0;
  return n;
}

// Clicking a hold between moments seg and seg + 1: the hold now ends at moment seg (a tap there
// if that's where it starts).
export function cutHold(c, start, seg) {
  const h = holds(c).find(x => x.start === start);
  if (!h || seg < h.start || seg >= h.end) return [...c];
  if (seg === h.start) { const n = clearHold(c, h); n[start] = 1; return n; }
  return setHold(c, start, seg - start);
}

// What a pattern does, in words: "held press → release", "tap at bottom".
export function describe(c) {
  const parts = [
    ...holds(c).map(h => ({ at: h.start, text: `held ${MOMENT_NAMES[h.start]} → ${MOMENT_NAMES[h.end]}` })),
    ...taps(c).map(i => ({ at: i, text: `tap at ${MOMENT_NAMES[i]}` })),
  ].sort((a, b) => a.at - b.at);
  return parts.map(p => p.text).join(', ');
}

// One press scrubbed from t = 0 (key up) to 100 (key up again): down to the bottom over 0–40, at the
// bottom over 40–60, back up over 60–100. Returns the depth, the last moment passed (−1 before the
// first), and where along the four moments the press is (0–1, or null outside the trigger point).
export function pressAt(t, trigger, bottom) {
  if (t < 40) {
    const depth = (t / 40) * bottom;
    return { depth, dir: 'down', moment: depth >= trigger ? 0 : -1, x: depth >= trigger ? (depth - trigger) / (bottom - trigger) / 3 : null };
  }
  if (t < 60) return { depth: bottom, dir: '', moment: 1, x: 1 / 3 + (t - 40) / 20 / 3 };
  const depth = ((100 - t) / 40) * bottom;
  return { depth, dir: 'up', moment: depth >= trigger ? 2 : 3, x: depth >= trigger ? 2 / 3 + (bottom - depth) / (bottom - trigger) / 3 : null };
}

// Whether an action is held, or was just tapped, after the given moment.
export const heldAfter = (c, moment) => holds(c).some(h => moment >= h.start && moment < h.end);
export const tappedAt = (c, moment) => moment >= 0 && taps(c).includes(moment);
