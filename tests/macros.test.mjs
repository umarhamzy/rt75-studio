// Macro encoding (qmk.top macroEventToByte / _setMacro), validated write packets, slot picking and
// the library file format. Macro slots are never read back (the keyboard's 0x8B read is unreliable).
import { readFileSync } from 'node:fs';
globalThis.setTimeout = f => (f(), 0);
const { buildMacroPackets, writeMacros, readMacroSlotsInUse, pickFreeSlot, isWritableAction, buildKeymapPackets, readSettings } = await import(new URL('../src/device.js', import.meta.url).href);
const { encodeMacro, decodeMacro, macroProblem, heldAtEnd, macroSummary } = await import(new URL('../src/macros.js', import.meta.url).href);
const { exportLibrary, parseLibraryFile, isOutdated, uniqueName } = await import(new URL('../src/library.js', import.meta.url).href);
const { createDemoDevice } = await import(new URL('../src/demo.js', import.meta.url).href);
const dump = JSON.parse(readFileSync(new URL('../fixtures/sample-dump.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };
const any = () => true;
const key = (code, down, delay) => ({ kind: 'key', code, down, delay });
const steps = m => m.steps.map(s => `${s.kind}:${s.code}:${s.down ? 'd' : 'u'}:${s.delay}`).join(' ');
const ctrlC = { repeat: 2, steps: [key(224, true, 20), key(6, true, 300), key(6, false, 20), key(224, false, 20)] };

// Encoder (macroEventToByte): short records [code, flag], long records [code, flag, u16 delay].
const enc = encodeMacro(ctrlC, any);
check('encoder mirrors macroEventToByte', [...enc.slice(0, 14)].join() === '2,0,224,148,6,128,44,1,6,20,224,20,0,0', [...enc.slice(0, 14)].join());
check('encode → qmk.top decode round-trips', steps(decodeMacro(enc)) === steps(ctrlC));
check('mouse buttons encode as 240–244', [...encodeMacro({ repeat: 1, steps: [{ kind: 'mouse', code: 241, down: true, delay: 5 }] }, any).slice(2, 4)].join() === '241,133');
check('zero delay refused', /delay/.test(macroProblem({ repeat: 1, steps: [key(4, true, 0)] }, any)));
check('mouse move refused', /mouse moves/.test(macroProblem({ repeat: 1, steps: [{ kind: 'move', dx: 1, dy: 1, delay: 5 }] }, any)));
check('repeat 0 refused', /Repeat/.test(macroProblem({ repeat: 0, steps: [] }, any)));
check('over 256 bytes refused', /Too long/.test(macroProblem({ repeat: 1, steps: Array.from({ length: 126 }, () => key(4, true, 5)) }, any)));
check('held keys found', heldAtEnd({ steps: [key(224, true, 5), key(4, true, 5), key(4, false, 5)] }).map(s => s.code).join() === '224');
check('summary lists presses', macroSummary(ctrlC, c => ({ 224: 'L Ctrl', 6: 'C' })[c]) === 'L Ctrl → C');

// Write packets (_setMacro): [0B, slot, page, 56, last, 0, 0, cs, 56 data bytes].
const pk = buildMacroPackets(3, ctrlC);
check('one packet for a short macro, with the end flag', pk.length === 1 && pk[0][4] === 1);
check('packet header', [...pk[0].slice(0, 7)].join() === '11,3,0,56,1,0,0' && pk[0][7] === 255 - ((11 + 3 + 56 + 1) & 255));
check('packet data is the buffer', [...pk[0].slice(8, 20)].join() === [...enc.slice(0, 12)].join());
const long = { repeat: 1, steps: Array.from({ length: 30 }, (_, i) => key(4 + (i % 20), i % 2 === 0, 10)) }; // 66 bytes
const pkl = buildMacroPackets(0, long);
check('pages cover the end marker', pkl.length === 2 && pkl[0][4] === 0 && pkl[1][4] === 1 && pkl[1][2] === 1);
check('a macro filling a page exactly still fits one page', buildMacroPackets(0, { repeat: 1, steps: Array.from({ length: 25 }, () => key(4, true, 10)) }).length === 1);
const blocked = (name, f) => { try { f(); check(name, false, 'not blocked'); } catch (e) { check(name, true, e.message.split('(')[0].trim()); } };
blocked('slot 50 refused', () => buildMacroPackets(50, ctrlC));
blocked('unknown key refused', () => buildMacroPackets(0, { repeat: 1, steps: [key(200, true, 5)] }));
check('run-macro action allowed on keys', isWritableAction([9, 1, 4, 0], 'base', 14) && isWritableAction([9, 2, 49, 0], 'fnWin', 14));
check('bad macro actions refused', !isWritableAction([9, 3, 4, 0], 'base', 14) && !isWritableAction([9, 0, 50, 0], 'base', 14) && !isWritableAction([9, 0, 4, 1], 'base', 14));
check('key-map packet for a macro key', buildKeymapPackets([{ layer: 'base', slot: 14, action: [9, 0, 4, 0] }], 0)[0].pkt.slice(8, 12).join() === '9,0,4,0');

// Writing on the simulated keyboard: exact bytes land in the slot, and nothing reads a macro slot.
const dev = createDemoDevice(dump);
const sent = [];
const orig = dev.sendFeatureReport.bind(dev);
dev.sendFeatureReport = async (id, b) => { sent.push(b[0]); return orig(id, b); };
const s = await readSettings(dev);
const w = await writeMacros(dev, s, [{ slot: 3, macro: ctrlC }, { slot: 7, macro: long }]);
check('macros written', w.written.join() === '3,7');
check('slot holds the encoded macro', [...dev.demoMacros.get(3).slice(0, 14)].join() === [...enc.slice(0, 14)].join());
check('a two-page macro lands whole', steps(decodeMacro(dev.demoMacros.get(7))) === steps(long));
await writeMacros(dev, s, [{ slot: 7, macro: { repeat: 1, steps: [key(4, true, 5), key(4, false, 5)] } }]);
check('a shorter macro replaces a longer one cleanly', decodeMacro(dev.demoMacros.get(7)).steps.length === 2);
check('no macro read (0x8B) is ever sent', !sent.includes(0x8b));

// Free slots: keys on every profile and the Fn layers count; the library's slots are skipped too.
const used = await readMacroSlotsInUse(dev, s);
check('slots in use include the Fn+F macro (slot 0)', used.join() === '0', used.join());
check('free slot skips used and claimed slots', pickFreeSlot(used, [1, 2]) === 3 && pickFreeSlot([], []) === 0);
blocked('no free slot', () => pickFreeSlot(Array.from({ length: 50 }, (_, i) => i)));

// Library file format.
const lib = [{ id: 'a', name: 'Copy', repeat: 2, steps: ctrlC.steps, slot: 3, written: ctrlC }];
const back = parseLibraryFile(exportLibrary(lib), any);
check('export → import keeps names and steps, drops slots', back.length === 1 && back[0].name === 'Copy' && steps(back[0]) === steps(ctrlC) && !('slot' in back[0]));
blocked('import refuses other JSON', () => parseLibraryFile('{"type":"x","macros":[]}', any));
blocked('import refuses a zero delay', () => parseLibraryFile(JSON.stringify({ type: 'rt75-studio-macro-library', version: 1, macros: [{ name: 'Bad', repeat: 1, steps: [key(4, true, 0)] }] }), any));
blocked('import refuses a nameless macro', () => parseLibraryFile(JSON.stringify({ type: 'rt75-studio-macro-library', version: 1, macros: [{ name: ' ', repeat: 1, steps: [] }] }), any));
check('outdated when steps change after writing', !isOutdated(lib[0]) && isOutdated({ ...lib[0], steps: [key(4, true, 5)] }));
check('unique names', uniqueName([{ name: 'A' }, { name: 'A (2)' }], 'A') === 'A (3)');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
