// Lighting (0x07 / 0x87) against qmk.top's byte layout and the demo's simulated keyboard.
import { readFileSync } from 'node:fs';
globalThis.setTimeout = f => (f(), 0);
const { buildLightingPacket, writeLighting, readSettings } = await import(new URL('../src/device.js', import.meta.url).href);
const { decodeLighting, lightingBytes, lightingDiff, normalizeLighting, EFFECTS } = await import(new URL('../src/lighting.js', import.meta.url).href);
const { createDemoDevice } = await import(new URL('../src/demo.js', import.meta.url).href);
const dump = JSON.parse(readFileSync(new URL('../fixtures/sample-dump.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };
const hex = p => [...p.slice(0, 10)].map(b => b.toString(16).padStart(2, '0')).join(' ');
const base = { effect: 4, speed: 2, brightness: 3, option: 1, rainbow: false, color: 0x00ff00 };

// Packet layout (setLightSetting): speed inverted, option in the high nibble, Bit8 checksum.
const pk = buildLightingPacket(base);
check('single-colour packet', hex(pk) === '07 04 02 03 17 00 ff 00 d9 00', hex(pk));
check('rainbow sets colour mode 8', (buildLightingPacket({ ...base, rainbow: true })[4] & 15) === 8);
check('white is sent as FAFFFA', hex(buildLightingPacket({ ...base, color: 0xffffff })).startsWith('07 04 02 03 17 fa ff fa'));
const custom = buildLightingPacket({ effect: 13, speed: 0, brightness: 4, option: 2, rainbow: false, color: 0 });
check('custom pattern uses qmk.top fixed bytes', hex(custom).startsWith('07 0d 04 04 20 00 c8 c8'), hex(custom));
check('checksum covers bytes 0–7', pk[8] === 255 - ([...pk.slice(0, 8)].reduce((a, b) => a + b, 0) & 0xff) && pk[7] === 0);

// Blocked writes
const blocked = (name, l) => { try { buildLightingPacket(l); check(name, false, 'not blocked'); } catch (e) { check(name, true, e.message.split(':')[0]); } };
blocked('unknown effect refused', { ...base, effect: 30 });
blocked('music sync not offered', { ...base, effect: 22, option: 0 });
blocked('screen sync not offered', { ...base, effect: 21, option: 0 });
blocked('Off (0) not in the RT75 list', { ...base, effect: 0, option: 0 });
blocked('brightness above 4 refused', { ...base, brightness: 5 });
blocked('speed above 4 refused', { ...base, speed: -1 });
blocked('option out of range refused', { ...base, option: 4 });
blocked('option on an effect without options refused', { ...base, effect: 1, option: 1 });

// Decoding a reply
const r = lightingBytes(base);
r[0] = 0x87; // the reply echoes the GET command
check('decode round-trips', JSON.stringify(decodeLighting(r)) === JSON.stringify(base), JSON.stringify(decodeLighting(r)));
check('preset colour modes 0–6 decode to their colour', decodeLighting([0x87, 1, 4, 4, 0x02, 0, 0, 0]).color === 0xffff00);
check('FAFFFA decodes as white', decodeLighting([0x87, 1, 4, 4, 0x07, 0xfa, 0xff, 0xfa]).color === 0xffffff);
check('wrong reply ignored', decodeLighting([0x86, 1]) === undefined);

// Normalising and diffs
check('options dropped on effects without them', normalizeLighting({ ...base, effect: 1 }).option === 0 && normalizeLighting({ ...base, effect: 1 }).speed === 0);
check('effect change lists only what differs', lightingDiff(base, { ...base, effect: 2, option: 0 }).join() === 'effect');
check('a control the old effect lacked counts as changed', lightingDiff({ ...base, effect: 1, speed: 0, option: 0 }, { ...base, effect: 2, option: 0 }).join() === 'effect,speed');
check('Spectrum Cycle never goes out as rainbow', (buildLightingPacket({ ...base, effect: 3, option: 0, rainbow: true })[4] & 15) === 7);
check('colour ignored when rainbow',lightingDiff({ ...base, rainbow: true }, { ...base, rainbow: true, color: 1 }).length === 0);
check('every offered effect builds a valid packet', EFFECTS.filter(e => e.offered !== false).every(e => {
  try { buildLightingPacket(normalizeLighting({ ...base, effect: e.id, option: 0 })); return true; } catch { return false; }
}));

// Write + read back on the simulated keyboard
const dev = createDemoDevice(dump);
const s = await readSettings(dev);
check('settings include lighting', s.lighting?.effect === 4 && s.lighting.rainbow === true && s.lighting.brightness === 3);
const res = await writeLighting(dev, s, { effect: 2, speed: 4, brightness: 1, option: 0, rainbow: false, color: 0xff0000 });
check('write confirmed by read-back', res.mismatches.length === 0 && res.retried === 0 && res.lighting.effect === 2 && res.lighting.color === 0xff0000, JSON.stringify(res));
check('a fresh read shows it', (await readSettings(dev)).lighting.speed === 4);

// Retry recovers a dropped write
const dev2 = createDemoDevice(dump);
let dropped = false;
const orig = dev2.sendFeatureReport.bind(dev2);
dev2.sendFeatureReport = async (id, b) => { if (!dropped && b[0] === 0x07) { dropped = true; return; } return orig(id, b); };
const res2 = await writeLighting(dev2, await readSettings(dev2), { ...base });
check('retry recovers a dropped lighting write', res2.mismatches.length === 0 && res2.retried === 1);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
