import { KEYS, DEFAULT_MATRIX, DEFAULT_FN_MATRIX, DEFAULT_FN_MAC_MATRIX, LAYOUT_WIDTH, LAYOUT_HEIGHT, DEVICE_ID } from './layout.js';
import { decodeAction, encodeKey, splitKey, FUNCTIONS, RISKY, KEY_CHOICES, CODE_TO_HID, MODIFIERS, keyName, DISABLED, HID_NAMES } from './actions.js';
import {
  isSupported, requestKeyboard, findGrantedKeyboard, readSettings, readKeymaps, settingsFromDump, setDongleTiming,
  writeBounds, writeKeySettings, startLiveTravel, writeReportRate, switchProfile, writeSleepTimes,
  writeKeymap, isWritableAction, LOCKED_SLOTS, writeLighting, writeMacros, readMacroSlotsInUse, pickFreeSlot,
  LIMITS, RATE_OPTIONS, PROFILE_COUNT, SLEEP_LIMITS,
} from './device.js';
import { EFFECTS, effectById, isOffered, normalizeLighting, lightingDiff, lightingFields, hex, MAX_LEVEL } from './lighting.js';
import { MACRO_MODES, MOUSE_BUTTONS, MAX_DELAY, MAX_REPEAT, MACRO_BYTES, stepLabel, macroSummary, macroProblem, macroSize, heldAtEnd } from './macros.js';
import { loadLibrary, saveLibrary, newId, isOutdated, uniqueName, exportLibrary, parseLibraryFile, validSlot } from './library.js';

// ---------- Key naming ----------
const HID = {
  40: 'Enter', 41: 'Esc', 42: 'Backspace', 43: 'Tab', 44: 'Space', 45: '-', 46: '=', 47: '[', 48: ']', 49: '\\',
  51: ';', 52: "'", 53: '`', 54: ',', 55: '.', 56: '/', 57: 'Caps', 70: 'PrtSc', 71: 'ScrLk', 72: 'Pause', 73: 'Ins',
  74: 'Home', 75: 'PgUp', 76: 'Del', 77: 'End', 78: 'PgDn', 79: '→', 80: '←', 81: '↓', 82: '↑',
  224: 'L Ctrl', 225: 'L Shift', 226: 'L Alt', 227: 'L Win', 228: 'R Ctrl', 229: 'R Shift', 230: 'R Alt', 231: 'R Win',
};
for (let i = 0; i < 26; i++) HID[4 + i] = String.fromCharCode(65 + i);
for (let i = 0; i < 9; i++) HID[30 + i] = String(i + 1);
HID[39] = '0';
for (let i = 0; i < 12; i++) HID[58 + i] = 'F' + (i + 1);
const CONSUMER = { 226: 'Mute', 233: 'Volume up', 234: 'Volume down' };

function actionName(q) {
  if (q.every(b => b === 0)) return 'Disabled';
  if (q[0] === 0 && q[1] === 0 && q[3] === 0) return HID[q[2]] ?? `HID 0x${q[2].toString(16)}`;
  if (q[0] === 3) return CONSUMER[q[2] | (q[3] << 8)] ?? 'Media key';
  if (q[0] === 10 && q[1] === 1) return 'Fn';
  return 'Special (' + q.map(b => b.toString(16).padStart(2, '0')).join(' ') + ')';
}

// Switch-type byte (magnet param 252), from qmk.top/v4's switch enum. The RT75 Pro offers
// these seven; qmk.top shows any other value (e.g. 0xFF, unset) as type 1, Outemu.
const SWITCHES = {
  0: 'Outemu', 1: 'Magnetic Jade', 2: 'Magnetic Jade Pro', 3: 'Magnetic Jade Gaming',
  4: 'Heavenly King', 5: 'Magneto', 46: 'Red Sky',
};
function switchName(byte) {
  if (byte === undefined) return 'Unknown';
  return SWITCHES[byte] ?? (byte === 0xff ? 'Outemu (default)' : `Type ${byte}`);
}

const MODES = { 0: 'Normal', 2: 'Dynamic keystroke (DKS)', 3: 'Mod-tap', 4: 'Toggle (hold)', 5: 'Toggle', 7: 'Snap Tap' };
const FIELD_LABELS = {
  mode: 'Key mode', actuation: 'Actuation point', release: 'Release point',
  rtPress: 'RT press sensitivity', rtRelease: 'RT release sensitivity',
  bottomDeadZone: 'Bottom dead zone', topDeadZone: 'Top dead zone', snapPartner: 'Snap Tap partner',
};
const SNAP = 7;
const RT_DEFAULT_MM = 0.2; // qmk.top/v4's default RT sensitivity, used when a key has none set

// ---------- State ----------
const state = {
  settings: null,
  dev: null,                 // HIDDevice from the last live read, used for writes
  view: 'actuation',
  layer: 'base',             // key map view: 'base' | 'fnWin' | 'fnMac'
  selected: new Set(),       // matrix slots
  knob: false,               // knob selected instead of keys
  pending: new Map(),        // slot -> { field: raw value } differing from settings
  pendingKb: {},             // keyboard-wide edits, e.g. { reportRateHz: 8000 }
  pendingKeys: new Map(),    // key map edits: 'layer:slot' -> 4 action bytes
  pendingLight: null,        // lighting setting to write, or null
  library: [],               // macro library (this browser): [{ id, name, repeat, steps, slot?, written? }]
  pendingMacroWrites: new Map(), // macro slot -> library macro id to write there
  macroDraft: null,          // macro open in the editor dialog
  recording: null,           // { last: timestamp } while the editor records keys
  capture: null,             // { layer, slot } while waiting for a key press to assign
  picking: null,             // slot waiting for a Snap Tap partner click
  // "Release at the same point" / "Same for press and release" unticked by the user. Kept per
  // selection; without it the boxes re-ticked themselves whenever the values were still equal.
  unlinked: { key: '', release: false, rt: false },
  busy: false,
  lastApplied: null,         // { undo: edits } for the most recent successful write
  live: null,                // running live test: { stop, depth, peak, trace, focus, down }
};
const $ = id => document.getElementById(id);
const MAGNETIC = KEYS.filter(k => !k.knob);
const keyBySlot = slot => KEYS.find(k => k.slot === slot && !k.knob);

const bounds = () => (state.settings?.source === 'device' ? writeBounds(state.settings.travelStep) : null);
const editable = () => !!bounds() && !!state.dev && !state.busy && !state.live;

// ---------- Values ----------
// Raw value for a field, with any pending edit applied.
function raw(slot, field) {
  const p = state.pending.get(slot);
  if (p && p[field] !== undefined) return p[field];
  return state.settings.magnet[field][slot];
}

function keyData(key) {
  const s = state.settings;
  if (!s || key.knob) return null;
  const m = s.magnet, i = key.slot, step = s.travelStep;
  const modeByte = raw(i, 'mode') ?? 0;
  const modeId = modeByte & 0x7f;
  const current = s.keymap?.slice(i * 4, i * 4 + 4); // undefined until the key map is loaded
  const factory = DEFAULT_MATRIX.slice(i * 4, i * 4 + 4);
  const partnerSlot = modeId === 7 ? raw(i, 'snapPartner') : undefined;
  return {
    mode: MODES[modeId] ?? `Mode ${modeId}`,
    modeId,
    rt: (modeByte & 0x80) !== 0,
    actuation: raw(i, 'actuation') / step,
    release: raw(i, 'release') / step,
    rtPress: raw(i, 'rtPress') / step,
    rtRelease: raw(i, 'rtRelease') / step,
    bottomDeadZone: raw(i, 'bottomDeadZone') / step,
    topDeadZone: (raw(i, 'topDeadZone') ?? 0) / step,
    switchType: switchName(m.switchType?.[i]),
    action: current ? actionName(current) : null,
    remapped: current ? current.join() !== factory.join() : null,
    pending: hasPending(i),
    partner: partnerSlot !== undefined && partnerSlot !== 0xff ? keyBySlot(partnerSlot) : undefined,
  };
}

const mm = v => v.toFixed(2);
// Two decimals, or three when the value needs it (0.005 mm steps): 1.30, 1.25, 0.805.
const mm3 = v => v.toFixed(3).replace(/(\.\d\d)0$/, '$1');

// Records an edit, dropping it again if it matches what the keyboard already has.
function setPending(slot, field, value) {
  const entry = { ...(state.pending.get(slot) ?? {}) };
  if (value === state.settings.magnet[field][slot]) delete entry[field];
  else entry[field] = value;
  if (Object.keys(entry).length) state.pending.set(slot, entry);
  else state.pending.delete(slot);
}

function toRaw(mmValue, min, max) {
  const step = state.settings.travelStep;
  const clamped = Math.min(max, Math.max(min, mmValue));
  return Math.round(clamped * step);
}

// Snap pairs get a stable color index, ordered by the lower slot.
function snapPairs() {
  const pairs = new Map();
  for (const k of MAGNETIC) {
    const d = keyData(k);
    if (!d?.partner) continue;
    const id = [k.slot, d.partner.slot].sort((a, b) => a - b).join('-');
    if (!pairs.has(id)) pairs.set(id, { index: pairs.size, keys: [k, d.partner] });
  }
  return pairs;
}

// ---------- Board ----------
function renderBoard() {
  const board = $('board');
  board.style.aspectRatio = `${LAYOUT_WIDTH} / ${LAYOUT_HEIGHT}`;
  board.innerHTML = '';
  const s = state.settings;
  $('empty').hidden = !!s;
  board.classList.toggle('is-empty', !s);

  const actuations = s ? MAGNETIC.map(k => keyData(k).actuation) : [];
  const lo = Math.min(...actuations), hi = Math.max(...actuations);
  const pairs = s ? snapPairs() : new Map();
  const led = s && state.view === 'lighting' ? ledPreview() : null;
  board.classList.toggle('led-board', !!led);
  // Lighting and Macros don't use key selection: hide it there (it's kept for the other tabs).
  const selectable = !!s && state.view !== 'lighting' && state.view !== 'macros';
  board.classList.toggle('mc-board', !!s && state.view === 'macros');

  // The three knob entries share one physical knob.
  const knobKeys = KEYS.filter(k => k.knob);
  const kx = Math.min(...knobKeys.map(k => k.x)), kw = Math.max(...knobKeys.map(k => k.x + k.w)) - kx;
  const knob = document.createElement('button');
  knob.type = 'button';
  knob.className = 'knob' + (state.knob && selectable ? ' is-selected' : '');
  place(knob, { x: kx, y: 0, w: kw, h: knobKeys[0].h });
  knob.setAttribute('aria-label', 'Volume knob');
  if (!selectable) knob.tabIndex = -1;
  else knob.onclick = () => { state.knob = !state.knob; state.selected.clear(); refresh(); };
  board.appendChild(knob);

  for (const key of MAGNETIC) {
    const d = keyData(key);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'key';
    place(el, key);
    el.dataset.slot = key.slot;
    if (selectable && state.selected.has(key.slot)) el.classList.add('is-selected');
    if (state.picking !== null && key.slot !== state.picking) el.classList.add(snapEligible(key.slot) ? 'pick-target' : 'pick-blocked');
    if (selectable) el.setAttribute('aria-pressed', String(state.selected.has(key.slot)));

    const legend = document.createElement('span');
    legend.className = 'key-legend';
    legend.textContent = key.label;
    el.appendChild(legend);

    if (d) {
      if (d.pending) el.classList.add('is-pending');
      const value = document.createElement('span');
      value.className = 'key-value';
      if (state.view === 'actuation') {
        value.textContent = mm(d.actuation);
        const t = hi > lo ? (hi - d.actuation) / (hi - lo) : 0;   // shorter travel = stronger color
        el.style.setProperty('--heat', `${Math.round(15 + t * 70)}%`);
        el.classList.add('heat');
      } else if (state.view === 'rt') {
        if (d.rt) {
          // One value when press and release sensitivity match (the usual case); otherwise
          // ↓press ↑release on two short lines so nothing clips.
          const same = Math.abs(d.rtPress - d.rtRelease) < 0.0005;
          value.textContent = same ? mm(d.rtPress) : `↓${mm(d.rtPress)} ↑${mm(d.rtRelease)}`;
          if (!same) value.classList.add('rt-split');
          el.classList.add('hl-rt');
        }
        else el.classList.add('dim');
      } else if (state.view === 'snap') {
        if (d.partner) {
          const pair = [...pairs.values()].find(p => p.keys.some(k => k.slot === key.slot));
          el.classList.add('hl-snap');
          el.style.setProperty('--pair', `var(--pair-${pair.index % 4})`);
          value.textContent = `↔ ${d.partner.label}`;
        } else el.classList.add('dim');
      } else if (state.view === 'live') {
        el.classList.add('live-key');
        if (state.live?.focus === key.slot) el.classList.add('live-focus');
        if (state.live?.down.has(key.slot)) el.classList.add('live-down');
      } else if (state.view === 'keymap') {
        const a = layerAction(state.layer, key.slot);
        // Long combos wrap after "+" in a smaller size instead of being cut off.
        value.textContent = a.none ? '·' : a.short.replaceAll('+', '+​');
        value.title = a.label;
        el.classList.add('km-key');
        if (a.none) el.classList.add('dim');
        if (a.changed) el.classList.add('km-changed');
        if (state.pendingKeys.has(`${state.layer}:${key.slot}`)) el.classList.add('is-pending');
        if (state.capture?.slot === key.slot) el.classList.add('is-capturing');
      } else if (state.view === 'macros') {
        // Keys that run a macro show its name; the rest are dimmed.
        const b = layerBytes(state.layer, key.slot);
        if (b && b[0] === 9) {
          const { entry } = macroForSlot(b[2]);
          value.textContent = entry?.name ?? `Slot ${b[2] + 1}`;
          value.title = entry ? `${entry.name} · ${MACRO_MODES[b[1]]?.name ?? ''}` : `Macro slot ${b[2] + 1}, made elsewhere`;
          el.classList.add(entry ? 'mc-key' : 'mc-elsewhere');
          if (state.pendingKeys.has(`${state.layer}:${key.slot}`)) el.classList.add('is-pending');
          if (entry) el.dataset.macroId = entry.id;
        } else el.classList.add('dim');
      } else if (led) {
        led.paint(el, key);
      }
      el.appendChild(value);

      const marks = document.createElement('span');
      marks.className = 'key-marks';
      if (d.rt) marks.insertAdjacentHTML('beforeend', '<i class="mark mark-rt" title="Rapid Trigger"></i>');
      if (d.partner) marks.insertAdjacentHTML('beforeend', '<i class="mark mark-snap" title="Snap Tap"></i>');
      if (d.remapped) marks.insertAdjacentHTML('beforeend', '<i class="mark mark-remap" title="Remapped"></i>');
      el.appendChild(marks);

      el.setAttribute('aria-label', `${key.label}: actuation ${mm(d.actuation)} millimetres${d.rt ? ', rapid trigger on' : ''}${d.partner ? ', snap tap with ' + d.partner.label : ''}${d.pending ? ', unsaved change' : ''}`);
    } else {
      el.setAttribute('aria-label', key.label);
    }
    if (led) {
      el.tabIndex = -1; // lighting is keyboard-wide, so keys aren't selectable here
      el.setAttribute('aria-hidden', 'true');
    } else if (state.view === 'macros') {
      // Clicking a key that runs a library macro opens that macro; other keys do nothing here.
      if (el.dataset.macroId) el.onclick = () => openMacroEditor(libById(el.dataset.macroId));
      else el.tabIndex = -1;
    } else el.onclick = e => clickKey(key.slot, e.ctrlKey || e.metaKey || e.shiftKey);
    board.appendChild(el);
  }
  fitKeyLabels(board);
  renderLegend(lo, hi);
}

// Keycap labels that don't fit shrink one step, and only wrap if they still don't fit.
function fitKeyLabels(board = $('board')) {
  for (const v of board.querySelectorAll('.key-value')) {
    v.classList.remove('fit-1', 'fit-2');
    if (!v.textContent || v.classList.contains('rt-split')) continue;
    if (v.scrollWidth <= v.clientWidth + 1) continue;
    v.classList.add('fit-1');
    if (v.scrollWidth > v.clientWidth + 1) { v.classList.remove('fit-1'); v.classList.add('fit-2'); }
  }
}
let fitTimer;
window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => fitKeyLabels(), 120); });

function place(el, k) {
  el.style.left = `${(k.x / LAYOUT_WIDTH) * 100}%`;
  el.style.top = `${(k.y / LAYOUT_HEIGHT) * 100}%`;
  el.style.width = `${(k.w / LAYOUT_WIDTH) * 100}%`;
  el.style.height = `${(k.h / LAYOUT_HEIGHT) * 100}%`;
}

function clickKey(slot, additive) {
  state.knob = false;
  if (state.picking !== null) {
    if (slot !== state.picking && snapEligible(slot)) {
      makePair(state.picking, slot);
      state.selected = new Set([state.picking]);
    }
    state.picking = null;
    refresh();
    return;
  }
  if (additive) {
    if (state.selected.has(slot)) state.selected.delete(slot);
    else state.selected.add(slot);
  } else if (state.selected.size === 1 && state.selected.has(slot)) {
    state.selected.clear();
  } else {
    state.selected = new Set([slot]);
  }
  refresh();
}

