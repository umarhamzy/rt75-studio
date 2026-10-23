// Golden packet test: drives every device operation against the simulated keyboard, logs every packet
// sent, and checks which values, slots and actions the validators accept. The result must match
// fixtures/packets-golden.json byte for byte, so refactors (like moving the RT75's constants into
// a model file) provably change nothing on the wire.
// Regenerate (only when a change to the packets is intended): node tests/packets.test.mjs --update
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = new URL('../src/', import.meta.url).href;
globalThis.setTimeout = (f) => (f(), 0);
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
const D = await import(ROOT + 'device.js');
const L = await import(ROOT + 'lighting.js');
const P = await import(ROOT + 'patterns.js');
const M = await import(ROOT + 'macros.js');
const layout = await import(ROOT + 'model.js').catch(() => import(ROOT + 'layout.js'));
const { createDemoDevice } = await import(ROOT + 'demo.js');
const { DEFAULT_TRIGGERS } = await import(ROOT + 'dks.js');
const GOLDEN = new URL('../fixtures/packets-golden.json', import.meta.url);

const dump = JSON.parse(readFileSync(new URL('../fixtures/sample-dump.json', import.meta.url), 'utf8'));
const hex = p => [...p].map(b => b.toString(16).padStart(2, '0')).join('').replace(/(00)+$/, '');
const out = { session: [], accepts: {}, constants: {} };

// ---- 1. A session through every device operation, logging what is sent ----
const dev = createDemoDevice(dump);
const send = dev.sendFeatureReport.bind(dev);
dev.sendFeatureReport = (id, buf) => { out.session.push(hex(Uint8Array.from(buf))); return send(id, buf); };
const step = async (name, fn) => {
  out.session.push(`# ${name}`);
  try { const r = await fn(); out.session.push(`= ${JSON.stringify(r ?? null)}`.slice(0, 400)); }
  catch (e) { out.session.push(`! ${e.message}`); }
};

let s;
await step('readSettings', async () => { s = await D.readSettings(dev); return { id: s.deviceId, step: s.travelStep, profile: s.profile }; });
await step('readSettings without key maps', async () => (await D.readSettings(dev, () => {}, { keymaps: false })).deviceId);
await step('readKeymaps', async () => (await D.readKeymaps(dev, s)).keymap.length);
await step('readKeymaps profile 4 (blocked)', () => D.readKeymaps(dev, { ...s, profile: 4 }));
await step('readDksSettings', async () => (await D.readDksSettings(dev, s)).dksTriggers.length);
await step('readKbOption', () => D.readKbOption(dev, s));
await step('readCurrentProfile', () => D.readCurrentProfile(dev, s));
const quad = (DEFAULT_TRIGGERS * 0x01010101) >>> 0;
await step('writeKeySettings', () => D.writeKeySettings(dev, s, [
  { slot: 20, mode: 0x80, rtPress: 40, rtRelease: 40 },
  { slot: 14, actuation: 100, release: 120, bottomDeadZone: 20, topDeadZone: 10 },
  { slot: 15, mode: 2, dksTravel: 140, dksTriggers: quad },
  { slot: 16, mode: 3, mtTime: 20 },
  { slot: 21, switchType: 46 },
  { slot: 9, mode: 0x87, snapPartner: 15 },
]).then(r => ({ mismatches: r.mismatches, retried: r.retried })));
await step('writeKeySettings blocked', () => D.writeKeySettings(dev, s, [{ slot: 14, actuation: 2000 }]));
await step('writeKeymap', () => D.writeKeymap(dev, s, [
  { layer: 'base', slot: 14, action: [0, 224, 4, 0] },
  { layer: 'tap', slot: 16, action: [0, 5, 0, 0] },
  { layer: 'fnWin', slot: 20, action: [0, 6, 0, 0] },
  { layer: 'fnMac', slot: 20, action: [9, 1, 3, 0] },
]).then(r => ({ mismatches: r.mismatches, retried: r.retried })));
await step('writeLighting', () => D.writeLighting(dev, s, { effect: 4, speed: 2, brightness: 3, option: 1, rainbow: false, color: 0x123456 }));
const colors = Array.from({ length: P.PATTERN_BYTES }, (_, i) => (i * 7) % 256);
await step('writeUserPic', () => D.writeUserPic(dev, s, 2, colors).then(r => ({ mismatches: r.mismatches })));
await step('readUserPic', async () => (await D.readUserPic(dev, s, 2)).length);
await step('readUserPic pattern 6 (blocked)', () => D.readUserPic(dev, s, 5));
const macro = { repeat: 2, steps: [224, 6].map(c => ({ kind: 'key', code: c, down: true, delay: 20 })).concat([6, 224].map(c => ({ kind: 'key', code: c, down: false, delay: 300 }))) };
await step('writeMacros', () => D.writeMacros(dev, s, [{ slot: 3, macro }, { slot: 49, macro }]));
await step('writeMacros slot 50 (blocked)', () => D.writeMacros(dev, s, [{ slot: 50, macro }]));
await step('readMacroSlotsInUse', () => D.readMacroSlotsInUse(dev, s));
for (const hz of [...D.RATE_OPTIONS, 3000]) await step(`writeReportRate ${hz}`, () => D.writeReportRate(dev, s, hz));
for (const i of [1, 3, 4, 0]) await step(`switchProfile ${i}`, () => D.switchProfile(dev, s, i));
await step('writeSleepTimes', () => D.writeSleepTimes(dev, s, { time_bt: 300, time_24: 0, deepTime_bt: 3600 }));
await step('writeSleepTimes out of range', () => D.writeSleepTimes(dev, s, { deepTime_bt: 5 }));
await step('startLiveTravel', async () => { const stop = await D.startLiveTravel(dev, s, () => {}, dev.demoInput); await stop(); });

