// RY5088 protocol for the Yunzii RT75 Pro. See protocol-notes.md.
// Reads go through query(), which only accepts READ_COMMANDS. Writes go through send() with a
// validator for their command: per-key magnet (0x65, single-key form), polling rate, profile,
// sleep timers, key map and lighting. Every packet in a batch is validated before the first
// one is sent.

import { KEYS, DEFAULT_MATRIX, DEFAULT_FN_MATRIX, DEFAULT_FN_MAC_MATRIX } from './layout.js';
import { FUNCTIONS, MODIFIERS, HID_NAMES } from './actions.js';
import { effectById, isOffered, decodeLighting, lightingBytes, lightingFields, MAX_LEVEL } from './lighting.js';
import { MAX_MACROS, MACRO_MODES, MACRO_CHUNK, encodeMacro, macroSize, macroRefs } from './macros.js';

const MACRO_MODE_IDS = new Set(Object.keys(MACRO_MODES).map(Number));

const VID = 0x3151;
// Matrix slots of real magnetic keys (the knob entries are excluded).
const KEY_SLOTS = new Set(KEYS.filter(k => !k.knob).map(k => k.slot));
const KEY_MODES = new Set([0, 2, 3, 4, 5, 7]);
const DONGLE_PIDS = new Set([0x5037, 0x5038, 0x503d]);

const CMD = {
  GET_RF_VERSION: 0x80,
  GET_REPORT_RATE: 0x83,
  GET_PROFILE: 0x84,
  GET_DEBOUNCE: 0x86,
  GET_SLEEPTIME: 0x91,
  GET_KEYMATRIX: 0x8a,
  GET_FN: 0x90,
  GET_USB_VERSION: 0x8f,
  GET_MAGNETISM: 0xe5,
  GET_FEATURE_LIST: 0xe6,
  GET_LEDPARAM: 0x87,
  GET_KBOPTION: 0x89,
};
const READ_COMMANDS = new Set(Object.values(CMD));
const SET_MAGNETISM = 0x65;

// Magnet params this app may write, keyed by the settings field they come from.
export const WRITABLE = {
  mode: 7,
  actuation: 0,
  release: 1,
  bottomDeadZone: 6,
  rtPress: 2,
  rtRelease: 3,
  topDeadZone: 251,
  snapPartner: 9,
  mtTime: 5,
};
// One byte per key; the rest are uint16 LE.
const NARROW_PARAMS = new Set([WRITABLE.mode, WRITABLE.topDeadZone, WRITABLE.snapPartner, WRITABLE.mtTime]);
// Order qmk.top/v4 uses within one key: mode first, then 0, 1, 6, 2, 3, 5, 251
// (setMagnetismInfoSimple); Snap partners (9) are sent last (setMultiMagnetismInfo).
const WRITE_ORDER = ['mode', 'actuation', 'release', 'bottomDeadZone', 'rtPress', 'rtRelease', 'mtTime', 'topDeadZone', 'snapPartner'];

// Setting ranges in mm, from qmk.top/v4 for this device: actuation/release 0.1 to 3.3,
// Rapid Trigger sensitivity one step (0.005) to 2.0, top and bottom dead zone 0 to 1.
export const LIMITS = {
  travel: { min: 0.1, max: 3.3 },
  rt: { max: 2.0 },
  deadZone: { min: 0, max: 1 },
  mtTime: { min: 10, max: 1000, default: 200 }, // mod-tap hold time in ms, stored ÷ 10 (qmk.top's 按键时间)
};

// Magnet parameters: [param, name, pages, 16-bit values]
const MAGNET_PARAMS = [
  [7, 'mode', 2, false],
  [0, 'actuation', 4, true],
  [1, 'release', 4, true],
  [6, 'bottomDeadZone', 4, true],
  [2, 'rtPress', 4, true],
  [3, 'rtRelease', 4, true],
  [251, 'topDeadZone', 2, false],
  [9, 'snapPartner', 2, false],
  [5, 'mtTime', 2, false],
  [252, 'switchType', 2, false],
];

const REPORT_RATES = { 0: 8000, 1: 4000, 2: 2000, 3: 1000, 4: 500, 5: 250, 6: 125 };
// The RT75 Pro's USB and dongle filters in qmk.top/v4 declare reportRate 8000, so every rate is offered.
export const RATE_OPTIONS = [8000, 4000, 2000, 1000, 500, 250, 125];
// qmk.top's "Profile 1–4" are the device's key layers (deviceType.layer = 4).
export const PROFILE_COUNT = 4;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Bit7 checksum framing: buf[7] = 255 - (sum(buf[0..6]) & 0xFF), padded to 64 bytes.
function encode(cmd) {
  const buf = new Uint8Array(64);
  buf.set(cmd);
  buf[7] = 255 - (buf.slice(0, 7).reduce((a, b) => a + b, 0) & 0xff);
  return buf;
}

// Raw units per mm, mirroring qmk.top/v4 get磁轴行程步进倍数 (legacy branch when there
// is no feature list). The RT75 Pro on USB fw 0x0512 resolves to 200 (0.005mm steps).
export function travelStep(featurePrecision, usbVersion, rfVersion) {
  if (featurePrecision) return { '0.01mm': 100, '0.005mm': 200, '0.001mm': 1000 }[featurePrecision] ?? 100;
  const v = rfVersion || usbVersion;
  if (v === undefined) return 10;
  if (v >= 768 && v < 1280) return 100;
  return v >= 1280 ? 200 : 10;
}

// 2.4G dongle timing. qmk.top waits 100 ms before every dongle status check (up to 5 tries), twice
// per read, so a full load (~60 reads) takes 15–20 s wireless. 'fast' asks right away and then at
// short, growing intervals with about the same overall timeout. It only changes how often the
// dongle's status (0xF7, a read) is asked. 'classic' keeps qmk.top's timing (?dongle=classic).
const DONGLE_WAITS = {
  fast: [0, 5, 10, 20, 40, 80, 100, 100, 100, 100, 100, 100, 100, 100],
  classic: Array(10).fill(100),
};
let dongleTiming = 'fast';
export function setDongleTiming(mode) { if (mode in DONGLE_WAITS) dongleTiming = mode; }
export const getDongleTiming = () => dongleTiming;

class Transport {
  constructor(dev) {
    this.dev = dev;
    this.viaDongle = DONGLE_PIDS.has(dev.productId);
    this.routed = false; // F6 0A sent during this operation
    this.reads = 0;
  }

