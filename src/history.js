// History: every write RT75 Studio makes (from Review changes, Instant save or Undo), kept in this
// browser per keyboard so it survives a reload (design HS1, canvas Round 22). Each entry keeps the
// rows shown to the user and what Undo needs to write the old values back.

export const MAX_ENTRIES = 200;
export const AREAS = {
  keys: 'Key settings', keymap: 'Key map', lighting: 'Lighting', keyboard: 'Keyboard',
};

const storeKey = (deviceId, demo) => `rt75-studio-history-${demo ? 'demo-' : ''}${deviceId ?? 'none'}`;
let memory = {}; // used when storage is blocked: kept for this visit

export function loadHistory(deviceId, demo) {
  const key = storeKey(deviceId, demo);
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? 'null');
    return Array.isArray(list) ? list : memory[key] ?? [];
  } catch { return memory[key] ?? []; }
}

// Saves the newest MAX_ENTRIES; if storage is full, drops the oldest half and tries again.
export function saveHistory(deviceId, demo, list) {
  const key = storeKey(deviceId, demo);
  let keep = list.slice(-MAX_ENTRIES);
  memory[key] = keep;
  for (let tries = 0; tries < 4; tries++) {
    try { localStorage.setItem(key, JSON.stringify(keep)); return keep; } catch (e) {
      if (e?.name !== 'QuotaExceededError') return keep; // storage blocked: kept in memory for this visit
      keep = keep.slice(Math.floor(keep.length / 2));
      memory[key] = keep;
    }
  }
  return keep;
}

// rows: [[what, setting, before, after]] as plain text.
// "W, A, S, D: 1.20 → 0.80 mm" when every row changes the same setting the same way, otherwise
// the first two rows and how many more.
export function summarize(rows) {
  if (!rows.length) return '';
  const [, setting, before, after] = rows[0];
  if (rows.length > 1 && rows.every(r => r[1] === setting && r[2] === before && r[3] === after)) {
    const what = rows.map(r => r[0]);
    return `${what.length > 6 ? `${what.slice(0, 5).join(', ')} +${what.length - 5}` : what.join(', ')}: ${before} → ${after}`;
  }
  const what = [...new Set(rows.map(r => r[0]))];
  if (what.length === 1 && rows.length > 1) {
    const lower = t => t.charAt(0).toLowerCase() + t.slice(1);
    const parts = rows.slice(0, 3).map(r => `${lower(r[1])} ${r[2]} → ${r[3]}`);
    return `${what[0]}: ${parts.join(', ')}${rows.length > 3 ? ` +${rows.length - 3} more` : ''}`;
  }
  const one = r => `${r[0] === r[1] || ['Keyboard', 'Lighting'].includes(r[0]) ? '' : `${r[0]} `}${r[1]}: ${r[2]} → ${r[3]}`;
  return rows.slice(0, 2).map(one).join(' · ') + (rows.length > 2 ? ` · +${rows.length - 2} more` : '');
}

// The entry's title: the one setting it changed, or the areas it touched.
export function titleFor(rows, areas) {
  const settings = [...new Set(rows.map(r => r[1]))];
  // Key-map rows name the layer (Base, Fn …), which says less than "Key map".
  if (settings.length <= 2 && areas.length === 1 && areas[0] !== 'keymap') return settings.join(' and ');
  return areas.map(a => AREAS[a]).join(' + ');
}

export const dayLabel = (iso, now = new Date()) => {
  const d = new Date(iso), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};
export const timeLabel = iso => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
