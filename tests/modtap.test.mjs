// Mod-tap: the tap layer (key-matrix sub-layer 1), the hold time (magnet param 5) and their limits,
// against the demo's simulated keyboard.
import { readFileSync } from 'node:fs';
globalThis.setTimeout = f => (f(), 0);
const { writeKeymap, buildKeymapPackets, buildWritePackets, writeKeySettings, readSettings, isModTapKeys, isWritableAction, writeBounds } =
  await import(new URL('../src/device.js', import.meta.url).href);
const { encodeModTap } = await import(new URL('../src/actions.js', import.meta.url).href);
const { createDemoDevice } = await import(new URL('../src/demo.js', import.meta.url).href);
const dump = JSON.parse(readFileSync(new URL('../fixtures/sample-dump.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };
const hex = p => [...p.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join(' ');
const at = (arr, slot) => arr.slice(slot * 4, slot * 4 + 4).join();
const CAPS = 3, LCTRL = 224, LSHIFT = 225;

// Encoding: qmk.top's mod-tap layout packs keys from byte 1.
check('a lone modifier is [0, mod, 0, 0]', encodeModTap(LCTRL).join() === '0,224,0,0');
check('a key is [0, key, 0, 0]', encodeModTap(57).join() === '0,57,0,0');
check('modifiers come first', encodeModTap(6, [LCTRL]).join() === '0,224,6,0' && encodeModTap(6, [LCTRL, LSHIFT]).join() === '0,224,225,6');
check('mod-tap keys accepted', isModTapKeys([0, 224, 0, 0]) && isModTapKeys([0, 224, 6, 0]) && isModTapKeys([0, 224, 225, 6]));
check('gaps, two main keys, repeats and functions refused',
  !isModTapKeys([0, 0, 224, 0]) && !isModTapKeys([0, 224, 0, 6]) && !isModTapKeys([0, 4, 5, 0]) && !isModTapKeys([0, 224, 224, 0]) && !isModTapKeys([3, 0, 205, 0]));
check('tap layer: keys and clearing only', isWritableAction([0, 57, 0, 0], 'tap', CAPS) && isWritableAction([0, 0, 0, 0], 'tap', CAPS) &&
  !isWritableAction([3, 0, 205, 0], 'tap', CAPS) && !isWritableAction([9, 0, 1, 0], 'tap', CAPS));

// Packets: hold (base, sub 0) then tap (sub 1), save only on the last key-matrix packet.
const pk = buildKeymapPackets([
  { layer: 'tap', slot: CAPS, action: [0, 57, 0, 0] },
  { layer: 'fnWin', slot: 12, action: [3, 0, 205, 0] },
  { layer: 'base', slot: CAPS, action: [0, 224, 0, 0] },
], 1);
const order = pk.map(p => p.layer).join();
check('tap follows its hold; other edits keep their place', order === 'fnWin,base,tap', order);
const [fnP, holdP, tapP] = pk;
check('hold is the base layer (sub 0), no save', hex(holdP.pkt).startsWith('0a 01 03 00 00 00 00') && holdP.pkt.slice(8, 12).join() === '0,224,0,0', hex(holdP.pkt));
check('tap is sub 1 with the save flag', tapP.pkt[6] === 1 && tapP.pkt[5] === 1, hex(tapP.pkt));
check('Fn edits keep no save byte', fnP.pkt[0] === 0x10 && fnP.pkt[5] === 0);
const blocked = (name, fn) => { try { fn(); check(name, false, 'not blocked'); } catch (e) { check(name, true, e.message.split(':')[0]); } };
blocked('a function on the tap layer is refused', () => buildKeymapPackets([{ layer: 'tap', slot: CAPS, action: [3, 0, 205, 0] }], 0));
blocked('the Fn key is locked on the tap layer', () => buildKeymapPackets([{ layer: 'tap', slot: 65, action: [0, 4, 0, 0] }], 0));

// Hold time: param 5, one byte, 10–1000 ms.
const bounds = writeBounds(200);
const mt = buildWritePackets([{ slot: CAPS, mode: 3, mtTime: 20, actuation: 300 }], bounds);
check('mode, travel, then hold time', mt.map(p => p.field).join() === 'mode,actuation,mtTime', mt.map(p => p.field).join());
check('hold time packet', hex(mt[2].pkt).startsWith('65 05 00 03 01') && mt[2].pkt[8] === 20 && mt[2].pkt[9] === 0, hex(mt[2].pkt));
blocked('hold time 0 refused', () => buildWritePackets([{ slot: CAPS, mtTime: 0 }], bounds));
blocked('hold time over 1000 ms refused', () => buildWritePackets([{ slot: CAPS, mtTime: 101 }], bounds));

// Reads: the tap layer is loaded with the key map; sub-layers past 1 are refused.
const dev = createDemoDevice(dump);
const s = await readSettings(dev);
check('tap layer read, all zeros from the factory', s.tapLayer?.length === 512 && s.tapLayer.every(b => b === 0));
check('hold times read', s.magnet.mtTime?.length === 128);
{
  const dev3 = createDemoDevice(dump);
  const s3 = await readSettings(dev3);
  const send = dev3.sendFeatureReport.bind(dev3);
  const subs = [];
  dev3.sendFeatureReport = async (id, b) => { if (b[0] === 0x8a) subs.push(b[4]); return send(id, b); };
  await readSettings(dev3);
  check('key-matrix reads use sub 0 and 1 only', subs.length === 16 && subs.every(v => v === 0 || v === 1), subs.join());
  void s3;
}

// Turning Caps into mod-tap (tap Caps, hold Ctrl, 250 ms) and back, with read-back.
const km = await writeKeymap(dev, s, [{ layer: 'base', slot: CAPS, action: [0, 224, 0, 0] }, { layer: 'tap', slot: CAPS, action: [0, 57, 0, 0] }]);
check('key matrix written and read back', km.mismatches.length === 0 && at(km.layers.base, CAPS) === '0,224,0,0' && at(km.layers.tap, CAPS) === '0,57,0,0', JSON.stringify(km.mismatches));
const mg = await writeKeySettings(dev, s, [{ slot: CAPS, mode: 3, mtTime: 25 }]);
check('mode and hold time written and read back', mg.mismatches.length === 0 && mg.magnet.mode[CAPS] === 3 && mg.magnet.mtTime[CAPS] === 25);
const s2 = await readSettings(dev);
check('a fresh read shows the mod-tap key', s2.magnet.mode[CAPS] === 3 && at(s2.tapLayer, CAPS) === '0,57,0,0' && at(s2.keymap, CAPS) === '0,224,0,0');
const off = await writeKeymap(dev, s2, [{ layer: 'base', slot: CAPS, action: [0, 0, 57, 0] }, { layer: 'tap', slot: CAPS, action: [0, 0, 0, 0] }]);
check('leaving mod-tap restores the key and clears the tap layer', off.mismatches.length === 0 && at(off.layers.base, CAPS) === '0,0,57,0' && at(off.layers.tap, CAPS) === '0,0,0,0');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
