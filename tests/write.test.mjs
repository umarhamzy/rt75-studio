// Simulated RT75 Pro: stores magnet params, applies 0x65 single-key writes, serves 0xE5/0x8F reads.
import { readFileSync } from 'node:fs';
const ROOT = new URL('../src/', import.meta.url).href;
globalThis.setTimeout = (f) => (f(), 0);
const dev_ = await import(ROOT + 'device.js');
const { buildWritePackets, writeKeySettings, writeBounds } = dev_;

const dump = JSON.parse(readFileSync(new URL('../fixtures/sample-dump.json', import.meta.url), 'utf8'));
const PARAMS = { 7: 'mode', 0: 'actuation', 1: 'release', 6: 'bottomDeadZone', 2: 'rtPress', 3: 'rtRelease', 251: 'topDeadZone', 9: 'snapPartner', 252: 'switchType' };
const WIDE = new Set([0, 1, 6, 2, 3]);

function makeDevice({ ignoreSlot, dropOnce } = {}) {
  let dropped = false;
  const store = structuredClone(dump.magnet);
  const log = [];
  let last;
  return {
    store, log, productId: 0x5030, opened: false,
    async open() { this.opened = true; }, async close() { this.opened = false; },
    async sendFeatureReport(id, buf) {
      last = Uint8Array.from(buf);
      log.push(last);
      if (last[0] === 0x65) {
        const name = PARAMS[last[1]], slot = last[3];
        if (slot === ignoreSlot) return;           // simulate the keyboard dropping a write
        if (dropOnce && !dropped && slot === dropOnce.slot && last[1] === dropOnce.param) { dropped = true; return; }
        store[name][slot] = WIDE.has(last[1]) ? last[8] | (last[9] << 8) : last[8];
      }
    },
    async receiveFeatureReport() {
      const r = new Uint8Array(64);
      if (last[0] === 0x8f) r.set([0x8f, 0x31, 0x0b, 0, 0, 0, 0, 0x12, 0x05]);
      else if (last[0] === 0xe5) {
        const name = PARAMS[last[1]], page = last[3];
        const bytes = WIDE.has(last[1]) ? store[name].flatMap(v => [v & 255, v >> 8]) : store[name];
        r.set(bytes.slice(page * 64, page * 64 + 64));
      }
      return new DataView(r.buffer);
    },
  };
}

const settings = { deviceId: 2865, travelStep: 200, magnet: dump.magnet };
const hex = p => [...p.slice(0, 10)].map(b => b.toString(16).padStart(2, '0')).join(' ');
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures++; };

// 1. Packet layout: E (slot 28? find E) -> use slot of key E: W is 14, E is 20 per default matrix (HID 8)
const b = writeBounds(200);
const pk = buildWritePackets([{ slot: 20, mode: 0x80, rtPress: 40, rtRelease: 40 }, { slot: 14, actuation: 100 }], b);
console.log(pk.map(p => `${p.field.padEnd(10)} ${hex(p.pkt)}`).join('\n'));
check('mode is sent before travels for a key', pk[0].field === 'mode' && pk[1].field === 'rtPress');
check('save flag only on the batch final packet', pk.map(p => p.pkt[4]).join('') === '0001');
check('values little-endian at bytes 8-9', pk[3].pkt[8] === 100 && pk[3].pkt[9] === 0);

// 2. Blocked writes
const blocked = (name, edits) => { try { buildWritePackets(edits, b); check(name, false, 'was not blocked'); } catch (e) { check(name, true, e.message.split(':')[0]); } };
blocked('blocks actuation below 0.1 mm', [{ slot: 14, actuation: 19 }]);
blocked('blocks actuation above 3.3 mm', [{ slot: 14, actuation: 661 }]);
blocked('blocks RT sensitivity of 0', [{ slot: 14, rtPress: 0 }]);
blocked('blocks RT sensitivity above 2 mm', [{ slot: 14, rtPress: 401 }]);
blocked('blocks the knob slot', [{ slot: 91, actuation: 200 }]);
blocked('blocks an unused slot', [{ slot: 6, actuation: 200 }]);
blocked('blocks an unknown key mode', [{ slot: 14, mode: 0x86 }]);
check('no bounds for unknown precision', writeBounds(10) === null);

