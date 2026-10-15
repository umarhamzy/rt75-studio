// 2.4G dongle relay: routing (F6), status polling (F7), reply fetch (FC), against a simulated dongle
// wrapped around the demo keyboard. Checks the fast and classic (qmk.top) timings.
import { readFileSync } from 'node:fs';
const delays = [];
globalThis.setTimeout = (f, ms) => { delays.push(ms ?? 0); f(); return 0; };
const { readSettings, setDongleTiming, writeReportRate } = await import(new URL('../src/device.js', import.meta.url).href);
const { createDemoDevice } = await import(new URL('../src/demo.js', import.meta.url).href);
const dump = JSON.parse(readFileSync(new URL('../fixtures/sample-dump.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };

// A dongle that becomes ready after `lag` status polls (Infinity = never).
function fakeDongle({ lag = 0 } = {}) {
  const kb = createDemoDevice(dump);
  const log = { routes: 0, status: 0, fetch: 0, relayed: 0 };
  let last = null, polls = 0, phase = 'idle'; // idle → sent (waiting for reply) → ready
  return {
    log,
    productName: 'Dongle', vendorId: 0x3151, productId: 0x5038,
    collections: [{ usagePage: 0xffff, usage: 2, featureReports: [{}] }],
    opened: false, async open() { this.opened = true; }, async close() { this.opened = false; },
    async sendFeatureReport(id, b) {
      last = b[0];
      if (b[0] === 0xf6) { log.routes++; return; }
      if (b[0] === 0xf7) { log.status++; polls++; return; }
      if (b[0] === 0xfc) { log.fetch++; return; }
      log.relayed++;
      polls = 0;
      phase = 'sent';
      await kb.sendFeatureReport(id, b);
    },
    async receiveFeatureReport() {
      if (last === 0xf7) {
        const ready = polls > lag;
        const r = new Uint8Array(64);
        // [canRead, kbBattery, mouseBattery, kbOffline, mouseOffline, canSend]
        r.set([phase === 'sent' && ready ? 1 : 0, 87, 0, 0, 1, ready ? 1 : 0]);
        return new DataView(r.buffer);
      }
      phase = 'idle';
      return kb.receiveFeatureReport();
    },
  };
}
const wired = await readSettings(createDemoDevice(dump));

// Fast timing (default)
let d = fakeDongle();
delays.length = 0;
let s = await readSettings(d);
check('2.4G read returns the same settings as wired', JSON.stringify(s.magnet) === JSON.stringify(wired.magnet) && s.keymap.join() === wired.keymap.join() && s.fnWin.join() === wired.fnWin.join());
check('routes to the keyboard once per load (like qmk.top)', d.log.routes === 1, `${d.log.routes} routes`);
check('fast timing: no fixed 100 ms waits when the dongle is ready', !delays.includes(100), `${delays.filter(x => x === 100).length} × 100 ms`);
check('load stats recorded', s.loadStats?.reads === wired.loadStats.reads && s.loadStats.timing === 'fast', JSON.stringify(s.loadStats));

d = fakeDongle({ lag: 3 });
s = await readSettings(d);
check('a slower dongle still works (ready after 3 polls)', s.keymap.join() === wired.keymap.join());

d = fakeDongle({ lag: Infinity });
let err = '';
try { await readSettings(d); } catch (e) { err = e.message; }
check('a dongle that never gets ready times out with a clear error', /Dongle|asleep/.test(err), err);

// Writes route once too and keep their read-back.
d = fakeDongle();
s = await readSettings(d);
d.log.routes = 0;
const got = await writeReportRate(d, s, 4000);
check('write through the dongle reads back', got === 4000);
check('write routes once', d.log.routes === 1);

// Classic timing (?dongle=classic): qmk.top's 100 ms before every status check.
setDongleTiming('classic');
d = fakeDongle();
delays.length = 0;
s = await readSettings(d);
const hundreds = delays.filter(x => x === 100).length;
// Every status check waits 100 ms first, except the one "is the keyboard awake?" check at the start.
check('classic timing waits 100 ms before each status check', hundreds === d.log.status - 1, `${hundreds} waits, ${d.log.status} status checks`);
check('classic timing labelled in load stats', s.loadStats.timing === 'classic');
setDongleTiming('fast');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
