/**
 * Browser verification for The Reef.
 *
 * Drives the running dev server through the Chrome DevTools Protocol. Time is
 * advanced through the app's own fixed-step hook rather than by waiting on
 * requestAnimationFrame, because a headless tab throttles rAF to a crawl and
 * would make every timing observation meaningless.
 *
 * Usage: node .qa/verify.mjs [baseUrl] [cdpPort]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5177/';
const PORT = process.argv[3] ?? '9333';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[verify]', ...a);

async function newTarget(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });
  if (!res.ok) throw new Error(`cannot open target: ${res.status} ${await res.text()}`);
  return res.json();
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: res, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}, timeoutMs = 90000) {
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
    if (r.exceptionDetails) {
      const d = r.exceptionDetails.exception;
      throw new Error(
        `eval threw: ${r.exceptionDetails.text} | ${d?.description ?? ''} ${d?.className ?? ''} ${d?.value ?? ''}`,
      );
    }
    return r.result.value;
  }

  async step(frames, label) {
    const t0 = Date.now();
    await this.evaluate(`window.__reef.render(${frames})`);
    log(`stepped ${frames} frames in ${Date.now() - t0}ms (${label})`);
  }

  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const file = resolve(OUT, `${name}.png`);
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    log(`shot ${name}.png`);
    return file;
  }

  /**
   * Frame budget, measured honestly.
   *
   * `bench()` pauses the app's own loop, so what it times is the work of one
   * update + render rather than the display's refresh interval. This machine is
   * still shared with a dev server and a browser, so the number is retried and
   * the cheapest observation is kept: interference can only ever add time, so
   * the minimum is the closest thing to the true cost. A minimum that is still
   * high means the environment really was saturated, and it is reported as
   * such rather than presented as the tank's frame cost.
   */
  async bench(label, attempts = 4) {
    let best = Infinity;
    for (let i = 0; i < attempts; i++) {
      await this.evaluate(
        'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))',
      ).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 200));
      const ms = await this.evaluate(
        'window.__reef.bench(30), Math.min(window.__reef.bench(60), window.__reef.bench(60), window.__reef.bench(60))',
      );
      best = Math.min(best, ms);
      if (best < 6) break;
    }
    const suspect = best >= 8;
    log(
      `bench ${label} ${best.toFixed(2)} ms/frame` + (suspect ? '  ** contended, not a work measurement **' : ''),
    );
    return { ms: best, suspect };
  }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('websocket error')), { once: true });
  });
  return new Session(ws);
}

const PROBE = `(() => {
  const p = window.__reef;
  const canvas = document.querySelector('canvas');
  const s = p ? p.stats() : { meals: -1, pellets: -1, creatures: -1, fps: -1 };
  return {
    hasApi: !!p,
    errors: (window.__REEF_ERRORS__ || []).slice(0, 5),
    canvas: canvas ? { w: canvas.width, h: canvas.height } : null,
    meals: s.meals,
    pellets: s.pellets,
    creatures: s.creatures,
    kinds: p ? p.kinds() : null,
    guideOpen: !!document.querySelector('dialog[open]'),
  };
})()`;

/**
 * Watches the whole cast for a while and reports how it actually moves:
 * whether the fish hold a horizontal heading, whether they swim head first,
 * whether the crossers sweep one side to the other, whether anyone is leaving
 * the tank, and how big the fish are against the tank.
 */