// ---- 2. What the validators accept, as bit strings ----
const ok = fn => { try { fn(); return '1'; } catch { return '0'; } };
const SLOTS = Array.from({ length: 140 }, (_, i) => i);
const VALUES = [0, 1, 2, 9, 10, 19, 20, 21, 50, 99, 100, 101, 140, 199, 200, 201, 250, 255, 256, 329, 330, 331, 399, 400, 401, 499, 500, 501, 659, 660, 661, 999, 1000, 1001, 2000, 3300, 3301, 65535];
const VALID = { mode: 0x80, actuation: 200, release: 200, bottomDeadZone: 20, rtPress: 40, rtRelease: 40, topDeadZone: 10, snapPartner: 15, mtTime: 20, dksTravel: 140, dksTriggers: quad, switchType: 1 };
for (const step of [10, 100, 200, 1000]) {
  const b = D.writeBounds(step);
  out.accepts[`bounds ${step}`] = JSON.stringify(b);
  if (!b) continue;
  for (const [field, v] of Object.entries(VALID)) {
    out.accepts[`${field} slots @${step}`] = SLOTS.map(slot => ok(() => D.buildWritePackets([{ slot: slot === 15 && field === 'snapPartner' ? 14 : slot, [field]: v }], b))).join('');
    out.accepts[`${field} values @${step}`] = VALUES.map(x => ok(() => D.buildWritePackets([{ slot: 14, [field]: x }], b))).join('');
  }
  for (const field of ['mode', 'switchType', 'snapPartner', 'topDeadZone', 'mtTime']) {
    out.accepts[`${field} bytes @${step}`] = Array.from({ length: 256 }, (_, x) => ok(() => D.buildWritePackets([{ slot: 14, [field]: x }], b))).join('');
  }
  out.accepts[`dksTriggers bytes @${step}`] = Array.from({ length: 256 }, (_, x) => ok(() => D.buildWritePackets([{ slot: 14, dksTriggers: (x * 0x01010101) >>> 0 }], b))).join('');
}
const ACTIONS = [[0, 0, 0, 0], [0, 4, 0, 0], [0, 224, 4, 0], [0, 224, 225, 4], [0, 4, 5, 0], [0, 0, 4, 0], [9, 1, 0, 0], [9, 1, 49, 0], [9, 1, 50, 0], [9, 0, 0, 0], [1, 0, 1, 0], [1, 0, 245, 1], [3, 0, 226, 0], [13, 2, 1, 0], [10, 4, 0, 0], [255, 255, 255, 255]];
for (const layer of Object.keys(D.KEYMAP_LAYERS)) {
  for (const a of ACTIONS) out.accepts[`${layer} ${a}`] = SLOTS.map(slot => ok(() => { if (!D.isWritableAction(a, layer, slot)) throw 0; })).join('');
  out.accepts[`${layer} factory`] = SLOTS.map(slot => ok(() => { if (!D.isWritableAction(D.KEYMAP_LAYERS[layer].factory.slice(slot * 4, slot * 4 + 4), layer, slot)) throw 0; })).join('');
  for (const profile of [0, 3, 4]) out.accepts[`${layer} packets profile ${profile}`] = SLOTS.map(slot => ok(() => D.buildKeymapPackets([{ layer, slot, action: [0, 0, 0, 0] }], profile))).join('');
}
for (const e of L.EFFECTS) {
  out.accepts[`light ${e.id}`] = [0, 1, 2, 3, 4, 5].flatMap(option => [false, true].flatMap(rainbow => [0, 4, 5].map(level =>
    ok(() => D.buildLightingPacket({ effect: e.id, speed: level, brightness: level, option, rainbow, color: 0x102030 }))))).join('');
}
out.accepts['userpic layers'] = [0, 1, 2, 3, 4, 5].map(l => ok(() => D.buildUserPicPackets(colors, l))).join('');
out.accepts['userpic sizes'] = [377, 378, 384].map(n => ok(() => D.buildUserPicPackets(colors.slice(0, n), 0))).join('');
out.accepts['userpic packets'] = D.buildUserPicPackets(colors, 4).map(hex).join(' ');
out.accepts['macro packets'] = D.buildMacroPackets(7, macro).map(hex).join(' ');

