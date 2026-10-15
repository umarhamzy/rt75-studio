// Macro library: named macros kept by RT75 Studio in this browser, like qmk.top's Key Scheme
// Library. The keyboard only stores a macro's steps in a numbered slot and can't reliably give them
// back, so the library is where names and steps live.
//
// Entry: { id, name, repeat, steps, slot?, written? }
//   slot     the keyboard macro slot (0–49) this macro was last written to
//   written  { repeat, steps } as last written, to tell when the keyboard's copy is out of date

import { macroProblem, sameMacro, MAX_MACROS } from './macros.js';

const storageKey = demo => `rt75-studio-macros-${demo ? 'demo-' : ''}2865`;
const FILE_TYPE = 'rt75-studio-macro-library';

export function loadLibrary(demo) {
  try {
    const list = JSON.parse(localStorage.getItem(storageKey(demo)) ?? '[]');
    return Array.isArray(list) ? list.filter(e => e && typeof e.id === 'string' && Array.isArray(e.steps)) : [];
  } catch { return []; }
}

export function saveLibrary(list, demo) {
  try { localStorage.setItem(storageKey(demo), JSON.stringify(list)); return true; } catch { return false; }
}

export const newId = () => (crypto.randomUUID?.() ?? `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

// True when the macro is on the keyboard but its steps changed since they were written.
export const isOutdated = e => e.slot !== undefined && !!e.written && !sameMacro(e.written, e);

export function uniqueName(list, base) {
  const names = new Set(list.map(e => e.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} (${i})`)) return `${base} (${i})`;
}

// Export: names and steps only (slots belong to one keyboard).
export function exportLibrary(list) {
  return JSON.stringify({
    type: FILE_TYPE, version: 1, exportedAt: new Date().toISOString(),
    macros: list.map(e => ({ name: e.name, repeat: e.repeat, steps: e.steps.map(({ kind, code, down, delay }) => ({ kind, code, down, delay })) })),
  }, null, 2);
}

// Import: returns [{ name, repeat, steps }] or throws with a reason. Every macro must pass the same
// checks as one made here.
export function parseLibraryFile(text, validKey) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('not a JSON file'); }
  if (data?.type !== FILE_TYPE || !Array.isArray(data.macros)) throw new Error('not an RT75 Studio macro library file');
  if (data.macros.length > 500) throw new Error('too many macros');
  return data.macros.map((m, i) => {
    const name = typeof m?.name === 'string' ? m.name.trim().slice(0, 40) : '';
    const steps = Array.isArray(m?.steps) ? m.steps.map(s => ({ kind: s?.kind, code: s?.code, down: !!s?.down, delay: s?.delay })) : null;
    const macro = { repeat: m?.repeat, steps };
    const why = !name ? 'no name' : !steps ? 'no steps' : macroProblem(macro, validKey);
    if (why) throw new Error(`macro ${i + 1}${name ? ` (“${name}”)` : ''}: ${why}`);
    return { name, ...macro };
  });
}

export const validSlot = s => Number.isInteger(s) && s >= 0 && s < MAX_MACROS;
