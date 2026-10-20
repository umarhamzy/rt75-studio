// Themes (Appearance page and the sidebar's dark/light switch), kept in this browser. The colours
// are in themes.css (Amber, the default, in styles.css). index.html applies the saved theme before
// the page paints, so a light theme doesn't flash dark first.

export const THEMES = [
  { id: 'amber', name: 'Amber', mode: 'dark', note: 'Default · warm dark' },
  { id: 'frost', name: 'Frost', mode: 'dark', note: 'Soft slate' },
  { id: 'contrast', name: 'High contrast', mode: 'dark', note: 'Strongest text and lines' },
  { id: 'ember', name: 'Ember', mode: 'dark', note: 'Warm charcoal' },
  { id: 'moss', name: 'Moss', mode: 'dark', note: 'Olive and brass' },
  { id: 'paper', name: 'Paper', mode: 'light', note: 'Warm paper' },
  { id: 'porcelain', name: 'Porcelain', mode: 'light', note: 'Cool white' },
  { id: 'mint', name: 'Mint', mode: 'light', note: 'Pale green' },
  { id: 'retro', name: 'Retro', mode: 'light', note: 'Cream, dark keycaps' },
];
const STORE = 'rt75-studio-theme';
// The switch flips between the last dark and the last light theme picked.
const DEFAULT = { mode: 'dark', dark: 'amber', light: 'paper' };

export const themeById = id => THEMES.find(t => t.id === id);

export function loadTheme() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}; } catch { /* storage blocked or bad JSON: defaults */ }
  const pick = (mode) => (themeById(saved[mode])?.mode === mode ? saved[mode] : DEFAULT[mode]);
  return { mode: saved.mode === 'light' ? 'light' : 'dark', dark: pick('dark'), light: pick('light') };
}

export const themeInUse = pref => themeById(pref[pref.mode]);

export function saveTheme(pref) {
  try { localStorage.setItem(STORE, JSON.stringify(pref)); } catch { /* storage blocked: kept for this visit */ }
}

export function applyTheme(pref) {
  document.documentElement.dataset.theme = themeInUse(pref).id;
}

// Picking a theme makes it the one for its mode, and switches to that mode.
export const withTheme = (pref, id) => {
  const t = themeById(id);
  return t ? { ...pref, mode: t.mode, [t.mode]: t.id } : pref;
};
export const flipped = pref => ({ ...pref, mode: pref.mode === 'dark' ? 'light' : 'dark' });