  // Routes the dongle to the keyboard once per operation. qmk.top also sends F6 only when the
  // target device changes (___dongleSend24GDeviceByF6).
  async #route() {
    if (this.routed) return;
    await this.#rawSend([0xf6, 0x0a]);
    this.routed = true;
  }

  async #rawSend(bytes) {
    const b = new Uint8Array(64);
    b.set(bytes);
    await sleep(10);
    await this.dev.sendFeatureReport(0, b);
  }

  async #rawRead() {
    await sleep(10);
    return new Uint8Array((await this.dev.receiveFeatureReport(0)).buffer);
  }

  // Dongle status 0xF7: [canRead, kbBattery, mouseBattery, kbOffline, mouseOffline, canSend]
  async dongleStatus() {
    await this.#rawSend([0xf7]);
    const r = await this.#rawRead();
    return { canRead: r[0] === 1, battery: r[1], keyboardOnline: r[3] === 0, canSend: r[5] === 1 };
  }

  async #waitFor(key) {
    for (const wait of DONGLE_WAITS[dongleTiming]) {
      if (wait) await sleep(wait);
      if ((await this.dongleStatus())[key]) return true;
    }
    return false;
  }

  async query(cmd) {
    if (!READ_COMMANDS.has(cmd[0])) throw new Error(`Blocked non-read command 0x${cmd[0].toString(16)}`);
    // Reads stay inside the ranges qmk.top uses: firmware doesn't bounds-check them (a macro read at
    // index 254/255 hung the keyboard until it was power-cycled, 2026-10-15).
    // Sub-layer (byte 4): 0 is the base layer, 1 holds mod-tap tap actions. qmk.top reads 0–3; this
    // app only needs 0–1.
    if (cmd[0] === CMD.GET_KEYMATRIX && !(cmd[1] < PROFILE_COUNT && cmd[3] < 8 && (cmd[4] ?? 0) <= TAP_SUB)) {
      throw new Error(`Blocked key-map read outside profiles 1–${PROFILE_COUNT} (profile ${cmd[1]}, page ${cmd[3]}, sub ${cmd[4]})`);
    }
    // Only Fn layer 0 exists on this keyboard (see FN_LAYER); OS 0/1, pages 0–7.
    if (cmd[0] === CMD.GET_FN && !(cmd[1] <= 1 && cmd[2] === 0 && cmd[4] < 8)) {
      throw new Error(`Blocked Fn-layer read outside layer 0 (os ${cmd[1]}, layer ${cmd[2]}, page ${cmd[4]})`);
    }
    if (cmd[0] === CMD.GET_MAGNETISM && !(cmd[3] < 4)) throw new Error(`Blocked magnet read beyond page 3 (page ${cmd[3]})`);
    const pkt = encode(cmd);
    this.reads++;
    if (!this.viaDongle) {
      await sleep(10);
      await this.dev.sendFeatureReport(0, pkt);
      return this.#rawRead();
    }
    await this.#route();
    if (!await this.#waitFor('canSend')) throw new Error('Dongle not ready to send');
    await sleep(10);
    await this.dev.sendFeatureReport(0, pkt);
    if (!await this.#waitFor('canRead')) throw new Error('Dongle has no reply ready');
    await this.#rawSend([0xfc]); // fetch reply
    return this.#rawRead();
  }

  // Write path, mirroring qmk.top/v4 sendMsg: no reply is read.
  // check: validator for the packet; defaults to the per-key magnet write rules.
  async send(pkt, bounds, check = assertAllowedWrite) {
    check(pkt, bounds);
    if (this.viaDongle) {
      await this.#route();
      if (!await this.#waitFor('canSend')) throw new Error('Dongle not ready to send');
    }
    await sleep(10);
    await this.dev.sendFeatureReport(0, pkt);
  }

  async readPages(header, pages) {
    const out = [];
    for (let p = 0; p < pages; p++) {
      const cmd = [...header];
      cmd[3] = p;
      out.push(...await this.query(cmd));
    }
    return out;
  }
}

const u16 = bytes => {
  const v = [];
  for (let i = 0; i < bytes.length; i += 2) v.push(bytes[i] | (bytes[i + 1] << 8));
  return v;
};

export function isSupported() {
  return 'hid' in navigator;
}

// Opens the picker filtered to the vendor configuration interface.
export async function requestKeyboard() {
  const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: VID, usagePage: 0xffff }] });
  return devices.find(d => d.collections.some(c => c.featureReports.length)) ?? null;
}

// Reconnects to an already-permitted keyboard without a picker.
export async function findGrantedKeyboard() {
  const devices = await navigator.hid.getDevices();
  return devices.find(d => d.vendorId === VID && d.collections.some(c => c.featureReports.length)) ?? null;
}

// Device operations run one at a time: each opens the keyboard, works, and closes it again, so
// two at once (say, loading the key map while a write runs) would trip over each other.
let deviceQueue = Promise.resolve();
// While operations run (and just after), the keyboard's own "busy" pushes aren't knob events.
let running = 0, lastIo = 0;
const touchIo = () => { lastIo = performance.now(); };
const ioActive = (graceMs) => running > 0 || performance.now() - lastIo < graceMs;
function exclusive(fn) {
  running++;
  const run = deviceQueue.then(fn, fn);
  deviceQueue = run.catch(() => {});
  run.finally(() => { running--; touchIo(); }).catch(() => {});
  return run;
}

const MAGNET_LABELS = {
  mode: 'Key modes', actuation: 'Actuation points', release: 'Release points', bottomDeadZone: 'Dead zones',
  rtPress: 'Rapid Trigger', rtRelease: 'Rapid Trigger', topDeadZone: 'Dead zones', snapPartner: 'Snap Tap',
  switchType: 'Switch types',
};
const STARTUP_READS = 9 + MAGNET_PARAMS.reduce((a, p) => a + p[2], 0); // single reads + magnet pages

// KB options (0x89), as qmk.top's getKBOption reads them on connect: byte 1 is the keyboard's
// Win/Mac switch (0 Windows, 1 Mac, 2 iOS, 3 Android), byte 2 the Fn layer index.
const KB_SYSTEMS = { 0: 'win', 1: 'mac', 2: 'ios', 3: 'android' };
function decodeKbOption(r) {
  if (!r || r[0] !== CMD.GET_KBOPTION) return undefined;
  return { system: KB_SYSTEMS[r[1]] ?? 'win', fnIndex: r[2] };
}

// Re-reads the KB options, as qmk.top does when the keyboard reports a Win/Mac switch.
export function readKbOption(dev, settings) {
  return withDevice(dev, settings, async t => decodeKbOption(await t.query([CMD.GET_KBOPTION])));
}
const KEYMAP_READS = 8 + 8 + 16; // base layer + mod-tap tap layer + two Fn layers

