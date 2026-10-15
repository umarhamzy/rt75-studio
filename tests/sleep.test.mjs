import { readFileSync } from 'node:fs';
globalThis.setTimeout = f => (f(), 0);
const ROOT = new URL('../', import.meta.url).href;
const { writeSleepTimes, readSettings } = await import(ROOT + 'src/device.js');
const { createDemoDevice } = await import(ROOT + 'src/demo.js');
const dump = JSON.parse(readFileSync(new URL('../fixtures/sample-dump.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };
const hex = p => [...p.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join(' ');

const dev = createDemoDevice(dump);
const sent = [];
const orig = dev.sendFeatureReport.bind(dev);
dev.sendFeatureReport = async (id, b) => { sent.push(Uint8Array.from(b)); return orig(id, b); };

const s = await readSettings(dev);
check('reads the four timers', JSON.stringify(s.sleep) === JSON.stringify({ time_bt: 120, time_24: 120, deepTime_bt: 1680, deepTime_24: 1680 }), JSON.stringify(s.sleep));

sent.length = 0;
const got = await writeSleepTimes(dev, s, { time_bt: 300, deepTime_bt: 3600 });
const w = sent.filter(p => p[0] === 0x11);
check('one sleep packet with all four values', w.length === 1 && hex(w[0]) === '11 00 00 00 00 00 00 ee 2c 01 78 00 10 0e 90 06', hex(w[0] ?? []));
check('read back new BT values, 2.4G unchanged', got.time_bt === 300 && got.deepTime_bt === 3600 && got.time_24 === 120 && got.deepTime_24 === 1680, JSON.stringify(got));
check('never (0) allowed for backlight off', (await writeSleepTimes(dev, { ...s, sleep: got }, { time_24: 0 })).time_24 === 0);
check('18 h maximum allowed', (await writeSleepTimes(dev, { ...s, sleep: got }, { time_bt: 64800 })).time_bt === 64800);

const blocked = async (name, sleep) => { const before = sent.length; try { await writeSleepTimes(dev, s, sleep); check(name, false, 'not blocked'); } catch (e) { check(name, !sent.slice(before).some(p => p[0] === 0x11), e.message); } };
await blocked('blocks BT deep sleep under 10 s', { deepTime_bt: 5 });
await blocked('blocks more than 18 h', { time_bt: 64801 });
await blocked('blocks fractions of a second', { time_24: 1.5 });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
