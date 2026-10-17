// DKS: trigger point (param 4), trigger table (written as param 8, read as param 10), the four
// key-matrix sub-layers, read ranges, against the demo's simulated keyboard.
import { readFileSync } from 'node:fs';
globalThis.setTimeout = f => (f(), 0);
const { buildWritePackets, writeKeySettings, readSettings, readDksSettings, buildKeymapPackets, writeKeymap, writeBounds, isWritableAction } =
  await import(new URL('../src/device.js', import.meta.url).href);
const { createDemoDevice } = await import(new URL('../src/demo.js', import.meta.url).href);
const dump = JSON.parse(readFileSync(new URL('../fixtures/sample-dump.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };
const hex = p => [...p.slice(0, 14)].map(b => b.toString(16).padStart(2, '0')).join(' ');
const at = (arr, slot) => arr.slice(slot * 4, slot * 4 + 4).join();
const blocked = (name, fn) => { try { fn(); check(name, false, 'not blocked'); } catch (e) { check(name, true, e.message.split(':')[0]); } };
const W = 14; // slot of W
const bounds = writeBounds(200);

// Packets: mode, then trigger point, then trigger table (qmk.top's order 7, 4, 8).
const triggers = (0x0f | (0x03 << 8) | (0xc0 << 16)) >>> 0;
const pk = buildWritePackets([{ slot: W, mode: 2, dksTravel: 140, dksTriggers: triggers }], bounds);
check('order: mode, trigger point, trigger table', pk.map(p => p.field).join() === 'mode,dksTravel,dksTriggers', pk.map(p => p.field).join());
check('trigger point is param 4, uint16', hex(pk[1].pkt).startsWith('65 04 00 0e 00 00 00') && pk[1].pkt[8] === 140 && pk[1].pkt[9] === 0, hex(pk[1].pkt));
check('trigger table is param 8, four bytes, save on it', hex(pk[2].pkt).startsWith('65 08 00 0e 01') && [...pk[2].pkt.slice(8, 13)].join() === '15,3,192,0,0', hex(pk[2].pkt));
blocked('trigger point under 0.5 mm refused', () => buildWritePackets([{ slot: W, dksTravel: 99 }], bounds));
blocked('trigger point over 2.5 mm refused', () => buildWritePackets([{ slot: W, dksTravel: 501 }], bounds));

// Actions on sub-layers 2–3: keys only, like the tap layer.
check('sub-layer actions: keys or clear', isWritableAction([0, 225, 26, 0], 'sub3', W) && isWritableAction([0, 0, 0, 0], 'sub2', W) && !isWritableAction([3, 0, 205, 0], 'sub2', W));
const km = buildKeymapPackets([
  { layer: 'sub3', slot: W, action: [0, 44, 0, 0] }, { layer: 'base', slot: W, action: [0, 26, 0, 0] },
  { layer: 'sub2', slot: W, action: [0, 0, 0, 0] }, { layer: 'tap', slot: W, action: [0, 225, 26, 0] },
], 0);
check('subs 0–3 in order, save on the last', km.map(p => p.pkt[6]).join() === '0,1,2,3' && km.map(p => p.pkt[5]).join() === '0,0,0,1', km.map(p => hex(p.pkt)).join(' | '));

// Reads: the trigger table is 8 pages (only for param 10); other magnet tables stay at 4.
{
  const dev = createDemoDevice(dump);
  const s = await readSettings(dev);
  check('no DKS key: DKS settings not read at startup', s.magnet.dksTravel === undefined && s.magnet.dksTriggers === undefined);
  const send = dev.sendFeatureReport.bind(dev);
  const pages = [];
  dev.sendFeatureReport = async (id, b) => { if (b[0] === 0xe5 && b[1] === 10) pages.push(b[3]); return send(id, b); };
  const d = await readDksSettings(dev, s);
  check('readDksSettings reads param 10 pages 0–7', pages.join() === '0,1,2,3,4,5,6,7' && d.dksTriggers.length === 128 && d.dksTravel.length === 128, pages.join());
}

// Write, read back, then a fresh read picks DKS up at startup.
{
  const dev = createDemoDevice(dump);
  const s = await readSettings(dev);
  Object.assign(s.magnet, await readDksSettings(dev, s));
  const res = await writeKeySettings(dev, s, [{ slot: W, mode: 2, dksTravel: 140, dksTriggers: triggers }]);
  check('written and read back', res.mismatches.length === 0 && res.magnet.dksTriggers[W] === triggers && res.magnet.dksTravel[W] === 140, JSON.stringify(res.mismatches));
  const k = await writeKeymap(dev, s, [{ layer: 'base', slot: W, action: [0, 26, 0, 0] }, { layer: 'tap', slot: W, action: [0, 225, 26, 0] }, { layer: 'sub3', slot: W, action: [0, 44, 0, 0] }]);
  check('actions written and read back', k.mismatches.length === 0 && at(k.layers.tap, W) === '0,225,26,0' && at(k.layers.sub3, W) === '0,44,0,0');
  const s2 = await readSettings(dev);
  check('a DKS key makes startup read DKS settings', s2.magnet.mode[W] === 2 && s2.magnet.dksTriggers?.[W] === triggers && s2.magnet.dksTravel?.[W] === 140);
  check('fresh read has all four actions', at(s2.keymap, W) === '0,26,0,0' && at(s2.tapLayer, W) === '0,225,26,0' && at(s2.sub2Layer, W) === '0,0,0,0' && at(s2.sub3Layer, W) === '0,44,0,0');
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