// Reads everything the keyboard view needs. onProgress(fraction, label) is optional; the label
// names what is being read now. With { keymaps: false } the base layer and Fn layers (24 reads)
// are left out (settings.keymap etc. stay undefined) and can be read later with readKeymaps.
export function readSettings(dev, onProgress = () => {}, { keymaps = true } = {}) {
  return exclusive(async () => {
    if (!dev.opened) await dev.open();
    const t = new Transport(dev);
    const started = Date.now();
    const expected = STARTUP_READS + (keymaps ? KEYMAP_READS : 0);
    const reading = label => onProgress(Math.min(1, t.reads / expected), label);

    try {
      const s = { productName: dev.productName, viaDongle: t.viaDongle, battery: undefined };
      if (t.viaDongle) {
        reading('Keyboard status');
        const st = await t.dongleStatus();
        if (!st.keyboardOnline) throw new Error('Keyboard is asleep or out of range. Press a key and try again.');
        s.battery = st.battery;
      }

      reading('Device ID');
      const id = await t.query([CMD.GET_USB_VERSION]);
      if (id[0] !== CMD.GET_USB_VERSION) throw new Error('Keyboard did not answer the ID query.');
      s.deviceId = new DataView(id.buffer).getUint32(1, true);
      s.usbVersion = (id[8] << 8 | id[7]) || undefined;

      reading('Firmware');
      const rf = await t.query([CMD.GET_RF_VERSION]);
      s.rfVersion = rf[0] === CMD.GET_RF_VERSION ? ((rf[2] << 8 | rf[1]) || undefined) : undefined;
      const fl = await t.query([CMD.GET_FEATURE_LIST]);
      const precision = fl[1] === 0xaa ? { 0: '0.01mm', 1: '0.005mm', 2: '0.001mm' }[fl[2]] : undefined;
      s.travelStep = travelStep(precision, s.usbVersion, s.rfVersion);

      reading('Profile and polling rate');
      s.profile = (await t.query([CMD.GET_PROFILE]))[1];
      s.reportRateHz = REPORT_RATES[(await t.query([CMD.GET_REPORT_RATE]))[2]];
      reading('Debounce and sleep timers');
      s.debounce = (await t.query([CMD.GET_DEBOUNCE]))[1];
      s.sleep = decodeSleep(await t.query([CMD.GET_SLEEPTIME]));
      reading('Lighting');
      s.lighting = decodeLighting(await t.query([CMD.GET_LEDPARAM]));
      reading('Keyboard options');
      s.kbOption = decodeKbOption(await t.query([CMD.GET_KBOPTION]));

      if (keymaps) Object.assign(s, await readLayers(t, s.profile, reading));

      s.magnet = {};
      for (const [param, name, pages, wide] of MAGNET_PARAMS) {
        reading(MAGNET_LABELS[name] ?? name);
        const bytes = await t.readPages([CMD.GET_MAGNETISM, param, 1, 0], pages);
        s.magnet[name] = wide ? u16(bytes) : bytes;
      }
      onProgress(1, 'Done');
      s.source = 'device';
      s.loadStats = { ms: Date.now() - started, reads: t.reads, timing: t.viaDongle ? dongleTiming : 'usb' };
      return s;
    } finally {
      try { await dev.close(); } catch { /* already closed */ }
    }
  });
}

// Base layer of the profile, its mod-tap tap layer (sub 1), then the shared Fn layers
// ([0x90, os, Fn layer 0, 0xFF, page]).
async function readLayers(t, profile, reading = () => {}) {
  reading('Key map');
  const keymap = await t.readPages([CMD.GET_KEYMATRIX, profile, 0xff, 0, 0], 8);
  const tapLayer = await t.readPages([CMD.GET_KEYMATRIX, profile, 0xff, 0, TAP_SUB], 8);
  reading('Fn layers');
  const fnWin = await readFnLayer(t, 0);
  const fnMac = await readFnLayer(t, 1);
  return { keymap, tapLayer, fnWin, fnMac };
}

// Reads the key map and Fn layers on their own (24 reads), for loading them when they're needed.
// Returns { keymap, fnWin, fnMac }.
export function readKeymaps(dev, settings, onProgress = () => {}) {
  return withDevice(dev, settings, t => {
    const base = t.reads;
    return readLayers(t, settings.profile, label => onProgress(Math.min(1, (t.reads - base) / KEYMAP_READS), label));
  });
}

// Builds the same shape from a dump.html JSON export, for offline viewing.
export function settingsFromDump(d) {
  const idBytes = d.raw.id.split(' ').map(h => parseInt(h, 16));
  const usbVersion = (idBytes[8] << 8 | idBytes[7]) || undefined;
  const rfVersion = d.rfVersion;
  return {
    productName: d.device.productName,
    viaDongle: d.device.viaDongle,
    battery: d.battery,
    deviceId: d.deviceId,
    usbVersion,
    rfVersion,
    travelStep: travelStep(d.featureListSupported ? d.precision : undefined, usbVersion, rfVersion),
    profile: d.profile,
    reportRateHz: d.reportRateHz,
    debounce: d.debounce,
    sleep: d.sleep,
    lighting: d.lighting,
    keymap: d.keymap?.['0'],
    tapLayer: d.tapLayer,
    fnWin: d.fnWin,
    fnMac: d.fnMac,
    magnet: d.magnet,
    source: 'file',
  };
}

// ---------- Writing (per-key magnet settings) ----------

// Raw-unit bounds for the current travel step (units per mm).
export function writeBounds(step) {
  if (step !== 100 && step !== 200 && step !== 1000) return null; // unknown precision: no writes
  return {
    step,
    travelMin: Math.round(LIMITS.travel.min * step),
    travelMax: Math.round(LIMITS.travel.max * step),
    rtMin: 1,
    rtMax: Math.round(LIMITS.rt.max * step),
    dzMin: Math.round(LIMITS.deadZone.min * step),
    dzMax: Math.min(255, Math.round(LIMITS.deadZone.max * step)), // top dead zone is one byte
  };
}

