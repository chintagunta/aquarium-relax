/**
 * Unit tests for the parts of the simulation that are pure logic.
 *
 * Everything that draws goes through canvas, so the rendering half is verified
 * separately in a real browser (see .qa/verify.mjs and the README). What is
 * testable here is the maths, the seeded randomness, the water palette, and the
 * species roster's internal consistency.
 *
 * Run with: node --experimental-strip-types src/sim/aquarium.test.ts
 */
import assert from 'node:assert/strict';
import { Rng } from '../core/rng.ts';
import { angleDelta, clamp, damp, frameDelta, lerp, mixHex, sampleGradient, withAlpha } from '../core/math.ts';
import { MAX_PIXELS, MIN_DPR, renderDpr } from '../core/budget.ts';
import { REEF_PALETTE, waterAt } from '../world/ocean.ts';
import { MAX_SIZE, SPECIES, SPECIES_BY_ID, SPECIES_GROUPS, SIZE_EXP } from './species.ts';

/** The extremes of the cast, by real length. */
const SIZE = (() => {
  const sorted = [...SPECIES].sort((a, b) => a.realCm - b.realCm);
  return { smallest: sorted[0], largest: sorted[sorted.length - 1] };
})();

let passed = 0;
const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

/* ------------------------------- maths ------------------------------- */

test('clamp holds values inside the range', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(0.4, 0, 1), 0.4);
});

test('lerp and damp land on their targets', () => {
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.ok(near(damp(0, 10, 5, 0), 0));
  assert.ok(damp(0, 10, 5, 10) > 9.99);
  // damp must be frame-rate independent: two half steps == one full step
  const twoSteps = damp(damp(0, 10, 4, 0.5), 10, 4, 0.5);
  const oneStep = damp(0, 10, 4, 1);
  assert.ok(Math.abs(twoSteps - oneStep) < 1e-9, `${twoSteps} vs ${oneStep}`);
});

test('angleDelta always takes the short way round', () => {
  assert.ok(near(angleDelta(3.0, -3.0), 0.283185307179586, 1e-9));
  assert.ok(near(angleDelta(0, 1), 1));
  assert.ok(near(angleDelta(0, -1), -1));
});

test('mixHex blends in both directions', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0), '#000000');
  assert.equal(mixHex('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHex('#ff0000', '#00ff00', 0), '#ff0000');
});

test('withAlpha produces a usable rgba string', () => {
  assert.equal(withAlpha('#0596cf', 0.5), 'rgba(5,150,207,0.5)');
  assert.equal(withAlpha('#ffffff', 2), 'rgba(255,255,255,1)');
});

test('sampleGradient interpolates and clamps', () => {
  const stops: Array<[number, string]> = [
    [0, '#000000'],
    [0.5, '#808080'],
    [1, '#ffffff'],
  ];
  assert.equal(sampleGradient(stops, 0), '#000000');
  assert.equal(sampleGradient(stops, 1), '#ffffff');
  assert.equal(sampleGradient(stops, -3), '#000000');
  assert.equal(sampleGradient(stops, 42), '#ffffff');
});

test('a frame delta never runs the tank backwards', () => {
  // A stale rAF timestamp after a blocking call can put the frame clock behind
  // the last one: that must not become a negative step.
  assert.equal(frameDelta(-1.86), 1 / 60);
  assert.equal(frameDelta(-0.001), 1 / 60);
  assert.equal(frameDelta(0), 1 / 60);
  // a genuinely slow frame is still honoured...
  assert.ok(near(frameDelta(0.1), 0.1));
  // ...but a throttled tab or a long stall advances one nominal frame only
  assert.equal(frameDelta(2.5), 1 / 60);
  assert.equal(frameDelta(0.25), 1 / 60);
  // and a normal 60fps frame passes through untouched
  assert.ok(near(frameDelta(1 / 60), 1 / 60));
});

/* -------------------------------- rng -------------------------------- */

test('the same seed always grows the same reef', () => {
  const a = new Rng(1234);
  const b = new Rng(1234);
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
});