function renderLegend(lo, hi) {
  const el = $('legend');
  if (!state.settings) { el.innerHTML = ''; return; }
  if (state.view === 'actuation') {
    el.innerHTML = `<span>${mm(lo)} mm</span><span class="ramp" aria-hidden="true"></span><span>${mm(hi)} mm</span><span class="muted">stronger color = shorter travel</span>`;
  } else if (state.view === 'rt') {
    el.innerHTML = '<span class="swatch swatch-rt"></span><span>Rapid Trigger on · sensitivity in mm (↓ press, ↑ release when they differ)</span>';
  } else if (state.view === 'live') {
    const why = liveUnavailableReason();
    el.innerHTML = state.live
      ? '<button class="btn btn-small btn-stop" id="btnLive" type="button">Stop live test</button><span class="live-dot"></span><span>Live: press keys to see their depth</span>'
      : `<button class="btn btn-small btn-primary" id="btnLive" type="button" ${why ? 'disabled' : ''}>Start live test</button><span class="muted">${why ?? 'Shows how deep the key you press goes, against its trigger points.'}</span>`;
    $('btnLive').onclick = () => (state.live ? stopLive() : startLive());
  } else if (state.view === 'keymap') {
    el.innerHTML = `<div class="segmented segmented-sm" role="group" aria-label="Layer">
        ${Object.entries(LAYERS).map(([id, l]) => `<button type="button" data-layer="${id}" aria-pressed="${state.layer === id}">${l.label}</button>`).join('')}
      </div><span class="swatch swatch-km"></span><span class="muted">changed from factory</span>`;
    el.querySelectorAll('[data-layer]').forEach(b => b.onclick = () => { state.layer = b.dataset.layer; refresh(); });
  } else if (state.view === 'macros') {
    el.innerHTML = `<div class="segmented segmented-sm" role="group" aria-label="Layer">
        ${Object.entries(LAYERS).map(([id, l]) => `<button type="button" data-layer="${id}" aria-pressed="${state.layer === id}">${l.label}</button>`).join('')}
      </div><span class="swatch swatch-mc"></span><span>library macro</span><span class="muted">(click to edit)</span><span class="swatch swatch-mc-elsewhere"></span><span>made elsewhere</span>`;
    el.querySelectorAll('[data-layer]').forEach(b => b.onclick = () => { state.layer = b.dataset.layer; refresh(); });
  } else if (state.view === 'lighting') {
    const l = currentLight();
    const e = l && effectById(l.effect);
    el.innerHTML = l
      ? `<span class="swatch led-swatch" style="--sw:${l.rainbow || !e?.color ? 'conic-gradient(from 90deg, #f55, #fc4, #5e7, #4cf, #a6f, #f55)' : hex(l.color)}"></span>
         <span>${e?.name ?? `Effect ${l.effect}`} · ${l.brightness ? `brightness ${l.brightness}/${MAX_LEVEL}` : 'lights off'}</span><span class="muted">preview is approximate</span>`
      : '<span class="muted">Lighting wasn’t read from this source.</span>';
  } else {
    el.innerHTML = '<span class="swatch swatch-snap"></span><span>Snap Tap pairs: the last key pressed wins</span>';
  }
}

function renderSelectionTools() {
  const el = $('selectTools');
  if (!state.settings || state.view === 'lighting' || state.view === 'macros') { el.hidden = true; return; }
  el.hidden = false;
  $('selectCount').textContent = state.selected.size ? `${state.selected.size} selected` : 'Ctrl/Shift-click to select several';
  $('btnClearSel').disabled = !state.selected.size;
}

