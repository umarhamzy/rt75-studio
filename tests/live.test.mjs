const ROOT = new URL('../src/', import.meta.url).href;
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (f) => (f(), 0);
const { startLiveTravel } = await import(ROOT + 'device.js');
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };
const hex = p => [...p.slice(0, 9)].map(b => b.toString(16).padStart(2, '0')).join(' ');

const sent = [];
const feature = { productId: 0x5030, opened: false, async open() { this.opened = true; }, async close() { this.opened = false; },
  async sendFeatureReport(id, b) { sent.push(Uint8Array.from(b)); } };
const input = new EventTarget();
Object.assign(input, { opened: false, async open() { this.opened = true; }, async close() { this.opened = false; } });
const push = bytes => { const d = new Uint8Array(31); d.set(bytes); const e = new Event('inputreport'); e.reportId = 0; e.data = new DataView(d.buffer); input.dispatchEvent(e); };

const samples = [];
const stop = await startLiveTravel(feature, { travelStep: 200 }, v => samples.push(v), input);
check('turn-on packet is 1B 01 with checksum', sent.length === 1 && hex(sent[0]) === '1b 01 00 00 00 00 00 e3 00', hex(sent[0]));
push([0x1b, 160, 0]); push([0x1b, 0x94, 0x02]); push([0x05, 1, 2]);
check('decodes depth (160 → 0.80 mm, 660 → 3.30 mm)', samples.length === 2 && samples[0] === 0.8 && samples[1] === 3.3, JSON.stringify(samples));
check('ignores other vendor reports', samples.length === 2);
check('both interfaces opened', feature.opened && input.opened);
await stop();
check('turn-off packet is 1B 00 with checksum', sent.length === 2 && hex(sent[1]) === '1b 00 00 00 00 00 00 e4 00', hex(sent[1]));
push([0x1b, 100, 0]);
check('no samples after stop', samples.length === 2);
check('interfaces closed after stop', !feature.opened && !input.opened);
await stop();
check('stop is idempotent', sent.length === 2);
try { await startLiveTravel({ ...feature, productId: 0x5038 }, { travelStep: 200 }, () => {}, input); check('refuses the 2.4G dongle', false); }
catch (e) { check('refuses the 2.4G dongle', /USB cable/.test(e.message), e.message); }
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
