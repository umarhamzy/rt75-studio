// History helpers (src/history.js): summaries, titles, the 200-entry cap and storage fallback.
const { summarize, titleFor, saveHistory, loadHistory, MAX_ENTRIES, dayLabel } = await import(new URL('../src/history.js', import.meta.url).href);

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };

const wasd = ['W', 'A', 'S', 'D'].map(k => [k, 'Actuation point', '1.20 mm', '0.80 mm']);
check('same change on several keys is one line', summarize(wasd) === 'W, A, S, D: 1.20 mm → 0.80 mm', summarize(wasd));
const q = [['Q', 'Actuation point', '1.30 mm', '1.00 mm'], ['Q', 'Release point', '1.30 mm', '1.00 mm']];
check('one key, two settings', summarize(q) === 'Q: actuation point 1.30 mm → 1.00 mm, release point 1.30 mm → 1.00 mm', summarize(q));
const mixed = [['E', 'Base', 'E', 'Left click'], ['Keyboard', 'Polling rate', '1 kHz', '8 kHz'], ['F', 'Base', 'F', 'Mute']];
check('mixed rows: first two and a count', summarize(mixed) === 'E Base: E → Left click · Polling rate: 1 kHz → 8 kHz · +1 more', summarize(mixed));
const many = 'QWERTYUIO'.split('').map(k => [k, 'Switch', 'Outemu', 'Magneto']);
check('long key lists are cut', summarize(many).startsWith('Q, W, E, R, T +4: '), summarize(many));
check('title: the setting', titleFor(wasd, ['keys']) === 'Actuation point');
check('title: two settings', titleFor(q, ['keys']) === 'Actuation point and Release point');
check('title: key map says Key map', titleFor([['E', 'Base', 'E', 'Left click']], ['keymap']) === 'Key map');
check('title: several areas', titleFor(mixed, ['keymap', 'keyboard']) === 'Key map + Keyboard');

// No localStorage in node: kept in memory for the visit, capped at MAX_ENTRIES.
const list = Array.from({ length: MAX_ENTRIES + 25 }, (_, i) => ({ id: String(i) }));
const kept = saveHistory(2865, true, list);
check('keeps the newest 200', kept.length === MAX_ENTRIES && kept[0].id === '25' && kept.at(-1).id === String(MAX_ENTRIES + 24));
check('memory fallback loads back', loadHistory(2865, true).length === MAX_ENTRIES && loadHistory(2865, false).length === 0);
const now = new Date(2026, 9, 21, 12);
check('day labels', dayLabel(new Date(2026, 9, 21, 9).toISOString(), now) === 'Today' && dayLabel(new Date(2026, 9, 20, 23).toISOString(), now) === 'Yesterday');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
