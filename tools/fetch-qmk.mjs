// Downloads the qmk.top code RT75 Studio was reverse engineered from, into reference/qmk/
// (git-ignored), for reading only. Usage: node tools/fetch-qmk.mjs
//
// File names are content hashes that change when qmk.top redeploys, so they are discovered:
//   GearHub-V5 bundle  ← script tag in https://qmk.top/
//   v4 app bundle      ← script tag in https://qmk.top/v4/
//   RY5088 finder      ← findRy5088Device:()=>…import("./<hash>.js") in the v4 bundle
//   RT75 Pro module    ← ry5088_zmd_k982d_3m_8k_1k:()=>…import("./<hash>.js",[deps]) in the finder
//   RT75 layout        ← "./keyboard_ui_info/keyboard_81_rt75_keymappings_ui_info.ts" in the v4 bundle
// See protocol-notes.md for what each file contains.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../reference/qmk/', import.meta.url));
const DEVICE = 'ry5088_zmd_k982d_3m_8k_1k';
mkdirSync(OUT, { recursive: true });

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
function save(name, text) {
  writeFileSync(OUT + name, text);
  console.log(`saved ${name} (${Math.round(text.length / 1024)} KB)`);
}
function must(match, what) {
  if (!match) throw new Error(`Could not find ${what}; qmk.top may have changed its build.`);
  return match[1];
}

const gearhubHtml = await get('https://qmk.top/');
const gearhub = must(gearhubHtml.match(/src="\.\/(js\/index\.[\w-]+\.js)"/), 'the GearHub-V5 bundle');
save('gearhub-index.js', await get('https://qmk.top/' + gearhub));

const v4Html = await get('https://qmk.top/v4/');
save('v4-index.html', v4Html);
const v4Main = must(v4Html.match(/src="\.\/(js\/index\.[\w-]+\.js)"/), 'the v4 bundle');
const v4 = await get('https://qmk.top/v4/' + v4Main);
save('v4-index.js', v4);

const finder = must(v4.match(/findRy5088Device:\(\)=>\w+\(\(\)=>import\("\.\/([\w-]+\.js)"/), 'the RY5088 device finder');
const finderJs = await get('https://qmk.top/v4/js/' + finder);
save('v4-ry5088-finder.js', finderJs);

const mod = finderJs.match(new RegExp(`${DEVICE}:\\(\\)=>\\w+\\(\\(\\)=>import\\("\\./([\\w-]+\\.js)"\\),\\[([^\\]]*)\\]`));
if (!mod) throw new Error(`Could not find the ${DEVICE} module in the finder.`);
save('v4-rt75pro-device.js', await get('https://qmk.top/v4/js/' + mod[1]));
for (const dep of mod[2].match(/"\.\/[\w-]+\.js"/g) ?? []) {
  const file = dep.slice(3, -1);
  if (file === mod[1] || file.startsWith('index.')) continue;
  const text = await get('https://qmk.top/v4/js/' + file);
  // The RY5088 base class (the whole protocol) is the dependency defining FEA_CMD_SET_MULTI_MAGNETISM.
  save(text.includes('FEA_CMD_SET_MULTI_MAGNETISM') ? 'v4-ry5088-base.js' : `v4-dep-${file}`, text);
}

const layout = must(v4.match(/"\.\/keyboard_ui_info\/keyboard_81_rt75_keymappings_ui_info\.ts":\(\)=>\w+\(\(\)=>import\("\.\/([\w-]+\.js)"/), 'the RT75 layout');
save('v4-rt75-layout.js', await get('https://qmk.top/v4/js/' + layout));
console.log(`\nDone. Files are in ${OUT}`);