// Structural and range check for one outgoing write. Throws on anything unexpected.
function assertAllowedWrite(p, bounds) {
  const fail = why => { throw new Error(`Blocked write (${why}): ${[...p.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join(' ')}`); };
  if (!bounds) fail('no write bounds');
  if (p.length !== 64) fail('length');
  if (p[0] !== SET_MAGNETISM) fail('not the magnet command');
  if (!Object.values(WRITABLE).includes(p[1])) fail(`param ${p[1]} is not writable`);
  if (p[2] !== 0) fail('not the single-key form');
  if (!KEY_SLOTS.has(p[3])) fail(`slot ${p[3]} is not a magnetic key`);
  if (p[4] !== 0 && p[4] !== 1) fail('bad last flag');
  if (p[5] !== 0 || p[6] !== 0) fail('reserved bytes');
  if (p[7] !== 255 - (p.slice(0, 7).reduce((a, b) => a + b, 0) & 0xff)) fail('checksum');
  const wide = !NARROW_PARAMS.has(p[1]);
  if (p.slice(wide ? 10 : 9).some(b => b !== 0)) fail('trailing bytes');
  const v = wide ? p[8] | (p[9] << 8) : p[8];
  const range = (lo, hi) => { if (v < lo || v > hi) fail(`value ${v} outside ${lo}–${hi}`); };
  switch (p[1]) {
    case WRITABLE.mode:
      if (!KEY_MODES.has(v & 0x7f)) fail('unknown key mode');
      break;
    case WRITABLE.snapPartner:
      if (!KEY_SLOTS.has(v) || v === p[3]) fail(`partner ${v} is not another magnetic key`);
      break;
    case WRITABLE.actuation:
    case WRITABLE.release:
      range(bounds.travelMin, bounds.travelMax);
      break;
    case WRITABLE.rtPress:
    case WRITABLE.rtRelease:
      range(bounds.rtMin, bounds.rtMax);
      break;
    case WRITABLE.bottomDeadZone:
    case WRITABLE.topDeadZone:
      range(bounds.dzMin, bounds.dzMax);
      break;
    case WRITABLE.mtTime:
      range(LIMITS.mtTime.min / 10, LIMITS.mtTime.max / 10);
      break;
  }
}

// edits: [{ slot, <field>: raw value, … }] for fields in WRITABLE, holding only fields that
// differ from the current settings. Returns the packets in send order.
// The last flag (byte 4) tells the keyboard to save; like qmk.top's batch writes
// (setMultiMagnetismInfo) it is set only on the final packet of the whole batch. Setting it per
// key let the keyboard start saving mid-batch and drop the next key's first packet.
export function buildWritePackets(edits, bounds) {
  const items = edits.flatMap(e => WRITE_ORDER.filter(f => e[f] !== undefined).map(f => ({ slot: e.slot, field: f, value: e[f] })));
  return items.map((it, i) => {
    const data = NARROW_PARAMS.has(WRITABLE[it.field]) ? [it.value & 0xff] : [it.value & 0xff, (it.value >> 8) & 0xff];
    const head = [SET_MAGNETISM, WRITABLE[it.field], 0, it.slot, i === items.length - 1 ? 1 : 0, 0, 0];
    const pkt = encode([...head, 0, ...data]);
    assertAllowedWrite(pkt, bounds);
    return { ...it, pkt };
  });
}

// Sends the edits, then reads the touched parameters back and compares. Values that read back
// wrong are re-sent once after a pause, then checked again.
// Returns { magnet: fresh arrays for the touched params, mismatches: [...], retried: count }.
export async function writeKeySettings(dev, settings, edits, onProgress = () => {}) {
  const bounds = writeBounds(settings.travelStep);
  if (!bounds) throw new Error(`Unknown travel precision (step ${settings.travelStep}); writing is disabled.`);
  const packets = buildWritePackets(edits, bounds); // validates everything before sending
  if (!packets.length) return { magnet: {}, mismatches: [], retried: 0 };

  if (!dev.opened) await dev.open();
  const t = new Transport(dev);
  const touched = [...new Set(packets.map(p => p.field))];
  const total = packets.length + touched.length;
  let done = 0;

  const sendAll = async (pkts, label) => {
    for (const p of pkts) {
      await t.send(p.pkt, bounds);
      onProgress(Math.min(1, ++done / total), label);
    }
    await sleep(500); // qmk.top waits 500 ms after a batch that includes Snap partners
  };
  const readBack = async (fields, magnet) => {
    for (const field of fields) {
      const [param, name, pages, wide] = MAGNET_PARAMS.find(m => m[1] === field);
      const bytes = await t.readPages([CMD.GET_MAGNETISM, param, 1, 0], pages);
      magnet[name] = wide ? u16(bytes) : bytes;
      onProgress(Math.min(1, ++done / total), 'Verifying');
    }
  };
  const diff = (pkts, magnet) => pkts.filter(p => magnet[p.field][p.slot] !== p.value);

  try {
    if (t.viaDongle && !(await t.dongleStatus()).keyboardOnline) throw new Error('Keyboard is asleep or out of range. Press a key and try again.');
    // Re-check the device before writing anything.
    const id = await t.query([CMD.GET_USB_VERSION]);
    if (new DataView(id.buffer).getUint32(1, true) !== settings.deviceId) throw new Error('A different keyboard is connected. Refresh first.');

    await sendAll(packets, 'Writing');
    const magnet = {};
    await readBack(touched, magnet);

    let wrong = diff(packets, magnet);
    const retried = wrong.length;
    if (wrong.length) {
      await sleep(800);
      const again = buildWritePackets(wrong.map(p => ({ slot: p.slot, [p.field]: p.value })), bounds);
      await sendAll(again, 'Retrying');
      await readBack([...new Set(again.map(p => p.field))], magnet);
      wrong = diff(packets, magnet);
    }
    const mismatches = wrong.map(p => ({ slot: p.slot, field: p.field, expected: p.value, actual: magnet[p.field][p.slot] }));
    return { magnet, mismatches, retried };
  } finally {
    try { await dev.close(); } catch { /* already closed */ }
  }
}

// ---------- Live depth (qmk.top's "Simulation Test") ----------
// 0x1B 01 makes the keyboard push the current press depth of the key being moved as vendor input
// reports [0x1B, lo, hi, …] on the other vendor collection (usagePage 0xFFFF, usage 1);
// 0x1B 00 stops it. qmk.top toggles this freely; it is not a settings write.
// (qmk.top's all-keys depth read, param 254, only works inside calibration mode, which
// rewrites switch calibration, so it is deliberately not used.)
const SET_MAGNETISM_REPORT = 0x1b;

async function sendReportToggle(dev, on) {
  const pkt = encode([SET_MAGNETISM_REPORT, on ? 1 : 0]);
  if (pkt.slice(2, 7).some(b => b !== 0) || pkt.slice(8).some(b => b !== 0)) throw new Error('Blocked report toggle');
  await sleep(10);
  touchIo();
  await dev.sendFeatureReport(0, pkt);
}