// 3. Full write + verify on a simulated keyboard
const dev = makeDevice();
const res = await writeKeySettings(dev, settings, [{ slot: 20, mode: 0x80, rtPress: 40, rtRelease: 40 }, { slot: 14, actuation: 100, release: 100 }]);
const sent = dev.log.filter(p => p[0] !== 0xe5 && p[0] !== 0x8f);
check('only 0x65 writes sent', sent.every(p => p[0] === 0x65), `${sent.length} writes`);
check('every write checksum valid', dev.log.every(p => p[7] === 255 - (p.slice(0, 7).reduce((a, x) => a + x, 0) & 255)));
check('device ID re-checked before writing', dev.log[0][0] === 0x8f);
check('keyboard now has the new values', dev.store.mode[20] === 0x80 && dev.store.rtPress[20] === 40 && dev.store.actuation[14] === 100 && dev.store.release[14] === 100);
check('untouched keys unchanged', dev.store.actuation[15] === dump.magnet.actuation[15] && dev.store.mode[9] === dump.magnet.mode[9]);
check('read-back reports no mismatches', res.mismatches.length === 0);
check('read-back covers touched params only', Object.keys(res.magnet).sort().join() === 'actuation,mode,release,rtPress,rtRelease');

// 4. Mismatch detection
const dev2 = makeDevice({ ignoreSlot: 14 });
const res2 = await writeKeySettings(dev2, settings, [{ slot: 14, actuation: 100 }]);
check('detects a write the keyboard ignored', res2.mismatches.length === 1 && res2.mismatches[0].actual === dump.magnet.actuation[14], JSON.stringify(res2.mismatches));

// 5. Wrong device refuses to write
const dev3 = makeDevice();
try { await writeKeySettings(dev3, { ...settings, deviceId: 1234 }, [{ slot: 14, actuation: 100 }]); check('refuses a different device', false); }
catch (e) { check('refuses a different device', !dev3.log.some(p => p[0] === 0x65), e.message); }


// 6. Dead zones and Snap Tap
const pk2 = buildWritePackets([
  { slot: 20, mode: 0x87, bottomDeadZone: 80, topDeadZone: 40, snapPartner: 26 },
  { slot: 26, mode: 0x07, snapPartner: 20 },
], b);
console.log(pk2.map(p => `${p.field.padEnd(14)} ${hex(p.pkt)}`).join('\n'));
check('order: mode, bottom dz, top dz, partner', pk2.slice(0, 4).map(p => p.field).join() === 'mode,bottomDeadZone,topDeadZone,snapPartner');
check('bottom dead zone is uint16', pk2[1].pkt[8] === 80 && pk2[1].pkt[9] === 0 && pk2[1].pkt[10] === 0);
check('top dead zone is one byte', pk2[2].pkt[8] === 40 && pk2[2].pkt[9] === 0);
check('partner is one byte', pk2[3].pkt[8] === 26 && pk2[3].pkt[9] === 0);
check('save flag only on the final packet (snap batch)', pk2.map(p => p.pkt[4]).join('') === '000001');
blocked('blocks top dead zone above 1 mm', [{ slot: 14, topDeadZone: 201 }]);
blocked('blocks bottom dead zone above 1 mm', [{ slot: 14, bottomDeadZone: 201 }]);
blocked('blocks pairing a key with itself', [{ slot: 14, snapPartner: 14 }]);
blocked('blocks pairing with the knob', [{ slot: 14, snapPartner: 91 }]);
blocked('blocks pairing with an unused slot', [{ slot: 14, snapPartner: 6 }]);
check('allows dead zone 0', (() => { try { buildWritePackets([{ slot: 14, topDeadZone: 0, bottomDeadZone: 0 }], b); return true; } catch { return false; } })());

