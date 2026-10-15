// Loading the key map later (readSettings { keymaps: false } + readKeymaps), progress labels, and
// device operations running one at a time.
import { readFileSync } from 'node:fs';
globalThis.setTimeout = f => (f(), 0);
const { readSettings, readKeymaps, writeReportRate } = await import(new URL('../src/device.js', import.meta.url).href);
const { createDemoDevice } = await import(new URL('../src/demo.js', import.meta.url).href);
const dump = JSON.parse(readFileSync(new URL('../fixtures/sample-dump.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };

const full = await readSettings(createDemoDevice(dump));

// Startup without the key map: 24 fewer reads, nothing else missing.
const dev = createDemoDevice(dump);
const labels = [];
const s = await readSettings(dev, (f, label) => labels.push([f, label]), { keymaps: false });
check('startup skips the key map and Fn layers', s.keymap === undefined && s.fnWin === undefined && s.fnMac === undefined);
check('startup reads 24 fewer times', s.loadStats.reads === full.loadStats.reads - 24, `${s.loadStats.reads} vs ${full.loadStats.reads}`);
check('everything else is read', JSON.stringify(s.magnet) === JSON.stringify(full.magnet) && s.lighting?.effect === full.lighting.effect && s.sleep && s.profile === full.profile);
check('progress names what is being read now, in order', labels[0][1] === 'Device ID' && labels.some(l => l[1] === 'Debounce and sleep timers') && labels.at(-1)[1] === 'Done');
check('progress only goes up and ends at 1', labels.every((l, i) => i === 0 || l[0] >= labels[i - 1][0]) && labels.at(-1)[0] === 1);

// The key map on demand.
const kmLabels = [];
const km = await readKeymaps(dev, s, (f, label) => kmLabels.push(label));
check('readKeymaps returns the same layers', km.keymap.join() === full.keymap.join() && km.fnWin.join() === full.fnWin.join() && km.fnMac.join() === full.fnMac.join());
check('readKeymaps labels', kmLabels.includes('Key map') && kmLabels.includes('Fn layers'));

// Operations started together run one at a time (each opens and closes the keyboard).
const dev2 = createDemoDevice(dump);
let misuse = 0;
const send = dev2.sendFeatureReport.bind(dev2), recv = dev2.receiveFeatureReport.bind(dev2);
dev2.sendFeatureReport = async (id, b) => { if (!dev2.opened) misuse++; return send(id, b); };
dev2.receiveFeatureReport = async () => { if (!dev2.opened) misuse++; return recv(); };
const s2 = await readSettings(dev2, () => {}, { keymaps: false });
const [km2, rate] = await Promise.all([readKeymaps(dev2, s2), writeReportRate(dev2, s2, 2000), readSettings(dev2, () => {}, { keymaps: false })]);
check('overlapping operations never use a closed device', misuse === 0, `${misuse} reports on a closed device`);
check('and all of them complete correctly', km2.keymap.join() === full.keymap.join() && rate === 2000);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
