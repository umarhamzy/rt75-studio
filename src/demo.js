// In-memory stand-in for the RT75 Pro, used by ?demo. It answers the same HID reports as
// the real keyboard (IDs, settings reads, single-key magnet writes) from a saved dump,
// so the whole read / edit / write / verify flow can be tried without hardware.
// Profiles 1-4 each keep their own key settings; profile 2 starts with every key at 1.00 mm.

const PARAMS = { 7: 'mode', 0: 'actuation', 1: 'release', 6: 'bottomDeadZone', 2: 'rtPress', 3: 'rtRelease', 251: 'topDeadZone', 9: 'snapPartner', 252: 'switchType' };
const WIDE = new Set([0, 1, 6, 2, 3]);

// options.ignore: [{ slot, param }] writes the simulated keyboard silently drops, to reproduce
// failed writes (e.g. ?demo&ignore=15:7 drops mode writes to S).
export function createDemoDevice(dump, { ignore = [] } = {}) {
  const profiles = Array.from({ length: 4 }, () => structuredClone(dump.magnet));
  profiles[1].actuation = profiles[1].actuation.map(v => (v ? 200 : 0));
  profiles[1].release = profiles[1].release.map(v => (v ? 200 : 0));
  profiles[1].mode = profiles[1].mode.map(() => 0);
  let profile = 0, rateCode = 3; // 1000 Hz
  // Sleep timers (seconds, uint16 LE): BT backlight 120, 2.4G backlight 120, BT deep 1680, 2.4G deep 1680
  let sleepBytes = Uint8Array.from([120, 0, 120, 0, 0x90, 0x06, 0x90, 0x06]);
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
  const keymap = [...dump.keymap['0']];
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

    async sendFeatureReport(_id, buf) {
      last = Uint8Array.from(buf);
      if (last[0] === 0x1b) { setReporting(last[1] === 1); return; }
      if (last[0] === 0x03) { rateCode = last[2]; return; }
      if (last[0] === 0x04) { profile = last[1]; return; }
      if (last[0] === 0x11) { sleepBytes = last.slice(8, 16); return; }
      if (last[0] === 0x65 && ignore.some(x => x.slot === last[3] && x.param === last[1])) return;
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
        case 0x83: r.set([0x83, 0, rateCode]); break;
        case 0x86: r.set([0x86, 0]); break;
        case 0x8a: r.set(keymap.slice(last[3] * 64, last[3] * 64 + 64)); break;
        case 0xe5: {
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
