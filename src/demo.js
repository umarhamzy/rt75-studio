import { DEFAULT_FN_MATRIX, DEFAULT_FN_MAC_MATRIX } from './layout.js';

// In-memory stand-in for the RT75 Pro, used by ?demo. It answers the same HID reports as
// the real keyboard (IDs, settings reads, single-key magnet writes) from a saved dump,
// so the whole read / edit / write / verify flow can be tried without hardware.
// Profiles 1-4 each keep their own key settings; profile 2 starts with every key at 1.00 mm.

const PARAMS = { 7: 'mode', 0: 'actuation', 1: 'release', 6: 'bottomDeadZone', 2: 'rtPress', 3: 'rtRelease', 251: 'topDeadZone', 9: 'snapPartner', 5: 'mtTime', 4: 'dksTravel', 252: 'switchType' };
const WIDE = new Set([0, 1, 6, 2, 3, 4]);

// options.ignore: [{ slot, param }] writes the simulated keyboard silently drops, to reproduce
// failed writes (e.g. ?demo&ignore=15:7 drops mode writes to S).
export function createDemoDevice(dump, { ignore = [] } = {}) {
  const profiles = Array.from({ length: 4 }, () => structuredClone(dump.magnet));
  profiles[1].actuation = profiles[1].actuation.map(v => (v ? 200 : 0));
  profiles[1].release = profiles[1].release.map(v => (v ? 200 : 0));
  profiles[1].mode = profiles[1].mode.map(() => 0);
  for (const p of profiles) {
    p.mtTime ??= new Array(p.mode.length).fill(0);
    p.dksTravel ??= p.dksStart ?? new Array(p.mode.length).fill(0);
    p.dksTriggers = new Array(p.mode.length).fill(0); // DKS trigger table, 4 bytes per key (packed)
  }
  // Switch types (param 252) are one table for the whole keyboard, as on the real RT75 Pro.
  for (const p of profiles) p.switchType = profiles[0].switchType;
  let profile = 0, rateCode = 3; // 1000 Hz
  // Sleep timers (seconds, uint16 LE): BT backlight 120, 2.4G backlight 120, BT deep 1680, 2.4G deep 1680
  let sleepBytes = Uint8Array.from([120, 0, 120, 0, 0x90, 0x06, 0x90, 0x06]);
  // Lighting reply bytes 1–7: Flowing Light, speed 2, brightness 3, rainbow, white (FAFFFA).
  let ledBytes = Uint8Array.from([4, 2, 3, 0x08, 0xfa, 0xff, 0xfa]);
  const store = () => profiles[profile];

  // Vendor report interface: while 0x1B 01 is on, push a repeating press cycle
  // (a full press, then a light press that stops short of the actuation point).
  const input = new EventTarget();
  Object.assign(input, {
    productName: 'YUNZII RT75 PRO Keyboard (demo)', vendorId: 0x3151, productId: 0x5030,
    collections: [{ usagePage: 0xffff, usage: 1, inputReports: [{ reportId: 0 }] }],
    opened: false, async open() { this.opened = true; }, async close() { this.opened = false; },
  });
  let timer = null;
  const setReporting = on => {
    clearInterval(timer);
    timer = null;
    if (!on) return;
    const t0 = performance.now();
    timer = setInterval(() => {
      const t = (performance.now() - t0) % 2400;
      const peak = t < 1200 ? 3.3 : 0.9;
      const p = t % 1200;
      const depth = p < 180 ? peak * p / 180 : p < 380 ? peak : p < 560 ? peak * (1 - (p - 380) / 180) : 0;
      const raw = Math.round(depth * 200);
      const data = new Uint8Array(31);
      data.set([0x1b, raw & 255, raw >> 8]);
      const e = new Event('inputreport');
      e.reportId = 0;
      e.data = new DataView(data.buffer);
      input.dispatchEvent(e);
    }, 16);
  };
  // Each profile's key matrix has four sub-layers: 0 is the base layer, 1 holds mod-tap tap
  // actions; 1–3 are all zeros from the factory.
  const keymaps = Array.from({ length: 4 }, () => [[...dump.keymap['0']], ...Array.from({ length: 3 }, () => new Array(dump.keymap['0'].length).fill(0))]);
  // Fn layers per profile: [windows, mac]
  // One Fn layer (index 0) shared by every profile, like the real keyboard: [windows, mac].
  const fnLayers = [[[...(dump.fnWin ?? DEFAULT_FN_MATRIX)], [...(dump.fnMac ?? DEFAULT_FN_MAC_MATRIX)]]];
  // Like the user's keyboard: Fn+F runs macro slot 0 (made in qmk.top, Toggle playback).
  fnLayers[0][0].splice(27 * 4, 4, 9, 1, 0, 0);
  // Macro slots as written (256-byte buffers). The demo, like RT75 Studio, never reads them back.
  const macros = new Map();
  // Custom lighting patterns 1–5 (128 slots × R, G, B). Pattern 1 starts as a gradient, like a
  // keyboard that has had one set; the rest are dark.
  const userPics = Array.from({ length: 5 }, (_, n) => Array.from({ length: 384 }, (_, i) =>
    n === 0 ? [(i / 3) * 2 % 256, 80, 255 - (i / 3) * 2 % 256][i % 3] | 0 : 0));
  let last = new Uint8Array(64);

  return {
    productName: 'YUNZII RT75 PRO Keyboard (demo)',
    vendorId: 0x3151,
    productId: 0x5030,
    collections: [{ usagePage: 0xffff, usage: 2, featureReports: [{}] }],
    opened: false,
    async open() { this.opened = true; },
    async close() { this.opened = false; },

    demoInput: input,
    demoMacros: macros, // for tests: what was written to each slot

    async sendFeatureReport(_id, buf) {
      last = Uint8Array.from(buf);
      if (last[0] === 0x1b) { setReporting(last[1] === 1); return; }
      if (last[0] === 0x03) { rateCode = last[2]; return; }
      if (last[0] === 0x04) { profile = last[1]; return; }
      if (last[0] === 0x11) { sleepBytes = last.slice(8, 16); return; }
      if (last[0] === 0x07) { ledBytes = last.slice(1, 8); return; }
      if (last[0] === 0x0c) { userPics[last[1]].splice(last[3] * 56, last[4], ...last.slice(8, 8 + last[4])); return; }
      if (last[0] === 0x0b) {
        const b = macros.get(last[1]) ?? new Uint8Array(256);
        b.set(last.slice(8, 8 + Math.min(56, 256 - last[2] * 56)), last[2] * 56);
        macros.set(last[1], b);
        return;
      }
      if (last[0] === 0x0a) { keymaps[last[1]][last[6]].splice(last[2] * 4, 4, ...last.slice(8, 12)); return; }
      if (last[0] === 0x10) { fnLayers[last[2]][last[1]].splice(last[3] * 4, 4, ...last.slice(8, 12)); return; }
      if (last[0] === 0x65 && ignore.some(x => x.slot === last[3] && x.param === last[1])) return;
      if (last[0] === 0x65 && last[2] === 0 && last[1] === 8) {
        store().dksTriggers[last[3]] = (last[8] | (last[9] << 8) | (last[10] << 16) | (last[11] << 24)) >>> 0;
        return;
      }
      if (last[0] === 0x65 && last[2] === 0) {
        const name = PARAMS[last[1]];
        if (name) store()[name][last[3]] = WIDE.has(last[1]) ? last[8] | (last[9] << 8) : last[8];
      }
    },

    async receiveFeatureReport() {
      const r = new Uint8Array(64);
      switch (last[0]) {
        case 0x8f: r.set([0x8f, 0x31, 0x0b, 0, 0, 0, 0, 0x12, 0x05]); break;
        case 0x80: r.set([0x80]); break;
        case 0xe6: r.set([0xe6]); break;          // no feature list, like the real keyboard
        case 0x84: r.set([0x84, profile]); break;
        case 0x91: r.set([0x91]); r.set(sleepBytes, 8); break;
        case 0x87: r.set([0x87, ...ledBytes]); break;
        case 0x8c: r.set(userPics[last[1]].slice(last[3] * 64, last[3] * 64 + 64)); break;
        case 0x89: r.set([0x89, this.demoOs ?? 0, 0]); break; // KB options: Windows, Fn layer 0
        case 0x83: r.set([0x83, 0, rateCode]); break;
        case 0x86: r.set([0x86, 0]); break;
        case 0x8a: r.set(keymaps[last[1]][last[4]].slice(last[3] * 64, last[3] * 64 + 64)); break;
        case 0x90: r.set(fnLayers[last[2]][last[1]].slice(last[4] * 64, last[4] * 64 + 64)); break;
        case 0xe5: {
          if (last[1] === 10) { // DKS trigger table: action-major, 128 bytes per action
            const all = [0, 8, 16, 24].flatMap(s => store().dksTriggers.map(v => (v >>> s) & 0xff));
            r.set(all.slice(last[3] * 64, last[3] * 64 + 64));
            break;
          }
          const name = PARAMS[last[1]];
          const bytes = WIDE.has(last[1]) ? store()[name].flatMap(v => [v & 255, v >> 8]) : store()[name];
          r.set(bytes.slice(last[3] * 64, last[3] * 64 + 64));
          break;
        }
      }
      return new DataView(r.buffer);
    },
  };
}