function renderStats() {
  const s = state.settings;
  if (!s) { $('stats').innerHTML = ''; return; }
  const data = MAGNETIC.map(keyData);
  const acts = [...new Set(data.map(d => mm(d.actuation)))].sort();
  const rt = data.filter(d => d.rt).length;
  const pairs = snapPairs().size;
  const remapped = data.filter(d => d.remapped).length;
  const items = [
    ['Actuation points', acts.join(' · ') + ' mm'],
    ['Rapid Trigger', `${rt} key${rt === 1 ? '' : 's'}`],
    ['Snap Tap', `${pairs} pair${pairs === 1 ? '' : 's'}`],
    ['Remapped', state.settings.keymap ? `${remapped} key${remapped === 1 ? '' : 's'}` : 'Open Key map to load'],
  ];
  $('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><span class="stat-label">${k}</span><span class="stat-value">${v}</span></div>`).join('');
}

function renderDevice() {
  const s = state.settings;
  $('device').hidden = !s;
  $('badgeMode').textContent = editable() || (bounds() && state.busy) ? 'Review before write' : 'Read-only';
  if (!s) return;
  $('deviceName').textContent = s.deviceId === DEVICE_ID ? 'Yunzii RT75 Pro' : (s.productName ?? 'Keyboard');
  const fw = s.usbVersion ? `fw ${(s.usbVersion >> 8).toString(16)}.${(s.usbVersion & 0xff).toString(16).padStart(2, '0')}` : 'fw ?';
  $('chipFirmware').textContent = fw;
  $('chipRate').textContent = s.reportRateHz ? `${s.reportRateHz >= 1000 ? s.reportRateHz / 1000 + ' kHz' : s.reportRateHz + ' Hz'} polling` : 'polling ?';
  $('chipProfile').textContent = `Profile ${(s.profile ?? 0) + 1}`;
  $('chipBattery').hidden = s.battery === undefined;
  if (s.battery !== undefined) $('chipBattery').textContent = `Battery ${s.battery}%`;
  $('chipSource').textContent = s.demo ? 'Demo · simulated keyboard' : s.source === 'device' ? (s.viaDongle ? 'Live · 2.4G' : 'Live · USB') : 'From file';
  // How long the last full read took, so wireless speed can be compared (?dongle=classic).
  const ls = s.loadStats;
  if (ls && !s.demo) {
    $('chipSource').textContent += ` · ${(ls.ms / 1000).toFixed(1)} s`;
    $('chipSource').title = `Last read: ${(ls.ms / 1000).toFixed(1)} s, ${ls.reads} reads${ls.timing === 'usb' ? '' : `, ${ls.timing} dongle timing`}`;
  } else $('chipSource').title = '';
  $('btnConnect').textContent = s.source === 'device' ? 'Refresh' : 'Connect keyboard';
}

// ---------- Pending bar ----------
function renderPendingBar() {
  const edits = pendingEdits();
  const n = edits.length, kb = kbChanges().length, km = keymapChanges().length, lt = lightChange() ? 1 : 0, mw = macroWrites().length;
  const settingsCount = edits.reduce((a, e) => a + Object.keys(e).length - 1, 0);
  $('pendingBar').hidden = n === 0 && kb === 0 && km === 0 && !lt && !mw;
  const parts = [];
  if (n) parts.push(`${settingsCount} unsaved change${settingsCount === 1 ? '' : 's'} on ${n} key${n === 1 ? '' : 's'}`);
  if (kb) parts.push(n ? `${kb} keyboard setting${kb === 1 ? '' : 's'}` : `${kb} unsaved keyboard setting${kb === 1 ? '' : 's'}`);
  if (km) parts.push(`${km} key mapping${km === 1 ? '' : 's'}`);
  if (lt) parts.push('lighting');
  if (mw) parts.push(`${mw} macro${mw === 1 ? '' : 's'}`);
  $('pendingText').textContent = parts.length === 1 && km && !n && !kb ? `${km} unsaved key mapping${km === 1 ? '' : 's'}`
    : parts.length === 1 && lt ? 'Unsaved lighting change'
    : parts.length === 1 && mw ? `${mw} macro${mw === 1 ? '' : 's'} to write` : parts.join(' + ');
  $('btnReview').disabled = !editable();
  $('btnDiscard').disabled = state.busy;
}

// ---------- Inspector ----------
function row(label, value, extra = '') {
  return `<div class="row${extra}"><dt>${label}</dt><dd>${value}</dd></div>`;
}

// One value if all selected keys agree, otherwise null ("mixed").
function common(datas, f) {
  const vals = [...new Set(datas.map(f))];
  return vals.length === 1 ? vals[0] : null;
}

function renderInspector() {
  const el = $('inspector');
  if (state.view === 'live' && state.settings) { renderLivePanel(); return; }
  if (state.view === 'lighting' && state.settings) { renderLightingPanel(); return; }
  if (state.view === 'macros' && state.settings) { renderLibraryPanel(); return; }
  if (state.view === 'keymap' && state.settings && !state.knob && state.selected.size) { renderKeymapPanel(); return; }
  if (!state.settings || (!state.knob && !state.selected.size)) {
    el.innerHTML = '<p class="inspector-hint">Select a key to see its settings. Ctrl- or Shift-click to select several.</p>';
    return;
  }
  if (state.knob) {
    el.innerHTML = `<h2>Volume knob</h2><dl>${row('Turn', 'Volume down / up')}${row('Press', 'Mute')}</dl>
      <p class="note">The knob is not a magnetic switch, so it has no travel settings.</p>`;
    return;
  }

  const keys = [...state.selected].map(keyBySlot);
  const datas = keys.map(keyData);
  const single = keys.length === 1 ? datas[0] : null;
  const title = single ? keys[0].label : `${keys.length} keys`;
  const subtitle = single
    ? `${single.action === null ? '' : single.remapped ? `Remapped to <strong>${single.action}</strong> · ` : `Sends ${single.action} · `}${single.mode}`
    : keys.map(k => k.label).join(', ');

  // Revert sits in the title row so showing it never moves the controls below.
  const revert = editable() && datas.some(d => d.pending)
    ? `<button class="revert-chip" id="btnRevertSel" type="button" title="Discard unsaved changes on ${keys.length === 1 ? 'this key' : 'these keys'}">Unsaved · Revert</button>` : '';
  let html = `<div class="insp-head"><h2>${title}</h2>${revert}</div><p class="sub">${subtitle}</p>`;
  if (single) html += `<div class="travel" aria-hidden="true">${travelDiagram(single)}</div>`;

  if (editable()) html += editorHtml(datas);
  else html += readOnlyHtml(datas, single);

  if (single) {
    html += `<h3>Other settings</h3><dl>
      ${row('Switch', single.switchType)}
      ${editable() ? '' : row('Top dead zone', `${mm(single.topDeadZone)} mm`) + row('Bottom dead zone', `${mm(single.bottomDeadZone)} mm`)}
      ${editable() ? '' : row('Snap Tap partner', single.partner ? `<button class="link" data-jump="${single.partner.slot}">${single.partner.label}</button>` : 'None')}
    </dl>`;
  }
  if (!editable()) {
    html += `<p class="note">${state.settings.source === 'device' ? (state.busy ? 'Writing…' : 'This keyboard’s travel precision is unknown, so editing is off.') : 'Viewing a file. Connect the keyboard to edit.'}</p>`;
  }
  el.innerHTML = html;
  el.querySelector('[data-jump]')?.addEventListener('click', e => { state.selected = new Set([Number(e.currentTarget.dataset.jump)]); refresh(); });
  if (editable()) wireEditor(el);
}

function readOnlyHtml(datas, single) {
  const act = common(datas, d => mm(d.actuation)), rel = common(datas, d => mm(d.release));
  const rt = common(datas, d => d.rt);
  return `<h3>Travel</h3><dl>
      ${row('Actuation point', act ? `${act} mm` : 'Mixed')}
      ${row('Release point', rel ? `${rel} mm` : 'Mixed')}
    </dl>
    <h3>Rapid Trigger</h3><dl>
      ${row('Status', rt === null ? 'Mixed' : rt ? '<span class="pill pill-rt">On</span>' : '<span class="pill">Off</span>')}
      ${single?.rt ? row('Press sensitivity', `${mm(single.rtPress)} mm`) + row('Release sensitivity', `${mm(single.rtRelease)} mm`) : ''}
    </dl>`;
}

// badge: optional inline note shown on the label line, so it never changes the panel's height.
function slider(id, label, value, min, max, badge = '') {
  const v = value === null ? '' : mm3(value);
  return `<div class="field">
      <div class="field-label"><label for="${id}Num">${label}</label>${badge}</div>
      <div class="field-row">
        <input type="range" id="${id}Range" min="${min}" max="${max}" step="0.005" value="${value ?? (min + max) / 2}" ${value === null ? 'class="is-mixed"' : ''} aria-label="${label}">
        <span class="num"><input type="number" id="${id}Num" min="${min}" max="${max}" step="0.005" value="${v}" placeholder="mixed"><span>mm</span></span>
      </div>
    </div>`;
}

// Resets the link toggles when the selection changes.
function unlinked() {
  const key = [...state.selected].sort((a, b) => a - b).join(',');
  if (state.unlinked.key !== key) state.unlinked = { key, release: false, rt: false };
  return state.unlinked;
}

function editorHtml(datas) {
  const act = common(datas, d => d.actuation);
  const rel = common(datas, d => d.release);
  const linked = !unlinked().release && datas.every(d => Math.abs(d.actuation - d.release) < 0.0005);
  const rt = common(datas, d => d.rt);
  const rtP = common(datas, d => d.rtPress), rtR = common(datas, d => d.rtRelease);
  const rtLinked = !unlinked().rt && datas.every(d => Math.abs(d.rtPress - d.rtRelease) < 0.0005);
  const anyRt = datas.some(d => d.rt);
  const rtMin = 1 / state.settings.travelStep;
  const T = LIMITS.travel, DZ = LIMITS.deadZone;
  const tdz = common(datas, d => d.topDeadZone), bdz = common(datas, d => d.bottomDeadZone);

  return `
    <h3>Travel</h3>
    ${slider('act', 'Actuation point', act, T.min, T.max)}
    <label class="check"><input type="checkbox" id="relLink" ${linked ? 'checked' : ''}> Release at the same point</label>
    ${linked ? '' : slider('rel', 'Release point', rel, T.min, T.max)}

    <h3>Dead zones</h3>
    ${slider('tdz', 'Top dead zone', tdz, DZ.min, DZ.max, datas.some(d => d.topDeadZone === 0)
      ? '<span class="warn-badge" title="A top dead zone of 0 can cause accidental presses. qmk.top shows the same warning.">⚠ 0 may misfire</span>' : '')}
    ${slider('bdz', 'Bottom dead zone', bdz, DZ.min, DZ.max)}

    <h3>Rapid Trigger</h3>
    <label class="switch"><input type="checkbox" id="rtToggle" ${rt ? 'checked' : ''}><span class="switch-track"></span>
      <span>${rt === null ? 'On for some keys' : rt ? 'On' : 'Off'}</span></label>
    ${anyRt ? `
      ${slider('rtp', rtLinked ? 'Sensitivity (press and release)' : 'Press sensitivity', rtP, rtMin, LIMITS.rt.max)}
      <label class="check"><input type="checkbox" id="rtLink" ${rtLinked ? 'checked' : ''}> Same for press and release</label>
      ${rtLinked ? '' : slider('rtr', 'Release sensitivity', rtR, rtMin, LIMITS.rt.max)}` : ''}

    <h3>Snap Tap</h3>
    ${snapHtml(datas)}`;
}

// Snap Tap only replaces Normal mode here; keys using DKS, mod-tap or toggle are left alone.
const snapEligible = slot => [0, SNAP].includes(raw(slot, 'mode') & 0x7f);

function snapHtml(datas) {
  const slots = [...state.selected];
  if (state.picking !== null) {
    return `<div class="pick-note"><span>Click the key to pair with <strong>${keyBySlot(state.picking).label}</strong></span>
      <button class="link small" id="btnPickCancel" type="button">Cancel</button></div>`;
  }
  if (slots.length === 2) {
    const [a, b] = slots;
    // Both directions must agree; a half-written pair (one key pointing at the other) can be completed.
    const paired = keyData(keyBySlot(a)).partner?.slot === b && keyData(keyBySlot(b)).partner?.slot === a;
    if (paired) return `<p class="snap-line">These two keys are a pair.</p><button class="btn btn-small" id="btnUnpair" type="button">Remove pair</button>`;
    if (!snapEligible(a) || !snapEligible(b)) return '<p class="note">One of these keys uses another advanced mode (DKS, mod-tap or toggle), which this app can’t change yet.</p>';
    return '<p class="snap-line">The last of the two pressed wins.</p><button class="btn btn-small" id="btnPairTwo" type="button">Pair these two keys</button>';
  }
  if (slots.length !== 1) return '<p class="note">Select one key, or exactly two keys to pair them.</p>';
  const d = datas[0];
  if (!snapEligible(slots[0])) return `<p class="note">This key uses ${d.mode}, which this app can’t change yet.</p>`;
  if (d.partner && keyData(d.partner).partner?.slot !== slots[0]) {
    return `<p class="snap-line">Points at <button class="link" data-jump="${d.partner.slot}">${d.partner.label}</button>, but ${d.partner.label} isn’t paired back.</p>
      <div class="btn-row"><button class="btn btn-small" id="btnFixPair" type="button">Complete the pair</button>
      <button class="btn btn-small" id="btnUnpair" type="button">Remove</button></div>`;
  }
  if (d.partner) {
    return `<p class="snap-line">Paired with <button class="link" data-jump="${d.partner.slot}">${d.partner.label}</button></p>
      <div class="btn-row"><button class="btn btn-small" id="btnPick" type="button">Change partner</button>
      <button class="btn btn-small" id="btnUnpair" type="button">Remove pair</button></div>`;
  }
  return '<p class="snap-line">Not paired.</p><button class="btn btn-small" id="btnPick" type="button">Pair with another key…</button>';
}

// Pairs a and b, releasing any key either was previously paired with.
function makePair(a, b) {
  for (const [s, other] of [[a, b], [b, a]]) {
    const old = keyData(keyBySlot(s)).partner?.slot;
    if (old !== undefined && old !== other) setMode(old, 0);
    setMode(s, SNAP);
    setPending(s, 'snapPartner', other);
  }
}

function unpair(a) {
  const p = keyData(keyBySlot(a)).partner?.slot;
  setMode(a, 0);
  if (p !== undefined) setMode(p, 0);
}

// Changes the mode while keeping the Rapid Trigger bit.
function setMode(slot, modeId) {
  setPending(slot, 'mode', (raw(slot, 'mode') & 0x80) | modeId);
}

function wireEditor(el) {
  const slots = [...state.selected];
  const T = LIMITS.travel, rtMin = 1 / state.settings.travelStep;
  const apply = () => refresh();

  const bind = (id, onValue, min, max) => {
    const range = el.querySelector(`#${id}Range`), num = el.querySelector(`#${id}Num`);
    if (!range) return;
    range.addEventListener('input', () => { num.value = mm3(Number(range.value)); onValue(Number(range.value), min, max); renderBoardOnly(); });
    range.addEventListener('change', apply);
    num.addEventListener('change', () => { if (num.value === '') return; onValue(Number(num.value), min, max); apply(); });
  };

  const linked = () => el.querySelector('#relLink')?.checked;
  bind('act', (v, min, max) => slots.forEach(s => {
    setPending(s, 'actuation', toRaw(v, min, max));
    if (linked()) setPending(s, 'release', toRaw(v, min, max));
  }), T.min, T.max);
  bind('rel', (v, min, max) => slots.forEach(s => setPending(s, 'release', toRaw(v, min, max))), T.min, T.max);
  const DZ = LIMITS.deadZone;
  bind('tdz', (v, min, max) => slots.forEach(s => setPending(s, 'topDeadZone', toRaw(v, min, max))), DZ.min, DZ.max);
  bind('bdz', (v, min, max) => slots.forEach(s => setPending(s, 'bottomDeadZone', toRaw(v, min, max))), DZ.min, DZ.max);

  el.querySelector('#relLink')?.addEventListener('change', e => {
    unlinked().release = !e.target.checked;
    if (e.target.checked) slots.forEach(s => setPending(s, 'release', raw(s, 'actuation')));
    apply();
  });

  el.querySelector('#rtToggle')?.addEventListener('change', e => {
    const on = e.target.checked;
    for (const s of slots) {
      const mode = (raw(s, 'mode') & 0x7f) | (on ? 0x80 : 0);
      setPending(s, 'mode', mode);
      for (const f of ['rtPress', 'rtRelease']) {
        // A key that never had RT has zero sensitivity; start it at qmk.top's default.
        if (on && !raw(s, f)) setPending(s, f, toRaw(RT_DEFAULT_MM, rtMin, LIMITS.rt.max));
        // With RT off the sensitivities do nothing, so drop any edits to them.
        if (!on) setPending(s, f, state.settings.magnet[f][s]);
      }
    }
    apply();
  });

  // Sensitivity only applies to selected keys that have RT on.
  const rtSlots = () => slots.filter(s => raw(s, 'mode') & 0x80);
  const rtLinked = () => el.querySelector('#rtLink')?.checked;
  bind('rtp', (v, min, max) => rtSlots().forEach(s => {
    setPending(s, 'rtPress', toRaw(v, min, max));
    if (rtLinked()) setPending(s, 'rtRelease', toRaw(v, min, max));
  }), rtMin, LIMITS.rt.max);
  bind('rtr', (v, min, max) => rtSlots().forEach(s => setPending(s, 'rtRelease', toRaw(v, min, max))), rtMin, LIMITS.rt.max);

  el.querySelector('#rtLink')?.addEventListener('change', e => {
    unlinked().rt = !e.target.checked;
    if (e.target.checked) rtSlots().forEach(s => setPending(s, 'rtRelease', raw(s, 'rtPress')));
    apply();
  });

  el.querySelector('#btnRevertSel')?.addEventListener('click', () => { slots.forEach(s => state.pending.delete(s)); apply(); });

  el.querySelector('#btnPick')?.addEventListener('click', () => { state.picking = slots[0]; setView('snap'); apply(); });
  el.querySelector('#btnPickCancel')?.addEventListener('click', () => { state.picking = null; apply(); });
  el.querySelector('#btnUnpair')?.addEventListener('click', () => { unpair(slots[0]); apply(); });
  el.querySelector('#btnPairTwo')?.addEventListener('click', () => { makePair(slots[0], slots[1]); apply(); });
  el.querySelector('#btnFixPair')?.addEventListener('click', () => { makePair(slots[0], keyData(keyBySlot(slots[0])).partner.slot); apply(); });
}

// Deepest settable actuation point. qmk.top/v4 returns 3.3 mm for every switch type
// (轴体行程最大值); it only allows 4 mm on firmware older than 0x0300.
const MAX_TRAVEL_MM = 3.3;

// Vertical travel bar: 0 mm at the top, the deepest setting at the bottom.
function travelDiagram(d) {
  const MAX = MAX_TRAVEL_MM, H = 140, y = v => 8 + (Math.min(v, MAX) / MAX) * H;
  const lines = [
    [d.actuation, 'act', 'Actuation'],
    [d.release, 'rel', 'Release'],
  ];
  const deadTop = d.topDeadZone > 0 ? `<rect class="dz" x="44" y="${y(0)}" width="20" height="${y(d.topDeadZone) - y(0)}"/>` : '';
  const deadBottom = d.bottomDeadZone > 0 ? `<rect class="dz" x="44" y="${y(MAX - d.bottomDeadZone)}" width="20" height="${y(MAX) - y(MAX - d.bottomDeadZone)}"/>` : '';
  const same = Math.abs(d.actuation - d.release) < 0.005;
  return `<svg viewBox="0 0 240 ${H + 30}" role="img">
    <defs><clipPath id="travelClip"><rect x="44" y="${y(0)}" width="20" height="${H}" rx="4"/></clipPath></defs>
    <rect class="track" x="44" y="${y(0)}" width="20" height="${H}" rx="4"/>
    <g clip-path="url(#travelClip)">${deadTop}${deadBottom}</g>
    <text class="tick" x="36" y="${y(0) + 4}" text-anchor="end">0 mm</text>
    <text class="tick" x="36" y="${y(MAX) + 4}" text-anchor="end">${MAX} mm</text>
    <text class="tick" x="36" y="${y(MAX) + 16}" text-anchor="end">max</text>
    ${lines.filter((l, i) => !(same && i === 1)).map(([v, cls, label]) => `
      <line class="mk mk-${cls}" x1="38" x2="70" y1="${y(v)}" y2="${y(v)}"/>
      <text class="lbl" x="78" y="${y(v) + 4}">${same && cls === 'act' ? 'Actuation / release' : label} ${mm(v)}</text>`).join('')}
  </svg>`;
}

// ---------- Key map ----------
// Base layer = the profile's key matrix; Fn layers are separate per OS. On an Fn layer an all-zero
// slot has no Fn action.
const LAYERS = {
  base: { label: 'Base', field: 'keymap', defaults: DEFAULT_MATRIX, fn: false },
  fnWin: { label: 'Fn · Windows', field: 'fnWin', defaults: DEFAULT_FN_MATRIX, fn: true },
  fnMac: { label: 'Fn · Mac', field: 'fnMac', defaults: DEFAULT_FN_MAC_MATRIX, fn: true },
};

// What the keyboard has now (ignores unsaved edits).
function deviceBytes(layer, slot) {
  const arr = state.settings?.[LAYERS[layer].field];
  return arr ? arr.slice(slot * 4, slot * 4 + 4) : undefined;
}

// With any unsaved edit applied.
function layerBytes(layer, slot) {
  return state.pendingKeys.get(`${layer}:${slot}`) ?? deviceBytes(layer, slot);
}

function setKeyPending(layer, slot, bytes) {
  const id = `${layer}:${slot}`;
  if (bytes.join() === deviceBytes(layer, slot)?.join()) state.pendingKeys.delete(id);
  else state.pendingKeys.set(id, [...bytes]);
}

// Key map edits that differ from the keyboard: [{ layer, slot, from, to }].
function keymapChanges() {
  return [...state.pendingKeys].map(([id, to]) => {
    const [layer, slot] = [id.split(':')[0], Number(id.split(':')[1])];
    return { layer, slot, from: deviceBytes(layer, slot), to };
  }).filter(c => c.from && c.to.join() !== c.from.join());
}

const actionLabel = (layer, bytes) => {
  if (LAYERS[layer].fn && bytes.every(b => b === 0)) return 'No Fn action';
  if (bytes[0] === 9) { // a macro: use its library name when RT75 Studio knows it
    const entry = macroForSlot(bytes[2]).entry;
    return `${entry ? `“${entry.name}”` : `Macro slot ${bytes[2] + 1}`} · ${MACRO_MODES[bytes[1]]?.name ?? `mode ${bytes[1]}`}`;
  }
  return decodeAction(bytes, { mac: layer === 'fnMac' }).label;
};
const kmRows = changes => changes.map(c => `<tr><td>${keyBySlot(c.slot).label}</td><td>${LAYERS[c.layer].label}</td><td>${escapeHtml(actionLabel(c.layer, c.from))}</td><td><strong>${escapeHtml(actionLabel(c.layer, c.to))}</strong></td></tr>`).join('');

function layerAction(layer, slot) {
  const b = layerBytes(layer, slot);
  if (!b) return { none: true, short: '·', label: state.settings?.source === 'device' ? 'Loading…' : 'Not in this file' };
  const factory = LAYERS[layer].defaults.slice(slot * 4, slot * 4 + 4);
  const changed = b.join() !== factory.join();
  if (LAYERS[layer].fn && b.every(x => x === 0)) return { none: true, changed, short: '·', label: 'No Fn action', bytes: b, factory };
  return { ...decodeAction(b, { mac: layer === 'fnMac' }), changed, bytes: b, factory };
}

function factoryLabel(layer, slot) {
  const f = LAYERS[layer].defaults.slice(slot * 4, slot * 4 + 4);
  if (LAYERS[layer].fn && f.every(x => x === 0)) return 'No Fn action';
  return decodeAction(f, { mac: layer === 'fnMac' }).label;
}

// ---------- Macro library ----------
// Named macros live in RT75 Studio's library (this browser); the keyboard only holds their steps in
// numbered slots and can't give them back. Keys point at slots with [9, mode, slot, 0].
const validMacroKey = c => c in HID_NAMES;
const fmtMs = ms => (ms >= 1000 ? `${+(ms / 1000).toFixed(2)} s` : `${ms} ms`);
const macroLength = m => `${m.steps.length} step${m.steps.length === 1 ? '' : 's'}, ${fmtMs(m.steps.reduce((t, s) => t + s.delay, 0))}`;
const libById = id => state.library.find(e => e.id === id);
const persistLibrary = () => { if (!saveLibrary(state.library, !!state.settings?.demo)) showError('Couldn’t save the macro library in this browser (storage is blocked or full).'); };

// Library macro for a slot: a pending write to that slot first, then the macro written there.
function macroForSlot(slot) {
  const pendingId = state.pendingMacroWrites.get(slot);
  if (pendingId) return { entry: libById(pendingId), pending: true };
  return { entry: state.library.find(e => e.slot === slot), pending: false };
}

// Keys (on the current profile's base layer and the Fn layers) that run a slot, with unsaved edits.
function slotUsers(slot) {
  const users = [];
  for (const layer of Object.keys(LAYERS)) {
    for (const key of MAGNETIC) {
      const b = layerBytes(layer, key.slot);
      if (b && b[0] === 9 && b[2] === slot) users.push({ key, layer });
    }
  }
  return users;
}
const userLabel = u => `${u.layer === 'base' ? '' : 'Fn+'}${u.key.label}${u.layer === 'fnMac' ? ' (Mac)' : ''}`;

// Slots keys use that no library macro claims: made in qmk.top, or before the library existed.
function elsewhereSlots() {
  const slots = new Map();
  for (const layer of Object.keys(LAYERS)) {
    for (const key of MAGNETIC) {
      const b = layerBytes(layer, key.slot);
      if (!b || b[0] !== 9 || macroForSlot(b[2]).entry) continue;
      if (!slots.has(b[2])) slots.set(b[2], []);
      slots.get(b[2]).push({ key, layer });
    }
  }
  return [...slots].sort((a, b) => a[0] - b[0]);
}

// Queued macro writes: [{ slot, entry, macro }].
function macroWrites() {
  return [...state.pendingMacroWrites]
    .map(([slot, id]) => ({ slot, entry: libById(id) }))
    .filter(w => w.entry)
    .map(w => ({ ...w, macro: { repeat: w.entry.repeat, steps: w.entry.steps } }))
    .sort((a, b) => a.slot - b.slot);
}
function macroWriteRows(writes) {
  return writes.map(w => {
    const before = w.before ?? (w.entry.slot === w.slot && w.entry.written ? w.entry.written : null);
    const users = slotUsers(w.slot).map(userLabel);
    return `<tr><td>Macro slot ${w.slot + 1}${users.length ? `<br><span class="muted">used by ${escapeHtml(users.join(', '))}</span>` : ''}</td><td>“${escapeHtml(w.entry.name)}”</td>
      <td>${before ? macroLength(before) : '<span class="muted">unknown</span>'}</td><td><strong>${macroLength(w.macro)}</strong></td></tr>`;
  }).join('');
}

// Key map: what a macro key runs.
function macroCardHtml(bytes) {
  const slot = bytes[2];
  const { entry, pending } = macroForSlot(slot);
  const mode = MACRO_MODES[bytes[1]]?.name ?? `Mode ${bytes[1]}`;
  if (!entry) {
    return `<div class="macro-card"><div class="macro-head"><strong>Macro slot ${slot + 1}</strong><span class="muted">${mode}</span></div>
      <p class="muted macro-empty">Made outside RT75 Studio (for example in qmk.top), so its name and steps aren’t known here. The Macros tab can re-create it.</p></div>`;
  }
  return `<div class="macro-card${pending ? ' is-pending' : ''}">
    <div class="macro-head"><strong>${escapeHtml(entry.name)}${pending ? ' <span class="km-badge km-badge-pending">not written yet</span>' : ''}</strong>
      <span class="muted">${mode}${bytes[1] === 0 ? ` · ${entry.repeat}×` : ''} · ${macroLength(entry)}</span></div>
    ${entry.steps.length ? `<ol class="macro-steps">${entry.steps.map(s => `<li class="${s.down ? 'is-down' : 'is-up'}">
        <span class="macro-arrow" aria-hidden="true">${s.down ? '↓' : '↑'}</span>
        <span class="macro-what">${escapeHtml(stepLabel(s, keyName))}</span>
        <span class="macro-delay muted">${fmtMs(s.delay)}</span></li>`).join('')}</ol>` : '<p class="muted macro-empty">No steps yet.</p>'}
    <div class="btn-row macro-actions"><button class="btn btn-small" type="button" data-edit-macro="${entry.id}">Edit macro…</button></div>
  </div>`;
}

// Key editor: run a library macro, a slot made elsewhere, or a new macro; and the play mode.
function macroEditorHtml(cur) {
  const isMacro = cur[0] === 9;
  const curLabel = isMacro ? (macroForSlot(cur[2]).entry?.name ?? `Macro slot ${cur[2] + 1}`) : 'Run a macro…';
  return `<span class="km-edit-label">Macro</span>
    <div class="km-key-row">
      <select id="kmMacroSelect" aria-label="Run a macro">
        <option value="">${escapeHtml(curLabel)}</option>
        ${state.library.map(e => `<option value="lib:${e.id}">${escapeHtml(e.name)}</option>`).join('')}
        ${elsewhereSlots().map(([slot]) => `<option value="slot:${slot}">Macro slot ${slot + 1} (made elsewhere)</option>`).join('')}
        <option value="new">New macro…</option>
      </select>
      ${isMacro ? `<select id="kmMacroMode" aria-label="Play mode">
        ${Object.entries(MACRO_MODES).map(([id, m]) => `<option value="${id}" ${Number(id) === cur[1] ? 'selected' : ''}>${m.name}</option>`).join('')}
      </select>` : ''}
    </div>`;
}

// Points a key at a library macro. A macro without a slot gets the lowest slot that no key on any
// profile uses (read from the keyboard) and that no other library macro holds.
async function assignLibraryMacro(layer, slot, entry, mode) {
  showError(null);
  let target = [...state.pendingMacroWrites].find(([, id]) => id === entry.id)?.[0] ?? entry.slot;
  if (target === undefined) {
    state.busy = true;
    refresh();
    try {
      const used = await readMacroSlotsInUse(state.dev, state.settings, (f, label) => setBusy(f, `Finding a free macro slot: ${label}…`));
      const claimed = [...state.library.map(e => e.slot).filter(validSlot), ...state.pendingMacroWrites.keys()];
      target = pickFreeSlot(used, claimed);
    } catch (e) {
      showError('Couldn’t pick a macro slot: ' + e.message);
      return;
    } finally {
      state.busy = false;
      setBusy(null);
    }
  }
  // Always (re)write the steps: the slot may have been changed since (by qmk.top, or a factory
  // reset), and the keyboard can't be asked what it holds.
  state.pendingMacroWrites.set(target, entry.id);
  setKeyPending(layer, slot, [9, mode, target, 0]);
  refresh();
}

// Puts every key that runs a slot (on this profile's base layer and the Fn layers) back to its
// factory action, as reviewed key-map changes. The slot itself is just left unused: the keyboard
// has no command to delete a macro, and qmk.top's “delete” only removes it from its own list.
function removeSlotFromKeys(slot) {
  for (const u of slotUsers(slot)) {
    const bytes = factoryBytes(u.layer, u.key.slot);
    if (isWritableAction(bytes, u.layer, u.key.slot)) setKeyPending(u.layer, u.key.slot, bytes);
  }
  if (state.pendingMacroWrites.get(slot) && !slotUsers(slot).length) state.pendingMacroWrites.delete(slot);
  libraryStatus = 'Queued: those keys go back to their factory action when you write your changes.';
  refresh();
  setTimeout(() => { libraryStatus = ''; }, 0);
}

// Macros view: the library.
let libraryStatus = '';
function renderLibraryPanel() {
  const el = $('inspector');
  const can = editable();
  const items = state.library.map(e => {
    const pendingSlot = [...state.pendingMacroWrites].find(([, id]) => id === e.id)?.[0];
    const users = e.slot !== undefined ? slotUsers(e.slot) : [];
    let status, cls = '';
    if (pendingSlot !== undefined) { status = `Will be written to slot ${pendingSlot + 1} when you review your changes.`; cls = ' is-pending'; }
    else if (e.slot !== undefined && users.length && isOutdated(e)) { status = `On ${users.map(userLabel).join(', ')}, but changed since it was written.`; cls = ' is-outdated'; }
    else if (users.length) status = `On ${users.map(userLabel).join(', ')} · slot ${e.slot + 1}`;
    else status = e.slot !== undefined ? `Not on a key on this profile · keeps slot ${e.slot + 1}` : 'Not on a key yet';
    return `<li class="lib-item${cls}">
      <div class="lib-top"><span class="lib-name">${escapeHtml(e.name)}</span><span class="lib-meta">${macroLength(e)}</span></div>
      <div class="lib-summary">${escapeHtml(macroSummary(e, keyName))}</div>
      <p class="lib-status${cls === ' is-outdated' ? ' is-warn' : ''}">${status}</p>
      <div class="lib-buttons">
        <button class="btn btn-small" type="button" data-lib-edit="${e.id}">Edit…</button>
        ${cls === ' is-outdated' && can ? `<button class="btn btn-small btn-primary" type="button" data-lib-write="${e.id}">Write to keyboard</button>` : ''}
        ${users.length && can ? `<button class="btn btn-small" type="button" data-remove-slot="${e.slot}">Remove from keys</button>` : ''}
        <button class="btn btn-small" type="button" data-lib-dup="${e.id}">Duplicate</button>
        <button class="btn btn-small" type="button" data-lib-del="${e.id}">Delete</button>
      </div></li>`;
  }).join('');
  const elsewhere = elsewhereSlots();
  el.innerHTML = `<div class="insp-head"><h2>Macros</h2></div>
    <p class="sub">Named macros, kept in this browser. Put one on a key in the Key map tab.</p>
    <div class="lib-actions">
      <button class="btn btn-small btn-primary" id="libNew" type="button">New macro</button>
      <button class="btn btn-small" id="libImport" type="button">Import…</button>
      <button class="btn btn-small" id="libExport" type="button" ${state.library.length ? '' : 'disabled'}>Export</button>
      <input type="file" id="libFile" accept="application/json,.json" hidden>
    </div>
    <p class="review-status" id="libStatus" role="status">${escapeHtml(libraryStatus)}</p>
    ${state.library.length ? `<ul class="lib-list">${items}</ul>` : '<p class="note">No macros yet. Create one, or import a library you exported.</p>'}
    ${elsewhere.length ? `<div class="lib-elsewhere"><h3>Made elsewhere</h3><ul class="lib-list">${elsewhere.map(([slot, users]) => `<li class="lib-item">
        <div class="lib-top"><span class="lib-name">Macro slot ${slot + 1}</span><span class="lib-meta">steps unknown</span></div>
        <p class="lib-status">On ${users.map(userLabel).join(', ')}. Made outside RT75 Studio, for example in qmk.top.</p>
        <div class="lib-buttons"><button class="btn btn-small" type="button" data-lib-recreate="${slot}">Re-create here…</button>${can ? `<button class="btn btn-small" type="button" data-remove-slot="${slot}">Remove from keys</button>` : ''}</div></li>`).join('')}</ul></div>` : ''}
    <p class="note">The keyboard can’t give macro steps back, so this library is the only copy of their names and steps. Export it to keep a backup or move it to another browser.</p>`;

  const byId = b => libById(b.dataset[Object.keys(b.dataset)[0]]);
  el.querySelectorAll('[data-lib-edit]').forEach(b => b.onclick = () => openMacroEditor(byId(b)));
  el.querySelectorAll('[data-lib-write]').forEach(b => b.onclick = () => { const e = byId(b); state.pendingMacroWrites.set(e.slot, e.id); refresh(); });
  el.querySelectorAll('[data-lib-dup]').forEach(b => b.onclick = () => {
    const e = byId(b);
    state.library.push({ id: newId(), name: uniqueName(state.library, e.name), repeat: e.repeat, steps: e.steps.map(s => ({ ...s })) });
    persistLibrary();
    refresh();
  });
  el.querySelectorAll('[data-lib-del]').forEach(b => b.onclick = () => {
    const e = byId(b);
    const users = e.slot !== undefined ? slotUsers(e.slot) : [];
    const msg = users.length
      ? `Delete “${e.name}” from the library? ${users.map(userLabel).join(', ')} will keep running it from the keyboard, but RT75 Studio won’t know its name or steps any more. (Use “Remove from keys” first to take it off them.)`
      : `Delete “${e.name}” from the library?`;
    if (!confirm(msg)) return;
    state.library = state.library.filter(x => x.id !== e.id);
    for (const [slot, id] of state.pendingMacroWrites) if (id === e.id) state.pendingMacroWrites.delete(slot);
    persistLibrary();
    refresh();
  });
  el.querySelectorAll('[data-remove-slot]').forEach(b => b.onclick = () => removeSlotFromKeys(Number(b.dataset.removeSlot)));
  el.querySelectorAll('[data-lib-recreate]').forEach(b => b.onclick = () => openMacroEditor(null, { slot: Number(b.dataset.libRecreate) }));
  $('libNew').onclick = () => openMacroEditor(null);
  $('libExport').onclick = () => {
    const blob = new Blob([exportLibrary(state.library)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rt75-macros-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('libImport').onclick = () => $('libFile').click();
  $('libFile').onchange = async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const macros = parseLibraryFile(await file.text(), validMacroKey);
      for (const m of macros) state.library.push({ id: newId(), name: uniqueName(state.library, m.name), repeat: m.repeat, steps: m.steps });
      persistLibrary();
      libraryStatus = `Imported ${macros.length} macro${macros.length === 1 ? '' : 's'}.`;
    } catch (e) {
      libraryStatus = 'Import failed: ' + e.message;
    }
    refresh();
    setTimeout(() => { libraryStatus = ''; }, 0);
  };
}

const macroNote = macros => (macros.length ? ` ${macros.length} macro${macros.length === 1 ? '' : 's'} written; the keyboard can’t confirm macro steps, so press the key to check.` : '');

// ---------- Macro editor (dialog) ----------
const DEFAULT_STEP_DELAY = 20;
let afterMacroSave = null; // called with the saved entry (used by "New macro…" in the key editor)

// entry: a library macro, or null for a new one. opts.slot: re-create a macro made elsewhere.
function openMacroEditor(entry, opts = {}) {
  afterMacroSave = opts.then ?? null;
  state.macroDraft = entry
    ? { id: entry.id, name: entry.name, repeat: entry.repeat, steps: entry.steps.map(s => ({ ...s })) }
    : { id: null, name: uniqueName(state.library, opts.slot !== undefined ? `Macro slot ${opts.slot + 1}` : 'New macro'), repeat: 1, steps: [], slot: opts.slot };
  renderMacroDialog();
  $('macroDialog').showModal();
  if (!entry) $('mcName').select();
}

function closeMacroEditor() {
  state.recording = null;
  state.macroDraft = null;
  afterMacroSave = null;
  $('macroDialog').close();
}

function macroDialogStatus() {
  const d = state.macroDraft;
  const problem = !d.name.trim() ? 'Give the macro a name.' : macroProblem(d, validMacroKey);
  const held = heldAtEnd(d).map(s => (s.kind === 'key' ? keyName(s.code) : MOUSE_BUTTONS[s.code]));
  $('mcStats').textContent = state.recording
    ? `Recording… ${d.steps.length} steps. Press Esc or Stop to finish.`
    : `${d.steps.length} step${d.steps.length === 1 ? '' : 's'} · ${fmtMs(d.steps.reduce((t, s) => t + s.delay, 0))} · ${macroSize(d)} of ${MACRO_BYTES} bytes`;
  const warn = problem ?? (held.length ? `${held.join(', ')} ${held.length === 1 ? 'is' : 'are'} still held when the macro ends. Add ${held.length === 1 ? 'a release' : 'releases'} unless that’s intended.` : '');
  $('mcWarn').textContent = warn;
  $('mcWarn').classList.toggle('is-error', !!problem);
  $('mcWarn').hidden = !warn;
  $('btnMacroDone').disabled = !!problem || !!state.recording;
}

function renderMacroDialog() {
  const d = state.macroDraft;
  if (!d) return;
  const entry = d.id ? libById(d.id) : null;
  const onKeyboard = entry?.slot !== undefined && slotUsers(entry.slot).length > 0;
  $('macroTitle').textContent = d.id ? 'Edit macro' : 'New macro';
  const rec = !!state.recording;
  const dis = rec ? 'disabled' : '';
  $('macroBody').innerHTML = `
    <label class="mc-name">Name <input type="text" id="mcName" maxlength="40" value="${escapeHtml(d.name)}" ${dis}></label>
    <div class="mc-toolbar">
      <button class="btn btn-small${rec ? ' btn-stop' : ''}" id="mcRecord" type="button">${rec ? '■ Stop' : '● Record'}</button>
      <select id="mcAddKey" aria-label="Add a key press and release" ${dis}>
        <option value="">+ Key…</option>${KEY_CHOICES.map(c => `<option value="${c}">${keyName(c)}</option>`).join('')}
        <optgroup label="Modifiers">${MODIFIERS.map(c => `<option value="${c}">${keyName(c)}</option>`).join('')}</optgroup>
      </select>
      <select id="mcAddMouse" aria-label="Add a mouse button click" ${dis}>
        <option value="">+ Mouse button…</option>${Object.entries(MOUSE_BUTTONS).map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}
      </select>
      <button class="btn btn-small" id="mcClear" type="button" ${rec || !d.steps.length ? 'disabled' : ''}>Clear</button>
    </div>
    <p class="mc-stats muted" id="mcStats" role="status"></p>
    ${d.steps.length ? `<ol class="mc-steps">${d.steps.map((s, i) => `<li>
        <span class="mc-n muted">${i + 1}</span>
        <button type="button" class="mc-dir ${s.down ? 'is-down' : 'is-up'}" data-dir="${i}" title="Switch between press and release" ${dis}>${s.down ? '↓ Press' : '↑ Release'}</button>
        <span class="mc-what">${escapeHtml(s.kind === 'key' ? keyName(s.code) : MOUSE_BUTTONS[s.code] ?? `Code ${s.code}`)}</span>
        <label class="mc-delay"><input type="number" data-delay="${i}" min="1" max="${MAX_DELAY}" step="1" value="${s.delay}" aria-label="Wait after step ${i + 1}, ms" ${dis}> ms</label>
        <span class="mc-tools">
          <button type="button" data-move="${i}:-1" title="Move up" aria-label="Move step ${i + 1} up" ${rec || i === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" data-move="${i}:1" title="Move down" aria-label="Move step ${i + 1} down" ${rec || i === d.steps.length - 1 ? 'disabled' : ''}>▼</button>
          <button type="button" data-del="${i}" title="Delete" aria-label="Delete step ${i + 1}" ${dis}>✕</button>
        </span></li>`).join('')}</ol>`
      : '<p class="mc-empty muted">No steps yet. Press <strong>Record</strong> and type, or add keys and mouse buttons.</p>'}
    <div class="mc-footer">
      <label>Every delay <input type="number" id="mcAllDelay" min="1" max="${MAX_DELAY}" step="1" value="${DEFAULT_STEP_DELAY}"> ms
        <button class="btn btn-small" id="mcApplyDelay" type="button" ${rec || !d.steps.length ? 'disabled' : ''}>Apply</button></label>
      <label>Repeat count <input type="number" id="mcRepeat" min="1" max="${MAX_REPEAT}" step="1" value="${d.repeat}" ${dis}>
        <span class="muted">used in Loop count mode</span></label>
    </div>
    <p class="hint-warn" id="mcWarn" hidden></p>
    <p class="note">The delay is the wait after each step. Recording captures key presses and releases with their timing; the browser can’t capture some keys (such as the Windows key or Alt+Tab), so add those from the list.
      ${onKeyboard ? ' This macro is on the keyboard: saving queues a write, which you review before anything is sent.' : ' Saving keeps it in the library; nothing is written to the keyboard until you put it on a key and review.'}</p>`;
  macroDialogStatus();
  const body = $('macroBody');
  const pushPair = (kind, code) => {
    d.steps.push({ kind, code, down: true, delay: DEFAULT_STEP_DELAY }, { kind, code, down: false, delay: DEFAULT_STEP_DELAY });
    renderMacroDialog();
  };
  $('mcName').oninput = e => { d.name = e.target.value; macroDialogStatus(); };
  $('mcRecord').onclick = () => { state.recording = state.recording ? null : { last: null }; renderMacroDialog(); };
  $('mcAddKey').onchange = e => { if (e.target.value) pushPair('key', Number(e.target.value)); };
  $('mcAddMouse').onchange = e => { if (e.target.value) pushPair('mouse', Number(e.target.value)); };
  $('mcClear').onclick = () => { d.steps = []; renderMacroDialog(); };
  $('mcApplyDelay').onclick = () => {
    const v = Math.round(Number($('mcAllDelay').value));
    if (v >= 1 && v <= MAX_DELAY) { d.steps.forEach(s => (s.delay = v)); renderMacroDialog(); }
  };
  $('mcRepeat').oninput = e => { d.repeat = Math.round(Number(e.target.value)); macroDialogStatus(); };
  body.querySelectorAll('[data-delay]').forEach(inp => inp.oninput = () => { d.steps[Number(inp.dataset.delay)].delay = Math.round(Number(inp.value)); macroDialogStatus(); });
  body.querySelectorAll('[data-dir]').forEach(b => b.onclick = () => { const s = d.steps[Number(b.dataset.dir)]; s.down = !s.down; renderMacroDialog(); });
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { d.steps.splice(Number(b.dataset.del), 1); renderMacroDialog(); });
  body.querySelectorAll('[data-move]').forEach(b => b.onclick = () => {
    const [i, dir] = b.dataset.move.split(':').map(Number);
    [d.steps[i], d.steps[i + dir]] = [d.steps[i + dir], d.steps[i]];
    renderMacroDialog();
    $('macroBody').querySelector(`[data-move="${i + dir}:${dir}"]:not(:disabled)`)?.focus();
  });
  const list = body.querySelector('.mc-steps');
  if (rec && list) list.scrollTop = list.scrollHeight;
}

// While recording, every key press and release becomes a step; the time to the next one becomes
// its delay (1 ms to 65.5 s). Esc stops recording instead of being recorded.
function onRecordKey(e) {
  const r = state.recording, d = state.macroDraft;
  if (!r || !d) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.key === 'Escape') { if (e.type === 'keydown') { state.recording = null; renderMacroDialog(); } return; }
  if (e.repeat) return;
  const hid = CODE_TO_HID[e.code];
  if (hid === undefined || !validMacroKey(hid)) return;
  const now = performance.now();
  if (d.steps.length && r.last !== null) d.steps[d.steps.length - 1].delay = Math.min(MAX_DELAY, Math.max(1, Math.round(now - r.last)));
  d.steps.push({ kind: 'key', code: hid, down: e.type === 'keydown', delay: DEFAULT_STEP_DELAY });
  r.last = now;
  if (macroSize(d) > MACRO_BYTES) { d.steps.pop(); state.recording = null; }
  renderMacroDialog();
}

