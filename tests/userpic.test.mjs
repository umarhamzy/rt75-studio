// Custom lighting patterns (0x0C write / 0x8C read) against the demo's simulated keyboard.
import { readFileSync } from 'node:fs';
globalThis.setTimeout = f => (f(), 0);
const { buildUserPicPackets, readUserPic, writeUserPic, readSettings, USERPIC_BYTES } = await import(new URL('../src/device.js', import.meta.url).href);
const { createDemoDevice } = await import(new URL('../src/demo.js', import.meta.url).href);
const dump = JSON.parse(readFileSync(new URL('../fixtures/sample-dump.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };
const hex = p => [...p.slice(0, 10)].map(b => b.toString(16).padStart(2, '0')).join(' ');
const blocked = (name, fn) => { try { fn(); check(name, false, 'not blocked'); } catch (e) { check(name, true, e.message.split(':')[0]); } };

const colors = Array.from({ length: 384 }, (_, i) => (i * 7) % 256);
const pk = buildUserPicPackets(colors, 2);
check('seven packets', pk.length === 7);
check('page header (pattern 3, page 0, 56 bytes)', hex(pk[0]).startsWith('0c 02 ff 00 38 00 00'), hex(pk[0]));
check('last page: 42 bytes, last flag', pk[6][3] === 6 && pk[6][4] === 42 && pk[6][5] === 1, hex(pk[6]));
check('data in order', pk[1][8] === colors[56] && pk[6][8 + 41] === colors[377] && pk[6][8 + 42] === 0);
check('378 bytes in all', pk.reduce((a, p) => a + p[4], 0) === USERPIC_BYTES);
blocked('pattern 6 refused', () => buildUserPicPackets(colors, 5));
blocked('a value over 255 refused', () => buildUserPicPackets(colors.map((v, i) => (i === 5 ? 256 : v)), 0));

const dev = createDemoDevice(dump);
const s = await readSettings(dev, () => {}, { keymaps: false });
const sent = [];
const send = dev.sendFeatureReport.bind(dev);
dev.sendFeatureReport = async (id, b) => { sent.push([...b.slice(0, 5)]); return send(id, b); };
const before = await readUserPic(dev, s, 0);
check('a pattern reads as 384 bytes, pages 0–5', before.length === 384 && sent.filter(b => b[0] === 0x8c).map(b => b[3]).join() === '0,1,2,3,4,5');
let threw = false;
try { await readUserPic(dev, s, 5); } catch { threw = true; }
check('reading pattern 6 is refused before anything is sent', threw && !sent.some(b => b[0] === 0x8c && b[1] === 5));
sent.length = 0;
const res = await writeUserPic(dev, s, 1, colors);
check('written and read back', res.mismatches === 0 && res.retried === 0 && res.colors.slice(0, 378).join() === colors.slice(0, 378).join(), String(res.mismatches));
check('device check, seven writes, then six reads', sent.map(b => b[0]).join() === '143,12,12,12,12,12,12,12,140,140,140,140,140,140', sent.map(b => b[0]).join());
check('other patterns untouched', (await readUserPic(dev, s, 0)).join() === before.join());

// A dropped page is re-sent once.
const dev2 = createDemoDevice(dump);
const s2 = await readSettings(dev2, () => {}, { keymaps: false });
let dropped = false;
const send2 = dev2.sendFeatureReport.bind(dev2);
dev2.sendFeatureReport = async (id, b) => { if (!dropped && b[0] === 0x0c && b[3] === 3) { dropped = true; return; } return send2(id, b); };
const res2 = await writeUserPic(dev2, s2, 0, colors);
check('retry recovers a dropped page', res2.retried === 1 && res2.mismatches === 0);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