async function findVendorInput(featureDev) {
  const isInput = d => d !== featureDev && d.vendorId === featureDev.vendorId && d.productId === featureDev.productId &&
    d.collections.some(c => c.usagePage === 0xffff && c.usage === 1);
  const granted = (await navigator.hid.getDevices()).find(isInput);
  if (granted) return granted;
  const picked = await navigator.hid.requestDevice({ filters: [{ vendorId: featureDev.vendorId, productId: featureDev.productId, usagePage: 0xffff, usage: 1 }] });
  return picked.find(isInput) ?? null;
}

// Starts live depth reporting. onSample(depthMm) is called for every report.
// Returns an async stop() that turns reporting off and closes both interfaces.
export async function startLiveTravel(featureDev, settings, onSample, inputDev = null) {
  if (DONGLE_PIDS.has(featureDev.productId)) throw new Error('The live test needs the USB cable (qmk.top also limits it to wired).');
  const step = settings.travelStep;
  if (![10, 100, 200, 1000].includes(step)) throw new Error('Unknown travel precision.');
  const input = inputDev ?? await findVendorInput(featureDev);
  if (!input) throw new Error('The keyboard\u2019s report interface was not granted.');

  if (!featureDev.opened) await featureDev.open();
  if (!input.opened) await input.open();
  const onReport = e => {
    const d = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    if (d[0] !== SET_MAGNETISM_REPORT) return;
    onSample((step === 10 ? d[1] : d[1] | (d[2] << 8)) / step);
  };
  input.addEventListener('inputreport', onReport);
  try {
    await sendReportToggle(featureDev, true);
  } catch (e) {
    input.removeEventListener('inputreport', onReport);
    throw e;
  }

  let stopped = false;
  return async function stop() {
    if (stopped) return;
    stopped = true;
    try { await sendReportToggle(featureDev, false); }
    finally {
      input.removeEventListener('inputreport', onReport);
      if (input !== watchedInput) { try { await input.close(); } catch { /* ignore */ } } // the knob watcher keeps listening
      try { await featureDev.close(); } catch { /* ignore */ }
    }
  };
}

// ---------- Knob and lighting events (listen-only) ----------
// The keyboard reports these on its own; nothing is sent (protocol-notes.md, "Knob modes and push
// reports"). Consumer report 3: E9 volume up, EA down, E2 mute. Vendor pushes: 06 nn brightness,
// 04 nn effect, then 0F 01 / 0F 00. A 0F 01 with no lighting push just before it is a knob hold,
// which toggles the knob between volume and lighting mode. The same reports arrive through the
// 2.4G dongle. onEvent gets { type: 'volume', action: 'up'|'down'|'mute' }, { type: 'brightness',
// value }, { type: 'effect', value } or { type: 'toggle' }.
let watchedInput = null;
const CONSUMER_ACTIONS = { 0xe9: 'up', 0xea: 'down', 0xe2: 'mute' };
const PUSH_GAP_MS = 40;        // a 0F pair follows its lighting push within ~12 ms
const IO_GRACE_MS = 1500;      // 0F pairs during or right after our own reads and writes are ignored

export async function watchKeyboardEvents(featureDev, onEvent, inputDev = null) {
  const input = inputDev ?? (await navigator.hid.getDevices()).find(d => d !== featureDev &&
    d.vendorId === featureDev.vendorId && d.productId === featureDev.productId &&
    d.collections.some(c => c.usagePage === 0xffff && c.usage === 1));
  if (!input) return null; // not granted: no picker here, the knob mode just stays unknown
  if (!input.opened) await input.open();
  let lastPush = -Infinity;
  const onReport = e => {
    const d = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    if (e.reportId === 3) {
      const action = CONSUMER_ACTIONS[d[0]];
      if (action) onEvent({ type: 'volume', action });
      return;
    }
    // 03 nn 00/02: the keyboard's Win/Mac switch moved (qmk.top's push decoder: nn & 2 = Mac).
    if (d[0] === 0x03 && (d[2] === 0 || d[2] === 2)) { lastPush = performance.now(); onEvent({ type: 'os', os: d[1] & 2 ? 'mac' : 'win' }); }
    else if (d[0] === 0x06) { lastPush = performance.now(); onEvent({ type: 'brightness', value: d[1] }); }
    else if (d[0] === 0x04) { lastPush = performance.now(); onEvent({ type: 'effect', value: d[1] }); }
    else if (d[0] >= 0x01 && d[0] <= 0x0e) lastPush = performance.now(); // other pushes (profile, rate, …) also end in 0F
    else if (d[0] === 0x0f && d[1] === 1 && performance.now() - lastPush > PUSH_GAP_MS && !ioActive(IO_GRACE_MS)) onEvent({ type: 'toggle' });
  };
  input.addEventListener('inputreport', onReport);
  watchedInput = input;
  let stopped = false;
  return async function stop() {
    if (stopped) return;
    stopped = true;
    input.removeEventListener('inputreport', onReport);
    if (watchedInput === input) watchedInput = null;
    try { await input.close(); } catch { /* ignore */ }
  };
}

// ---------- Keyboard-wide settings ----------
// Formats from qmk.top/v4's RY5088 base: setReportRate [0x03, 0, code], setCurrentProfile
// [0x04, index] (then a 200 ms pause). Debounce (0x06) is not offered: qmk.top only shows it when
// the device entry declares other.deBounce, which the RT75 Pro's does not.
const SET_REPORT_RATE = 0x03;
const SET_PROFILE = 0x04;
const RATE_CODES = Object.fromEntries(Object.entries(REPORT_RATES).map(([code, hz]) => [hz, Number(code)]));

function assertAllowedKeyboardWrite(p) {
  const fail = why => { throw new Error(`Blocked write (${why}): ${[...p.slice(0, 9)].map(b => b.toString(16).padStart(2, '0')).join(' ')}`); };
  if (p.length !== 64) fail('length');
  if (p[7] !== 255 - (p.slice(0, 7).reduce((a, b) => a + b, 0) & 0xff)) fail('checksum');
  if (p.slice(3, 7).some(b => b !== 0) || p.slice(8).some(b => b !== 0)) fail('unexpected bytes');
  if (p[0] === SET_REPORT_RATE) {
    if (p[1] !== 0 || !(p[2] in REPORT_RATES)) fail('bad polling-rate code');
  } else if (p[0] === SET_PROFILE) {
    if (p[1] >= PROFILE_COUNT || p[2] !== 0) fail('bad profile index');
  } else {
    fail('not a keyboard-setting command');
  }
}