const MOTION = (seconds) => `(() => {
  const p = window.__reef;
  const start = p.sample();
  let minX = {}, maxX = {}, minY = {}, maxY = {}, straight = {}, seen = {};
  // An animal that turns around is mirrored, never rotated, so while it has a
  // heading worth the name its facing must agree with the sign of vx.
  const face = { n: 0, ok: 0 };
  let maxPitch = 0;
  const track = (s) => {
    for (const c of s) {
      const k = c.kind;
      minX[k] = Math.min(minX[k] ?? 1e9, c.x); maxX[k] = Math.max(maxX[k] ?? -1e9, c.x);
      minY[k] = Math.min(minY[k] ?? 1e9, c.y); maxY[k] = Math.max(maxY[k] ?? -1e9, c.y);
      seen[k] = (seen[k] ?? 0) + 1;
      // level travel: horizontal speed should dominate vertical
      const sp = Math.hypot(c.vx, c.vy);
      if (sp > 1) {
        straight[k] = straight[k] ?? { n: 0, level: 0 };
        straight[k].n++;
        if (Math.abs(c.vx) / sp > 0.72) straight[k].level++;
      }
      maxPitch = Math.max(maxPitch, Math.abs(c.pitch));
      if (Math.abs(c.vx) > 15) {
        face.n++;
        if (Math.sign(c.vx) === c.facing) face.ok++;
      }
    }
  };
  track(start);
  const frames = ${seconds} * 60;
  for (let i = 0; i < frames; i += 10) {
    p.render(10);
    track(p.sample());
  }
  const big = Math.max(...start.filter(c => c.kind === 'fish').map(c => c.bodyPx));
  return {
    span: Object.fromEntries(Object.keys(seen).map(k => [k, {
      dx: Math.round(maxX[k] - minX[k]), dy: Math.round(maxY[k] - minY[k]),
      n: seen[k],
    }])),
    levelFraction: Object.fromEntries(Object.entries(straight).map(([k, v]) => [k, +(v.level / v.n).toFixed(2)])),
    headFirst: +(face.ok / Math.max(1, face.n)).toFixed(3),
    faceSamples: face.n,
    maxPitch: +maxPitch.toFixed(2),
    biggestFishPx: Math.round(big),
    canvasH: document.querySelector('canvas').clientHeight,
    onScreen: p.sample().filter(c => c.x > 0 && c.x < window.innerWidth).length,
    total: p.sample().length,
  };
})()`;

/**
 * Close any tab left behind by an earlier run. An orphaned copy of the tank is
 * not idle — its animation loop keeps running — and two of them fighting this
 * one for the machine is how a protocol call times out for no reason.
 */
async function closeStrays(base) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const mine = list.filter((t) => t.type === 'page' && typeof t.url === 'string' && t.url.startsWith(base));
  for (const t of mine) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => undefined);
  }
  if (mine.length) log(`closed ${mine.length} stray tab${mine.length > 1 ? 's' : ''}`);
}

