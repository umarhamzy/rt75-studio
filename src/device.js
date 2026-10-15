// RY5088 protocol for the Yunzii RT75 Pro. See protocol-notes.md.
// Reads go through query(), which only accepts READ_COMMANDS. The only write is the
// per-key magnet command (0x65, single-key form) for actuation, release, Rapid Trigger
// sensitivity and the RT bit of the key mode; send() rejects anything else, and every
// packet in a batch is validated before the first one is sent.

import { KEYS } from './layout.js';

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
  GET_KEYMATRIX: 0x8a,
  GET_USB_VERSION: 0x8f,
  GET_MAGNETISM: 0xe5,
  GET_FEATURE_LIST: 0xe6,
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
};
// One byte per key; the rest are uint16 LE.
const NARROW_PARAMS = new Set([WRITABLE.mode, WRITABLE.topDeadZone, WRITABLE.snapPartner]);
// Order qmk.top/v4 uses within one key: mode first, then 0, 1, 6, 2, 3, 251
// (setMagnetismInfoSimple); Snap partners (9) are sent last (setMultiMagnetismInfo).
const WRITE_ORDER = ['mode', 'actuation', 'release', 'bottomDeadZone', 'rtPress', 'rtRelease', 'topDeadZone', 'snapPartner'];

// Setting ranges in mm, from qmk.top/v4 for this device: actuation/release 0.1 to 3.3,
// Rapid Trigger sensitivity one step (0.005) to 2.0, top and bottom dead zone 0 to 1.
export const LIMITS = {
  travel: { min: 0.1, max: 3.3 },
  rt: { max: 2.0 },
  deadZone: { min: 0, max: 1 },
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

class Transport {
  constructor(dev) {
    this.dev = dev;
    this.viaDongle = DONGLE_PIDS.has(dev.productId);
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
    for (let i = 0; i < 10; i++) {
      await sleep(100);
      if ((await this.dongleStatus())[key]) return true;
    }
    return false;
  }

  async query(cmd) {
    if (!READ_COMMANDS.has(cmd[0])) throw new Error(`Blocked non-read command 0x${cmd[0].toString(16)}`);
    const pkt = encode(cmd);
    if (!this.viaDongle) {
      await sleep(10);
      await this.dev.sendFeatureReport(0, pkt);
      return this.#rawRead();
    }
    await this.#rawSend([0xf6, 0x0a]); // route to keyboard
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
      await this.#rawSend([0xf6, 0x0a]);
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

// Reads everything the keyboard view needs. onProgress(fraction, label) is optional.
export async function readSettings(dev, onProgress = () => {}) {
  if (!dev.opened) await dev.open();
  const t = new Transport(dev);
  const total = 7 + MAGNET_PARAMS.length;
  let done = 0;
  const step = label => onProgress(++done / total, label);

  try {
    const s = { productName: dev.productName, viaDongle: t.viaDongle, battery: undefined };
    if (t.viaDongle) {
      const st = await t.dongleStatus();
      if (!st.keyboardOnline) throw new Error('Keyboard is asleep or out of range. Press a key and try again.');
      s.battery = st.battery;
    }

    const id = await t.query([CMD.GET_USB_VERSION]);
    if (id[0] !== CMD.GET_USB_VERSION) throw new Error('Keyboard did not answer the ID query.');
    s.deviceId = new DataView(id.buffer).getUint32(1, true);
    s.usbVersion = (id[8] << 8 | id[7]) || undefined;
    step('Device ID');

    const rf = await t.query([CMD.GET_RF_VERSION]);
    s.rfVersion = rf[0] === CMD.GET_RF_VERSION ? ((rf[2] << 8 | rf[1]) || undefined) : undefined;
    step('Firmware');

    const fl = await t.query([CMD.GET_FEATURE_LIST]);
    const precision = fl[1] === 0xaa ? { 0: '0.01mm', 1: '0.005mm', 2: '0.001mm' }[fl[2]] : undefined;
    s.travelStep = travelStep(precision, s.usbVersion, s.rfVersion);
    step('Features');

    s.profile = (await t.query([CMD.GET_PROFILE]))[1];
    step('Profile');
    s.reportRateHz = REPORT_RATES[(await t.query([CMD.GET_REPORT_RATE]))[2]];
    step('Polling rate');
    s.debounce = (await t.query([CMD.GET_DEBOUNCE]))[1];
    step('Debounce');

    s.keymap = await t.readPages([CMD.GET_KEYMATRIX, s.profile, 0xff, 0, 0], 8);
    step('Key map');

    s.magnet = {};
    for (const [param, name, pages, wide] of MAGNET_PARAMS) {
      const bytes = await t.readPages([CMD.GET_MAGNETISM, param, 1, 0], pages);
      s.magnet[name] = wide ? u16(bytes) : bytes;
      step(name);
    }
    s.source = 'device';
    return s;
  } finally {
    try { await dev.close(); } catch { /* already closed */ }
  }
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
    keymap: d.keymap['0'],
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
      try { await input.close(); } catch { /* ignore */ }
      try { await featureDev.close(); } catch { /* ignore */ }
    }
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

async function withDevice(dev, settings, fn) {
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
