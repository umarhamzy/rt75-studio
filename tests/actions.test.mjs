// Key action decoding/encoding (src/actions.js) against qmk.top's byte layouts.
const { decodeAction, encodeKey, splitKey } = await import(new URL('../src/actions.js', import.meta.url).href);
const { DEFAULT_MATRIX, DEFAULT_FN_MATRIX, DEFAULT_FN_MAC_MATRIX } = await import(new URL('../src/layout.js', import.meta.url).href);

let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) failures++; };
const d = (bytes, opts) => decodeAction(bytes, opts);

check('plain key', d([0, 0, 4, 0]).label === 'A' && d([0, 0, 4, 0]).kind === 'key');
check('disabled (both forms)', d([0, 0, 0, 0]).kind === 'disabled' && d([0, 0, 3, 0]).kind === 'disabled');
check('two-key combo', d([0, 0, 227, 15]).label === 'Left Win + L');
check('three-key combo', d([0, 224, 225, 41]).label === 'Left Ctrl + Left Shift + Esc');
check('Mac names on the Mac layer', d([0, 0, 227, 44], { mac: true }).label === 'Left Cmd + Space' && d([0, 0, 227, 44], { mac: true }).short === '⌘Spc');
check('media function', d([3, 0, 205, 0]).label === 'Play / Pause' && d([3, 0, 205, 0]).short === 'Play');
check('profile select', d([8, 0, 4, 2]).label === 'Profile 3');
check('Fn key', d([10, 1, 0, 0]).label === 'Fn');
check('macro not editable', d([9, 0, 2, 0]).kind === 'macro' && !d([9, 0, 2, 0]).editable);
check('unknown kept raw', d([10, 4, 0, 0]).kind === 'unknown' && !d([10, 4, 0, 0]).editable);

check('encode single key', encodeKey(4).join() === '0,0,4,0');
check('encode one modifier (qmk layout)', encodeKey(15, [227]).join() === '0,0,227,15');
check('encode two modifiers', encodeKey(41, [224, 225]).join() === '0,224,225,41');
check('encode drops a third modifier and duplicates', encodeKey(4, [224, 224, 225, 226]).join() === '0,224,225,4');
check('split round-trips', JSON.stringify(splitKey(encodeKey(41, [224, 225]))) === JSON.stringify({ main: 41, mods: [224, 225] }));

// Every factory entry decodes to something other than "unknown", except Tab's 10,4 on the Fn layers.
for (const [name, m] of [['base', DEFAULT_MATRIX], ['Fn Windows', DEFAULT_FN_MATRIX], ['Fn Mac', DEFAULT_FN_MAC_MATRIX]]) {
  const unknown = [];
  for (let i = 0; i < 128; i++) {
    const q = m.slice(i * 4, i * 4 + 4);
    if (q.some(Boolean) && d(q).kind === 'unknown') unknown.push(`${i}:${q.join(',')}`);
  }
  check(`factory ${name} layer decodes`, unknown.every(u => u === '2:10,4,0,0'), unknown.join(' '));
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
