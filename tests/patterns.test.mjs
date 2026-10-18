// Custom lighting helpers: fills, built-in designs, and per-key colours from a picture.
const { colorsFromImage, keyColor, BUILT_IN_DESIGNS, PATTERN_BYTES, applyFill } = await import(new URL('../src/patterns.js', import.meta.url).href);
const { KEYS, LAYOUT_WIDTH, LAYOUT_HEIGHT } = await import(new URL('../src/layout.js', import.meta.url).href);

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };
const key = code => KEYS.find(k => k.code === code && !k.knob);

// A synthetic picture the size of the layout: left half red, right half blue, top 40 px green.
const W = LAYOUT_WIDTH, H = LAYOUT_HEIGHT;
const data = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  data.set(y < 50 ? [0, 255, 0, 255] : x < W / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], i);
}
const img = { data, width: W, height: H };
const base = new Array(PATTERN_BYTES).fill(7);
const out = colorsFromImage(base, img);
check('a key on the left takes the left half’s colour', keyColor(out, key('KeyA').slot) === '#ff0000', keyColor(out, key('KeyA').slot));
check('a key on the right takes the right half’s colour', keyColor(out, key('Enter').slot) === '#0000ff', keyColor(out, key('Enter').slot));
check('the top row takes the band above it', keyColor(out, key('Escape').slot) === '#00ff00', keyColor(out, key('Escape').slot));
const space = keyColor(out, key('Space').slot);
check('a key across both halves averages them', /^#[0-9a-f]{2}00[0-9a-f]{2}$/.test(space) && space !== '#ff0000' && space !== '#0000ff', space);
check('slots that aren’t keys keep their bytes', out.slice(126 * 3).every(v => v === 7));

// A half-size picture gives the same colours (only proportions matter).
const half = { width: Math.round(W / 2), height: Math.round(H / 2), data: new Uint8ClampedArray(Math.round(W / 2) * Math.round(H / 2) * 4) };
for (let y = 0; y < half.height; y++) for (let x = 0; x < half.width; x++) half.data.set(y < 25 ? [0, 255, 0, 255] : x < half.width / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * half.width + x) * 4);
const out2 = colorsFromImage(base, half);
check('scale doesn’t matter', keyColor(out2, key('KeyA').slot) === '#ff0000' && keyColor(out2, key('Escape').slot) === '#00ff00');

// Vivid: a dull colour gets stronger and brighter.
const dull = { width: 1, height: 1, data: new Uint8ClampedArray([120, 90, 80, 255]) };
const v = keyColor(colorsFromImage(base, { ...dull, width: 1, height: 1 }, { vivid: true }), key('KeyA').slot);
const [r, g, b] = [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16));
check('vivid makes a dull colour stronger', r > 120 && b < 80 && r - b > 40, v);

check('Sunset is built in', BUILT_IN_DESIGNS.some(d => d.name === 'Sunset' && d.builtIn && d.colors.length === PATTERN_BYTES));
check('Sunset runs red to purple, left to right', keyColor(BUILT_IN_DESIGNS[0].colors, key('Escape').slot).startsWith('#f') && keyColor(BUILT_IN_DESIGNS[0].colors, key('Delete')?.slot ?? key('ArrowRight').slot) !== keyColor(BUILT_IN_DESIGNS[0].colors, key('Escape').slot));
check('fills only touch keys', applyFill(base, 'solid', '#102030', '#000000').slice(126 * 3).every(v => v === 7));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
