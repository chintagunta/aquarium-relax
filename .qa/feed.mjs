/**
 * How well does the tank actually eat?
 *
 * Drops a handful at several places across the endless tank and reports how
 * many crumbs each drop loses, plus how many animals were near enough to be
 * interested. A single drop is a lottery — it can land in a quiet gap between
 * two fish — so the check is a series of drops, not one.
 *
 *   node .qa/feed.mjs [url] [port]
 */
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4177/';
const PORT = Number(process.argv[3] ?? 9333);

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
  if (m.result.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? 'eval failed');
  return m.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
for (let i = 0; i < 40; i++) {
  await sleep(250);
  if (await ev('!!(window.__reef && window.__reef.feed)')) break;
}
await ev('window.dispatchEvent(new Event("resize"))');
await sleep(800);
await ev('window.__reef.render(120)'); // settle: the cast fills in

const DROPS = 6;
const report = await ev(`(() => {
  const r = window.__reef;
  const boot = r.population().total;
  const out = [];
  for (let i = 0; i < ${DROPS}; i++) {
    // a different place in the tank each time, so no drop inherits the last
    // one's crowd — and a little way in, away from the very edge
    r.scrollBy(900);
    r.render(90);
    const v = r.view();
    const x = v.x + v.width * (0.35 + 0.3 * ((i * 7) % 3) / 2);
    const y = 120 + ((i * 53) % 260);
    const before = r.stats().meals;
    const near = r.sample().filter((c) => Math.abs(c.x - x) < 260 && Math.abs(c.y - y) < 200).length;
    r.feed(x, y);
    r.render(60);
    const at075 = r.population().pellets;
    r.render(300);
    const after5 = r.population().pellets;
    // A drop can land in a gap between two lanes. Food that is still there a
    // quarter of a minute later, though, is food nobody can reach.
    r.render(720);
    out.push({
      drop: i,
      near,
      at075,
      after5,
      after17: r.population().pellets,
      eaten: r.stats().meals - before,
      total: r.population().total,
      boot,
    });
  }
  return out;
})()`);

const eaten = report.reduce((n, d) => n + d.eaten, 0);
const dropped = report.length * 12;
const worst = Math.min(...report.map((d) => d.eaten));
const total = report[report.length - 1].total;
const boot = report[0].boot;
for (const d of report) {
  console.log(
    `drop ${d.drop}: ${String(d.near).padStart(3)} animals within reach | ` +
      `crumbs ${d.at075}/12 at 0.75s -> ${d.after5} at 5s -> ${d.after17} at 17s | eaten ${d.eaten}`,
  );
}
console.log(`\neaten ${eaten}/${dropped} crumbs across ${report.length} drops, worst drop ${worst}/12`);
console.log(`population ${boot} -> ${total} over ${report.length} hard scrolls`);
writeFileSync('.qa/out/feed.json', JSON.stringify(report, null, 2));

// A drop in a quiet corner can take a while to be noticed, so the bar is not
// 12/12 — but food that is still sitting there after seventeen seconds, past the
// first screenful of an endless tank, is exactly the bug this checks for.
const failures = [];
if (worst < 6) failures.push(`a drop fed only ${worst}/12 crumbs`);
if (total > boot * 2.5) failures.push(`the cast grew from ${boot} to ${total} while scrolling`);
console.log(failures.length ? '\nFEED FAILED: ' + failures.join('; ') : 'feed ok');

await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => undefined);
ws.close();
// let the sockets unwind on their own; exiting while the close handshake is in
// flight trips a libuv assertion on Windows
setTimeout(() => process.exit(failures.length ? 1 : 0), 250);