// Saves the draft into the library (this browser). A macro that keys already run gets a queued
// write, reviewed like any other change.
function saveMacroDraft() {
  const d = state.macroDraft;
  if (!d || !d.name.trim() || macroProblem(d, validMacroKey)) return;
  const steps = d.steps.map(({ kind, code, down, delay }) => ({ kind, code, down, delay }));
  let entry = d.id ? libById(d.id) : null;
  if (entry) Object.assign(entry, { name: d.name.trim(), repeat: d.repeat, steps });
  else {
    entry = { id: newId(), name: d.name.trim(), repeat: d.repeat, steps };
    state.library.push(entry);
    if (d.slot !== undefined) state.pendingMacroWrites.set(d.slot, entry.id); // re-created macro made elsewhere
  }
  if (entry.slot !== undefined && slotUsers(entry.slot).length && isOutdated(entry)) state.pendingMacroWrites.set(entry.slot, entry.id);
  persistLibrary();
  const then = afterMacroSave;
  closeMacroEditor();
  refresh();
  then?.(entry);
}

function renderKeymapPanel() {
  const el = $('inspector');
  const keys = [...state.selected].map(keyBySlot);
  const layer = state.layer, L = LAYERS[layer];
  const canEdit = editable() && !!deviceBytes(layer, keys[0]?.slot);

  if (keys.length !== 1) {
    const editableKeys = keys.filter(k => keyEditBlock(layer, k.slot) === null);
    el.innerHTML = `<h2>${keys.length} keys</h2><p class="sub">${keys.map(k => k.label).join(', ')}</p>
      ${canEdit ? `<h3>${L.label} layer</h3>
        <div class="btn-row">
          <button class="btn btn-small" id="kmMultiDisable" type="button">${L.fn ? 'Remove Fn actions' : 'Disable all'}</button>
          <button class="btn btn-small" id="kmMultiFactory" type="button">Restore factory</button>
        </div>
        <p class="note">Applies to ${editableKeys.length} of ${keys.length} selected keys${editableKeys.length < keys.length ? ' (locked keys are skipped)' : ''}. Select a single key to assign something else.</p>`
        : '<p class="note">Select a single key to see what it sends on each layer.</p>'}`;
    $('kmMultiDisable')?.addEventListener('click', () => { editableKeys.forEach(k => setKeyPending(layer, k.slot, DISABLED)); refresh(); });
    $('kmMultiFactory')?.addEventListener('click', () => { editableKeys.forEach(k => setKeyPending(layer, k.slot, factoryBytes(layer, k.slot))); refresh(); });
    return;
  }

  const key = keys[0];
  const rows = Object.entries(LAYERS).map(([id, l]) => {
    const a = layerAction(id, key.slot);
    const pending = state.pendingKeys.has(`${id}:${key.slot}`);
    return `<button type="button" class="km-row${id === layer ? ' is-current' : ''}${pending ? ' is-pending' : ''}" data-layer-row="${id}">
      <span class="km-layer">${l.label}</span>
      <span class="km-now">${a.kind === 'macro' ? escapeHtml(macroForSlot(a.bytes[2]).entry?.name ?? `Macro slot ${a.bytes[2] + 1}`) + ` · ${MACRO_MODES[a.bytes[1]]?.name ?? ''}` : a.label}${a.changed ? ' <span class="km-badge">changed</span>' : ''}${pending ? ' <span class="km-badge km-badge-pending">unsaved</span>' : ''}</span>
      ${a.note ? `<span class="km-factory muted">${a.note}</span>` : ''}
      ${a.kind === 'unknown' ? `<span class="km-factory muted">A built-in keyboard function qmk.top doesn’t name either (bytes ${a.raw}); left untouched.</span>` : ''}
      <span class="km-factory muted">Factory: ${factoryLabel(id, key.slot)}</span>
    </button>${a.kind === 'macro' ? macroCardHtml(a.bytes) : ''}`;
  }).join('');

  const block = keyEditBlock(layer, key.slot);
  let editor = '';
  if (canEdit && block) editor = `<p class="note">${block}</p>`;
  else if (canEdit) editor = keyEditorHtml(layer, key.slot);

  el.innerHTML = `
    <div class="insp-head"><h2>${key.label}</h2>${revertChipHtml(key.slot)}</div>
    <p class="sub">What this key sends. Base is for profile ${(state.settings.profile ?? 0) + 1}; the Fn layers apply while Fn is held and are shared by all profiles. Click a layer to edit it.</p>
    <div class="km-rows">${rows}</div>
    ${editor}
    ${canEdit ? '' : `<p class="note">${state.settings.source === 'device' ? (state.live ? 'Stop the live test to edit.' : '') : 'Viewing a file. Connect the keyboard to edit.'}</p>`}`;

  el.querySelectorAll('[data-layer-row]').forEach(b => b.onclick = () => { state.layer = b.dataset.layerRow; state.capture = null; refresh(); });
  $('kmRevert')?.addEventListener('click', () => { Object.keys(LAYERS).forEach(l => state.pendingKeys.delete(`${l}:${key.slot}`)); refresh(); });
  if (canEdit && !block) wireKeyEditor(layer, key.slot);
  el.querySelectorAll('[data-edit-macro]').forEach(b => b.onclick = () => openMacroEditor(libById(b.dataset.editMacro)));
}

