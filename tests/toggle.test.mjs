// Toggle keys: mode 4 (Long press) or 5 (Rapid fire), with the action on the base layer in the
// mod-tap key layout, against the demo's simulated keyboard.
import { readFileSync } from 'node:fs';
globalThis.setTimeout = f => (f(), 0);
const { buildWritePackets, writeKeySettings, writeKeymap, readSettings, writeBounds, isWritableAction } =
  await import(new URL('../src/device.js', import.meta.url).href);
const { encodeModTap } = await import(new URL('../src/actions.js', import.meta.url).href);
const { createDemoDevice } = await import(new URL('../src/demo.js', import.meta.url).href);
const dump = JSON.parse(readFileSync(new URL('../fixtures/sample-dump.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };
const hex = p => [...p.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join(' ');
const at = (arr, slot) => arr.slice(slot * 4, slot * 4 + 4).join();
const W = 14, bounds = writeBounds(200);

const p4 = buildWritePackets([{ slot: W, mode: 4 }], bounds), p5 = buildWritePackets([{ slot: W, mode: 5 | 0x80 }], bounds);
check('Long press is mode 4', hex(p4[0].pkt).startsWith('65 07 00 0e 01') && p4[0].pkt[8] === 4, hex(p4[0].pkt));
check('Rapid fire with RT is mode 5 | 0x80', p5[0].pkt[8] === 0x85, hex(p5[0].pkt));
check('the action uses the mod-tap layout on the base layer', isWritableAction(encodeModTap(26), 'base', W) && encodeModTap(26).join() === '0,26,0,0');
check('a combo action is allowed', isWritableAction(encodeModTap(6, [224]), 'base', W));

const dev = createDemoDevice(dump);
const s = await readSettings(dev);
const order = [];
const send = dev.sendFeatureReport.bind(dev);
dev.sendFeatureReport = async (id, b) => { if (b[0] === 0x0a || b[0] === 0x65) order.push(b[0] === 0x0a ? 'key' : `p${b[1]}`); return send(id, b); };
const km = await writeKeymap(dev, s, [{ layer: 'base', slot: W, action: encodeModTap(26) }]);
const mg = await writeKeySettings(dev, s, [{ slot: W, mode: 5 }]);
check('written and read back', km.mismatches.length === 0 && mg.mismatches.length === 0 && at(km.layers.base, W) === '0,26,0,0' && mg.magnet.mode[W] === 5);
check('key map before the mode, as qmk.top sends it', order.join() === 'key,p7', order.join());
const back = await writeKeymap(dev, s, [{ layer: 'base', slot: W, action: [0, 0, 26, 0] }]);
const off = await writeKeySettings(dev, s, [{ slot: W, mode: 0 }]);
check('back to Normal: plain key and mode 0', back.mismatches.length === 0 && off.magnet.mode[W] === 0 && at(back.layers.base, W) === '0,0,26,0');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
