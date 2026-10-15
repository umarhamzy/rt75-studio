// Runs every *.test.mjs in this folder: node tests/run.mjs
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
let failed = 0;
for (const file of readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort()) {
  const r = spawnSync(process.execPath, [dir + file], { encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  const pass = (out.match(/^PASS/gm) ?? []).length, fail = (out.match(/^FAIL/gm) ?? []).length;
  const ok = r.status === 0 && fail === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${file}  (${pass} passed${fail ? `, ${fail} failed` : ''})`);
  if (!ok) console.log(out.split('\n').filter(l => /^FAIL|Error/.test(l)).map(l => '     ' + l).join('\n'));
}
process.exitCode = failed ? 1 : 0;
