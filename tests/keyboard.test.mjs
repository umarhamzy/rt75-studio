// Polling rate and profile writes against the demo's simulated keyboard.
import { readFileSync } from 'node:fs';
globalThis.setTimeout = f => (f(), 0);
const ROOT = new URL('../', import.meta.url).href;
const { writeReportRate, switchProfile, readSettings } = await import(ROOT + 'src/device.js');
const { createDemoDevice } = await import(ROOT + 'src/demo.js');
const dump = JSON.parse(readFileSync(new URL('../fixtures/sample-dump.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };
const hex = p => [...p.slice(0, 9)].map(b => b.toString(16).padStart(2, '0')).join(' ');

const dev = createDemoDevice(dump);
const sent = [];
const orig = dev.sendFeatureReport.bind(dev);
dev.sendFeatureReport = async (id, b) => { sent.push(Uint8Array.from(b)); return orig(id, b); };
const settings = await readSettings(dev);
check('starts at 1 kHz, profile 1', settings.reportRateHz === 1000 && settings.profile === 0);

sent.length = 0;
const got = await writeReportRate(dev, settings, 8000);
const w = sent.filter(p => p[0] === 0x03);
check('polling packet is 03 00 00 … checksum', w.length === 1 && hex(w[0]) === '03 00 00 00 00 00 00 fc 00', hex(w[0] ?? []));
check('read back 8 kHz', got === 8000);
check('device ID checked before writing', sent[0][0] === 0x8f);
check('125 Hz maps to code 6', (await writeReportRate(dev, settings, 125)) === 125 && sent.filter(p => p[0] === 0x03).pop()[2] === 6);

sent.length = 0;
const now = await switchProfile(dev, settings, 1);
const pw = sent.filter(p => p[0] === 0x04);
check('profile packet is 04 01 … checksum', pw.length === 1 && hex(pw[0]) === '04 01 00 00 00 00 00 fa 00', hex(pw[0] ?? []));
check('reads back profile 2', now === 1);
const s2 = await readSettings(dev);
check('profile 2 has its own key settings', s2.profile === 1 && s2.magnet.actuation[14] === 200 && s2.magnet.mode[9] === 0);
await switchProfile(dev, settings, 0);
const s1 = await readSettings(dev);
check('back on profile 1 the original values return', s1.profile === 0 && s1.magnet.actuation[14] === 160 && s1.magnet.mode[9] === 0x87);

const blocked = async (name, fn) => { const before = sent.length; try { await fn(); check(name, false, 'was not blocked'); } catch (e) { check(name, !sent.slice(before).some(p => p[0] === 0x03 || p[0] === 0x04), e.message.split(':')[0]); } };
await blocked('rejects an unsupported rate', () => writeReportRate(dev, settings, 3000));
await blocked('rejects profile 5', () => switchProfile(dev, settings, 4));
await blocked('rejects a different device', () => writeReportRate(dev, { ...settings, deviceId: 1 }, 1000).then(() => { throw new Error('should have thrown'); }));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