test('different seeds diverge', () => {
  const a = new Rng(1);
  const b = new Rng(2);
  assert.notEqual(a.next(), b.next());
});

test('rng stays inside its declared ranges', () => {
  const rng = new Rng(99);
  for (let i = 0; i < 500; i++) {
    const r = rng.next();
    assert.ok(r >= 0 && r < 1, `next() out of range: ${r}`);
    const v = rng.range(-4, 7);
    assert.ok(v >= -4 && v < 7, `range() out of range: ${v}`);
    const n = rng.int(2, 5);
    assert.ok(Number.isInteger(n) && n >= 2 && n <= 5, `int() out of range: ${n}`);
    assert.ok(Math.abs(rng.bell()) <= 1, 'bell() out of range');
  }
});

test('int() can actually reach both ends', () => {
  const rng = new Rng(7);
  const seen = new Set<number>();
  for (let i = 0; i < 400; i++) seen.add(rng.int(0, 3));
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
});

/* ------------------------------- water ------------------------------- */

test('water colour is defined across the whole column', () => {
  for (let i = 0; i <= 20; i++) {
    const c = waterAt(REEF_PALETTE, i / 20);
    assert.match(c, /^#[0-9a-f]{6}$/, `bad colour at ${i / 20}: ${c}`);
  }
});

test('the water gets darker with depth', () => {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.6 + (n & 255) * 0.1;
  };
  const surface = lum(waterAt(REEF_PALETTE, 0));
  const mid = lum(waterAt(REEF_PALETTE, 0.5));
  const floor = lum(waterAt(REEF_PALETTE, 1));
  assert.ok(surface > mid, `${surface} should be brighter than ${mid}`);
  assert.ok(mid > floor, `${mid} should be brighter than ${floor}`);
});

/* ------------------------------ species ------------------------------ */

test('species ids are unique', () => {
  const ids = SPECIES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every species is described in the field guide groups', () => {
  const grouped = new Set(SPECIES_GROUPS.flatMap((g) => g.ids));
  for (const s of SPECIES) {
    assert.ok(grouped.has(s.id), `${s.id} is missing from SPECIES_GROUPS`);
    assert.equal(SPECIES_BY_ID[s.id], s, `${s.id} is missing from SPECIES_BY_ID`);
  }
  assert.equal(grouped.size, SPECIES.length, 'a group references an unknown species');
});

test('the roster covers every creature the brief asked for', () => {
  const kinds = new Set(SPECIES.map((s) => s.kind));
  for (const kind of [
    'fish', 'octopus', 'turtle', 'shark', 'jelly', 'mermaid', 'squid', 'seahorse', 'ray', 'crab', 'starfish',
  ]) {
    assert.ok(kinds.has(kind as never), `no species of kind "${kind}"`);
  }
});

test('species numbers are sane', () => {
  for (const s of SPECIES) {
    assert.ok(s.size > 0.01 && s.size <= MAX_SIZE + 1e-9, `${s.id}: size ${s.size}`);
    assert.ok(s.baseSpeed > 0 && s.baseSpeed < 200, `${s.id}: baseSpeed ${s.baseSpeed}`);
    assert.ok(s.accel > 0 && s.turn > 0, `${s.id}: accel/turn`);
    // Visitors are not part of the standing cast, so they seed nothing.
    const minPop = s.visitor ? 0 : 1;
    assert.ok(s.population >= minPop && s.population <= 8, `${s.id}: population ${s.population}`);
    assert.ok(s.appetite >= 0 && s.appetite <= 1, `${s.id}: appetite ${s.appetite}`);
    const [lo, hi] = s.band;
    assert.ok(lo >= 0 && hi <= 1 && lo < hi, `${s.id}: band ${lo}..${hi}`);
    for (const [role, hex] of Object.entries(s.colors)) {
      if (hex === undefined) continue;
      assert.match(hex, /^#[0-9a-f]{6}$/, `${s.id}.${role} is not a hex colour: ${hex}`);
    }
    // the outline has to be darker than the body or the art loses its ink line
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
    };
    assert.ok(
      lum(s.colors.outline) < lum(s.colors.body),
      `${s.id}: outline (${s.colors.outline}) is not darker than body (${s.colors.body})`,
    );
  }
});

