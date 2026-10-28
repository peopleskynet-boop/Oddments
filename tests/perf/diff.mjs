// node diff.mjs A B [noiseA2]  — computed-style differences per state; keys that differ between A and A2 are noise
import fs from 'fs';
const [A, B, N] = process.argv.slice(2);
let total = 0;
for (const f of fs.readdirSync(A).filter((f) => f.endsWith('.json'))) {
  if (!fs.existsSync(`${B}/${f}`)) { console.log('missing', f); continue; }
  const a = JSON.parse(fs.readFileSync(`${A}/${f}`)), b = JSON.parse(fs.readFileSync(`${B}/${f}`));
  const n = N && fs.existsSync(`${N}/${f}`) ? JSON.parse(fs.readFileSync(`${N}/${f}`)) : null;
  const lines = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!a[k] || !b[k]) { if (!(n && !n[k] !== !a[k])) lines.push(`  ${a[k] ? '-' : '+'} ${k}`); continue; }
    for (const p of Object.keys(a[k])) {
      if (a[k][p] === b[k][p]) continue;
      if (n && n[k] && n[k][p] !== a[k][p]) continue;
      lines.push(`  ${k} { ${p}: ${a[k][p]} → ${b[k][p]} }`);
    }
  }
  if (lines.length) { console.log(f, lines.length); console.log(lines.slice(0, 25).join('\n')); total += lines.length; }
}
console.log('total', total);
