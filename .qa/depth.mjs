/**
 * How much of the water column the fish actually use.
 *
 * The concern is specifically the top of the tank, so this reports the vertical
 * distribution directly: what fraction of the cast is in each fifth of the
 * column, and (the number that matters) how many are in the top quarter. A
 * "perfect" spread would be 20% per fifth; a reef tank will not be uniform, but
 * an empty top fifth is a visible fault.
 *
 *   node .qa/depth.mjs [baseUrl] [cdpPort]
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:4177/';
const PORT = process.argv[3] ?? '9333';

const target = await (
  await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE)}`, { method: 'PUT' })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const ev = async (x) => {
  const m = await send('Runtime.evaluate', {
    expression: x,
    returnByValue: true,
    awaitPromise: true,
  });
  if (m.result.exceptionDetails) throw new Error(m.result.exceptionDetails.text);
  return m.result.result.value;
};

for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250));
  if (await ev('!!(window.__reef && window.__reef.sample)')) break;
}

const out = await ev(`(() => {
  const r = window.__reef;
  // Step past the boot rearrangement so arrivals have settled into ranges.
  r.render(60);
  const h = document.querySelector('canvas').clientHeight;
  const bins = [0, 0, 0, 0, 0];
  const kinds = {};
  const fish = r.sample().filter((c) => c.kind === 'fish');
  for (const c of fish) {
    const f = Math.min(0.999, Math.max(0, c.y / h));
    bins[Math.floor(f * 5)] += 1;
    const b = Math.floor(f * 5);
    kinds[b] = kinds[b] ?? {};
    kinds[b][c.species] = (kinds[b][c.species] ?? 0) + 1;
  }
  const n = fish.length;
  const top25 = fish.filter((c) => c.y / h < 0.25).length;
  return {
    n,
    canvasH: h,
    fifths: bins.map((v) => +(100 * v / n).toFixed(1)),
    topQuarterPct: +(100 * top25 / n).toFixed(1),
    // the two most numerous species in each fifth, to see who lives where
    who: Object.fromEntries(Object.entries(kinds).map(([b, m]) => [b,
      Object.entries(m).sort((a, c) => c[1] - a[1]).slice(0, 3).map(([s, c]) => s + ':' + c).join(' ')])),
  };
})()`);

console.log('fish sampled:', out.n, ' canvas height:', out.canvasH);
console.log('fifths (surface -> sand), % of fish:', out.fifths.join('  '));
console.log('in the top quarter:', out.topQuarterPct + '%');
for (const [b, who] of Object.entries(out.who ?? {})) {
  console.log(`  fifth ${b} (${['0-20', '20-40', '40-60', '60-80', '80-100'][b]}%): ${who}`);
}
await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => undefined);
ws.close();
setTimeout(() => {}, 250);