test('the tank starts with a full cast', () => {
  const total = SPECIES.reduce((n, s) => n + s.population, 0);
  assert.ok(total >= 40, `only ${total} animals at startup`);
  assert.ok(SPECIES.filter((s) => s.kind === 'fish').length >= 10, 'too few fish species');
});

/* ------------------------------ budgeting ------------------------------ */

test('the render buffer stays inside its pixel budget', () => {
  // A retina laptop is the case that used to melt: 5.1 megapixels at dpr 2.
  const laptop = renderDpr(1512, 850, 2);
  assert.ok(laptop < 2, `dpr ${laptop} would fill ${(1512 * 850 * laptop * laptop) / 1e6} Mpx`);
  assert.ok(1512 * 850 * laptop * laptop <= MAX_PIXELS + 1, 'budget exceeded');
  // A small window on a retina screen gets the full ratio.
  assert.equal(renderDpr(900, 600, 2), 2);
  // A 4K display cannot meet the budget without going below the floor, so it
  // takes the floor — a third of the pixels a naive dpr 2 would have cost.
  const huge = renderDpr(3840, 2160, 2);
  assert.equal(huge, MIN_DPR);
  assert.ok(3840 * 2160 * huge * huge < 3840 * 2160 * 4 * 0.2, '4K was not cut back');
  // Never below the floor, whatever is asked for.
  assert.equal(renderDpr(20000, 20000, 1), MIN_DPR);
  assert.equal(renderDpr(1512, 850, 1), 1);
});

/* ------------------------------- movement ------------------------------- */

test('every species declares a known travel mode', () => {
  for (const s of SPECIES) {
    assert.ok(
      s.travel === 'swim' || s.travel === 'cross' || s.travel === 'drift',
      `${s.id}: travel ${s.travel}`,
    );
  }
});

test('the things that swim on tentacles are the ones that climb and sink', () => {
  // "down to up, and sideways, with tentacles pushing" — the cephalopods, the
  // jellies and the mermaid all leave the level lane behind.
  const drifters = SPECIES.filter((s) => s.travel === 'drift').map((s) => s.id).sort();
  assert.deepEqual(drifters, ['jelly-ember', 'jelly-moon', 'mermaid-lagoon', 'octopus-coral', 'squid-opal']);
  for (const s of SPECIES) {
    if (s.travel !== 'drift') continue;
    // a real band to climb through, not a hairline lane
    assert.ok(s.band[1] - s.band[0] >= 0.2, `${s.id}: only ${s.band[1] - s.band[0]} of water to rise through`);
    assert.ok(s.band[1] <= 0.95, `${s.id}: a drifter this low is under the sand`);
  }
});

test('only the rare animals are travellers', () => {
  const crossers = SPECIES.filter((s) => s.travel === 'cross').map((s) => s.id).sort();
  assert.deepEqual(crossers, []);
  // nothing is both rare and part of the standing shoal
  for (const s of SPECIES) {
    if (!s.visitor) continue;
    assert.ok(['shark-reef', 'whale-blue', 'mermaid-lagoon'].includes(s.id), `${s.id} is not one of the rare three`);
  }
});

/* ------------------------------ real scale ------------------------------ */

test('every species declares a real adult length', () => {
  for (const s of SPECIES) {
    assert.ok(Number.isFinite(s.realCm), `${s.id}: realCm is not a number`);
    assert.ok(s.realCm >= 2 && s.realCm <= 3000, `${s.id}: ${s.realCm} cm is not a plausible animal`);
  }
  // the largest real animal should be the largest drawn one
  const byReal = [...SPECIES].sort((a, b) => a.realCm - b.realCm);
  assert.equal(byReal[byReal.length - 1].kind, 'whale', 'the blue whale should be the biggest animal');
  assert.ok(byReal[byReal.length - 1].realCm >= 2000, 'a blue whale is not 20 metres');
});

