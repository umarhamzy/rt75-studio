// Key-map writes (base and Fn layers) against the demo's simulated keyboard.
import { readFileSync } from 'node:fs';
globalThis.setTimeout = f => (f(), 0);
const { writeKeymap, buildKeymapPackets, readSettings } = await import(new URL('../src/device.js', import.meta.url).href);
const { createDemoDevice } = await import(new URL('../src/demo.js', import.meta.url).href);
const dump = JSON.parse(readFileSync(new URL('../fixtures/sample-dump.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };
const hex = p => [...p.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join(' ');
const at = (arr, slot) => arr.slice(slot * 4, slot * 4 + 4).join();

// Packet layout
const pk = buildKeymapPackets([
  { layer: 'base', slot: 14, action: [0, 0, 26, 0] },      // W → W (any key)
  { layer: 'fnWin', slot: 12, action: [3, 0, 205, 0] },    // Fn+F1 → Play/Pause
  { layer: 'fnMac', slot: 12, action: [0, 0, 0, 0] },      // Fn+F1 (Mac) → no Fn action
  { layer: 'base', slot: 9, action: [0, 0, 227, 15] },     // A → Win+L
], 0);
check('base packet layout', hex(pk[0].pkt) === '0a 00 0e 00 00 00 00 e7 00 00 1a 00', hex(pk[0].pkt));
check('Fn Windows packet layout', hex(pk[1].pkt) === '10 00 00 0c 00 00 00 e3 03 00 cd 00', hex(pk[1].pkt));
check('Fn Mac uses os 1', pk[2].pkt[0] === 0x10 && pk[2].pkt[1] === 1);
check('save flag only on the final base packet', pk.filter(p => p.pkt[0] === 0x0a).map(p => p.pkt[5]).join('') === '01');

// The RT75 has one Fn layer (index 0), shared by all profiles: Fn writes never carry the profile.
const pk2 = buildKeymapPackets([{ layer: 'fnWin', slot: 12, action: [3, 0, 205, 0] }, { layer: 'base', slot: 14, action: [0, 0, 26, 0] }], 2);
check('Fn write on profile 3 still targets Fn layer 0', hex(pk2[0].pkt).startsWith('10 00 00 0c'), hex(pk2[0].pkt));
check('base write on profile 3 targets profile 3', pk2[1].pkt[1] === 2);

// Blocked writes
const blocked = (name, edits, profile = 0) => { try { buildKeymapPackets(edits, profile); check(name, false, 'not blocked'); } catch (e) { check(name, true, e.message.split(':')[0]); } };
blocked('Fn key locked (base)', [{ layer: 'base', slot: 65, action: [0, 0, 4, 0] }]);
blocked('Fn key locked (Fn layer)', [{ layer: 'fnWin', slot: 65, action: [0, 0, 4, 0] }]);
blocked('knob slot refused', [{ layer: 'base', slot: 91, action: [0, 0, 4, 0] }]);
blocked('unknown action refused', [{ layer: 'base', slot: 14, action: [10, 4, 0, 0] }]);
blocked('macro action refused', [{ layer: 'base', slot: 14, action: [9, 0, 0, 0] }]);
blocked('two non-modifier keys refused', [{ layer: 'base', slot: 14, action: [0, 0, 4, 5] }]);
blocked('unknown HID code refused', [{ layer: 'base', slot: 14, action: [0, 0, 200, 0] }]);
blocked('bad profile refused', [{ layer: 'base', slot: 14, action: [0, 0, 4, 0] }], 4);
let ok = true;
try { buildKeymapPackets([{ layer: 'fnWin', slot: 2, action: [10, 4, 0, 0] }], 0); } catch { ok = false; }
check('restoring an exact factory value is allowed (Fn+Tab 10,4)', ok);

// Write + read back on the simulated keyboard
const dev = createDemoDevice(dump);
const s = await readSettings(dev);
const res = await writeKeymap(dev, s, [
  { layer: 'base', slot: 9, action: [0, 0, 227, 15] },
  { layer: 'fnWin', slot: 12, action: [3, 0, 205, 0] },
]);
check('no mismatches', res.mismatches.length === 0 && res.retried === 0, JSON.stringify(res.mismatches));
check('base layer read back with the change', at(res.layers.base, 9) === '0,0,227,15' && at(res.layers.base, 14) === at(s.keymap, 14));
check('Fn layer read back with the change', at(res.layers.fnWin, 12) === '3,0,205,0');
const s2 = await readSettings(dev);
check('a fresh read shows both changes', at(s2.keymap, 9) === '0,0,227,15' && at(s2.fnWin, 12) === '3,0,205,0' && at(s2.fnMac, 12) === at(s.fnMac, 12));

// Retry recovers a dropped write
const dev2 = createDemoDevice(dump);
let dropped = false;
const orig = dev2.sendFeatureReport.bind(dev2);
dev2.sendFeatureReport = async (id, b) => { if (!dropped && b[0] === 0x0a && b[2] === 15) { dropped = true; return; } return orig(id, b); };
const s3 = await readSettings(dev2);
const res3 = await writeKeymap(dev2, s3, [{ layer: 'base', slot: 14, action: [0, 0, 22, 0] }, { layer: 'base', slot: 15, action: [0, 0, 26, 0] }]);
check('retry recovers a dropped key write', res3.mismatches.length === 0 && res3.retried === 1 && at(res3.layers.base, 15) === '0,0,26,0');

// Reading on another profile asks only for Fn layer 0, and sees the same Fn layer.
const { switchProfile } = await import(new URL('../src/device.js', import.meta.url).href);
const dev5 = createDemoDevice(dump);
const fnReads = [];
const orig5 = dev5.sendFeatureReport.bind(dev5);
dev5.sendFeatureReport = async (id, b) => { if (b[0] === 0x90) fnReads.push(b[2]); if (b[0] === 0x04) fnReads.length = 0; return orig5(id, b); };
const s5 = await readSettings(dev5);
await switchProfile(dev5, s5, 2);
const s6 = await readSettings(dev5);
check('profile 3 reads Fn layer 0 only', s6.profile === 2 && fnReads.length === 16 && fnReads.every(v => v === 0), fnReads.join());
check('Fn layer is the same on every profile', s6.fnWin.join() === s5.fnWin.join());

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