function withDevice(dev, settings, fn) {
  return exclusive(async () => {
    if (!dev.opened) await dev.open();
    const t = new Transport(dev);
    try {
      if (t.viaDongle && !(await t.dongleStatus()).keyboardOnline) throw new Error('Keyboard is asleep or out of range. Press a key and try again.');
      const id = await t.query([CMD.GET_USB_VERSION]);
      if (new DataView(id.buffer).getUint32(1, true) !== settings.deviceId) throw new Error('A different keyboard is connected. Refresh first.');
      return await fn(t);
    } finally {
      try { await dev.close(); } catch { /* already closed */ }
    }
  });
}

// Sets the polling rate and reads it back. Returns the rate the keyboard reports.
export async function writeReportRate(dev, settings, hz) {
  if (!(hz in RATE_CODES)) throw new Error(`Unsupported polling rate ${hz}`);
  const pkt = encode([SET_REPORT_RATE, 0, RATE_CODES[hz]]);
  assertAllowedKeyboardWrite(pkt);
  return withDevice(dev, settings, async t => {
    await t.send(pkt, null, assertAllowedKeyboardWrite);
    await sleep(300);
    return REPORT_RATES[(await t.query([CMD.GET_REPORT_RATE]))[2]];
  });
}

// Switches the active profile (0-based) and reads it back. The caller should re-read settings,
// since key settings are stored per profile.
export async function switchProfile(dev, settings, index) {
  const pkt = encode([SET_PROFILE, index]);
  assertAllowedKeyboardWrite(pkt);
  return withDevice(dev, settings, async t => {
    await t.send(pkt, null, assertAllowedKeyboardWrite);
    await sleep(300); // qmk.top waits 200 ms
    return (await t.query([CMD.GET_PROFILE]))[1];
  });
}

// ---------- Sleep timers ----------
// [0x11, 0…, checksum, BT backlight-off, 2.4G backlight-off, BT deep sleep, 2.4G deep sleep],
// each uint16 LE seconds at bytes 8–15 (qmk.top setSleepTime / getSleepTime, read 0x91).
// RT75 Pro ranges: backlight-off 0 (never) to 18 h; BT deep sleep 10 s to 18 h. 2.4G deep sleep
// is not offered for this keyboard and is always written back unchanged.
const SET_SLEEPTIME = 0x11;
const SLEEP_FIELDS = ['time_bt', 'time_24', 'deepTime_bt', 'deepTime_24'];
export const SLEEP_LIMITS = { time_bt: [0, 64800], time_24: [0, 64800], deepTime_bt: [10, 64800] };

function decodeSleep(r) {
  if (r[0] !== CMD.GET_SLEEPTIME) return undefined;
  return Object.fromEntries(SLEEP_FIELDS.map((f, i) => [f, r[8 + i * 2] | (r[9 + i * 2] << 8)]));
}

function assertAllowedSleepWrite(p, sleep) {
  const fail = why => { throw new Error(`Blocked write (${why})`); };
  if (p.length !== 64 || p[0] !== SET_SLEEPTIME) fail('not the sleep command');
  if (p.slice(1, 7).some(b => b !== 0) || p.slice(16).some(b => b !== 0)) fail('unexpected bytes');
  if (p[7] !== 255 - (p.slice(0, 7).reduce((a, b) => a + b, 0) & 0xff)) fail('checksum');
  for (const [f, [lo, hi]] of Object.entries(SLEEP_LIMITS)) {
    const v = sleep[f];
    if (!Number.isInteger(v) || v < lo || v > hi) fail(`${f} ${v} outside ${lo}–${hi}`);
  }
}

// Writes all four timers (unchanged ones as read) and reads them back.
export async function writeSleepTimes(dev, settings, sleep) {
  const full = { ...settings.sleep, ...sleep };
  const bytes = SLEEP_FIELDS.flatMap(f => [full[f] & 0xff, (full[f] >> 8) & 0xff]);
  const pkt = encode([SET_SLEEPTIME, 0, 0, 0, 0, 0, 0, 0, ...bytes]);
  assertAllowedSleepWrite(pkt, full);
  return withDevice(dev, settings, async t => {
    await t.send(pkt, null, p => assertAllowedSleepWrite(p, full));
    await sleep_(300);
    return decodeSleep(await t.query([CMD.GET_SLEEPTIME]));
  });
}
const sleep_ = ms => new Promise(r => setTimeout(r, ms));

// The Fn layer index ("Fn profile" in qmk.top) is separate from profiles 1–4. The RT75 Pro declares
// fnSysLayer { win: 1, mac: 1 }: one Fn layer per OS, index 0, shared by all profiles. qmk.top reads
// Fn layers 0 … fnSysLayer[os] - 1 only, so RT75 Studio never uses any other index.
const FN_LAYER = 0;

async function readFnLayer(t, os) {
  const out = [];
  for (let page = 0; page < 8; page++) out.push(...await t.query([CMD.GET_FN, os, FN_LAYER, 0xff, page]));
  return out;
}

// ---------- Key map writes ----------
// Base key  [0x0A, profile, slot, 0, 0, save, sub=0, cs, a0..a3]   (setKeyConfigSimple)
// Fn key    [0x10, os, profile, slot, 0, 0, 0, cs, a0..a3]         (setFnKeyConfigSimple)
// The base save flag goes only on the batch's final base packet, as with magnet writes.
const SET_KEYMATRIX = 0x0a;
const SET_FN = 0x10;
// Mod-tap: the hold action is the base layer (sub 0) and the tap action is sub-layer 1 of the same
// profile's key matrix, all zeros from the factory (protocol-notes.md, "Mod-tap").
const TAP_SUB = 1;
export const KEYMAP_LAYERS = {
  base: { sub: 0, factory: DEFAULT_MATRIX },
  tap: { sub: TAP_SUB, factory: new Array(DEFAULT_MATRIX.length).fill(0) },
  fnWin: { os: 0, factory: DEFAULT_FN_MATRIX },
  fnMac: { os: 1, factory: DEFAULT_FN_MAC_MATRIX },
};
// The Fn key itself is locked on every layer so the Fn layer can't be lost (qmk.top locks it too).
export const LOCKED_SLOTS = new Set(KEYS.filter(k => k.code === 'Fn').map(k => k.slot));
const FUNCTION_BYTES = new Set(FUNCTIONS.map(f => f[2].join(',')));
const VALID_HID = new Set(Object.keys(HID_NAMES).map(Number));

