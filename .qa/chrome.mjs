/**
 * Browser check for the hide switch.
 *
 * The claim being tested is not "a class was added" — it is that the panels are
 * actually off the glass. So this reads computed style and a bounding box for
 * each panel rather than trusting the attribute, and it checks the other half of
 * the promise too: the controls row and its button must survive the hide, or
 * there is no way back.
 *
 *   node .qa/chrome.mjs [baseUrl] [cdpPort]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4177/';
const PORT = process.argv[3] ?? '9333';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[chrome]', ...a);

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.console = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: res, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.console.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.console.push(msg.params.exceptionDetails.text);
      }
    });
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(`timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(`eval threw: ${r.exceptionDetails.text}`);
    return r.result.value;
  }

  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(r.data, 'base64'));
    log(`shot ${name}.png`);
  }
}

/**
 * One panel, measured. `visibility` and `pointer-events` are the load-bearing
 * part: opacity alone would still leave a clickable, focusable rectangle
 * sitting on the water.
 *
 * Two boxes are read on purpose. `getBoundingClientRect` is post-transform, so
 * it shrinks by the 0.98 the panel scales to while retreating; comparing those
 * numbers across states would report a reflow that never happened.
 * `offsetWidth`/`offsetHeight` are the layout box, untouched by the transform,
 * and that is the pair worth holding constant.
 *
 * The box is not expected to reach zero, either. `visibility: hidden` keeps a
 * layout box in Chrome, so a zero-size test would ask for something no hidden
 * element does.
 */
const READ = `(() => {
  const seen = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return { present: false };
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      present: true,
      opacity: +(+s.opacity).toFixed(3),
      visibility: s.visibility,
      pointerEvents: s.pointerEvents,
      // layout box: transform-independent, so it can be compared across states
      lw: el.offsetWidth,
      lh: el.offsetHeight,
      // visual box: what is actually painted right now
      w: Math.round(r.width),
      h: Math.round(r.height),
      ariaHidden: el.getAttribute('aria-hidden'),
    };
  };
  const btn = [...document.querySelectorAll('.controls .btn')].find((b) =>
    /info/i.test(b.textContent || ''),
  );
  const glyph = btn ? (btn.querySelector('.btn__glyph')?.textContent ?? '') : '';
  return {
    title: document.querySelector('.brand__title')?.textContent ?? null,
    docTitle: document.title,
    chrome: document.querySelector('.app')?.dataset.chrome ?? null,
    brand: seen('.brand'),
    stats: seen('.stats'),
    hint: seen('.hint'),
    controls: seen('.controls'),
    button: btn
      ? {
          // Strip the glyph so the label is what a person actually reads.
          label: btn.textContent.replace(glyph, '').trim(),
          pressed: btn.getAttribute('aria-pressed'),
          visible: btn.getBoundingClientRect().width > 0,
        }
      : null,
    errors: (window.__REEF_ERRORS__ || []).slice(0, 5),
  };
})()`;

const clickInfo = `(() => {
  const btn = [...document.querySelectorAll('.controls .btn')].find((b) => /info/i.test(b.textContent || ''));
  if (!btn) return 'no button';
  btn.click();
  return btn.textContent.trim();
})()`;

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const hidden = (p, was) =>
  p.present &&
  p.opacity === 0 &&
  p.visibility === 'hidden' &&
  p.pointerEvents === 'none' &&
  // layout box unchanged: hidden and inert, not reflowed
  p.lw === was.lw &&
  p.lh === was.lh;
const shown = (p) => p.present && p.opacity === 1 && p.visibility === 'visible' && p.lw > 0 && p.lh > 0;

const main = async () => {
  await fetch(`http://127.0.0.1:${PORT}/json/list`)
    .then((r) => r.json())
    .then(async (list) => {
      for (const t of list.filter((t) => t.type === 'page' && String(t.url).startsWith(BASE))) {
        await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => undefined);
      }
    })
    .catch(() => undefined);

  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE)}`, { method: 'PUT' })
  ).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('websocket error')), { once: true });
  });
  const session = new Session(ws);

  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Page.bringToFront').catch(() => undefined);

  for (let i = 0; i < 40; i++) {
    if (await session.evaluate('!!document.querySelector(".controls")')) break;
    await sleep(250);
  }
  await sleep(1500); // let the entrance animations finish before measuring

  const before = await session.evaluate(READ);
  await session.shot('07-info-shown');
  check('plain name is on the glass', before.title === "Yohans' Reef", JSON.stringify(before.title));
  check('document title follows', /Yohans' Reef/.test(before.docTitle), before.docTitle);
  check('panels start visible', shown(before.brand) && shown(before.stats) && shown(before.hint));
  check('the switch starts unpressed', before.button?.pressed === 'false', before.button?.label);

  await session.evaluate(clickInfo);
  await sleep(600);
  const after = await session.evaluate(READ);
  await session.shot('08-info-hidden');
  check('brand is gone', hidden(after.brand, before.brand), JSON.stringify(after.brand));
  check('stats are gone', hidden(after.stats, before.stats), JSON.stringify(after.stats));
  check('hint is gone', hidden(after.hint, before.hint), JSON.stringify(after.hint));
  check('hidden panels are out of the a11y tree', after.hint.ariaHidden === 'true');
  check('app reports bare chrome', after.chrome === 'bare', String(after.chrome));
  check('controls stay visible', shown(after.controls));
  check('button says Show info', after.button?.label === 'Show info', after.button?.label);
  check('button stays clickable', after.button?.visible === true && after.button?.pressed === 'true');

  await session.evaluate(clickInfo);
  await sleep(600);
  const back = await session.evaluate(READ);
  await session.shot('09-info-restored');
  check(
    'everything comes back',
    shown(back.brand) && shown(back.stats) && shown(back.hint) && back.chrome === 'full',
  );
  check('button says Hide info again', back.button?.label === 'Hide info', back.button?.label);
  check('no new page errors', back.errors.length === 0 && before.errors.length === 0, JSON.stringify(back.errors));
  check('nothing logged to console', session.console.length === 0, session.console.join(' | ').slice(0, 200));

  const failed = checks.filter((c) => !c.pass);
  writeFileSync(
    resolve(OUT, 'chrome.json'),
    JSON.stringify({ url: BASE, before, after, back, checks, console: session.console }, null, 2),
  );
  log(`${checks.length - failed.length}/${checks.length} checks passed`);
  await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => undefined);
  ws.close();
  if (failed.length) process.exitCode = 1;
};

await main();
