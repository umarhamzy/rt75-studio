import { KEYS, DEFAULT_MATRIX, LAYOUT_WIDTH, LAYOUT_HEIGHT, DEVICE_ID } from './layout.js';
import {
  isSupported, requestKeyboard, findGrantedKeyboard, readSettings, settingsFromDump,
  writeBounds, writeKeySettings, startLiveTravel, writeReportRate, switchProfile, LIMITS, RATE_OPTIONS, PROFILE_COUNT,
} from './device.js';

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
  selected: new Set(),       // matrix slots
  knob: false,               // knob selected instead of keys
  pending: new Map(),        // slot -> { field: raw value } differing from settings
  pendingKb: {},             // keyboard-wide edits, e.g. { reportRateHz: 8000 }
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
  const current = s.keymap.slice(i * 4, i * 4 + 4);
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
    action: actionName(current),
    remapped: current.join() !== factory.join(),
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

  // The three knob entries share one physical knob.
  const knobKeys = KEYS.filter(k => k.knob);
  const kx = Math.min(...knobKeys.map(k => k.x)), kw = Math.max(...knobKeys.map(k => k.x + k.w)) - kx;
  const knob = document.createElement('button');
  knob.type = 'button';
  knob.className = 'knob' + (state.knob ? ' is-selected' : '');
  place(knob, { x: kx, y: 0, w: kw, h: knobKeys[0].h });
  knob.setAttribute('aria-label', 'Volume knob');
  knob.onclick = () => { state.knob = !state.knob; state.selected.clear(); refresh(); };
  board.appendChild(knob);

  for (const key of MAGNETIC) {
    const d = keyData(key);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'key';
    place(el, key);
    el.dataset.slot = key.slot;
    if (state.selected.has(key.slot)) el.classList.add('is-selected');
    if (state.picking !== null && key.slot !== state.picking) el.classList.add(snapEligible(key.slot) ? 'pick-target' : 'pick-blocked');
    el.setAttribute('aria-pressed', String(state.selected.has(key.slot)));

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
        if (d.rt) { value.textContent = `${mm(d.rtPress)} / ${mm(d.rtRelease)}`; el.classList.add('hl-rt'); }
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
    el.onclick = e => clickKey(key.slot, e.ctrlKey || e.metaKey || e.shiftKey);
    board.appendChild(el);
  }
  renderLegend(lo, hi);
}

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
    el.innerHTML = '<span class="swatch swatch-rt"></span><span>Rapid Trigger on · values are press / release sensitivity (mm)</span>';
  } else if (state.view === 'live') {
    const why = liveUnavailableReason();
    el.innerHTML = state.live
      ? '<button class="btn btn-small btn-stop" id="btnLive" type="button">Stop live test</button><span class="live-dot"></span><span>Live: press keys to see their depth</span>'
      : `<button class="btn btn-small btn-primary" id="btnLive" type="button" ${why ? 'disabled' : ''}>Start live test</button><span class="muted">${why ?? 'Shows how deep the key you press goes, against its trigger points.'}</span>`;
    $('btnLive').onclick = () => (state.live ? stopLive() : startLive());
  } else {
    el.innerHTML = '<span class="swatch swatch-snap"></span><span>Snap Tap pairs: the last key pressed wins</span>';
  }
}

function renderSelectionTools() {
  const el = $('selectTools');
  if (!state.settings) { el.hidden = true; return; }
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
    ['Remapped', `${remapped} key${remapped === 1 ? '' : 's'}`],
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
  $('btnConnect').textContent = s.source === 'device' ? 'Refresh' : 'Connect keyboard';
}