const factoryBytes = (layer, slot) => LAYERS[layer].defaults.slice(slot * 4, slot * 4 + 4);

// Why a key can't be edited on a layer, or null if it can.
function keyEditBlock(layer, slot) {
  if (LOCKED_SLOTS.has(slot)) return 'The Fn key is locked, so you can’t lose access to the Fn layers.';
  if (decodeAction(deviceBytes(layer, slot) ?? DISABLED).kind === 'unknown') return 'This is a built-in system key, so it’s left untouched (qmk.top locks it too).';
  return null;
}

function revertChipHtml(slot) {
  const has = Object.keys(LAYERS).some(l => state.pendingKeys.has(`${l}:${slot}`));
  return has ? '<button class="revert-chip" id="kmRevert" type="button">Unsaved · Revert</button>' : '';
}

function keyEditorHtml(layer, slot) {
  const L = LAYERS[layer], mac = layer === 'fnMac';
  const cur = layerBytes(layer, slot);
  const a = decodeAction(cur, { mac });
  const isKey = a.kind === 'key' || a.kind === 'combo';
  const { main, mods } = isKey ? splitKey(cur) : { main: undefined, mods: [] };
  const capturing = state.capture?.slot === slot && state.capture.layer === layer;
  const modNames = mac ? { 224: 'Ctrl', 225: 'Shift', 226: 'Opt', 227: 'Cmd' } : { 224: 'Ctrl', 225: 'Shift', 226: 'Alt', 227: 'Win' };
  const groups = [...new Set(FUNCTIONS.map(f => f[0]))];
  const fnValue = a.kind === 'function' ? cur.join(',') : '';
  const overwriting = ['mouse', 'modtap'].includes(decodeAction(deviceBytes(layer, slot), { mac }).kind);
  return `
    <h3>Change ${L.label}</h3>
    ${overwriting ? '<p class="hint-warn">This key currently runs a mouse or mod-tap action set in qmk.top. Replacing it here can’t be undone from RT75 Studio; reassign it in qmk.top if you change your mind.</p>' : ''}
    <div class="km-edit">
      <span class="km-edit-label">Key</span>
      <div class="km-key-row">
        <button class="btn btn-small${capturing ? ' is-capturing' : ''}" id="kmCapture" type="button">${capturing ? 'Press a key… (Esc cancels)' : 'Press a key to assign'}</button>
        <select id="kmKeySelect" aria-label="Choose a key">
          <option value="">${isKey ? keyName(main) : 'Choose a key…'}</option>
          ${KEY_CHOICES.map(c => `<option value="${c}">${keyName(c)}</option>`).join('')}
        </select>
      </div>
      <div class="km-mods" role="group" aria-label="Modifiers">
        ${[224, 225, 226, 227].map(m => `<label class="check"><input type="checkbox" data-mod="${m}" ${mods.includes(m) ? 'checked' : ''} ${!isKey || (mods.length >= 2 && !mods.includes(m)) ? 'disabled' : ''}> ${modNames[m]}</label>`).join('')}
        <span class="muted km-mods-hint">up to 2</span>
      </div>
      ${macroEditorHtml(cur)}
      <span class="km-edit-label">Function</span>
      <select id="kmFnSelect" aria-label="Choose a function">
        <option value="">${a.kind === 'function' ? a.label : 'Choose a function…'}</option>
        ${groups.map(g => `<optgroup label="${g}">${FUNCTIONS.filter(f => f[0] === g).map(f => `<option value="${f[2].join(',')}" ${f[2].join(',') === fnValue ? 'selected' : ''}>${f[1]}${RISKY.has(f[1]) ? ' ⚠' : ''}</option>`).join('')}</optgroup>`).join('')}
      </select>
      <div class="btn-row km-actions">
        <button class="btn btn-small" id="kmDisable" type="button">${L.fn ? 'No Fn action' : 'Disable key'}</button>
        <button class="btn btn-small" id="kmFactory" type="button" ${cur.join() === factoryBytes(layer, slot).join() ? 'disabled' : ''}>Restore factory</button>
      </div>
    </div>`;
}

function wireKeyEditor(layer, slot) {
  const set = bytes => {
    if (!isWritableAction(bytes, layer, slot)) { showError('That assignment isn’t supported.'); return; }
    showError(null);
    setKeyPending(layer, slot, bytes);
    state.capture = null;
    refresh();
  };
  const cur = () => layerBytes(layer, slot);
  $('kmCapture').onclick = () => { state.capture = state.capture ? null : { layer, slot }; refresh(); };
  $('kmKeySelect').onchange = e => { if (e.target.value) set(encodeKey(Number(e.target.value), currentMods())); };
  document.querySelectorAll('[data-mod]').forEach(cb => cb.onchange = () => {
    const { main } = splitKey(cur());
    if (main !== undefined) set(encodeKey(main, currentMods()));
  });
  $('kmFnSelect').onchange = e => {
    if (!e.target.value) return;
    const f = FUNCTIONS.find(x => x[2].join(',') === e.target.value);
    if (RISKY.has(f[1]) && !confirm(`"${f[1]}" can be disruptive if pressed by accident. Assign it anyway?`)) { refresh(); return; }
    set(f[2]);
  };
  $('kmMacroSelect').onchange = e => {
    const v = e.target.value, mode = cur()[0] === 9 ? cur()[1] : 0;
    if (v === 'new') { openMacroEditor(null, { then: entry => assignLibraryMacro(layer, slot, entry, mode) }); return; }
    if (v.startsWith('lib:')) { assignLibraryMacro(layer, slot, libById(v.slice(4)), mode); return; }
    if (v.startsWith('slot:')) set([9, mode, Number(v.slice(5)), 0]);
  };
  $('kmMacroMode')?.addEventListener('change', e => set([9, Number(e.target.value), cur()[2], 0]));
  $('kmDisable').onclick = () => set(DISABLED);
  $('kmFactory').onclick = () => set(factoryBytes(layer, slot));
}

const currentMods = () => [...document.querySelectorAll('[data-mod]:checked')].map(cb => Number(cb.dataset.mod));

// "Press a key" capture. A non-modifier key is assigned with any held modifiers; a modifier
// pressed and released on its own is assigned by itself.
let captureMod = null;
function onCaptureKey(e) {
  const c = state.capture;
  if (!c) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === 'keydown' && e.key === 'Escape') { state.capture = null; captureMod = null; refresh(); return; }
  const hid = CODE_TO_HID[e.code];
  if (hid === undefined) return;
  if (MODIFIERS.includes(hid)) {
    if (e.type === 'keydown') captureMod = hid;
    else if (captureMod === hid) { captureMod = null; finishCapture(c, hid, []); }
    return;
  }
  if (e.type !== 'keydown') return;
  captureMod = null;
  const mods = [e.ctrlKey && 224, e.shiftKey && 225, e.altKey && 226, e.metaKey && 227].filter(Boolean);
  finishCapture(c, hid, mods);
}

function finishCapture(c, main, mods) {
  const bytes = encodeKey(main, mods);
  if (!isWritableAction(bytes, c.layer, c.slot)) { showError(`${keyName(main)} can’t be assigned.`); return; }
  setKeyPending(c.layer, c.slot, bytes);
  state.capture = null;
  refresh();
}

// ---------- Live test ----------
const TRACE_MS = 3000;

function liveUnavailableReason() {
  const s = state.settings;
  if (!s || s.source !== 'device' || !state.dev) return 'Connect the keyboard to use the live test.';
  if (s.viaDongle) return 'The live test needs the USB cable.';
  if (state.busy) return 'Busy writing…';
  return null;
}

async function startLive() {
  if (liveUnavailableReason() || state.live) return;
  showError(null);
  const live = { stop: null, depth: 0, peak: 0, trace: [], focus: null, down: new Set(), raf: 0 };
  // Until a key is pressed, measure against the selected key (if exactly one).
  if (state.selected.size === 1) live.focus = [...state.selected][0];
  try {
    live.stop = await startLiveTravel(state.dev, state.settings, depth => {
      live.depth = depth;
      if (depth > live.peak) live.peak = depth;
      live.trace.push([performance.now(), depth]);
    }, state.dev.demoInput ?? null);
  } catch (e) {
    showError('Could not start the live test: ' + e.message);
    return;
  }
  state.live = live;
  refresh();
  const frame = () => { if (state.live !== live) return; drawLive(); live.raf = requestAnimationFrame(frame); };
  live.raf = requestAnimationFrame(frame);
}

async function stopLive() {
  const live = state.live;
  if (!live) return;
  state.live = null;
  cancelAnimationFrame(live.raf);
  try { await live.stop(); } catch (e) { showError('Stopping the live test failed: ' + e.message + ' Unplugging the keyboard resets it.'); }
  refresh();
}

// Saved (keyboard) values, not unsaved edits: the live test shows what the keyboard does now.
function liveThresholds(slot) {
  const m = state.settings.magnet, step = state.settings.travelStep;
  return {
    actuation: m.actuation[slot] / step, release: m.release[slot] / step,
    rt: (m.mode[slot] & 0x80) !== 0, rtPress: m.rtPress[slot] / step, rtRelease: m.rtRelease[slot] / step,
    topDeadZone: (m.topDeadZone?.[slot] ?? 0) / step, bottomDeadZone: m.bottomDeadZone[slot] / step,
  };
}

const GAUGE = { H: 230, top: 24, x: 64, w: 36 };
const gy = v => GAUGE.top + (Math.min(Math.max(v, 0), MAX_TRAVEL_MM) / MAX_TRAVEL_MM) * GAUGE.H;

// Scale: labelled steps every 0.5 mm, small ticks every 0.1 mm, and the deepest setting.
function gaugeScale() {
  const parts = [];
  for (let i = 0; i <= Math.round(MAX_TRAVEL_MM * 10); i++) {
    const v = i / 10, major = i % 5 === 0;
    parts.push(`<line class="${major ? 'tick-major' : 'tick-minor'}" x1="${GAUGE.x - (major ? 9 : 5)}" x2="${GAUGE.x - 2}" y1="${gy(v)}" y2="${gy(v)}"/>`);
    if (major) parts.push(`<text class="tick" x="${GAUGE.x - 12}" y="${gy(v) + 3.5}" text-anchor="end">${v.toFixed(1)}</text>`);
  }
  const y = gy(MAX_TRAVEL_MM);
  parts.push(`<line class="tick-major" x1="${GAUGE.x - 9}" x2="${GAUGE.x - 2}" y1="${y}" y2="${y}"/>`,
    `<text class="tick" x="${GAUGE.x - 12}" y="${y + 3.5}" text-anchor="end">${MAX_TRAVEL_MM}</text>`,
    `<text class="tick" x="${GAUGE.x - 12}" y="${y + 16}" text-anchor="end">max</text>`,
    `<text class="tick tick-unit" x="${GAUGE.x - 12}" y="${GAUGE.top - 11}" text-anchor="end">mm</text>`);
  return parts.join('');
}