// Actions this app may write: disabled, a key with up to two modifiers, or a named function.
// Restoring a slot's exact factory value is also allowed (some factory values aren't in the lists).
export function isWritableAction(a, layer, slot) {
  if (a.length !== 4 || a.some(b => !Number.isInteger(b) || b < 0 || b > 255)) return false;
  const factory = KEYMAP_LAYERS[layer].factory.slice(slot * 4, slot * 4 + 4);
  if (a.join() === factory.join()) return true;
  if (a.join() === '0,0,0,0') return true;
  if (layer === 'tap') return isModTapKeys(a); // tap actions are keys only, as in qmk.top
  if (FUNCTION_BYTES.has(a.join())) return true;
  if (a[0] === 9) return MACRO_MODE_IDS.has(a[1]) && a[2] < MAX_MACROS && a[3] === 0; // run macro slot
  if (a[0] !== 0) return false;
  const codes = a.slice(1).filter(Boolean);
  if (!codes.length || codes.some(c => !VALID_HID.has(c))) return false;
  return codes.filter(c => !MODIFIERS.includes(c)).length <= 1 && codes.length <= 3;
}

// One side of a mod-tap key in qmk.top's layout: up to three keys from byte 1, packed left, at most
// one of them not a modifier ([0, k1, k2, k3]; protocol-notes.md, "Mod-tap").
export function isModTapKeys(a) {
  if (a.length !== 4 || a[0] !== 0 || !a[1]) return false;
  const codes = a.slice(1);
  const gap = codes.indexOf(0);
  if (gap !== -1 && codes.slice(gap).some(Boolean)) return false;
  const used = codes.filter(Boolean);
  return used.every(c => VALID_HID.has(c)) && new Set(used).size === used.length && used.filter(c => !MODIFIERS.includes(c)).length <= 1;
}

function assertAllowedKeymapWrite(p, ctx) {
  const fail = why => { throw new Error(`Blocked key-map write (${why}): ${[...p.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join(' ')}`); };
  if (p.length !== 64) fail('length');
  if (p[7] !== 255 - (p.slice(0, 7).reduce((a, b) => a + b, 0) & 0xff)) fail('checksum');
  if (p.slice(12).some(b => b !== 0)) fail('trailing bytes');
  let layer, slot;
  if (p[0] === SET_KEYMATRIX) {
    if (p[1] !== ctx.profile || p[3] !== 0 || p[4] !== 0 || (p[5] !== 0 && p[5] !== 1) || (p[6] !== 0 && p[6] !== TAP_SUB)) fail('header');
    layer = p[6] === TAP_SUB ? 'tap' : 'base'; slot = p[2];
  } else if (p[0] === SET_FN) {
    if ((p[1] !== 0 && p[1] !== 1) || p[2] !== FN_LAYER || p[4] !== 0 || p[5] !== 0 || p[6] !== 0) fail('header');
    layer = p[1] === 0 ? 'fnWin' : 'fnMac'; slot = p[3];
  } else {
    fail('not a key-map command');
  }
  if (!KEY_SLOTS.has(slot)) fail(`slot ${slot} is not a key`);
  if (LOCKED_SLOTS.has(slot)) fail('the Fn key is locked');
  if (!isWritableAction([...p.slice(8, 12)], layer, slot)) fail('action not allowed');
}

// edits: [{ layer: 'base'|'tap'|'fnWin'|'fnMac', slot, action: [4 bytes] }]
// Base and tap-layer edits are the profile's key matrix (sub 0 and 1); the save flag goes only on
// the last of those. A key's tap edit follows its base (hold) edit, as in qmk.top.
export function buildKeymapPackets(edits, profile) {
  if (!(profile >= 0 && profile < PROFILE_COUNT)) throw new Error('Unknown profile');
  const ordered = [];
  for (const e of edits) {
    if (e.layer === 'tap') continue;
    ordered.push(e);
    if (e.layer === 'base') ordered.push(...edits.filter(x => x.layer === 'tap' && x.slot === e.slot));
  }
  ordered.push(...edits.filter(x => x.layer === 'tap' && !ordered.includes(x)));
  const lastMatrix = ordered.map(e => KEYMAP_LAYERS[e.layer].sub !== undefined).lastIndexOf(true);
  return ordered.map((e, i) => {
    const sub = KEYMAP_LAYERS[e.layer].sub;
    const pkt = sub !== undefined
      ? encode([SET_KEYMATRIX, profile, e.slot, 0, 0, i === lastMatrix ? 1 : 0, sub, 0, ...e.action])
      : encode([SET_FN, KEYMAP_LAYERS[e.layer].os, FN_LAYER, e.slot, 0, 0, 0, 0, ...e.action]);
    assertAllowedKeymapWrite(pkt, { profile });
    return { ...e, pkt };
  });
}

// Writes key-map edits, reads the touched layers back, re-sends anything that differs once.
// Returns { layers: { base?, fnWin?, fnMac? } (fresh 512-byte arrays), mismatches, retried }.
export async function writeKeymap(dev, settings, edits, onProgress = () => {}) {
  const packets = buildKeymapPackets(edits, settings.profile);
  if (!packets.length) return { layers: {}, mismatches: [], retried: 0 };
  const check = p => assertAllowedKeymapWrite(p, { profile: settings.profile });
  return withDevice(dev, settings, async t => {
    const readLayer = layer => KEYMAP_LAYERS[layer].sub !== undefined
      ? t.readPages([CMD.GET_KEYMATRIX, settings.profile, 0xff, 0, KEYMAP_LAYERS[layer].sub], 8)
      : readFnLayer(t, KEYMAP_LAYERS[layer].os);
    const sendAll = async (pkts, label) => {
      for (const [i, p] of pkts.entries()) { await t.send(p.pkt, null, check); onProgress((i + 1) / pkts.length, label); }
      await sleep(500);
    };
    const layers = {};
    const readBack = async names => { for (const l of names) layers[l] = await readLayer(l); };
    const wrong = () => packets.filter(p => layers[p.layer].slice(p.slot * 4, p.slot * 4 + 4).join() !== p.action.join());

    await sendAll(packets, 'Writing keys');
    const touched = [...new Set(packets.map(p => p.layer))];
    await readBack(touched);
    let bad = wrong();
    const retried = bad.length;
    if (bad.length) {
      await sleep(800);
      await sendAll(buildKeymapPackets(bad.map(({ layer, slot, action }) => ({ layer, slot, action })), settings.profile), 'Retrying');
      await readBack([...new Set(bad.map(p => p.layer))]);
      bad = wrong();
    }
    const mismatches = bad.map(p => ({ layer: p.layer, slot: p.slot, expected: p.action, actual: layers[p.layer].slice(p.slot * 4, p.slot * 4 + 4) }));
    return { layers, mismatches, retried };
  });
}

// ---------- Lighting ----------
// Main backlight only: the RT75 Pro's qmk.top entry has a lightLayout and no sideLightLayout.
// [0x07, effect, 4 - speed, brightness, option << 4 | colour mode, r, g, b, Bit8 checksum]
// (qmk.top setLightSetting, sendMsg(…, Bit8), then vendorSleep 100 ms). Read with 0x87 (Bit7).
const SET_LEDPARAM = 0x07;

