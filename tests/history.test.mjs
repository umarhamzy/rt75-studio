// History helpers (src/history.js): summaries, titles, the 200-entry cap and storage fallback.
const { summarize, titleFor, saveHistory, loadHistory, MAX_ENTRIES, dayLabel } = await import(new URL('../src/history.js', import.meta.url).href);

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };

const wasd = ['W', 'A', 'S', 'D'].map(k => [k, 'Actuation point', '1.20 mm', '0.80 mm']);
check('same change on several keys: just the change', summarize(wasd) === 'Actuation point: 1.20 mm → 0.80 mm', summarize(wasd));
check('title names the keys', titleFor(wasd, ['keys']) === 'W, A, S, D · Actuation point', titleFor(wasd, ['keys']));
const q = [['Q', 'Actuation point', '1.30 mm', '1.00 mm'], ['Q', 'Release point', '1.30 mm', '1.00 mm']];
check('one key, two settings', summarize(q) === 'Actuation point 1.30 mm → 1.00 mm, release point 1.30 mm → 1.00 mm', summarize(q));
check('title: key and two settings', titleFor(q, ['keys']) === 'Q · Actuation point and Release point', titleFor(q, ['keys']));
const dks = [['W', 'Key mode', 'Normal', 'DKS'], ['W', 'DKS trigger point', '0.00 mm', '0.70 mm']];
check('acronyms keep their capitals', summarize(dks) === 'Key mode Normal → DKS, DKS trigger point 0.00 mm → 0.70 mm', summarize(dks));
const remap = [['F2', 'Base', 'F2', 'Left click']];
check('one remap', summarize(remap) === 'Base: F2 → Left click' && titleFor(remap, ['keymap']) === 'F2 · Key map', `${titleFor(remap, ['keymap'])} | ${summarize(remap)}`);
const mixed = [['E', 'Base', 'E', 'Left click'], ['Keyboard', 'Polling rate', '1 kHz', '8 kHz'], ['F', 'Base', 'F', 'Mute']];
check('mixed rows: first two and a count', summarize(mixed) === 'E Base: E → Left click · Polling rate: 1 kHz → 8 kHz · +1 more', summarize(mixed));
check('title: several areas', titleFor(mixed, ['keymap', 'keyboard']) === 'E, F · Key map + Keyboard', titleFor(mixed, ['keymap', 'keyboard']));
const many = 'QWERTYUIO'.split('').map(k => [k, 'Switch', 'Outemu', 'Magneto']);
check('long key lists are cut in the title', titleFor(many, ['keys']) === 'Q, W, E +6 · Switch', titleFor(many, ['keys']));
const light = [['Lighting', 'Effect', 'Wave', 'Breathing']];
check('lighting title', titleFor(light, ['lighting']) === 'Lighting · Effect' && summarize(light) === 'Effect: Wave → Breathing', titleFor(light, ['lighting']));
check('keyboard title', titleFor([['Keyboard', 'Polling rate', '1 kHz', '8 kHz']], ['keyboard']) === 'Keyboard · Polling rate');

// No localStorage in node: kept in memory for the visit, capped at MAX_ENTRIES.
const list = Array.from({ length: MAX_ENTRIES + 25 }, (_, i) => ({ id: String(i) }));
const kept = saveHistory(2865, true, list);
check('keeps the newest 200', kept.length === MAX_ENTRIES && kept[0].id === '25' && kept.at(-1).id === String(MAX_ENTRIES + 24));
check('memory fallback loads back', loadHistory(2865, true).length === MAX_ENTRIES && loadHistory(2865, false).length === 0);
const now = new Date(2026, 9, 21, 12);
check('day labels', dayLabel(new Date(2026, 9, 21, 9).toISOString(), now) === 'Today' && dayLabel(new Date(2026, 9, 20, 23).toISOString(), now) === 'Yesterday');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