const main = async () => {
  log('opening', BASE);
  await closeStrays(BASE);
  const target = await newTarget(BASE);
  const session = await connect(target.webSocketDebuggerUrl);
  const report = { url: BASE, steps: [] };

  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Log.enable').catch(() => undefined);
  // A window Chrome considers occluded stops handing out animation frames, and
  // every check that waits on the live loop then waits forever.
  await session.send('Page.bringToFront').catch(() => undefined);

  // wait until the app has mounted and reported in
  for (let i = 0; i < 40; i++) {
    const ready = await session.evaluate('!!(window.__reef && window.__reef.stats().creatures > 0)');
    if (ready) break;
    await sleep(500);
  }

  await session.step(30, 'warm up');
  report.steps.push({ name: 'boot', ...(await session.evaluate(PROBE)) });
  report.shot1 = await session.shot('01-boot');
  report.benchLively = await session.bench('lively');

  // ---- the frame clock across a blocking call.
  // rAF hands the callback the time its frame *started*, so a frame delivered
  // right after the loop was blocked for a second or more can carry a timestamp
  // from before the block finished — a negative step, which used to run the
  // tank backwards and blow up a ripple's radius until the draw threw. A ripple
  // is put in the water first, because a growing radius is what a backwards
  // step destroys, and the stale delta is measured so the mechanism itself is
  // on the record rather than assumed.
  report.clockJump = await session.evaluate(`new Promise((done) => {
    const r = window.__reef;
    r.render(150);
    r.splash(430, 300);
    const wall = performance.now();
    let stale = null;
    let n = 0;
    // Frames are the point of this check, but a throttled tab must not hang the
    // whole run: fall back to reporting what was seen.
    const giveUp = setTimeout(() => done({ staleMs: stale, frames: n, ripples: r.population().ripples, errors: (window.__REEF_ERRORS__ || []).length }), 2500);
    const tick = () => {
      if (++n < 6) return requestAnimationFrame(tick);
      clearTimeout(giveUp);
      done({
        staleMs: stale,
        frames: n,
        ripples: r.population().ripples,
        errors: (window.__REEF_ERRORS__ || []).length,
      });
    };
    requestAnimationFrame((now) => {
      stale = Math.round(wall - now);
      tick();
    });
  })`);
  log('clock jump', JSON.stringify(report.clockJump));
  if (report.clockJump.errors) {
    throw new Error(`a frame after a blocking call threw (${report.clockJump.errors} uncaught)`);
  }
  if (!(report.clockJump.ripples > 0)) throw new Error('the splash ripple disappeared');
  if (report.clockJump.frames < 6) {
    log(`WARNING: only ${report.clockJump.frames} live frames arrived — the clock check was not exercised`);
  }

  // ---- the whale turns up on its own schedule, and crosses the window
  // Stepped in chunks: ninety seconds of simulation in one call blows the
  // protocol timeout on a contended machine.
  let whaleWaited = 0;
  let whaleSeen = false;
  for (let i = 0; i < 30 && !whaleSeen; i++) {
    whaleSeen = await session.evaluate(`(() => {
      window.__reef.render(90);
      return window.__reef.population().whales > 0;
    })()`);
    whaleWaited += 1.5;
  }
  report.whale = await session.evaluate(`(() => {
    const r = window.__reef;
    const first = r.sample().find((c) => c.kind === 'whale');
    if (!first) return { appeared: false, secondsWaited: ${whaleWaited} };
    r.render(420);
    const later = r.sample().find((c) => c.kind === 'whale');
    return {
      appeared: true,
      secondsWaited: ${whaleWaited},
      bodyPx: Math.round(first.bodyPx),
      movedX: later ? Math.round(Math.abs(later.x - first.x)) : 0,
      stillHere: !!later,
    };
  })()`);
  log('whale', JSON.stringify(report.whale));

  // ---- the tank is endless: scroll a long way and check it stays populated
  report.scroll = await session.evaluate(`(() => {
    const r = window.__reef;
    const before = r.population();
    const trace = [];
    for (let i = 0; i < 12; i++) {
      r.scrollBy(1200);
      r.render(60);
      const p = r.population();
      trace.push(p.onScreen);
    }
    const after = r.population();
    return {
      viewBefore: 0,
      viewAfter: r.view().x,
      onScreenBefore: before.onScreen,
      onScreenAfter: after.onScreen,
      minOnScreenWhileScrolling: Math.min(...trace),
      totalAfter: after.total,
    };
  })()`);
  log('scroll', JSON.stringify(report.scroll));
  report.shotScroll = await session.shot('01d-scrolled');

  // ---- and are those animals actually *drawn* where the sim says they are?
  // Counting creatures inside the view is not enough: a render pass whose
  // transform disagreed with its culling window kept every animal one screen to
  // the right of where it belonged, and the only thing that noticed was a
  // human wondering why the far end of the reef was empty. So this samples the
  // canvas at each animal's own position and asks whether anything is there.
  report.drawn = await session.evaluate(`(() => {
    const r = window.__reef;
    const canvas = document.querySelector('canvas');
    const g = canvas.getContext('2d');
    const at = (x, y) => {
      const d = g.getImageData(Math.max(0, Math.round(x)) - 2, Math.max(0, Math.round(y)) - 2, 5, 5).data;
      let R = 0, G = 0, B = 0;
      for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
      return [R / 25, G / 25, B / 25];
    };
    const check = () => {
      r.render(2);
      const v = r.view();
      const h = document.querySelector('canvas').clientHeight;
      const list = r.sample().filter((q) =>
        q.x >= v.x + 40 && q.x <= v.x + v.width - 40 && q.y > 40 && q.y < h - 160);
      let drawn = 0;
      for (const q of list) {
        // The water behind varies slowly, so a colour change 70px up means ink.
        const a = at(q.x - v.x, q.y);
        const b = at(q.x - v.x, q.y - 70);
        const diff = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
        if (diff > 18) drawn++;
      }
      return { view: Math.round(v.x), onScreen: list.length, drawn };
    };
    const here = check();
    // A teleport is the worst case the tank can be asked for: everything that
    // was in front of the viewer is suddenly 15000px behind it, and the new
    // water has to fill in from the edges.
    r.scrollTo(30000);
    r.render(600);
    const far = check();
    return { here, far };
  })()`);
  log('drawn', JSON.stringify(report.drawn));
  for (const [where, d] of Object.entries(report.drawn)) {
    if (d.onScreen < 10) throw new Error(`only ${d.onScreen} animals on screen ${where} the scroll`);
    if (d.drawn < d.onScreen * 0.7) {
      throw new Error(`${where}: ${d.drawn} of ${d.onScreen} animals are actually drawn`);
    }
  }


  // ---- does it move the way an aquarium should?
  // Six seconds is plenty to see a heading hold, and keeps the single evaluate
  // well inside the protocol timeout on a contended machine.
  report.motion = await session.evaluate(MOTION(6));
  log('motion', JSON.stringify(report.motion));
  report.shotMotion = await session.shot('01b-motion');

  // ---- after dark
  await session.evaluate(`(() => {
    document.querySelector('.icon-toggle')?.click();
    return true;
  })()`);
  // React commits on its own schedule; wait for the tank to actually be dark
  // rather than assuming a fixed delay was long enough.
  let lit = 'day';
  for (let i = 0; i < 20 && lit !== 'night'; i++) {
    await sleep(150);
    lit = await session.evaluate(`document.querySelector('.app')?.dataset.light`);
  }
  if (lit !== 'night') throw new Error('night mode never engaged');
  await session.step(60, 'dusk');
  report.night = await session.evaluate(`(() => {
    const s = window.__reef.sample();
    return {
      lit: document.querySelector('.app')?.dataset.light,
      pressed: !!document.querySelector('.icon-toggle[aria-pressed="true"]'),
      glowSpecies: s.filter(c => c.kind === 'jelly' || c.kind === 'squid' || c.kind === 'mermaid').length,
      creatures: s.length,
    };
  })()`);
  report.benchNight = await session.bench('night');
  report.shotNight = await session.shot('01c-night');
  log('night', JSON.stringify(report.night));
  // and back to daylight, so the rest of the run is the tank the brief describes
  await session.evaluate(`(() => {
    document.querySelector('.icon-toggle')?.click();
    return true;
  })()`);
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    const now = await session.evaluate(`document.querySelector('.app')?.dataset.light`);
    if (now === 'day') break;
  }
  await session.step(20, 'dawn');

  // ---- a real trusted click, exactly like a visitor dropping food.
  // `buttons` matters: without it Chrome can synthesise repeat presses and the
  // tank gets three handfuls for one click.
  const AT = { x: 470, y: 330 };
  // Nothing has been fed yet unless something other than the test fed it, so
  // the meal count has to be zero before the click and exactly one handful
  // after it — otherwise the "how many crumbs get eaten" number below is
  // measuring somebody else's food.
  const beforeClick = await session.evaluate(PROBE);
  if (beforeClick.meals !== 0 || beforeClick.pellets !== 0) {
    throw new Error(
      `the tank was not empty before the click: ${beforeClick.meals} meals, ${beforeClick.pellets} crumbs`,
    );
  }
  await session.send('Input.dispatchMouseEvent', { ...AT, type: 'mouseMoved', button: 'none', buttons: 0 });
  await sleep(120);
  await session.send('Input.dispatchMouseEvent', {
    ...AT, type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1,
  });
  await session.send('Input.dispatchMouseEvent', {
    ...AT, type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1,
  });
  const justFed = await session.evaluate(PROBE);
  // One press, one handful — a double-fire here would be a real bug.
  if (justFed.pellets !== 12) {
    throw new Error(`one click produced ${justFed.pellets} crumbs, expected 12`);
  }
  await session.step(45, 'food falling');
  const fed = await session.evaluate(PROBE);
  report.steps.push({ name: 'feed+0.75s', ...fed });
  report.shot2 = await session.shot('02-feeding');

  // ---- how many of those crumbs get eaten, and how fast
  await session.step(240, 'feeding frenzy');
  const eaten = await session.evaluate(PROBE);
  report.steps.push({ name: 'feed+4.75s', ...eaten });
  report.shot3 = await session.shot('03-settled');
  log('meals', fed.meals, '->', eaten.meals, '| pellets', fed.pellets, '->', eaten.pellets);

  // ---- controls
  await session.evaluate(`(() => {
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add an animal')?.click();
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Field guide')?.click();
    return true;
  })()`);
  await sleep(700);
  report.steps.push({ name: 'controls', ...(await session.evaluate(PROBE)) });
  report.shot4 = await session.shot('04-guide');

  await session.evaluate(`(() => {
    document.querySelector('dialog[open] .guide__close')?.click();
    [...document.querySelectorAll('.segmented__btn')].find(b => b.textContent.trim() === 'Wild')?.click();
    return true;
  })()`);
  await sleep(400);
  await session.step(120, 'wild tank');
  report.steps.push({ name: 'wild', ...(await session.evaluate(PROBE)) });
  report.benchWild = await session.bench('wild');
  report.shot5 = await session.shot('05-wild');

  // ---- a narrow phone viewport, laid out fresh
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await session.evaluate('window.dispatchEvent(new Event("resize"))');
  await sleep(1500);
  await session.step(30, 'mobile');
  report.steps.push({ name: 'mobile', ...(await session.evaluate(PROBE)) });
  report.shot6 = await session.shot('06-mobile');
  log('mobile canvas', JSON.stringify((await session.evaluate(PROBE)).canvas));

  const logs = session.events
    .filter((e) => e.method === 'Log.entryAdded' || e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.entry?.text ?? e.params.exceptionDetails?.text ?? '')
    .filter(Boolean)
    // Chrome's own advice about the harness reading pixels back, not the tank.
    .filter((t) => !t.includes('willReadFrequently'));
  report.consoleIssues = logs.slice(0, 20);

  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2));
  log('report written');
  console.log(JSON.stringify({
    frameBudgetMs: {
      lively: report.benchLively.ms,
      night: report.benchNight.ms,
      wild: report.benchWild.ms,
    },
    contended: report.benchLively.suspect || report.benchNight.suspect || report.benchWild.suspect,
    motion: report.motion,
    night: report.night,
    scroll: report.scroll,
    whale: report.whale,
    steps: report.steps.map((s) => ({
      name: s.name, meals: s.meals, pellets: s.pellets, creatures: s.creatures,
      errors: s.errors, canvas: s.canvas, guideOpen: s.guideOpen,
    })),
    consoleIssues: report.consoleIssues,
  }, null, 2));

  await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => undefined);
  session.ws.close();
  // let the sockets unwind on their own; calling process.exit() here trips a
  // libuv assertion on Windows while the close handshake is still in flight.
  setTimeout(() => process.exit(0), 250);
};

main().catch(async (err) => {
  console.error('VERIFY FAILED:', err);
  // Do not leave the tab behind: it keeps animating, and the next run would be
  // measuring a machine that is already busy.
  await closeStrays(BASE).catch(() => undefined);
  process.exit(1);
});
