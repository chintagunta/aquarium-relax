/**
 * Two screenshots from one page session, with the state reported for each, so a
 * difference between them cannot be blamed on a different page load.
 *
 *   node .qa/two.mjs <framesA> <framesB>
 */
import { writeFileSync } from 'node:fs';

const A = Number(process.argv[2] ?? 5);
const B = Number(process.argv[3] ?? 1400);
const W = Number(process.env.W ?? 1496);
const H = Number(process.env.H ?? 805);
const BASE = process.env.URL ?? 'http://127.0.0.1:5177/';
const PORT = 9333;

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
  const m = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (m.result.exceptionDetails)
    return 'EXC ' + m.result.exceptionDetails.text + ' ' + (m.result.exceptionDetails.exception?.description ?? '');
  return m.result.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250));
  if (await ev('!!(window.__reef && window.__reef.scrollTo)')) break;
}
await ev('window.dispatchEvent(new Event("resize"))');
await new Promise((r) => setTimeout(r, 800));

const REPORT = `(() => {
  const c = document.querySelector('canvas');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4 * 37) {
    if (d[i] > d[i + 1] + 18 || d[i] > 140) ink++;
  }
  const v = window.__reef.view();
  const b = new Array(10).fill(0);
  for (const k of window.__reef.sample()) {
    if (k.x < v.x || k.x > v.x + v.width) continue;
    b[Math.min(9, Math.max(0, Math.floor(((k.x - v.x) / v.width) * 10)))]++;
  }
  const cv = document.querySelector('canvas');
  return { pop: window.__reef.population(), ink, buckets: b, view: v.x, worldW: v.width, canvasCss: cv.clientWidth, canvasBuf: cv.width };
})()`;

// Step the second phase in chunks so a collapse can be pinned to a moment.
const CHUNK = 100;
for (const [name, frames] of [['a', A], ['b', B]]) {
  const step = name === 'b' ? CHUNK : frames;
  let done = 0;
  while (done < frames) {
    await ev(`window.__reef.render(${Math.min(step, frames - done)})`);
    done += step;
    if (name === 'b' && done % 400 === 0) console.log('  b@' + done, JSON.stringify(await ev(REPORT)));
  }
  console.log(name, frames, JSON.stringify(await ev(REPORT)));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`.qa/out/two-${name}.png`, Buffer.from(shot.result.data, 'base64'));
}
await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => undefined);
ws.close();
setTimeout(() => {}, 250);