function assertAllowedLightWrite(p) {
  const fail = why => { throw new Error(`Blocked lighting write (${why}): ${[...p.slice(0, 9)].map(b => b.toString(16).padStart(2, '0')).join(' ')}`); };
  if (p.length !== 64 || p[0] !== SET_LEDPARAM) fail('not the lighting command');
  const e = effectById(p[1]);
  if (!isOffered(e)) fail('effect not offered');
  if (p[2] > MAX_LEVEL || p[3] > MAX_LEVEL) fail('speed or brightness out of range');
  const option = p[4] >> 4, mode = p[4] & 15;
  if (option >= (e.options?.length ?? 1)) fail('bad option');
  if (e.key === 'LightUserPicture') {
    if (mode !== 0 || p[5] !== 0 || p[6] !== 200 || p[7] !== 200) fail('bad custom-pattern bytes');
  } else if (mode !== 7 && mode !== 8) fail('bad colour mode');
  if (p[8] !== 255 - (p.slice(0, 8).reduce((a, b) => a + b, 0) & 0xff)) fail('checksum');
  if (p.slice(9).some(b => b !== 0)) fail('unexpected bytes');
}

export function buildLightingPacket(light) {
  const pkt = new Uint8Array(64);
  pkt.set(lightingBytes(light));
  pkt[8] = 255 - (pkt.slice(0, 8).reduce((a, b) => a + b, 0) & 0xff);
  assertAllowedLightWrite(pkt);
  return pkt;
}

// Writes the lighting setting, reads it back and re-sends once if it differs.
// Returns { lighting (as read back), mismatches: [field…], retried }.
export async function writeLighting(dev, settings, light) {
  const pkt = buildLightingPacket(light);
  return withDevice(dev, settings, async t => {
    const write = async () => {
      await t.send(pkt, null, assertAllowedLightWrite);
      await sleep(300); // qmk.top waits 100 ms
      return decodeLighting(await t.query([CMD.GET_LEDPARAM]));
    };
    const wrong = got => (got ? lightingFields(light).filter(f => got[f] !== light[f]) : ['effect']);
    let got = await write();
    let bad = wrong(got);
    const retried = bad.length ? 1 : 0;
    if (bad.length) { await sleep(500); got = await write(); bad = wrong(got); }
    return { lighting: got, mismatches: bad, retried };
  });
}

// ---------- Macro writes ----------
// [0x0B, slot, page, 56, isLast, 0, 0, cs (Bit7), 56 data bytes] per 56-byte chunk of the 256-byte
// buffer (qmk.top _setMacro), then vendorSleep. qmk.top sends the non-empty chunks; RT75 Studio
// sends every chunk up to and including the end marker, so a shorter macro never leaves the old
// macro's tail where the marker should be.
// There is no read-back: the keyboard's macro read (0x8B) doesn't reliably return a slot's steps
// (protocol-notes.md, "Macros"), and qmk.top doesn't read macros back either. The key assignment
// that points at a slot is a key-map write and is read back as usual.
const SET_MACRO = 0x0b;
const validMacroKey = c => VALID_HID.has(c);

export function buildMacroPackets(slot, macro) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_MACROS) throw new Error(`Blocked macro write (slot ${slot})`);
  const buf = encodeMacro(macro, validMacroKey);
  const pages = Math.ceil(macroSize(macro) / MACRO_CHUNK);
  return Array.from({ length: pages }, (_, p) => {
    const data = [...buf.slice(p * MACRO_CHUNK, (p + 1) * MACRO_CHUNK)];
    while (data.length < MACRO_CHUNK) data.push(0);
    return encode([SET_MACRO, slot, p, MACRO_CHUNK, p === pages - 1 ? 1 : 0, 0, 0, 0, ...data]);
  });
}

// Each packet must be one of the packets built (and validated) from the macro.
function assertAllowedMacroWrite(p, allowed) {
  const fail = why => { throw new Error(`Blocked macro write (${why}): ${[...p.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join(' ')}`); };
  if (p.length !== 64 || p[0] !== SET_MACRO) fail('not the macro command');
  if (p[1] >= MAX_MACROS || p[3] !== MACRO_CHUNK || p[4] > 1 || p[5] || p[6]) fail('header');
  if (p[7] !== 255 - (p.slice(0, 7).reduce((a, b) => a + b, 0) & 0xff)) fail('checksum');
  if (!allowed.some(q => q.every((b, i) => b === p[i]))) fail('not a validated packet');
}

// Writes macros to their slots. edits: [{ slot, macro: { repeat, steps } }]. Every packet of every
// macro is built and validated before the first is sent. Returns { written: [slot] }.
export async function writeMacros(dev, settings, edits, onProgress = () => {}) {
  const plan = edits.map(e => ({ ...e, packets: buildMacroPackets(e.slot, e.macro) }));
  return withDevice(dev, settings, async t => {
    const written = [];
    for (const [i, e] of plan.entries()) {
      onProgress((i + 1) / plan.length, `Writing macro slot ${e.slot + 1}`);
      for (const p of e.packets) await t.send(p, null, q => assertAllowedMacroWrite(q, e.packets));
      await sleep(150); // qmk.top waits 100 ms after each macro
      written.push(e.slot);
    }
    return { written };
  });
}

// Macro slots the keyboard's keys use: every profile's base layer and the Fn layers (reads only).
export async function readMacroSlotsInUse(dev, settings, onProgress = () => {}) {
  return withDevice(dev, settings, async t => {
    const used = new Set();
    for (let profile = 0; profile < PROFILE_COUNT; profile++) {
      onProgress(profile / (PROFILE_COUNT + 1), `Checking profile ${profile + 1}`);
      macroRefs(await t.readPages([CMD.GET_KEYMATRIX, profile, 0xff, 0, 0], 8)).forEach(i => used.add(i));
    }
    onProgress(PROFILE_COUNT / (PROFILE_COUNT + 1), 'Checking the Fn layers');
    macroRefs(await readFnLayer(t, 0), await readFnLayer(t, 1)).forEach(i => used.add(i));
    return [...used].sort((a, b) => a - b);
  });
}

// Lowest slot that no key uses and that isn't in `exclude` (slots the library already holds).
export function pickFreeSlot(used, exclude = []) {
  for (let i = 0; i < MAX_MACROS; i++) if (!used.includes(i) && !exclude.includes(i)) return i;
  throw new Error(`All ${MAX_MACROS} macro slots are in use.`);
}