const dev4 = makeDevice();
const res4 = await writeKeySettings(dev4, settings, [
  { slot: 20, mode: 0x07, snapPartner: 26, topDeadZone: 40 },
  { slot: 26, mode: 0x07, snapPartner: 20 },
]);
check('pair stored on the simulated keyboard', dev4.store.mode[20] === 7 && dev4.store.mode[26] === 7 && dev4.store.snapPartner[20] === 26 && dev4.store.snapPartner[26] === 20 && dev4.store.topDeadZone[20] === 40);
check('pair read back without mismatches', res4.mismatches.length === 0);
check('existing A/D pair untouched', dev4.store.mode[9] === 0x87 && dev4.store.snapPartner[9] === 21);


// 7. Retry recovers a write the keyboard dropped once (the W/S Snap Tap case)
const dev5 = makeDevice({ dropOnce: { slot: 15, param: 7 } });
const res5 = await writeKeySettings(dev5, settings, [
  { slot: 14, mode: 0x87, snapPartner: 15 },
  { slot: 15, mode: 0x87, snapPartner: 14 },
]);
check('dropped S mode recovered by retry', res5.mismatches.length === 0 && res5.retried === 1 && dev5.store.mode[15] === 0x87, JSON.stringify({ retried: res5.retried, mismatches: res5.mismatches }));
const retryPkts = dev5.log.filter(p => p[0] === 0x65).slice(4);
check('retry resends only the dropped value, with the save flag', retryPkts.length === 1 && retryPkts[0][1] === 7 && retryPkts[0][3] === 15 && retryPkts[0][4] === 1);
const res6 = await writeKeySettings(makeDevice({ ignoreSlot: 14 }), settings, [{ slot: 14, actuation: 100 }]);
check('persistent failure still reported after retry', res6.mismatches.length === 1 && res6.retried === 1);


// 8. Switch type (param 252): one byte after the key's other settings, before Snap partners
const pk3 = buildWritePackets([
  { slot: 20, mode: 0x07, topDeadZone: 40, switchType: 46, snapPartner: 26 },
  { slot: 26, switchType: 1 },
], b);
console.log(pk3.map(p => `${p.field.padEnd(14)} ${hex(p.pkt)}`).join('\n'));
check('order: mode, top dz, switch type, partner', pk3.slice(0, 4).map(p => p.field).join() === 'mode,topDeadZone,switchType,snapPartner');
check('switch type packet is [65 fc 00 slot …] with one byte', pk3[2].pkt[1] === 0xfc && pk3[2].pkt[2] === 0 && pk3[2].pkt[3] === 20 && pk3[2].pkt[8] === 46 && pk3[2].pkt[9] === 0);
check('save flag only on the final packet (switch batch)', pk3.map(p => p.pkt[4]).join('') === '00001');
for (const v of [0, 1, 2, 3, 4, 5, 46]) check(`allows switch type ${v}`, (() => { try { buildWritePackets([{ slot: 14, switchType: v }], b); return true; } catch { return false; } })());
blocked('blocks switch type 6 (not on the RT75 Pro)', [{ slot: 14, switchType: 6 }]);
blocked('blocks switch type 0xFF (qmk.top never writes it)', [{ slot: 14, switchType: 255 }]);
blocked('blocks switch type on the knob', [{ slot: 91, switchType: 1 }]);

const dev7 = makeDevice();
const res7 = await writeKeySettings(dev7, settings, [{ slot: 14, switchType: 2 }, { slot: 15, switchType: 2 }]);
check('switch types stored on the simulated keyboard', dev7.store.switchType[14] === 2 && dev7.store.switchType[15] === 2 && dev7.store.switchType[16] === dump.magnet.switchType[16]);
check('switch types read back without mismatches', res7.mismatches.length === 0 && Object.keys(res7.magnet).join() === 'switchType');
check('only switch-type writes sent', dev7.log.filter(p => p[0] === 0x65).every(p => p[1] === 0xfc));
const res8 = await writeKeySettings(makeDevice({ ignoreSlot: 14 }), settings, [{ slot: 14, switchType: 3 }]);
check('detects a switch type the keyboard ignored', res8.mismatches.length === 1 && res8.mismatches[0].field === 'switchType' && res8.mismatches[0].actual === 255);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
