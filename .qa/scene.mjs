/**
 * Renders the tank to a PNG after running a setup expression against it.
 *
 *   node .qa/scene.mjs out-name "window.__reef.scrollTo(2400); window.__reef.render(60)"
 *
 * Extra environment: W, H, URL, NIGHT (any value).
 */
import { writeFileSync } from 'node:fs';

const NAME = process.argv[2] ?? 'scene';
const SETUP = process.argv[3] ?? 'window.__reef.render(60)';
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
await send('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: 1, mobile: false,
});
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250));
  if (await ev('!!(window.__reef && window.__reef.scrollTo)')) break;
}
await ev('window.dispatchEvent(new Event("resize"))');
await new Promise((r) => setTimeout(r, 800));

const result = await ev(`(async () => {
  ${SETUP};
  // Count pixels that cannot be water, so the image and the number come from
  // the same canvas state rather than from two different runs.
  const c = document.querySelector('canvas');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4 * 37) {
    if (d[i] > d[i + 1] + 18 || d[i] > 140) ink++;
  }
  return {
    pop: window.__reef.population(),
    ink,
    whale: (() => {
      const w = window.__reef.sample().find((c) => c.kind === 'whale');
      if (!w) return null;
      const v = window.__reef.view();
      return { screenX: Math.round(w.x - v.x), y: Math.round(w.y), bodyPx: Math.round(w.bodyPx), depth: +w.depth.toFixed(2), state: w.state };
    })(),
    // where the animals actually are, in screen space
    xBuckets: (() => {
      const v = window.__reef.view();
      const b = new Array(10).fill(0);
      for (const c of window.__reef.sample()) {
        if (c.x < v.x || c.x > v.x + v.width) continue;
        b[Math.min(9, Math.max(0, Math.floor(((c.x - v.x) / v.width) * 10)))]++;
      }
      return b;
    })(),
  };
})()`);
console.log(JSON.stringify(result));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`.qa/out/${NAME}.png`, Buffer.from(shot.result.data, 'base64'));
console.log(`-> .qa/out/${NAME}.png`);
await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => undefined);
ws.close();
setTimeout(() => {}, 250);
