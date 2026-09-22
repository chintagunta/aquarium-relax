import { readFileSync, writeFileSync } from 'node:fs';
const f = 'src/world/ocean.ts';
const buf = readFileSync(f);
const out = [];
for (const b of buf) {
  if (b === 0x97) out.push(0xe2, 0x80, 0x94);  // cp1252 em dash -> UTF-8
  else out.push(b);
}
const fixed = Buffer.from(out);
const s = fixed.toString('utf8');
if (!Buffer.from(s, 'utf8').equals(fixed)) throw new Error('still invalid');
writeFileSync(f, fixed);
console.log('repaired; em dashes now:', (s.match(/\u2014/g) ?? []).length, '| bytes', buf.length, '->', fixed.length);