// ---- 3. Constants and layout the app reads ----
const C = out.constants;
for (const k of ['WRITABLE', 'SWITCH_TYPES', 'LIMITS', 'RATE_OPTIONS', 'PROFILE_COUNT', 'SLEEP_LIMITS', 'USERPIC_LAYERS', 'USERPIC_BYTES']) C[k] = JSON.stringify(D[k]);
C.LOCKED_SLOTS = JSON.stringify([...D.LOCKED_SLOTS]);
C.travelStep = JSON.stringify([[undefined, 0x512, undefined], [undefined, 0x300, undefined], [undefined, 0x200, undefined], ['0.001mm', 0, 0]].map(a => D.travelStep(...a)));
for (const k of ['DEVICE_ID', 'LAYOUT_WIDTH', 'LAYOUT_HEIGHT', 'KEYS', 'DEFAULT_MATRIX', 'DEFAULT_FN_MATRIX', 'DEFAULT_FN_MAC_MATRIX']) C[k] = JSON.stringify(layout[k]);
C.EFFECTS = JSON.stringify(L.EFFECTS);
C.MAX_LEVEL = JSON.stringify(L.MAX_LEVEL);
C.PATTERN_BYTES = JSON.stringify(P.PATTERN_BYTES);
C.MAX_MACROS = JSON.stringify(M.MAX_MACROS);
C.demo = JSON.stringify({ productName: dev.productName, vendorId: dev.vendorId, productId: dev.productId, input: [dev.demoInput.productName, dev.demoInput.vendorId, dev.demoInput.productId] });

// ---- Compare ----
if (process.argv.includes('--update')) {
  writeFileSync(GOLDEN, JSON.stringify(out, null, 1) + '\n');
  console.log(`PASS golden file written (${out.session.length} session lines, ${Object.keys(out.accepts).length} validator checks)`);
} else {
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  let failures = 0;
  const check = (name, a, b) => {
    const same = JSON.stringify(a) === JSON.stringify(b);
    if (!same) failures++;
    console.log(`${same ? 'PASS' : 'FAIL'} ${name}`);
  };
  const i = out.session.findIndex((l, n) => l !== golden.session[n]);
  check(`session: ${out.session.length} packets and results identical${i >= 0 || out.session.length !== golden.session.length ? ` (first difference at line ${i}: ${out.session[i]} vs ${golden.session[i]})` : ''}`, out.session, golden.session);
  for (const key of new Set([...Object.keys(golden.accepts), ...Object.keys(out.accepts)])) if (out.accepts[key] !== golden.accepts[key]) check(`validator: ${key}`, out.accepts[key], golden.accepts[key]);
  check(`validators: ${Object.keys(golden.accepts).length} accept/block patterns identical`, out.accepts, golden.accepts);
  for (const key of new Set([...Object.keys(golden.constants), ...Object.keys(out.constants)])) check(`constant: ${key}`, out.constants[key], golden.constants[key]);
  process.exitCode = failures ? 1 : 0;
}