test('drawn size follows real length, in order', () => {
  const sorted = [...SPECIES].sort((a, b) => a.realCm - b.realCm);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(
      sorted[i].size >= sorted[i - 1].size - 1e-9,
      `${sorted[i].id} (${sorted[i].realCm}cm) is drawn smaller than ${sorted[i - 1].id} (${sorted[i - 1].realCm}cm)`,
    );
  }
});

test('scale is compressed, not literal, and stays legible', () => {
  const small = SIZE.smallest;
  const big = SIZE.largest;
  const realRatio = big.realCm / small.realCm;
  const drawnRatio = big.size / small.size;
  // the real range is far wider than what fits on a screen...
  assert.ok(realRatio > 15, `the real cast is only ${realRatio.toFixed(1)}x — not much to compress`);
  // ...so the drawn range is narrower, but still a real hierarchy
  assert.ok(drawnRatio < realRatio, `drawn ratio ${drawnRatio.toFixed(1)} is not compressed`);
  assert.ok(drawnRatio > 4, `drawn ratio ${drawnRatio.toFixed(1)} flattens the cast into one size`);
  // and the exponent is the single knob that decides it
  assert.ok(SIZE_EXP > 0 && SIZE_EXP < 1, `SIZE_EXP ${SIZE_EXP} is not a compression`);
});

test('fish are small against the tank', () => {
  const fish = SPECIES.filter((s) => s.kind === 'fish');
  for (const s of fish) {
    assert.ok(s.size <= 0.12, `${s.id}: a fish at ${s.size} of the tank height is not small`);
  }
  // ...but not identical: a reef reads as furniture if every fish is one size.
  const sizes = fish.map((s) => s.size);
  assert.ok(Math.max(...sizes) / Math.min(...sizes) >= 3, 'the fish are all about the same size');
  // the largest fish is a real one — a 50cm parrotfish, not a minnow
  const biggest = fish.reduce((a, b) => (a.realCm > b.realCm ? a : b));
  assert.ok(biggest.realCm >= 40, `the biggest fish is only ${biggest.realCm}cm`);
});


test('the whale is a visitor, not a standing member of the cast', () => {
  const whale = SPECIES_BY_ID['whale-blue'];
  assert.ok(whale, 'there is no whale');
  assert.equal(whale.kind, 'whale');
  assert.ok(whale.visitor, 'the whale should arrive on its own schedule');
  assert.equal(whale.population, 0, 'a whale should not be part of the standing population');
  assert.equal(whale.appetite, 0, 'a blue whale does not eat fish food');
  // it is the size clamp, and nothing else, that keeps it on screen
  assert.ok(whale.size >= MAX_SIZE, 'the whale should be the species the clamp is for');
  for (const s of SPECIES) {
    if (s.id === whale.id) continue;
    assert.ok(s.size < whale.size, `${s.id} is drawn at least as large as a blue whale`);
  }
  // and every other animal is comfortably smaller than the ceiling
  const others = SPECIES.filter((s) => s.id !== whale.id).map((s) => s.size);
  assert.ok(Math.max(...others) < MAX_SIZE * 0.4, 'something else is crowding the whale');
});

test('the rare animals are visitors, listed but not seeded', () => {
  const visitors = SPECIES.filter((s) => s.visitor).map((s) => s.id).sort();
  assert.deepEqual(visitors, ['mermaid-lagoon', 'shark-reef', 'whale-blue']);
  const grouped = new Set(SPECIES_GROUPS.flatMap((g) => g.ids));
  for (const id of visitors) {
    assert.ok(grouped.has(id), `${id} is missing from the guide`);
    // a visitor contributes nothing to the standing population, or it would be
    // counted as always-present and stop being rare
    assert.equal(SPECIES_BY_ID[id].population, 0, `${id} is seeded like an ordinary animal`);
  }
});

/* ------------------------------ reporting ------------------------------ */

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${(err as Error).message}`);
  }
}
console.log(`\n${passed}/${tests.length} passed${failed ? `, ${failed} failed` : ''}`);
if (failed > 0) process.exitCode = 1;
