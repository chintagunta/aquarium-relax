import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs|css|html|json|md)$/.test(e)) files.push(p);
  }
};
walk('src'); walk('.qa');
for (const f of ['index.html', 'README.md', 'DESIGN.md']) files.push(f);
const bad = [];
const seen = new Map();
for (const f of files) {
  const buf = readFileSync(f);
  const s = buf.toString('utf8');
  if (Buffer.from(s, 'utf8').equals(buf)) continue;   // valid utf8, untouched
  bad.push(f);
  const l = buf.toString('latin1');
  for (let i = 0; i < l.length; i++) {
    const c = l.charCodeAt(i);
    if (c < 128) continue;
    const key = c.toString(16).padStart(4, '0');
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
}
console.log('invalid utf8 files:', bad.length ? bad : 'none');
console.log('non-ascii latin1 code points present:', [...seen.entries()].sort().map(([k, v]) => `${k}x${v}`).join(' '));
