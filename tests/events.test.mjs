// Knob, lighting and Win/Mac reports (listen-only, watchKeyboardEvents) and the KB-option read
// (0x89), against the demo keyboard's report interface.
import { readFileSync } from 'node:fs';
const { readSettings, readKbOption, watchKeyboardEvents } = await import(new URL('../src/device.js', import.meta.url).href);
const { createDemoDevice } = await import(new URL('../src/demo.js', import.meta.url).href);
const dump = JSON.parse(readFileSync(new URL('../fixtures/sample-dump.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };
const wait = ms => new Promise(r => setTimeout(r, ms));

// KB options
const dev = createDemoDevice(dump);
const s = await readSettings(dev, () => {}, { keymaps: false });
check('startup reads the keyboard’s Win/Mac switch', s.kbOption?.system === 'win' && s.kbOption.fnIndex === 0, JSON.stringify(s.kbOption));
dev.demoOs = 1;
check('re-read reports Mac', (await readKbOption(dev, s))?.system === 'mac');
dev.demoOs = 0;

// Reports the keyboard sends by itself. Nothing may be sent while listening.
const sent = [];
const orig = dev.sendFeatureReport.bind(dev);
dev.sendFeatureReport = (id, b) => { sent.push(b[0]); return orig(id, b); };
const events = [];
await wait(1600); // past the grace period after our own reads
const stop = await watchKeyboardEvents(dev, e => events.push(e), dev.demoInput);
const push = (id, bytes) => { const e = new Event('inputreport'); e.reportId = id; const d = new Uint8Array(31); d.set(bytes); e.data = new DataView(d.buffer); dev.demoInput.dispatchEvent(e); };

push(3, [0xe9, 0]); push(3, [0, 0]); push(3, [0xea, 0]); push(3, [0xe2, 0]);
check('consumer reports become volume up / down / mute', events.map(e => e.action).join() === 'up,down,mute', JSON.stringify(events));
events.length = 0;

push(5, [0x06, 3]); push(5, [0x0f, 1]); push(5, [0x0f, 0]);
push(5, [0x04, 0x0c]); push(5, [0x0f, 1]); push(5, [0x0f, 0]);
check('lighting pushes give brightness and effect, and their 0F pairs aren’t holds',
  events.map(e => e.type).join() === 'brightness,effect' && events[0].value === 3 && events[1].value === 12, JSON.stringify(events));
events.length = 0;

await wait(60);
push(5, [0x0f, 1]); push(5, [0x0f, 0]);
check('a lone 0F pair is a knob hold (mode toggle)', events.length === 1 && events[0].type === 'toggle', JSON.stringify(events));
events.length = 0;

push(5, [0x03, 0x02, 0x00]); push(5, [0x0f, 1]); push(5, [0x0f, 0]);
push(5, [0x03, 0x00, 0x02]);
check('03 pushes report the Win/Mac switch (bit 1 = Mac)', events.map(e => e.os).join() === 'mac,win', JSON.stringify(events));
events.length = 0;

push(5, [0x03, 0x01, 0x08]); // Fn-layer switch, not an OS change
check('other 03 pushes are not OS changes', !events.some(e => e.type === 'os'), JSON.stringify(events));

await stop();
check('listening sent nothing to the keyboard', sent.length === 0, sent.map(b => b.toString(16)).join(' '));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