// ---------- Pending bar ----------
function renderPendingBar() {
  const edits = pendingEdits();
  const n = edits.length, kb = kbChanges().length;
  const settingsCount = edits.reduce((a, e) => a + Object.keys(e).length - 1, 0);
  $('pendingBar').hidden = n === 0 && kb === 0;
  const parts = [];
  if (n) parts.push(`${settingsCount} unsaved change${settingsCount === 1 ? '' : 's'} on ${n} key${n === 1 ? '' : 's'}`);
  if (kb) parts.push(n ? 'polling rate' : 'Unsaved polling rate change');
  $('pendingText').textContent = parts.join(' + ');
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
    ? `${single.remapped ? `Remapped to <strong>${single.action}</strong>` : `Sends ${single.action}`} · ${single.mode}`
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

function hasAnyPending() { return pendingEdits().length > 0 || kbChanges().length > 0; }

// Keyboard-wide edits that differ from the keyboard: [{ field, label, from, to }].
function kbChanges() {
  const s = state.settings, k = state.pendingKb;
  if (!s) return [];
  return k.reportRateHz !== undefined && k.reportRateHz !== s.reportRateHz
    ? [{ field: 'reportRateHz', label: 'Polling rate', from: s.reportRateHz, to: k.reportRateHz }] : [];
}
const fmtHz = hz => (hz === undefined ? '?' : hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);
const kbRows = changes => changes.map(c => `<tr><td>Keyboard</td><td>${c.label}</td><td>${fmtHz(c.from)}</td><td><strong>${fmtHz(c.to)}</strong></td></tr>`).join('');

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
    <tbody>${changeRows(edits, (slot, f) => state.settings.magnet[f][slot])}${kbRows(kbChanges())}</tbody></table></div>
    <label class="check"><input type="checkbox" id="chkBackup" checked> Download a backup of the current settings first</label>`;
  $('reviewStatus').textContent = '';
  $('reviewStatus').className = 'review-status';
  $('btnApply').hidden = false;
  $('btnApply').disabled = false;
  $('btnUndo').hidden = true;
  $('btnCancel').textContent = 'Cancel';
  $('reviewDialog').showModal();
}

async function applyEdits(edits, { backup, kb = kbChanges() }) {
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
    for (const c of kb) {
      status.textContent = `Writing ${c.label.toLowerCase()}…`;
      const got = await writeReportRate(state.dev, state.settings, c.to);
      state.settings.reportRateHz = got;
      delete state.pendingKb[c.field];
      if (got !== c.to) result.mismatches.push({ kb: true, label: c.label, expected: fmtHz(c.to), actual: fmtHz(got) });
    }
    if (result.mismatches.length) {
      status.className = 'review-status is-error';
      status.textContent = `Written and retried once, but ${result.mismatches.length} value(s) still read back differently: ` +
        result.mismatches.map(m => m.kb ? `${m.label} expected ${m.expected}, got ${m.actual}`
          : `${keyBySlot(m.slot).label} ${FIELD_LABELS[m.field]} expected ${fmt(m.field, m.expected)}, got ${fmt(m.field, m.actual)}`).join('; ');
    } else {
      const n = edits.reduce((a, e) => a + Object.keys(e).length - 1, 0) + kb.length;
      status.className = 'review-status is-ok';
      status.textContent = `Done. All ${n} setting${n === 1 ? '' : 's'} written and confirmed by reading them back.` +
        (result.retried ? ` (${result.retried} needed a second try.)` : '');
    }
    state.lastApplied = { undo: [...before].map(([slot, fields]) => ({ slot, ...fields })), undoKb: kb.map(c => ({ ...c, from: c.to, to: c.from })) };
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
  state.lastApplied = null;
  $('btnUndo').hidden = true;
  $('reviewBody').innerHTML = `<p>Restoring the previous values:</p>
    <div class="table-wrap"><table class="changes"><thead><tr><th>Key</th><th>Setting</th><th>Now</th><th>Restored</th></tr></thead>
    <tbody>${changeRows(undo, (slot, f) => state.settings.magnet[f][slot])}${kbRows(undoKb)}</tbody></table></div>`;
  await applyEdits(undo, { backup: false, kb: undoKb });
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
    featureListSupported: false, profile: s.profile, reportRateHz: s.reportRateHz, debounce: s.debounce,
    keymap: { 0: s.keymap }, magnet: s.magnet, savedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rt75-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Keyboard-wide settings ----------
function renderKeyboardSettings() {
  const el = $('kbSettings');
  const s = state.settings;
  el.hidden = !s;
  if (!s) return;
  const can = editable();
  const rate = state.pendingKb.reportRateHz ?? s.reportRateHz;
  const ratePending = kbChanges().length > 0;
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
    ${s.source !== 'device' ? '<p class="note kb-note">Connect the keyboard to change these.</p>' : ''}`;
  el.querySelectorAll('[data-profile]').forEach(b => b.onclick = () => changeProfile(Number(b.dataset.profile)));
  $('rateSelect').onchange = e => {
    const hz = Number(e.target.value);
    if (hz === s.reportRateHz) delete state.pendingKb.reportRateHz; else state.pendingKb.reportRateHz = hz;
    refresh();
  };
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
    const settings = await readSettings(dev, (f, label) => setBusy(f, `Reading profile ${index + 1}: ${label}…`));
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
  const inspectorChanges = (view === 'live') !== (state.view === 'live');
  state.view = view;
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  if (inspectorChanges) refresh(); else renderBoard();
}

function load(settings, dev = null) {
  if (state.live) stopLive();
  state.settings = settings;
  state.dev = dev;
  state.pending.clear();
  state.pendingKb = {};
  state.lastApplied = null;
  refresh();
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
    const settings = await readSettings(dev, (f, label) => setBusy(f, `Reading ${label}…`));
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
$('btnDiscard').onclick = () => { state.pending.clear(); state.pendingKb = {}; refresh(); };
$('btnReview').onclick = openReview;
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
document.addEventListener('keydown', onLiveKey);
document.addEventListener('keyup', onLiveKey);

// ?demo: drive the full read / edit / write flow against a simulated keyboard.
async function startDemo() {
  const { createDemoDevice } = await import('./demo.js');
  const dump = await (await fetch('fixtures/sample-dump.json')).json();
  const ignore = (new URLSearchParams(location.search).get('ignore') ?? '').split(',').filter(Boolean)
    .map(s => { const [slot, param] = s.split(':').map(Number); return { slot, param }; });
  const dev = createDemoDevice(dump, { ignore });
  const settings = await readSettings(dev);
  settings.demo = true;
  load(settings, dev);
  $('btnConnect').hidden = true;
}

refresh();
if (new URLSearchParams(location.search).has('demo')) startDemo().catch(e => showError('Demo failed: ' + e.message));