function renderLivePanel() {
  const el = $('inspector');
  const live = state.live;
  const key = live?.focus !== null && live?.focus !== undefined ? keyBySlot(live.focus) : (state.selected.size === 1 ? keyBySlot([...state.selected][0]) : null);
  const t = key ? liveThresholds(key.slot) : null;
  const { x, w } = GAUGE, right = x + w;
  // Dead zones are drawn inside the clipped track; trigger lines cross it.
  const zones = t ? `
    ${t.topDeadZone > 0 ? `<rect class="dz" x="${x}" y="${gy(0)}" width="${w}" height="${gy(t.topDeadZone) - gy(0)}"/>` : ''}
    ${t.bottomDeadZone > 0 ? `<rect class="dz" x="${x}" y="${gy(MAX_TRAVEL_MM - t.bottomDeadZone)}" width="${w}" height="${gy(MAX_TRAVEL_MM) - gy(MAX_TRAVEL_MM - t.bottomDeadZone)}"/>` : ''}` : '';
  const marks = t ? `
    <line class="mk mk-act" x1="${x - 4}" x2="${right + 8}" y1="${gy(t.actuation)}" y2="${gy(t.actuation)}"/>
    <text class="lbl" x="${right + 12}" y="${gy(t.actuation) + 4}">Actuation ${mm(t.actuation)}</text>
    ${Math.abs(t.release - t.actuation) >= 0.005 ? `<line class="mk mk-rel" x1="${x - 4}" x2="${right + 8}" y1="${gy(t.release)}" y2="${gy(t.release)}"/>
    <text class="lbl" x="${right + 12}" y="${gy(t.release) + 4}">Release ${mm(t.release)}</text>` : ''}` : '';

  el.innerHTML = `
    <div class="insp-head"><h2>${key ? key.label : 'Live test'}</h2>${live ? '<span class="live-pill"><span class="live-dot"></span>Live</span>' : ''}</div>
    <p class="sub">${live ? (key ? 'Depth reported by the keyboard while you press keys.' : 'Press a key.') : 'Start the live test, then press a key. Select a key first to see its trigger points straight away.'}</p>
    <div class="live-gauge">
      <svg viewBox="0 0 250 ${GAUGE.H + 46}" role="img" aria-label="Key depth gauge">
        <defs>
          <clipPath id="gaugeClip"><rect x="${x}" y="${gy(0)}" width="${w}" height="${GAUGE.H}" rx="6"/></clipPath>
          <linearGradient id="liveFillGrad" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${gy(0)}" y2="${gy(0) + 1}">
            <stop offset="0" class="fill-stop" stop-opacity="0.06"/>
            <stop offset="0.7" class="fill-stop" stop-opacity="0.32"/>
            <stop offset="1" class="fill-stop" stop-opacity="0.9"/>
          </linearGradient>
          <linearGradient id="gaugeGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style="stop-color: var(--accent); stop-opacity: 1"/>
            <stop offset="1" style="stop-color: var(--accent); stop-opacity: 0"/>
          </linearGradient>
        </defs>
        <rect class="track" x="${x}" y="${gy(0)}" width="${w}" height="${GAUGE.H}" rx="6"/>
        <g clip-path="url(#gaugeClip)">
          ${zones}
          <rect class="depth-fill" id="liveFill" x="${x}" y="${gy(0)}" width="${w}" height="0" fill="url(#liveFillGrad)"/>
          <rect class="depth-glow" id="liveGlow" x="${x}" y="${gy(0)}" width="${w}" height="22" fill="url(#gaugeGlow)" opacity="0"/>
          <rect class="depth-edge" id="liveEdge" x="${x}" y="${gy(0)}" width="${w}" height="2" opacity="0"/>
        </g>
        ${gaugeScale()}
        ${marks}
        <line class="peak" id="livePeak" x1="${x - 4}" x2="${right + 4}" y1="${gy(0)}" y2="${gy(0)}"/>
      </svg>
    </div>
    <dl>
      ${row('Depth', '<span id="liveDepth">0.00</span> mm')}
      ${row('Peak', '<span id="livePeakVal">0.00</span> mm <button class="link small" id="btnPeakReset" type="button">reset</button>')}
      ${row('Key down (as your computer sees it)', '<span id="liveDown">No</span>')}
      ${t ? row('Rapid Trigger', t.rt ? `On · ${mm(t.rtPress)} / ${mm(t.rtRelease)} mm` : 'Off') : ''}
    </dl>
    <h3>Last 3 seconds</h3>
    <canvas class="live-trace" id="liveTrace" width="560" height="200" aria-label="Depth over the last 3 seconds"></canvas>
    <p class="note">${hasAnyPending() ? 'Showing the keyboard’s saved values; unsaved edits aren’t on the keyboard yet. ' : ''}The keyboard reports one depth at a time, for whichever key is moving; the key name comes from your browser’s key events, so Fn and keys pressed only part-way don’t change it.</p>`;
  $('btnPeakReset').onclick = () => { if (state.live) state.live.peak = 0; };
  drawLive();
}

function hasAnyPending() { return pendingEdits().length > 0 || kbChanges().length > 0 || keymapChanges().length > 0 || !!lightChange() || macroWrites().length > 0; }

