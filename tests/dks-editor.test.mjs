// DKS editor patterns (src/dks.js): every edit the editor can make stays a pattern qmk.top's editor
// can make (device.js isDksAction), and the clicks do what the hint says.
const D = await import(new URL('../src/dks.js', import.meta.url).href);
const { isDksAction } = await import(new URL('../src/device.js', import.meta.url).href);

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };
const same = (a, b) => a.join() === b.join();

const valid = [...Array(256).keys()].filter(isDksAction);
check('pack and unpack round-trip', valid.every(b => D.pack(D.unpack(b)) === b));
check('the default pattern is valid and holds press → release', isDksAction(D.DEFAULT_TRIGGERS) && D.describe(D.unpack(D.DEFAULT_TRIGGERS)) === 'held press → release', D.describe(D.unpack(D.DEFAULT_TRIGGERS)));

let bad = [];
for (const b of valid) {
  const c = D.unpack(b);
  for (let i = 0; i < 4; i++) if (!isDksAction(D.pack(D.cycleMoment(c, i)))) bad.push(`cycle ${c} @${i}`);
  for (const h of D.holds(c)) for (let s = h.start; s < h.end; s++) if (!isDksAction(D.pack(D.cutHold(c, h.start, s)))) bad.push(`cut ${c} ${h.start}/${s}`);
}
check('every click on every valid pattern gives a valid pattern', !bad.length, bad.slice(0, 4).join('; '));

// Reachable from nothing by clicks alone: everything qmk.top's editor can make with one action's holds and taps.
const seen = new Set([0]), queue = [[0, 0, 0, 0]];
while (queue.length) {
  const c = queue.shift();
  const next = [0, 1, 2, 3].map(i => D.cycleMoment(c, i));
  for (const h of D.holds(c)) for (let s = h.start; s < h.end; s++) next.push(D.cutHold(c, h.start, s));
  for (const n of next) if (!seen.has(D.pack(n))) { seen.add(D.pack(n)); queue.push(n); }
}
check('clicks reach every single hold and tap combination', [[3, 3, 2, 0], [0, 3, 2, 0], [1, 2, 1, 1], [2, 0, 2, 1], [3, 2, 0, 1]].every(c => seen.has(D.pack(c))), `${seen.size} patterns`);

// The dot cycle: nothing → tap → hold → hold further → nothing.
let c = [0, 0, 0, 0];
const steps = [];
for (let k = 0; k < 5; k++) { c = D.cycleMoment(c, 0); steps.push(c.join('')); }
check('a dot cycles nothing → tap → hold 1 → 2 → 3 → nothing', steps.join(' ') === '1000 2000 3200 3320 0000', steps.join(' '));
check('the last moment only taps', same(D.cycleMoment([0, 0, 0, 0], 3), [0, 0, 0, 1]) && same(D.cycleMoment([0, 0, 0, 1], 3), [0, 0, 0, 0]));
check('a dot inside a hold ends the hold there', same(D.cycleMoment([3, 3, 2, 0], 2), [3, 2, 0, 0]) && same(D.cycleMoment([3, 3, 2, 0], 1), [2, 0, 0, 0]));
check('clicking a hold ends it where clicked', same(D.cutHold([3, 3, 2, 0], 0, 1), [2, 0, 0, 0]) && same(D.cutHold([3, 3, 2, 0], 0, 2), [3, 2, 0, 0]));
check('clicking a one-step hold leaves a tap', same(D.cutHold([0, 2, 0, 0], 1, 1), [0, 1, 0, 0]));

check('holds are read as qmk.top writes them', JSON.stringify(D.holds([3, 2, 0, 1])) === '[{"start":0,"end":2}]' && JSON.stringify(D.holds([2, 2, 0, 0])) === '[{"start":0,"end":1},{"start":1,"end":2}]');
check('describe', D.describe([3, 2, 0, 1]) === 'held press → lift, tap at release' && D.describe([0, 1, 0, 0]) === 'tap at bottom', D.describe([3, 2, 0, 1]));

check('trigger bytes are per action, action 1 lowest', D.actionByte(0x00ff0a2f, 0) === 0x2f && D.actionByte(0x00ff0a2f, 2) === 0xff && D.setActionByte(0x00ff0a2f, 1, 0x01) === 0x00ff012f && D.setActionByte(0, 3, 0x80) === 0x80000000);

// One scrubbed press with the trigger point at 1.0 mm (bottom 3.2 mm).
const m = t => D.pressAt(t, 1, 3.2).moment;
check('the scrub passes the moments in order', [m(5), m(20), m(45), m(70), m(95)].join() === '-1,0,1,2,3', [m(5), m(20), m(45), m(70), m(95)].join());
check('held and tapped after a moment', D.heldAfter([3, 2, 0, 0], 1) && !D.heldAfter([3, 2, 0, 0], 2) && D.tappedAt([0, 1, 0, 0], 1) && !D.tappedAt([0, 1, 0, 0], -1));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