// Keyboard-wide edits that differ from the keyboard: [{ field, label, from, to }].
function kbChanges() {
  const s = state.settings, k = state.pendingKb;
  if (!s) return [];
  return Object.entries(KB_FIELDS)
    .filter(([field, def]) => k[field] !== undefined && k[field] !== def.current(s))
    .map(([field, def]) => ({ field, label: def.label, from: def.current(s), to: k[field] }));
}
const fmtHz = hz => (hz === undefined ? '?' : hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);
// Sleep timers are stored in seconds; 0 means never.
function fmtSecs(sec) {
  if (sec === undefined) return '?';
  if (sec === 0) return 'Never';
  if (sec < 60) return `${sec} s`;
  const min = sec / 60;
  if (min < 60) return `${+min.toFixed(2)} min`;
  const h = Math.floor(min / 60), rest = +(min - h * 60).toFixed(2);
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
const KB_FIELDS = {
  reportRateHz: { label: 'Polling rate', fmt: fmtHz, current: s => s.reportRateHz },
  time_bt: { label: 'Bluetooth backlight off', fmt: fmtSecs, current: s => s.sleep?.time_bt, sleep: true },
  deepTime_bt: { label: 'Bluetooth deep sleep', fmt: fmtSecs, current: s => s.sleep?.deepTime_bt, sleep: true },
  time_24: { label: '2.4G backlight off', fmt: fmtSecs, current: s => s.sleep?.time_24, sleep: true },
};
const kbRows = changes => changes.map(c => `<tr><td>Keyboard</td><td>${c.label}</td><td>${KB_FIELDS[c.field].fmt(c.from)}</td><td><strong>${KB_FIELDS[c.field].fmt(c.to)}</strong></td></tr>`).join('');

function drawLive() {
  const live = state.live;
  const depth = live?.depth ?? 0, peak = live?.peak ?? 0;
  const fill = $('liveFill');
  if (!fill) return;
  const depthY = gy(depth), touching = depth > 0.004;
  // The fill's gradient runs from the top to the leading edge, so it is brightest where the key
  // is now. It is muted above the focus key's actuation point and turns full accent once past it.
  // The top glow only marks a light touch and fades out over the first 0.6 mm.
  fill.setAttribute('height', String(Math.max(0, depthY - gy(0))));
  $('liveFillGrad').setAttribute('y2', String(Math.max(depthY, gy(0) + 1)));
  const focus = live?.focus ?? (state.selected.size === 1 ? [...state.selected][0] : null);
  const actuated = focus !== null && focus !== undefined && depth >= liveThresholds(focus).actuation;
  fill.closest('svg').classList.toggle('is-actuated', actuated);
  const edge = $('liveEdge');
  edge.setAttribute('y', String(Math.max(gy(0), depthY - 1)));
  edge.setAttribute('opacity', touching ? '1' : '0');
  $('liveGlow').setAttribute('opacity', touching ? String(Math.max(0, 0.85 * (1 - depth / 0.6))) : '0');
  const pk = $('livePeak');
  pk.setAttribute('y1', String(gy(peak)));
  pk.setAttribute('y2', String(gy(peak)));
  pk.style.opacity = peak > 0 ? '1' : '0';
  $('liveDepth').textContent = mm(depth);
  $('livePeakVal').textContent = mm(peak);
  $('liveDown').textContent = live && live.focus !== null && live.down.has(live.focus) ? 'Yes' : 'No';

  // Trace: depth (down = deeper) over the last TRACE_MS, with the focus key's trigger points.
  const c = $('liveTrace');
  const g = c.getContext('2d');
  const W = c.width, H = c.height, now = performance.now();
  const css = getComputedStyle(document.documentElement);
  g.clearRect(0, 0, W, H);
  const y = v => 8 + (Math.min(v, MAX_TRAVEL_MM) / MAX_TRAVEL_MM) * (H - 16);
  if (focus !== null && focus !== undefined) {
    const t = liveThresholds(focus);
    g.setLineDash([6, 6]);
    g.lineWidth = 2;
    g.strokeStyle = css.getPropertyValue('--accent');
    g.beginPath(); g.moveTo(0, y(t.actuation)); g.lineTo(W, y(t.actuation)); g.stroke();
    if (Math.abs(t.release - t.actuation) >= 0.005) {
      g.strokeStyle = css.getPropertyValue('--snap');
      g.beginPath(); g.moveTo(0, y(t.release)); g.lineTo(W, y(t.release)); g.stroke();
    }
    g.setLineDash([]);
  }
  if (live) {
    while (live.trace.length && now - live.trace[0][0] > TRACE_MS) live.trace.shift();
    g.strokeStyle = css.getPropertyValue('--text');
    g.lineWidth = 3;
    g.beginPath();
    live.trace.forEach(([ts, v], i) => {
      const x = W - ((now - ts) / TRACE_MS) * W;
      if (i === 0) g.moveTo(x, y(v)); else g.lineTo(x, y(v));
    });
    g.stroke();
  }
}

function onLiveKey(e) {
  const live = state.live;
  if (!live || e.key === 'Escape') return;
  const key = KEYS.find(k => k.code === e.code && !k.knob);
  e.preventDefault(); // keep Space, arrows, Tab etc. from scrolling or moving focus during the test
  if (!key) return;
  if (e.type === 'keydown') {
    live.down.add(key.slot);
    if (live.focus !== key.slot) { live.focus = key.slot; live.peak = 0; renderLivePanel(); }
  } else {
    live.down.delete(key.slot);
  }
  document.querySelectorAll('.key.live-key').forEach(k => {
    const s = Number(k.dataset.slot);
    k.classList.toggle('live-focus', s === live.focus);
    k.classList.toggle('live-down', live.down.has(s));
  });
}

// ---------- Presets ----------
// Stored per keyboard in this browser's localStorage, falling back to memory if storage is blocked.
const PRESET_FIELDS = ['mode', 'actuation', 'release', 'bottomDeadZone', 'rtPress', 'rtRelease', 'topDeadZone', 'snapPartner'];
const PRESET_FORMAT = 'rt75-studio-preset';
let memoryPresets = [];

const presetKey = () => `rt75-studio-presets-${state.settings?.demo ? 'demo-' : ''}${state.settings?.deviceId ?? 'none'}`;
function loadPresets() {
  try { return JSON.parse(localStorage.getItem(presetKey()) ?? '[]'); } catch { return memoryPresets; }
}
function storePresets(list) {
  memoryPresets = list;
  try { localStorage.setItem(presetKey(), JSON.stringify(list)); return true; } catch { return false; }
}

// The current setup as the keyboard would have it after writing the pending edits.
function snapshotPreset(name) {
  const m = state.settings.magnet;
  const magnet = {};
  for (const f of PRESET_FIELDS) {
    magnet[f] = [...m[f]];
    for (const k of MAGNETIC) magnet[f][k.slot] = raw(k.slot, f);
  }
  return { format: PRESET_FORMAT, version: 1, deviceId: state.settings.deviceId, name, savedAt: new Date().toISOString(), magnet };
}

function presetSummary(p) {
  const step = state.settings.travelStep, m = p.magnet;
  const acts = [...new Set(MAGNETIC.map(k => mm(m.actuation[k.slot] / step)))].sort();
  const rt = MAGNETIC.filter(k => m.mode[k.slot] & 0x80).length;
  const snap = MAGNETIC.filter(k => (m.mode[k.slot] & 0x7f) === SNAP).length / 2;
  return `${acts.join(' · ')} mm · ${rt} RT key${rt === 1 ? '' : 's'} · ${snap} Snap pair${snap === 1 ? '' : 's'}`;
}

function renderPresets(statusText = '') {
  const list = loadPresets();
  $('presetList').innerHTML = list.length
    ? list.map((p, i) => `<li><div><strong>${escapeHtml(p.name)}</strong><span class="muted">${new Date(p.savedAt).toLocaleString()} · ${presetSummary(p)}</span></div>
        <div class="btn-row"><button class="btn btn-small btn-primary" data-apply="${i}" type="button" ${editable() ? '' : 'disabled title="Connect the keyboard to apply presets"'}>Apply</button>
        <button class="btn btn-small" data-export="${i}" type="button">Export</button>
        <button class="btn btn-small" data-delete="${i}" type="button">Delete</button></div></li>`).join('')
    : '<li class="muted">No presets yet. Save your current setup to create one.</li>';
  $('presetStatus').textContent = statusText;
  $('presetList').querySelectorAll('[data-apply]').forEach(b => b.onclick = () => applyPreset(list[Number(b.dataset.apply)]));
  $('presetList').querySelectorAll('[data-export]').forEach(b => b.onclick = () => exportPreset(list[Number(b.dataset.export)]));
  $('presetList').querySelectorAll('[data-delete]').forEach(b => b.onclick = () => {
    if (!confirm(`Delete the preset "${list[Number(b.dataset.delete)].name}"?`)) return;
    storePresets(list.filter((_, i) => i !== Number(b.dataset.delete)));
    renderPresets('Deleted.');
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function savePreset(name) {
  const list = loadPresets();
  const existing = list.findIndex(p => p.name === name);
  if (existing >= 0 && !confirm(`Replace the preset "${name}"?`)) return;
  const preset = snapshotPreset(name);
  if (existing >= 0) list[existing] = preset; else list.push(preset);
  const persisted = storePresets(list);
  renderPresets(persisted ? `Saved "${name}".` : `Saved "${name}" for this session only (browser storage is blocked). Use Export to keep it.`);
}

// Loads a preset as pending edits. Values this app can't write safely are skipped.
function applyPreset(p) {
  if (!editable()) return;
  const b = bounds();
  const ok = {
    actuation: v => v >= b.travelMin && v <= b.travelMax, release: v => v >= b.travelMin && v <= b.travelMax,
    rtPress: v => v >= b.rtMin && v <= b.rtMax, rtRelease: v => v >= b.rtMin && v <= b.rtMax,
    bottomDeadZone: v => v >= b.dzMin && v <= b.dzMax, topDeadZone: v => v >= b.dzMin && v <= b.dzMax,
    snapPartner: (v, slot) => v !== slot && MAGNETIC.some(k => k.slot === v),
  };
  let skipped = 0;
  for (const k of MAGNETIC) {
    const s = k.slot;
    const curMode = state.settings.magnet.mode[s] & 0x7f, newMode = p.magnet.mode?.[s];
    const modeOk = newMode !== undefined && [0, SNAP].includes(curMode) && [0, SNAP].includes(newMode & 0x7f);
    for (const f of PRESET_FIELDS) {
      const v = p.magnet[f]?.[s];
      if (v === undefined) continue;
      if (f === 'mode' || f === 'snapPartner' ? !modeOk : false) { if (v !== state.settings.magnet[f][s]) skipped++; continue; }
      if (f !== 'mode' && !ok[f](v, s)) { if (v !== state.settings.magnet[f][s]) skipped++; continue; }
      setPending(s, f, v);
    }
  }
  $('presetDialog').close();
  refresh();
  const n = pendingEdits().reduce((a, e) => a + Object.keys(e).length - 1, 0);
  showError(null);
  if (skipped) showError(`Loaded "${p.name}". ${skipped} value(s) were skipped (DKS, mod-tap or toggle keys, or values outside the safe ranges).`);
  $('pendingText').textContent = n ? `"${p.name}" loaded: ${n} change${n === 1 ? '' : 's'} on ${pendingEdits().length} key${pendingEdits().length === 1 ? '' : 's'} to review` : `"${p.name}" matches the keyboard already`;
  $('pendingBar').hidden = false;
  if (!n) setTimeout(renderPendingBar, 2500);
}

function exportPreset(p) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rt75-preset-${p.name.replace(/[^\w-]+/g, '_')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importPreset(file) {
  try {
    const p = JSON.parse(await file.text());
    if (p.format !== PRESET_FORMAT || !p.magnet || !PRESET_FIELDS.every(f => Array.isArray(p.magnet[f]) && p.magnet[f].length === 128)) throw new Error('not an RT75 Studio preset');
    if (p.deviceId !== state.settings.deviceId) throw new Error(`it was made for device ${p.deviceId}, not ${state.settings.deviceId}`);
    const list = loadPresets();
    let name = String(p.name || 'Imported').slice(0, 40);
    for (let i = 2; list.some(x => x.name === name); i++) name = `${String(p.name).slice(0, 34)} (${i})`;
    list.push({ ...p, name });
    storePresets(list);
    renderPresets(`Imported "${name}".`);
  } catch (e) {
    renderPresets('Import failed: ' + e.message);
  }
}

function openPresets() {
  if (!state.settings) return;
  $('presetName').value = '';
  renderPresets();
  $('presetDialog').showModal();
}

// ---------- Review and write ----------
// Edits that do nothing are dropped, as qmk.top never sends them: RT sensitivity on keys that
// end up with RT off, and Snap partners on keys that end up without Snap Tap.
function sendable(e, modeOf) {
  const mode = modeOf(e.slot);
  if (!(mode & 0x80)) { delete e.rtPress; delete e.rtRelease; }
  if ((mode & 0x7f) !== SNAP) delete e.snapPartner;
  return e;
}

function pendingEdits() {
  return [...state.pending]
    .map(([slot, fields]) => sendable({ slot, ...fields }, s => raw(s, 'mode')))
    .filter(e => Object.keys(e).length > 1);
}

const hasPending = slot => pendingEdits().some(e => e.slot === slot);

function fmt(field, value) {
  if (field === 'mode') return `${MODES[value & 0x7f] ?? 'Mode ' + (value & 0x7f)}${value & 0x80 ? ' + RT' : ''}`;
  if (field === 'snapPartner') return keyBySlot(value)?.label ?? '—';
  return `${mm3(value / state.settings.travelStep)} mm`;
}

function changeRows(edits, before) {
  const order = Object.keys(FIELD_LABELS);
  return edits.flatMap(e => Object.keys(e).filter(f => f !== 'slot').sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(f =>
    `<tr><td>${keyBySlot(e.slot).label}</td><td>${FIELD_LABELS[f]}</td><td>${fmt(f, before(e.slot, f))}</td><td><strong>${fmt(f, e[f])}</strong></td></tr>`)).join('');
}

function openReview() {
  if (!editable() || !hasAnyPending()) return;
  const edits = pendingEdits();
  $('reviewBody').innerHTML = `
    <p>These settings will be written to the keyboard (profile ${(state.settings.profile ?? 0) + 1}). Nothing else changes.</p>
    <div class="table-wrap"><table class="changes"><thead><tr><th>Key</th><th>Setting</th><th>Now</th><th>New</th></tr></thead>
    <tbody>${changeRows(edits, (slot, f) => state.settings.magnet[f][slot])}${kbRows(kbChanges())}${kmRows(keymapChanges())}${macroWriteRows(macroWrites())}${lightRows(lightChange())}</tbody></table></div>
    ${macroWrites().length ? '<p class="hint-warn">This keyboard can’t give macro steps back, so they can’t be confirmed after writing. Press the key afterwards to check it.</p>' : ''}
    <label class="check"><input type="checkbox" id="chkBackup" checked> Download a backup of the current settings first</label>`;
  $('reviewStatus').textContent = '';
  $('reviewStatus').className = 'review-status';
  $('btnApply').hidden = false;
  $('btnApply').disabled = false;
  $('btnUndo').hidden = true;
  $('btnCancel').textContent = 'Cancel';
  $('reviewDialog').showModal();
}

async function applyEdits(edits, { backup, kb = kbChanges(), keys = keymapChanges(), light = lightChange(), macros = macroWrites() }) {
  // What each macro slot held before (when RT75 Studio wrote it), for Undo.
  for (const w of macros) w.before ??= w.entry.slot === w.slot && w.entry.written ? w.entry.written : null;
  const before = new Map(edits.map(e => [e.slot, Object.fromEntries(Object.keys(e).filter(f => f !== 'slot').map(f => [f, state.settings.magnet[f][e.slot]]))]));
  if (backup) downloadBackup();
  state.busy = true;
  refresh();
  $('btnApply').disabled = true;
  $('btnCancel').disabled = true;
  const status = $('reviewStatus');
  status.className = 'review-status';
  status.textContent = 'Writing…';
  try {
    const result = edits.length
      ? await writeKeySettings(state.dev, state.settings, edits, (f, label) => { status.textContent = `${label}… ${Math.round(f * 100)}%`; })
      : { magnet: {}, mismatches: [], retried: 0 };
    Object.assign(state.settings.magnet, result.magnet);       // trust what the keyboard reports
    for (const e of edits) state.pending.delete(e.slot);
    const rate = kb.find(c => c.field === 'reportRateHz');
    if (rate) {
      status.textContent = 'Writing polling rate…';
      const got = await writeReportRate(state.dev, state.settings, rate.to);
      state.settings.reportRateHz = got;
      delete state.pendingKb.reportRateHz;
      if (got !== rate.to) result.mismatches.push({ kb: true, label: rate.label, expected: fmtHz(rate.to), actual: fmtHz(got) });
    }
    const sleeps = kb.filter(c => KB_FIELDS[c.field].sleep);
    if (sleeps.length) {
      status.textContent = 'Writing sleep timers…';
      const got = await writeSleepTimes(state.dev, state.settings, Object.fromEntries(sleeps.map(c => [c.field, c.to])));
      if (got) state.settings.sleep = got;
      for (const c of sleeps) {
        delete state.pendingKb[c.field];
        if (got?.[c.field] !== c.to) result.mismatches.push({ kb: true, label: c.label, expected: fmtSecs(c.to), actual: fmtSecs(got?.[c.field]) });
      }
    }
    if (keys.length) {
      const km = await writeKeymap(state.dev, state.settings, keys.map(c => ({ layer: c.layer, slot: c.slot, action: c.to })),
        (f, label) => { status.textContent = `${label}… ${Math.round(f * 100)}%`; });
      for (const [layer, arr] of Object.entries(km.layers)) state.settings[LAYERS[layer].field] = arr; // trust the read-back
      for (const c of keys) state.pendingKeys.delete(`${c.layer}:${c.slot}`);
      result.retried += km.retried;
      for (const m of km.mismatches) result.mismatches.push({ kb: true, label: `${keyBySlot(m.slot).label} (${LAYERS[m.layer].label})`, expected: actionLabel(m.layer, m.expected), actual: actionLabel(m.layer, m.actual) });
    }
    // Macros go after the key map, as in qmk.top (setKeyConfigSimple, then setMacro). Their steps
    // can't be read back from this keyboard, so they're reported as written, not confirmed.
    if (macros.length) {
      await writeMacros(state.dev, state.settings, macros.map(w => ({ slot: w.slot, macro: w.macro })),
        (f, label) => { status.textContent = `${label}… ${Math.round(f * 100)}%`; });
      for (const w of macros) {
        const lib = libById(w.entry.id);
        if (lib) Object.assign(lib, { slot: w.slot, written: { repeat: w.macro.repeat, steps: w.macro.steps.map(x => ({ ...x })) } });
        state.pendingMacroWrites.delete(w.slot);
      }
      persistLibrary();
    }
    if (light) {
      status.textContent = 'Writing lighting…';
      const lr = await writeLighting(state.dev, state.settings, light.to);
      if (lr.lighting) state.settings.lighting = lr.lighting; // trust the read-back
      state.pendingLight = null;
      result.retried += lr.retried;
      for (const f of lr.mismatches) result.mismatches.push({ kb: true, label: `Lighting ${LIGHT_LABELS[f].toLowerCase()}`, expected: fmtLight(f, light.to), actual: lr.lighting ? fmtLight(f, lr.lighting) : 'no reply' });
    }
    if (result.mismatches.length) {
      status.className = 'review-status is-error';
      status.textContent = macroNote(macros).trim() + (macros.length ? ' ' : '') + `Written and retried once, but ${result.mismatches.length} value(s) still read back differently: ` +
        result.mismatches.map(m => m.kb ? `${m.label} expected ${m.expected}, got ${m.actual}`
          : `${keyBySlot(m.slot).label} ${FIELD_LABELS[m.field]} expected ${fmt(m.field, m.expected)}, got ${fmt(m.field, m.actual)}`).join('; ');
    } else {
      const n = edits.reduce((a, e) => a + Object.keys(e).length - 1, 0) + kb.length + keys.length + (light?.fields.length ?? 0);
      status.className = 'review-status is-ok';
      status.textContent = (n ? `Done. ${n === 1 ? 'The setting was' : `All ${n} settings were`} written and confirmed by reading ${n === 1 ? 'it' : 'them'} back.` : 'Done.') +
        (result.retried ? ` (${result.retried} needed a second try.)` : '') + macroNote(macros);
    }
    state.lastApplied = { undo: [...before].map(([slot, fields]) => ({ slot, ...fields })), undoKb: kb.map(c => ({ ...c, from: c.to, to: c.from })), undoKeys: keys.map(c => ({ ...c, from: c.to, to: c.from })),
      // A macro slot is restored only if RT75 Studio knows what it held before.
      undoMacros: macros.filter(w => w.before).map(w => ({ slot: w.slot, entry: w.entry, macro: w.before, before: w.macro })),
      undoLight: light && isOffered(effectById(light.from.effect)) ? { from: light.to, to: normalizeLighting(light.from), fields: light.fields } : null };
    $('btnApply').hidden = true;
    $('btnUndo').hidden = false;
    $('btnCancel').textContent = 'Close';
  } catch (e) {
    status.className = 'review-status is-error';
    status.textContent = 'Write failed: ' + e.message + ' Your pending changes are kept. Refresh to see what the keyboard has now.';
    $('btnApply').disabled = false;
  } finally {
    state.busy = false;
    $('btnCancel').disabled = false;
    refresh();
  }
}

async function undoLast() {
  if (!state.lastApplied) return;
  // A sensitivity of 0 means "never set" and can't be written; turning RT back off restores
  // those keys, so drop the zero values.
  const undo = state.lastApplied.undo
    .map(e => Object.fromEntries(Object.entries(e).filter(([f, v]) => !((f === 'rtPress' || f === 'rtRelease') && v === 0))))
    .map(e => sendable(e, s => e.mode ?? state.settings.magnet.mode[s]))
    .filter(e => Object.keys(e).length > 1);
  const undoKb = state.lastApplied.undoKb ?? [];
  const allUndoKeys = state.lastApplied.undoKeys ?? [];
  const undoKeys = allUndoKeys.filter(c => isWritableAction(c.to, c.layer, c.slot));
  const skippedKeys = allUndoKeys.length - undoKeys.length;
  const undoLight = state.lastApplied.undoLight ?? null;
  const undoMacros = state.lastApplied.undoMacros ?? [];
  state.lastApplied = null;
  $('btnUndo').hidden = true;
  $('reviewBody').innerHTML = `<p>Restoring the previous values:</p>
    <div class="table-wrap"><table class="changes"><thead><tr><th>Key</th><th>Setting</th><th>Now</th><th>Restored</th></tr></thead>
    <tbody>${changeRows(undo, (slot, f) => state.settings.magnet[f][slot])}${kbRows(undoKb)}${kmRows(undoKeys)}${macroWriteRows(undoMacros)}${lightRows(undoLight)}</tbody></table></div>${skippedKeys ? `<p class="hint-warn">${skippedKeys} key(s) had a macro, mouse or mod-tap action that RT75 Studio can’t write back; reassign those in qmk.top.</p>` : ''}`;
  await applyEdits(undo, { backup: false, kb: undoKb, keys: undoKeys, light: undoLight, macros: undoMacros });
  $('btnUndo').hidden = true;
}

// Saves current (keyboard) settings in dump.html's format, so "Open dump…" can show it later.
function downloadBackup() {
  const s = state.settings;
  const id = [0x8f, ...new Uint8Array(new Uint32Array([s.deviceId]).buffer), 0, 0, (s.usbVersion ?? 0) & 0xff, (s.usbVersion ?? 0) >> 8];
  const dump = {
    device: { productName: s.productName, viaDongle: s.viaDongle },
    raw: { id: id.map(b => b.toString(16).padStart(2, '0')).join(' ') },
    deviceId: s.deviceId, rfVersion: s.rfVersion, battery: s.battery,
    featureListSupported: false, profile: s.profile, reportRateHz: s.reportRateHz, debounce: s.debounce, sleep: s.sleep, lighting: s.lighting,
    keymap: { 0: s.keymap }, fnWin: s.fnWin, fnMac: s.fnMac, magnet: s.magnet, savedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rt75-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Lighting ----------
const LIGHT_LABELS = { effect: 'Effect', brightness: 'Brightness', speed: 'Speed', option: 'Direction', rainbow: 'Colour mode', color: 'Colour' };
const SWATCHES = [[0xff0000, 'Red'], [0xff8000, 'Orange'], [0xffff00, 'Yellow'], [0x00ff00, 'Green'], [0x00ffff, 'Cyan'], [0x0000ff, 'Blue'], [0xff00ff, 'Purple'], [0xffffff, 'White']];
const LED_SECONDS = [6, 4.5, 3.2, 2.2, 1.4]; // preview cycle length for speed 0–4

const currentLight = () => state.pendingLight ?? state.settings?.lighting ?? null;

function lightChange() {
  const from = state.settings?.lighting, to = state.pendingLight;
  if (!from || !to) return null;
  const fields = lightingDiff(from, to);
  return fields.length ? { from, to, fields } : null;
}

const optionHeading = e => (e?.key === 'LightUserPicture' ? 'Pattern' : e?.key === 'LightMusicFollow2' ? 'Style' : 'Direction');

// Plain-text value of one lighting field.
function fmtLight(f, l) {
  const e = effectById(l.effect);
  if (f === 'effect') return e?.name ?? `Effect ${l.effect}`;
  if (f === 'option') return e?.options?.[l.option] ?? String(l.option);
  if (f === 'rainbow') return l.rainbow ? 'Rainbow' : 'Single colour';
  if (f === 'color') return SWATCHES.find(([c]) => c === l.color)?.[1] ?? hex(l.color).toUpperCase();
  if (f === 'brightness' && l.brightness === 0) return 'Off';
  return `${l[f]} of ${MAX_LEVEL}`;
}

function lightRows(c) {
  if (!c) return '';
  const cell = (f, l) => !lightingFields(l).includes(f) ? '<span class="muted">—</span>'
    : (f === 'color' ? `<span class="swatch-dot" style="background:${hex(l.color)}"></span>` : '') + fmtLight(f, l);
  return c.fields.map(f => `<tr><td>Lighting</td><td>${f === 'option' ? optionHeading(effectById(c.to.effect)) : LIGHT_LABELS[f]}</td>
    <td>${cell(f, c.from)}</td><td><strong>${cell(f, c.to)}</strong></td></tr>`).join('');
}

// Brightness, speed and colour carry over between effects; returning to the keyboard's own effect
// brings back its direction and speed, so trying effects and coming back leaves nothing pending.
function setLight(patch, { quiet = false } = {}) {
  const saved = state.settings.lighting, cur = currentLight();
  let next;
  if (patch.effect !== undefined && patch.effect !== cur.effect) {
    const e = effectById(patch.effect), had = effectById(cur.effect);
    next = patch.effect === saved.effect
      ? { ...saved, brightness: cur.brightness, rainbow: cur.rainbow, color: cur.color }
      : { ...cur, effect: patch.effect, option: 0, speed: e.speed ? (had?.speed ? cur.speed : 2) : 0 };
  } else next = { ...cur, ...patch };
  next = normalizeLighting(next);
  state.pendingLight = lightingDiff(saved, next).length ? next : null;
  if (quiet) { renderBoard(); renderPendingBar(); return; }
  // Re-rendering replaces the buttons; keep keyboard focus on the one just used.
  const a = document.activeElement;
  const attr = a?.closest?.('#inspector') ? [...a.attributes].find(x => x.name.startsWith('data-')) : null;
  refresh();
  if (attr) $('inspector').querySelector(`[${attr.name}="${CSS.escape(attr.value)}"]`)?.focus();
}

const hash = n => ((n * 2654435761) >>> 0) / 2 ** 32;

// Approximate board preview: colour (or a rainbow), brightness, and a motion pattern per effect.
function ledPreview() {
  const l = currentLight();
  if (!l) return null;
  const e = effectById(l.effect) ?? { key: '', motion: 'none', color: true, speed: false };
  const secs = LED_SECONDS[e.speed ? l.speed : 2];
  const rainbow = !e.color || l.rainbow;
  const react = e.motion === 'react';
  const level = l.brightness / MAX_LEVEL;
  const spiral = e.key === 'LightSnake' && l.option === 1;
  const phase = key => {
    const kx = (key.x + key.w / 2) / LAYOUT_WIDTH, ky = (key.y + key.h / 2) / LAYOUT_HEIGHT;
    const angle = (Math.atan2(ky - 0.5, (kx - 0.5) * LAYOUT_WIDTH / LAYOUT_HEIGHT) / (2 * Math.PI) + 1) % 1;
    switch (spiral ? 'spin' : e.motion) {
      case 'wave': return [1 - kx, kx, 1 - ky, ky][e.options ? l.option : 0] ?? 1 - kx;
      case 'rows': case 'fall': return 1 - ky;
      case 'radial': { const d = Math.min(1, Math.hypot(kx - 0.5, (ky - 0.5) * LAYOUT_HEIGHT / LAYOUT_WIDTH) * 1.8); return l.option ? d : 1 - d; }
      case 'spin': return l.option ? angle : 1 - angle;
      case 'twinkle': case 'react': return hash(key.slot + 1);
      case 'none': case 'breathe': return kx;
      default: return 0;
    }
  };
  const anim = {
    wave: rainbow ? 'hue' : 'pulse', rows: rainbow ? 'hue' : 'pulse', fall: 'pulse', radial: rainbow ? 'hue' : 'pulse',
    spin: rainbow ? 'hue' : 'pulse', twinkle: 'twinkle', react: 'twinkle', breathe: 'breathe', cycle: 'hue',
  }[spiral ? 'spin' : e.motion];
  return {
    paint(el, key) {
      const p = phase(key);
      el.classList.add('led-key');
      if (level === 0) { el.classList.add('led-dark'); return; }
      const c = rainbow ? `hsl(${Math.round((e.motion === 'cycle' ? 0 : p) * 360)} 90% 56%)` : hex(l.color);
      el.style.setProperty('--led', c);
      el.style.setProperty('--led-mix', `${Math.round(level * (react ? 30 : 64))}%`);
      el.style.setProperty('--led-glow', `${Math.round(level * (react ? 20 : 55))}%`);
      if (!anim) return;
      // Delays come from a shared clock, so re-rendering the board doesn't restart the animation.
      const cycle = anim === 'twinkle' ? secs * 1.6 : secs;
      el.dataset.led = anim;
      el.style.animationDuration = `${cycle}s`;
      el.style.animationDelay = `${(-((performance.now() / 1000) % cycle) - p * cycle).toFixed(3)}s`;
    },
  };
}

function renderLightingPanel() {
  const el = $('inspector');
  const s = state.settings, l = currentLight();
  if (!l) {
    el.innerHTML = `<h2>Lighting</h2><p class="note">${s.source === 'device'
      ? 'The keyboard didn’t report its lighting. Refresh to try again.'
      : 'This file has no lighting settings. Connect the keyboard to see and change them.'}</p>`;
    return;
  }
  const can = editable();
  const e = effectById(l.effect);
  const change = lightChange();
  const dis = can ? '' : 'disabled';
  const changed = f => (change?.fields.includes(f) ? ' is-changed' : '');
  const revert = can && change ? '<button class="revert-chip" id="btnRevertLight" type="button" title="Discard the unsaved lighting change">Unsaved · Revert</button>' : '';
  // Brightness 0 turns the backlight fully off (verified on the keyboard), so it's labelled Off.
  const levels = (attr, value, on) => `<div class="segmented segmented-sm level-picker" role="group">
      ${Array.from({ length: MAX_LEVEL + 1 }, (_, i) => `<button type="button" data-${attr}="${i}" aria-pressed="${on && value === i}" ${can && on ? '' : 'disabled'}>${attr === 'bright' && i === 0 ? 'Off' : i}</button>`).join('')}
    </div>`;
  const offered = EFFECTS.filter(isOffered);
  const effects = (isOffered(e) ? offered : [e ?? { id: l.effect, name: `Effect ${l.effect}`, motion: 'none' }, ...offered])
    .map(x => `<button type="button" class="fx" data-fx="${x.id}" aria-pressed="${x.id === l.effect}" ${can && isOffered(x) ? '' : 'disabled'}>
        <span class="fx-icon fx-${x.motion}" aria-hidden="true"></span><span class="fx-name">${x.name}</span></button>`).join('');
  const hasColor = !!e?.color;
  const swatches = `<button type="button" class="sw sw-rainbow" data-rainbow="1" aria-pressed="${hasColor && l.rainbow}" title="Rainbow" aria-label="Rainbow" ${can && hasColor ? '' : 'disabled'}></button>
    ${SWATCHES.map(([c, name]) => `<button type="button" class="sw" data-color="${c}" style="--sw:${hex(c)}" aria-pressed="${hasColor && !l.rainbow && l.color === c}" title="${name}" aria-label="${name}" ${can && hasColor ? '' : 'disabled'}></button>`).join('')}
    <label class="sw sw-custom${hasColor && !l.rainbow && !SWATCHES.some(([c]) => c === l.color) ? ' is-on' : ''}" title="Custom colour">
      <input type="color" id="ledColor" value="${hex(l.color)}" aria-label="Custom colour" ${can && hasColor ? '' : 'disabled'}></label>`;
  const notes = [];
  if (e && !isOffered(e)) notes.push(`<strong>${e.name}</strong> was set in qmk.top and runs from its ${e.key === 'LightMusicFollow2' ? 'music' : 'screen'} sync, so RT75 Studio doesn’t set it. Picking another effect replaces it.`);
  if (!e) notes.push(`The keyboard reports effect ${l.effect}, which qmk.top doesn’t list for the RT75 Pro.`);
  if (e?.key === 'LightUserPicture') notes.push('Shows one of five per-key colour patterns stored on the keyboard. Edit the patterns in qmk.top.');
  if (e?.motion === 'react') notes.push('Lights keys up as you type.');
  if (!can) notes.push(s.source === 'device' ? (state.busy ? 'Writing…' : 'Editing is off while the live test runs.') : 'Viewing a file. Connect the keyboard to change the lighting.');

  el.innerHTML = `<div class="insp-head"><h2>Lighting</h2>${revert}</div>
    <p class="sub">Backlight for the whole keyboard, shared by all profiles</p>
    <h3 class="lt-head${changed('effect')}">Effect</h3>
    <div class="fx-grid" role="group" aria-label="Effect">${effects}</div>
    <div class="lt-row">
      <div><h3 class="lt-head${changed('brightness')}">Brightness</h3>${levels('bright', l.brightness, true)}</div>
      <div><h3 class="lt-head${changed('speed')}">Speed <span class="muted">${e?.speed ? 'slow → fast' : 'fixed'}</span></h3>${levels('speed', l.speed, !!e?.speed)}</div>
    </div>
    <h3 class="lt-head${changed('rainbow') || changed('color')}">Colour ${hasColor ? '' : '<span class="muted">set by the effect</span>'}</h3>
    <div class="sw-row${hasColor ? '' : ' is-off'}" role="group" aria-label="Colour">${swatches}</div>
    ${e?.options ? `<h3 class="lt-head${changed('option')}">${optionHeading(e)}</h3>
      <div class="segmented segmented-sm opt-picker" role="group" aria-label="${optionHeading(e)}">
        ${e.options.map((o, i) => `<button type="button" data-opt="${i}" aria-pressed="${l.option === i}" ${can && isOffered(e) ? '' : 'disabled'}>${o}</button>`).join('')}
      </div>` : ''}
    ${notes.map(n => `<p class="note">${n}</p>`).join('')}`;

  if (!can) return;
  el.querySelectorAll('[data-fx]').forEach(b => b.onclick = () => setLight({ effect: Number(b.dataset.fx) }));
  el.querySelectorAll('[data-bright]').forEach(b => b.onclick = () => setLight({ brightness: Number(b.dataset.bright) }));
  el.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => setLight({ speed: Number(b.dataset.speed) }));
  el.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => setLight({ option: Number(b.dataset.opt) }));
  el.querySelectorAll('[data-color]').forEach(b => b.onclick = () => setLight({ rainbow: false, color: Number(b.dataset.color) }));
  el.querySelector('[data-rainbow]')?.addEventListener('click', () => setLight({ rainbow: true }));
  // While the picker is open only the board updates, so the input isn't replaced mid-drag.
  const picker = $('ledColor');
  picker?.addEventListener('input', () => setLight({ rainbow: false, color: parseInt(picker.value.slice(1), 16) }, { quiet: true }));
  picker?.addEventListener('change', () => setLight({ rainbow: false, color: parseInt(picker.value.slice(1), 16) }));
  $('btnRevertLight')?.addEventListener('click', () => { state.pendingLight = null; refresh(); });
}

// ---------- Keyboard-wide settings ----------
function renderKeyboardSettings() {
  const el = $('kbSettings');
  const s = state.settings;
  el.hidden = !s;
  if (!s) return;
  const can = editable();
  const rate = state.pendingKb.reportRateHz ?? s.reportRateHz;
  const ratePending = kbChanges().some(c => c.field === 'reportRateHz');
  el.innerHTML = `
    <div class="kb-item">
      <span class="stat-label">Profile</span>
      <div class="segmented segmented-sm" role="group" aria-label="Active profile">
        ${Array.from({ length: PROFILE_COUNT }, (_, i) => `<button type="button" data-profile="${i}" aria-pressed="${s.profile === i}" ${can ? '' : 'disabled'}>${i + 1}</button>`).join('')}
      </div>
    </div>
    <div class="kb-item">
      <label class="stat-label" for="rateSelect">Polling rate</label>
      <select id="rateSelect" class="${ratePending ? 'is-pending' : ''}" ${can ? '' : 'disabled'}>
        ${RATE_OPTIONS.map(hz => `<option value="${hz}" ${hz === rate ? 'selected' : ''}>${fmtHz(hz)}${hz === s.reportRateHz ? ' (current)' : ''}</option>`).join('')}
      </select>
    </div>
    <div class="kb-item">
      <span class="stat-label">Debounce</span>
      <span class="stat-value" title="qmk.top doesn't offer debounce for this keyboard; magnetic (Hall-effect) switches don't bounce like mechanical contacts.">${s.debounce ?? '?'} · not adjustable here</span>
    </div>
    ${s.sleep ? `<div class="kb-item kb-sleep">
      <span class="stat-label">Wireless power saving <span class="muted">(minutes, 0 = never)</span></span>
      ${sleepInput('time_bt', 'Bluetooth backlight off', can)}
      ${sleepInput('deepTime_bt', 'Bluetooth deep sleep', can)}
      ${sleepInput('time_24', '2.4G backlight off', can)}
    </div>` : ''}
    ${s.source !== 'device' ? '<p class="note kb-note">Connect the keyboard to change these.</p>' : ''}`;
  el.querySelectorAll('[data-sleep]').forEach(inp => inp.onchange = () => {
    const field = inp.dataset.sleep, [lo, hi] = uiSleepLimits(field);
    if (inp.value === '') return;
    const sec = Math.min(hi, Math.max(lo, Math.round(Number(inp.value) * 60)));
    if (sec === s.sleep[field]) delete state.pendingKb[field]; else state.pendingKb[field] = sec;
    refresh();
  });
  el.querySelectorAll('[data-profile]').forEach(b => b.onclick = () => changeProfile(Number(b.dataset.profile)));
  $('rateSelect').onchange = e => {
    const hz = Number(e.target.value);
    if (hz === s.reportRateHz) delete state.pendingKb.reportRateHz; else state.pendingKb.reportRateHz = hz;
    refresh();
  };
}

// The inputs work in whole minutes, so deep sleep starts at 1 minute (the keyboard allows 10 s;
// a minimum of 10/60 made the browser's arrows step 0.17, 1.17, …).
function uiSleepLimits(field) {
  const [lo, hi] = SLEEP_LIMITS[field];
  return [lo > 0 ? Math.max(lo, 60) : 0, hi];
}

function sleepInput(field, label, can) {
  const s = state.settings, sec = state.pendingKb[field] ?? s.sleep[field];
  const [lo, hi] = uiSleepLimits(field);
  const pending = state.pendingKb[field] !== undefined && state.pendingKb[field] !== s.sleep[field];
  return `<label class="sleep-field${pending ? ' is-pending' : ''}"><span>${label}</span>
    <input type="number" data-sleep="${field}" min="${lo / 60}" max="${hi / 60}" step="1" value="${+(sec / 60).toFixed(2)}" ${can ? '' : 'disabled'}>
    <span class="muted">${fmtSecs(sec)}</span></label>`;
}

// Profiles hold their own key settings, so switching re-reads everything.
async function changeProfile(index) {
  const s = state.settings;
  if (!editable() || index === s.profile) return;
  if (hasAnyPending() && !confirm(`Switching to profile ${index + 1} discards your unsaved changes. Continue?`)) return;
  showError(null);
  const dev = state.dev;
  state.busy = true;
  refresh();
  try {
    setBusy(0.05, `Switching to profile ${index + 1}…`);
    const now = await switchProfile(dev, s, index);
    if (now !== index) throw new Error(`the keyboard stayed on profile ${now + 1}`);
    const settings = await readSettings(dev, (f, label) => setBusy(f, `Reading profile ${index + 1}: ${label}…`), { keymaps: false });
    settings.demo = s.demo;
    state.busy = false;
    load(settings, dev);
  } catch (e) {
    showError('Profile switch failed: ' + e.message);
  } finally {
    state.busy = false;
    setBusy(null);
    refresh();
  }
}

// ---------- Plumbing ----------
function renderBoardOnly() {
  renderBoard();
  renderPendingBar();
}

function refresh() {
  renderDevice();
  renderBoard();
  renderSelectionTools();
  renderStats();
  renderKeyboardSettings();
  renderPendingBar();
  renderInspector();
}

function setView(view) {
  if (view !== 'live' && state.live) stopLive();
  state.view = view;
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  refresh(); // the inspector differs per view (key map, macros, lighting, live test)
  if (KEYMAP_VIEWS.has(view)) ensureKeymaps();
}

// The key map and Fn layers (24 reads, slow over 2.4G) are read the first time a tab needs them.
const KEYMAP_VIEWS = new Set(['keymap', 'macros']);
let keymapsLoading = null;
function ensureKeymaps() {
  const s = state.settings;
  if (!s || s.source !== 'device' || s.keymap || !state.dev) return Promise.resolve();
  if (keymapsLoading) return keymapsLoading;
  keymapsLoading = (async () => {
    if (state.live) await stopLive();
    state.busy = true;
    refresh();
    try {
      const km = await readKeymaps(state.dev, s, (f, label) => setBusy(f, `Reading ${label}…`));
      if (state.settings === s) Object.assign(s, km); // ignore if the keyboard was re-read meanwhile
    } catch (e) {
      showError('Couldn’t read the key map: ' + e.message + ' Switch tabs to try again.');
    } finally {
      state.busy = false;
      setBusy(null);
      keymapsLoading = null;
      refresh();
    }
  })();
  return keymapsLoading;
}

function load(settings, dev = null) {
  if (state.live) stopLive();
  state.settings = settings;
  state.dev = dev;
  state.pending.clear();
  state.pendingKb = {};
  state.pendingKeys.clear();
  state.pendingLight = null;
  state.pendingMacroWrites.clear();
  state.library = loadLibrary(!!settings.demo);
  state.capture = null;
  state.lastApplied = null;
  refresh();
  if (KEYMAP_VIEWS.has(state.view)) setTimeout(ensureKeymaps, 0); // after the caller's own busy state clears
}

function showError(msg) {
  const el = $('error');
  el.hidden = !msg;
  el.textContent = msg ?? '';
}

function setBusy(fraction, label) {
  $('progress').hidden = fraction === null;
  if (fraction !== null) {
    $('progressFill').style.width = `${Math.round(fraction * 100)}%`;
    $('progressLabel').textContent = label;
  }
  $('btnConnect').disabled = fraction !== null;
  $('btnOpen').disabled = fraction !== null;
}

async function connect() {
  showError(null);
  if (!isSupported()) { showError('WebHID is not available in this browser. Use Chrome or Edge.'); return; }
  if (hasAnyPending() && !confirm('Refreshing discards your unsaved changes. Continue?')) return;
  if (state.live) await stopLive();
  try {
    const dev = state.settings?.source === 'device' ? (await findGrantedKeyboard() ?? await requestKeyboard()) : await requestKeyboard();
    if (!dev) return;
    setBusy(0, 'Connecting…');
    const settings = await readSettings(dev, (f, label) => setBusy(f, `Reading ${label}…`), { keymaps: false });
    if (settings.deviceId !== DEVICE_ID) showError(`This device reports ID ${settings.deviceId}, not the RT75 Pro (2865). Values may be wrong, so editing is off.`);
    load(settings, settings.deviceId === DEVICE_ID ? dev : null);
  } catch (e) {
    showError(e.name === 'NotAllowedError' || /open/i.test(e.message)
      ? 'Could not open the keyboard. Close qmk.top or any other configurator tab and try again.'
      : e.message);
  } finally {
    setBusy(null);
  }
}

async function openFile(file) {
  showError(null);
  if (hasAnyPending() && !confirm('Opening a file discards your unsaved changes. Continue?')) return;
  try {
    load(settingsFromDump(JSON.parse(await file.text())));
  } catch (e) {
    showError('That file is not a dump from dump.html or a backup: ' + e.message);
  }
}

// ---------- Wiring ----------
$('btnConnect').onclick = connect;
$('btnOpen').onclick = () => $('fileInput').click();
$('fileInput').onchange = e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; };
$('btnSample').onclick = async () => {
  try { load(settingsFromDump(await (await fetch('fixtures/sample-dump.json')).json())); }
  catch (e) { showError('Could not load the sample: ' + e.message); }
};
$('btnSelectAll').onclick = () => { state.knob = false; state.selected = new Set(MAGNETIC.map(k => k.slot)); refresh(); };
$('btnClearSel').onclick = () => { state.selected.clear(); refresh(); };
$('btnDiscard').onclick = () => { state.pending.clear(); state.pendingKb = {}; state.pendingKeys.clear(); state.pendingLight = null; state.pendingMacroWrites.clear(); state.capture = null; refresh(); };
$('btnReview').onclick = openReview;
$('btnMacroDone').onclick = saveMacroDraft;
$('btnMacroCancel').onclick = closeMacroEditor;
// Esc while recording stops the recording (onRecordKey), so it must not also close the editor.
$('macroDialog').addEventListener('cancel', e => { if (state.recording) e.preventDefault(); else { state.macroDraft = null; afterMacroSave = null; } });
document.addEventListener('keydown', onRecordKey, true);
document.addEventListener('keyup', onRecordKey, true);
$('btnApply').onclick = () => applyEdits(pendingEdits(), { backup: $('chkBackup')?.checked });
$('btnUndo').onclick = undoLast;
$('btnCancel').onclick = () => $('reviewDialog').close();
$('reviewDialog').addEventListener('cancel', e => { if (state.busy) e.preventDefault(); });
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || $('reviewDialog').open || $('presetDialog').open) return;
  if (state.picking !== null) { state.picking = null; refresh(); return; }
  if (state.selected.size || state.knob) { state.selected.clear(); state.knob = false; refresh(); }
});
window.addEventListener('beforeunload', e => { if (hasAnyPending() || state.busy) e.preventDefault(); });
// Best effort: turn live reporting off if the tab closes mid-test.
window.addEventListener('pagehide', () => { state.live?.stop().catch(() => {}); });
$('btnPresets').onclick = openPresets;
$('btnPresetClose').onclick = () => $('presetDialog').close();
$('presetSaveForm').onsubmit = e => { e.preventDefault(); const n = $('presetName').value.trim(); if (n) { savePreset(n); $('presetName').value = ''; } };
$('btnPresetImport').onclick = () => $('presetFile').click();
$('presetFile').onchange = e => { if (e.target.files[0]) importPreset(e.target.files[0]); e.target.value = ''; };
document.addEventListener('keydown', onCaptureKey, true);
document.addEventListener('keyup', onCaptureKey, true);
document.addEventListener('keydown', onLiveKey);
document.addEventListener('keyup', onLiveKey);

// ?demo: drive the full read / edit / write flow against a simulated keyboard.
async function startDemo() {
  const { createDemoDevice } = await import('./demo.js');
  const dump = await (await fetch('fixtures/sample-dump.json')).json();
  const ignore = (new URLSearchParams(location.search).get('ignore') ?? '').split(',').filter(Boolean)
    .map(s => { const [slot, param] = s.split(':').map(Number); return { slot, param }; });
  const dev = createDemoDevice(dump, { ignore });
  const settings = await readSettings(dev, () => {}, { keymaps: false });
  settings.demo = true;
  load(settings, dev);
  $('btnConnect').hidden = true;
}

refresh();
// ?dongle=classic uses qmk.top's original 2.4G timing (for comparing load times).
if (new URLSearchParams(location.search).get('dongle') === 'classic') setDongleTiming('classic');
if (new URLSearchParams(location.search).has('demo')) startDemo().catch(e => showError('Demo failed: ' + e.message));
