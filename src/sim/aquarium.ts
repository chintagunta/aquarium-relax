import { Rng } from '../core/rng';
import { angleDelta, clamp, damp, dist2, lerp, mixHex, smoothstep, TAU } from '../core/math';
import { NIGHT_PALETTE, Reef, waterAt } from '../world/ocean';
import { SPECIES, SPECIES_BY_ID } from './species';
import type {
  Bubble, Camera, Creature, CreatureKind, Particle, Pellet, Ripple, Species, Vec2, View,
} from './types';

/* ------------------------------------------------------------------ *
 * Tunables, exported so they can be shown in the guide and unit-tested.
 * ------------------------------------------------------------------ */

export const SIM = {
  /** Water drag per second. */
  drag: 0.85,
  /** How strongly a hungry animal commits to a pellet. */
  foodPull: 5.6,
  /** How much harder it can turn while chasing than while cruising. */
  chaseTurn: 1.5,
  /** Speed multiplier closing on a crumb, and easing into the last body length. */
  chaseBurst: 1.8,
  chaseCreep: 0.55,
  /** How far ahead of a sinking crumb a fish aims, in seconds. */
  leadTime: 1,
  /** Turn authority, radians/sec, per unit of species `turn`. */
  turnRate: 2,
  /** How far ahead of the pointer food is thrown. */
  scatter: 46,
  /** Pellets per feeding click. */
  pelletsPerFeed: 12,
  /** Hard cap so the tank never fills up. */
  maxPellets: 160,
  /** Pellets sink at this fraction of the world height per second. */
  sinkRate: 0.055,
  /** How long a fed fish loses interest in the next pellet. */
  satedTime: 3.4,
  /** Neighbour search radius for schooling, as a fraction of tank height. */
  flockRadius: 0.055,
  /** Anything smaller than this panics when a predator is within range. */
  fleeRadius: 0.13,
  /** Below this fraction of the tank height, the sand line matters. */
  floorMargin: 0.02,
  /** Click ripples also nudge life away from the pointer. */
  ripplePush: 46,
  /** How fast the window eases toward where it is being scrolled to. */
  scrollEase: 9,
} as const;

/**
 * How far outside the view the tank keeps living, as a fraction of the viewport
 * width, and how far outside it retires an animal. The gap between the two is
 * the buffer that lets a fish swim in rather than appear.
 */
const POPULATE = 0.24;
const CULL = 0.62;

/**
 * A rare animal's diary. It is not part of the standing population: it turns up
 * on its own schedule, crosses the window it arrives into and leaves, so that a
 * shark or a mermaid stays an event instead of becoming furniture.
 */
interface Guest {
  id: string;
  /** The individual currently in the water, if any. */
  c: Creature | null;
  /** Seconds until the next visit. */
  timer: number;
  /** The first visit, which is always sooner — nobody should have to wait. */
  first: number;
  /** Gap between later visits, in seconds. */
  gap: [number, number];
  /** Lane within the species band, as fractions of the tank height. */
  lane: [number, number];
  notice: string;
}

/* ------------------------------------------------------------------ *
 * Spatial hash — cheap neighbourhood queries, rebuilt each tick.
 * ------------------------------------------------------------------ */

class Grid {
  private cells = new Map<number, Creature[]>();
  private cell: number;

  constructor(cell: number) {
    this.cell = cell;
  }

  clear(): void {
    this.cells.clear();
  }

  private key(cx: number, cy: number): number {
    return (cx + 4096) * 8192 + (cy + 4096);
  }

  insert(c: Creature): void {
    const k = this.key(Math.floor(c.x / this.cell), Math.floor(c.y / this.cell));
    const bucket = this.cells.get(k);
    if (bucket) bucket.push(c);
    else this.cells.set(k, [c]);
  }

  /** Every creature whose cell overlaps the circle. */
  near(x: number, y: number, r: number, out: Creature[]): Creature[] {
    out.length = 0;
    const c0x = Math.floor((x - r) / this.cell);
    const c1x = Math.floor((x + r) / this.cell);
    const c0y = Math.floor((y - r) / this.cell);
    const c1y = Math.floor((y + r) / this.cell);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (bucket) {
          for (const c of bucket) out.push(c);
        }
      }
    }
    return out;
  }
}

/**
 * How much of the frame each rig covers, in body lengths, and how much of that
 * sits *ahead* of the origin. It matters because the art is anchored
 * differently per rig: a fish is drawn from the nose back, so it is entirely
 * behind the point the simulation steers, while a jelly hangs under its bell
 * and a turtle is centred on its shell. Getting this wrong puts animals either
 * visibly through the glass or turning a body length early.
 */
const RIG_EXTENT: Record<CreatureKind, { len: number; ahead: number }> = {
  fish: { len: 1.05, ahead: 0 },
  shark: { len: 1.05, ahead: 0 },
  whale: { len: 1.02, ahead: 0 },
  squid: { len: 1.1, ahead: 0 },
  ray: { len: 1.0, ahead: 0.45 },
  turtle: { len: 0.95, ahead: 0.45 },
  octopus: { len: 1.1, ahead: 0.25 },
  jelly: { len: 1.15, ahead: 0.45 },
  seahorse: { len: 0.8, ahead: 0.2 },
  mermaid: { len: 0.8, ahead: 0.2 },
  crab: { len: 0.9, ahead: 0.45 },
  starfish: { len: 0.9, ahead: 0.45 },
};

/* ------------------------------------------------------------------ *
 * Aquarium
 * ------------------------------------------------------------------ */

export interface FeedStats {
  meals: number;
  pellets: number;
  creatures: number;
}

export class Aquarium {
  rng: Rng;
  reef: Reef;

  creatures: Creature[] = [];
  pellets: Pellet[] = [];
  bubbles: Bubble[] = [];
  ripples: Ripple[] = [];
  particles: Particle[] = [];

  camera: Camera = { x: 0, y: 0, px: 600, py: 400, wx: 600, wy: 400, active: false };
  /** The sliding window onto an endless tank. */
  view: View = { x: 0, target: 0 };

  time = 0;
  meals = 0;
  /** Told when something worth announcing happens, e.g. the whale arriving. */
  onNotice: ((text: string) => void) | null = null;
  /** After dark the palette changes and the reef is relit for it. */
  night = false;
  /** Height of the tank in px — every distance in the sim derives from this. */
  height = 800;
  width = 1200;
  /**
   * The unit an animal's *size* is measured in. Height is the natural choice on
   * a landscape screen, but a phone holds a tall narrow tank, and a turtle
   * sized against the height then takes a third of the width. Capping the unit
   * at the geometric mean of the viewport leaves a laptop pixel-identical and
   * makes a portrait phone about two thirds the size, which is what lets the
   * population still read as a crowd. Distances, bands and speeds stay on
   * `height` — only bodies change.
   */
  unit = 800;

  private grid: Grid;
  private scratch: Creature[] = [];
  /** id -> animal, rebuilt each tick, so a stale crumb claim can be spotted. */
  private byId = new Map<number, Creature>();
  private nextId = 1;
  /** Rotates through the roster so no species starves the spawn budget. */
  private spawnCursor = 0;
  /** The rare animals, each with its own diary. See `visitors()`. */
  private guests: Guest[] = [];
  /** Live count of the drifting dust motes, so ambient() need not scan. */
  private motes = 0;

  constructor(seed = 20260920) {
    this.rng = new Rng(seed);
    this.grid = new Grid(120);
    this.reef = this.growReef();
    this.resetGuests();
  }

  /* --------------------------- lifecycle --------------------------- */

  private growReef(): Reef {
    return new Reef(this.width, this.height, this.rng, this.night ? NIGHT_PALETTE : undefined);
  }

  /**
   * The rare animals and their appointment books. Ids must exist in the species
   * table and carry `visitor: true`, which is what keeps them out of the
   * standing population.
   */
  private resetGuests(): void {
    const book: Array<Omit<Guest, 'c' | 'timer'>> = [
      {
        id: 'whale-blue',
        first: 12,
        gap: [55, 120],
        lane: [0.34, 0.56],
        notice: 'A blue whale drifts past',
      },
      {
        id: 'shark-reef',
        first: 26,
        gap: [45, 95],
        lane: [0.24, 0.5],
        notice: 'A reef shark cruises through',
      },
      {
        id: 'mermaid-lagoon',
        first: 40,
        gap: [60, 130],
        lane: [0.5, 0.78],
        notice: 'The mermaid is back',
      },
    ];
    this.guests = book
      .filter((g) => SPECIES_BY_ID[g.id])
      .map((g) => ({ ...g, c: null, timer: g.first }));
  }

  /**
   * Switch the tank between daylight and moonlight. The reef is rebuilt
   * because its rocks, sand and weed are baked offscreen in the palette's
   * colours; the animals only need re-tinting, which is a colour mix each.
   */
  setNight(on: boolean): void {
    if (this.night === on) return;
    this.night = on;
    this.reef = this.growReef();
    for (const c of this.creatures) {
      c.tintDepth = -1;
      this.applyTint(c);
    }
    // drifting dust reads as plankton after dark, so give it more to show
    this.particles = this.particles.filter((p) => p.kind !== 'sand');
    this.motes = 0;
  }

  resize(width: number, height: number): void {
    const changed = Math.abs(width - this.width) > 2 || Math.abs(height - this.height) > 2;
    if (!changed) return;
    this.width = width;
    this.height = height;
    this.computeUnit();
    if (!this.camera.active) {
      // keep the untouched default pointer somewhere sensible in the tank
      this.camera.px = width * 0.5;
      this.camera.py = height * 0.42;
    }
    this.reef = this.growReef();
    for (const c of this.creatures) {
      // Vertical only: in an endless tank an animal's x is wherever it has
      // swum to, and dragging them all back to the origin on a resize would
      // empty the water in front of the viewer.
      c.y = clamp(c.y, height * 0.05, this.reef.floor(c.x) - height * 0.02);
      // lanes are in pixels and derived from the old height — rebuild them
      const band = this.bandFor(c);
      c.laneY = clamp(c.y, band.top, band.bottom);
      c.laneEndY = clamp(c.laneY, band.top, band.bottom);
    }
    for (const p of this.pellets) {
      p.x = clamp(p.x, 4, width - 4);
      p.y = Math.min(p.y, this.reef.floor(p.x) - 2);
    }
    this.grid = new Grid(Math.max(80, height * 0.12));
  }

  /**
   * Populate the window the viewer is looking at.
   *
   * Fish are spread over a jittered grid rather than dropped at random, so the
   * water reads as a composed scene instead of a scrum in the middle. Only the
   * visible window is seeded; the endless tank beyond it is filled in as you
   * scroll, and by the same spawner that replaces animals which swim away.
   */
  populate(seedCounts = true): void {
    this.creatures = [];
    this.resetGuests();
    this.nextId = 1;
    if (!seedCounts) return;

    const h = this.height;
    const w = this.width;
    const rng = this.rng;
    const ox = this.view.x;
    const fish = SPECIES.filter((s) => s.kind === 'fish' && !s.visitor);

    const cols = clamp(Math.round(w / 168), 3, 7);
    const rows = clamp(Math.round(h / 132), 3, 6);
    const cells: Array<{ x: number; y: number }> = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = ox + ((c + 0.5 + rng.bell() * 0.28) / cols) * w;
        const y = ((r + 0.5 + rng.bell() * 0.26) / rows) * h * 0.84 + h * 0.06;
        cells.push({ x: clamp(x, ox + w * 0.07, ox + w * 0.93), y: clamp(y, h * 0.08, h * 0.84) });
      }
    }
    // shuffle the cells so the roster does not fill them in neat order
    for (let i = cells.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }

    let ci = 0;
    for (const s of fish) {
      // One screen's worth: the margins beyond it are filled by the spawner.
      for (let i = 0; i < s.population; i++) {
        const cell = cells[ci % cells.length];
        ci++;
        const spread = s.flock > 0.8 ? 0.13 : 0.3;
        this.creatures.push(
          this.spawn(s.id, {
            x: clamp(cell.x + rng.bell() * w * spread, ox + w * 0.05, ox + w * 0.95),
            y: clamp(cell.y + rng.bell() * h * spread * 0.8, h * 0.07, h * 0.86),
          }),
        );
      }
    }

    // The large animals are placed on purpose, on the lane each of them holds:
    // turtle and ray down on the sand, the tentacled ones low. The shark, the
    // mermaid and the whale are not seeded at all — they arrive on their own
    // schedule and leave again.
    const big: Array<[string, number, number]> = [
      ['turtle-green', 0.56, 0.66],
      ['ray-spotted', 0.3, 0.8],
      ['octopus-coral', 0.2, 0.76],
      ['octopus-coral', 0.86, 0.7],
      ['squid-opal', 0.66, 0.62],
      ['squid-opal', 0.4, 0.72],
      ['seahorse-gold', 0.13, 0.62],
      ['seahorse-gold', 0.9, 0.5],
      ['jelly-moon', 0.33, 0.66],
      ['jelly-moon', 0.62, 0.74],
      ['jelly-ember', 0.86, 0.6],
      ['jelly-ember', 0.22, 0.78],
      ['crab-reef', 0.28, 0.94],
      ['crab-reef', 0.72, 0.95],
      ['crab-reef', 0.5, 0.92],
      ['starfish-coral', 0.4, 0.96],
      ['starfish-coral', 0.82, 0.93],
    ];
    for (const [id, fx, fy] of big) {
      const x = ox + clamp(fx * w + rng.bell() * w * 0.03, 20, w - 20);
      const ceiling = this.reef.floor(x) - h * 0.015;
      const y = clamp(fy * h + rng.bell() * h * 0.03, 16, ceiling);
      this.creatures.push(this.spawn(id, { x, y }));
    }
  }

  /** Grow a brand-new reef: new rocks, corals, weed — and a new cast. */
  reseed(seed: number): void {
    this.rng = new Rng(seed);
    this.reef = this.growReef();
    this.pellets = [];
    this.bubbles = [];
    this.particles = [];
    this.ripples = [];
    this.meals = 0;
    this.time = 0;
    this.populate();
  }

  /** Add one animal of a species at a random legal spot. */
  spawn(speciesId: string, at?: Vec2): Creature {
    const species = SPECIES.find((s) => s.id === speciesId) ?? SPECIES[0];
    const rng = this.rng;
    const depth = clamp(rng.range(species.band[0], species.band[1]) + rng.bell() * 0.05, 0.03, 1);
    // No `at`: it arrives off the edge of the window and swims in. Nothing is
    // ever placed in the middle of the view — an animal that pops into
    // existence in front of the viewer reads as a glitch, not as a tank.
    const side = rng.chance(0.5) ? -1 : 1;
    const x = at
      ? at.x
      : this.view.x +
        (side < 0 ? -rng.range(0.06, 0.2) : 1 + rng.range(0.06, 0.2)) * this.width;
    const band = this.bandForSpecies(species, x);
    // Bottom dwellers start on the sand; everyone else starts on a random rung
    // of its own band, so a species is never lined up at one depth.
    const y = this.benthicKind(species.kind)
      ? this.reef.floor(x) - this.height * 0.008
      : clamp(at ? at.y : rng.range(band.top, band.bottom), band.top, band.bottom);

    const sizeMul = rng.range(0.86, 1.16);
    // Arrivals already know which way is in; a placed animal picks a heading.
    const dir = at ? (rng.chance(0.5) ? 1 : -1) : -side;
    const speed = species.baseSpeed * (this.height / 800) * rng.range(0.75, 1.2);
    const angle = dir > 0 ? rng.range(-0.2, 0.2) : Math.PI + rng.range(-0.2, 0.2);

    // In an endless tank there is no edge to keep clear of: an animal may
    // perfectly well be introduced off screen and swim in.
    const safeX = x;

    const c: Creature = {
      id: this.nextId++,
      species,
      x: safeX,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      facing: dir,
      pitch: 0,
      depth,
      sizeMul,
      phase: rng.range(0, TAU),
      fin: rng.range(3.2, 5.4),
      state: 'cruise',
      stateTime: 0,
      sated: 0,
      panic: 0,
      tx: x,
      ty: y,
      txTime: rng.range(0, 3),
      laneY: y,
      laneEndY: clamp(
        y + rng.bell() * this.height * 0.3 * (species.travel === 'cross' ? 1 : 0.4),
        band.top,
        band.bottom,
      ),
      tint: rng.next(),
      tintDepth: -1,
      flip: dir,
      a: 0,
      b: rng.next(),
      attention: 0,
      joy: 0,
      target: null,
      bite: 0,
      palette: species.colors,
    };
    this.applyTint(c);
    return c;
  }

  /** Depth-based colour: distant life drifts toward the water colour. */
  private applyTint(c: Creature): void {
    c.tintDepth = c.depth;
    const t = clamp((c.depth - 0.62) / 0.38, 0, 1) * 0.34;
    if (t <= 0.001) {
      c.palette = c.species.colors;
      return;
    }
    const water = waterAt(this.reef.palette, 0.55 + c.depth * 0.4);
    const src = c.species.colors;
    c.palette = {
      body: mixHex(src.body, water, t),
      belly: src.belly ? mixHex(src.belly, water, t * 0.7) : undefined,
      fin: mixHex(src.fin, water, t),
      accent: mixHex(src.accent, water, t * 0.8),
      pattern: mixHex(src.pattern, water, t),
      outline: mixHex(src.outline, water, t * 0.5),
    };
  }

  private computeUnit(): void {
    const geometric = Math.sqrt(Math.max(1, this.width * this.height)) * 0.8;
    this.unit = clamp(Math.min(this.height, geometric), this.height * 0.5, this.height);
  }

  countByKind(kind: string): number {
    let n = 0;
    for (const c of this.creatures) if (c.species.kind === kind) n++;
    return n;
  }

  get stats(): FeedStats {
    return { meals: this.meals, pellets: this.pellets.length, creatures: this.creatures.length };
  }

  /* ---------------------------- interaction ---------------------------- */

  /**
   * Food is thrown around a point (defaults to the pointer); fish come from
   * all over the tank. Returns how many crumbs landed.
   */
  feed(x?: number, y?: number): number {
    const rng = this.rng;
    const cx = x ?? (this.camera.active ? this.camera.wx : this.view.x + this.width * 0.5);
    const cy = y ?? (this.camera.active ? this.camera.wy : this.height * 0.42);
    const n = SIM.pelletsPerFeed;
    let added = 0;
    for (let i = 0; i < n; i++) {
      if (this.pellets.length >= SIM.maxPellets) break;
      const a = rng.range(0, TAU);
      const r = rng.next() * SIM.scatter * (this.height / 800);
      // Relative to the window, not to the world: the tank has no origin to
      // clamp against any more.
      const px = cx + Math.cos(a) * r;
      const py = clamp(cy + Math.sin(a) * r * 0.7, 6, this.reef.floor(px) - 6);
      this.pellets.push({
        x: px,
        y: py,
        vx: Math.cos(a) * rng.range(2, 14),
        vy: rng.range(4, 20),
        r: rng.range(2.4, 4.2) * (this.height / 800),
        life: rng.range(38, 62),
        seed: rng.range(0, TAU),
        eaten: false,
        fresh: 1,
        claim: 0,
      });
      added++;
    }
    return added;
  }

  /** A click also pushes a ripple through the water and startles nearby life. */
  splash(x: number, y: number): void {
    this.ripples.push({ x, y, r: 6, life: 1.4, maxLife: 1.4, strength: 1 });
    const rng = this.rng;
    const s = this.height / 800;
    for (let i = 0; i < 10; i++) {
      const a = rng.range(0, TAU);
      this.bubbles.push({
        x: x + Math.cos(a) * rng.range(2, 16),
        y: y + Math.sin(a) * rng.range(2, 16),
        vx: Math.cos(a) * rng.range(8, 30) * s,
        vy: rng.range(-46, -18) * s,
        r: rng.range(1.4, 4.4) * s,
        wobble: rng.range(0, TAU),
        life: rng.range(1.4, 3.4),
        maxLife: 3.4,
        seed: rng.next(),
      });
    }
    for (let i = 0; i < 12; i++) {
      const a = rng.range(0, TAU);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * rng.range(20, 90) * s,
        vy: Math.sin(a) * rng.range(20, 70) * s - 10,
        r: rng.range(1, 3) * s,
        life: rng.range(0.5, 1.2),
        maxLife: 1.2,
        color: '#eafcff',
        kind: 'sparkle',
        seed: rng.next(),
      });
    }
    // startle: nearby animals scatter for a moment
    const radius = this.height * 0.16;
    this.grid.near(x, y, radius, this.scratch);
    for (const c of this.scratch) {
      const d = Math.sqrt(dist2(x, y, c.x, c.y));
      if (d > radius) continue;
      const push = (1 - d / radius) * SIM.ripplePush * s * (1 + c.species.shy);
      const nx = (c.x - x) / (d || 1);
      const ny = (c.y - y) / (d || 1);
      c.vx += nx * push;
      c.vy += ny * push * 0.6;
      c.panic = Math.max(c.panic, (1 - d / radius) * c.species.shy * 1.4);
      if (c.species.kind === 'fish') c.state = 'flee';
    }
  }

  /** Scroll the window. `snap` skips the easing, for a drag. */
  scrollTo(x: number, snap = false): void {
    this.view.target = x;
    if (snap) this.view.x = x;
  }

  scrollBy(dx: number, snap = false): void {
    this.scrollTo(this.view.target + dx, snap);
  }

  pointer(x: number, y: number, active: boolean): void {
    this.camera.px = x;
    this.camera.py = y;
    this.camera.wx = x + this.view.x;
    this.camera.wy = y;
    this.camera.active = active;
    const nx = (x / this.width - 0.5) * 2;
    const ny = (y / this.height - 0.5) * 2;
    this.camera.x = damp(this.camera.x, clamp(nx, -1, 1) * this.height * 0.02, 2.2, 1 / 60);
    this.camera.y = damp(this.camera.y, clamp(ny, -1, 1) * this.height * 0.014, 2.2, 1 / 60);
  }

  /* ------------------------------ update ------------------------------ */

  update(dt: number): void {
    // Every consumer of `dt` here assumes time only moves forward, so the step
    // is held to that: a negative or absurd delta (a stale timestamp after a
    // blocking call) would un-eat food and shrink growing things.
    dt = clamp(dt, 0, 0.1);
    this.time += dt;

    // Ease the window toward wherever it has been scrolled to. Everything else
    // in the tank reads its position from `view.x`, so the whole reef slides.
    this.view.x = damp(this.view.x, this.view.target, SIM.scrollEase, dt);

    this.grid.clear();
    this.byId.clear();
    for (const c of this.creatures) {
      this.grid.insert(c);
      this.byId.set(c.id, c);
    }

    for (const c of this.creatures) {
      c.stateTime += dt;
      c.sated = Math.max(0, c.sated - dt);
      c.panic = Math.max(0, c.panic - dt * 0.75);
      c.joy = Math.max(0, c.joy - dt * 0.6);
      const a0 = c.attention;
      c.attention = damp(a0, this.attentionFor(c), 2.4, dt);
      this.updateCreature(c, dt);
    }

    this.updatePellets(dt);
    this.updateBubbles(dt);
    this.updateParticles(dt);
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.life -= dt;
      r.r = Math.max(0, r.r + dt * this.height * 0.42);
      if (r.life <= 0) this.ripples.splice(i, 1);
    }
    this.populateAroundView();
    this.visitors(dt);
    this.ambient(dt);
  }

  /** How interesting the pointer is to this animal, 0..1. */
  private attentionFor(c: Creature): number {
    if (!this.camera.active) return Math.max(c.species.kind === 'fish' ? 0 : 0.15, 0);
    const d = Math.sqrt(dist2(c.x, c.y, this.camera.wx, this.camera.wy));
    const r = this.height * (0.1 + c.species.shy * 0.16);
    if (d > r) return 0;
    return 1 - d / r;
  }

  private updateCreature(c: Creature, dt: number): void {
    const s = c.species;
    const kind = s.kind;

    // ---- decide a state
    const hungry = c.sated <= 0 && s.appetite > 0.3;
    if (!hungry) {
      this.release(c);
      if (c.state === 'seek') c.state = 'cruise';
    } else {
      // Hold the crumb already claimed; only look again if it is gone or
      // someone else took it. Re-picking every frame made fish twitch between
      // two equidistant crumbs instead of committing to one.
      const t = c.target;
      if (!t || t.eaten || t.claim !== c.id) this.claim(c);
      if (c.target) {
        c.state = 'seek';
        c.tx = c.target.x;
        c.ty = c.target.y;
      } else if (c.state === 'seek') {
        c.state = 'cruise';
      }
    }

    // ---- mouth opens over the last body length of a chase
    const wantBite = c.state === 'seek' && c.target ? 1 : 0;
    c.bite = damp(c.bite, wantBite, wantBite ? 7 : 4, dt);

    // ---- build a desired velocity for this archetype
    let dx = 0;
    let dy = 0;
    let speed = s.baseSpeed * (this.height / 800) * (0.75 + c.tint * 0.4);
    let turn = s.turn;

    switch (kind) {
      case 'fish':
        ({ dx, dy, speed, turn } = this.fishIntent(c, dx, dy, speed, turn, dt));
        break;
      case 'shark':
        ({ dx, dy, speed, turn } = this.sharkIntent(c, dx, dy, speed, turn));
        break;
      case 'whale':
        ({ dx, dy, speed } = this.whaleIntent(c, dx, dy, speed, dt));
        break;
      case 'jelly':
        ({ dx, dy, speed } = this.jellyIntent(c, dx, dy, speed));
        break;
      case 'squid':
        ({ dx, dy, speed } = this.squidIntent(c, dx, dy, speed, dt));
        break;
      case 'turtle':
        ({ dx, dy, speed, turn } = this.turtleIntent(c, dx, dy, speed, turn));
        break;
      case 'ray':
        ({ dx, dy, speed } = this.rayIntent(c, dx, dy, speed));
        break;
      case 'mermaid':
        ({ dx, dy, speed } = this.mermaidIntent(c, dx, dy, speed, dt));
        break;
      case 'seahorse':
        ({ dx, dy, speed } = this.seahorseIntent(c, dx, dy, speed));
        break;
      case 'octopus':
        ({ dx, dy, speed } = this.octopusIntent(c, dx, dy, speed, dt));
        break;
      case 'crab':
        ({ dx, dy, speed } = this.crabIntent(c, dx, dy, speed, dt));
        break;
      case 'starfish':
        ({ dx, dy, speed } = this.starfishIntent(c, dx, dy, speed, dt));
        break;
      default:
        break;
    }

    // ---- wander when nothing else is happening
    if (c.state !== 'seek') {
      this.travel(c, dt);
      const wa = Math.atan2(c.ty - c.y, c.tx - c.x);
      const d = Math.sqrt(dist2(c.x, c.y, c.tx, c.ty));
      if (d > 1) {
        const pull = 0.55 + 0.45 * Math.min(1, d / (this.height * 0.3));
        dx += Math.cos(wa) * pull;
        dy += Math.sin(wa) * pull;
      }
    }

    // ---- avoid the glass, the surface and the sand
    const edges = this.edgeSteer(c);
    dx += edges.x;
    dy += edges.y;

    // ---- pointer curiosity / shyness
    if (this.camera.active) {
      const d = Math.sqrt(dist2(c.x, c.y, this.camera.wx, this.camera.wy));
      const near = this.height * 0.16;
      if (d < near && kind !== 'starfish') {
        const nx = (c.x - this.camera.wx) / (d || 1);
        const ny = (c.y - this.camera.wy) / (d || 1);
        const push = (1 - d / near) * (0.4 + s.shy * 1.2);
        dx += nx * push;
        dy += ny * push * 0.6;
        if (s.shy > 0.55) c.panic = Math.max(c.panic, (1 - d / near) * 0.6);
      }
    }

    // ---- predators spook the small fry
    // `size` is a fraction of the tank height and `height * 0.2` is pixels, so
    // comparing them exempted nobody: the whale was being startled by sharks
    // and swerving around them. It is the drawn body length that decides who is
    // fry, and an animal the size of the shark has no reason to run from one.
    const spookable =
      kind !== 'shark' &&
      kind !== 'turtle' &&
      kind !== 'ray' &&
      kind !== 'whale' &&
      kind !== 'mermaid' &&
      this.bodyLen(c) < this.height * 0.2;
    if (spookable) {
      const r = this.height * SIM.fleeRadius;
      this.grid.near(c.x, c.y, r, this.scratch);
      for (const o of this.scratch) {
        if (o === c || o.species.kind !== 'shark') continue;
        const d = Math.sqrt(dist2(c.x, c.y, o.x, o.y));
        if (d > r) continue;
        const k = (1 - d / r) * 3.4;
        dx += ((c.x - o.x) / (d || 1)) * k;
        dy += ((c.y - o.y) / (d || 1)) * k * 0.7;
        c.panic = Math.max(c.panic, 1 - d / r);
        if (c.sated <= 0) c.state = 'flee';
      }
    }

    // ---- integrate
    const len = Math.hypot(dx, dy);
    if (len > 0.0001) {
      const desiredVx = (dx / len) * speed;
      const desiredVy = (dy / len) * speed;
      const accel = s.accel * (this.height / 800) * (1 + c.panic * 1.6);
      c.vx = approach(c.vx, desiredVx, accel * dt);
      c.vy = approach(c.vy, desiredVy, accel * dt);
    }
    c.vx *= 1 - SIM.drag * dt * 0.35;
    c.vy *= 1 - SIM.drag * dt * 0.35;
    c.x += c.vx * dt;
    c.y += c.vy * dt;

    // The water column has a top and a bottom, but no sides: an animal is free
    // to swim out of the window and is retired out there, not stopped at it.
    const floor = this.reef.floor(c.x) - this.height * 0.004;
    if (c.y > floor) {
      c.y = floor;
      c.vy = -Math.abs(c.vy) * 0.4;
    }
    if (c.y < this.height * 0.01) {
      c.y = this.height * 0.01;
      c.vy = Math.abs(c.vy) * 0.4;
    }

    // ---- facing and swim cycle
    const speedMag = Math.hypot(c.vx, c.vy);
    const target = normalizeAngle(Math.atan2(c.vy * 0.5, c.vx));
    // Turn authority in radians per second. This used to carry a x3.2 fudge
    // factor on top of the species value, which let a damselfish pivot about
    // five times a second — the single biggest reason the shoal read as
    // sprites being dragged rather than fish swimming.
    const maxTurn = turn * SIM.turnRate * dt;
    c.angle = normalizeAngle(c.angle + clamp(angleDelta(c.angle, target), -maxTurn, maxTurn));

    // ---- which way the art is drawn
    // A fish never rotates through 180 degrees to go back the way it came: it
    // is mirrored, and the only rotation left is the tilt of its nose as it
    // climbs or dives. So it is always seen head first, and turning reads as a
    // flick rather than as a slow pirouette.
    const base = s.baseSpeed * (this.height / 800);
    if (Math.abs(c.vx) > base * 0.12) c.facing = c.vx >= 0 ? 1 : -1;
    else if (c.flip) c.facing = c.flip;
    // The `+ base * 0.25` keeps a fish that has almost stopped from flipping
    // nose-up: at vx near zero the raw ratio is a knife edge.
    const pitchTarget = clamp(Math.atan2(c.vy, Math.abs(c.vx) + base * 0.25), -0.5, 0.5);
    c.pitch = damp(c.pitch, pitchTarget, 5, dt);

    const rate = c.fin * lerp(0.42, 1.8, clamp(speedMag / (s.baseSpeed * (this.height / 800) * 1.2), 0, 1));
    c.phase += rate * dt;
    if (c.phase > TAU * 64) c.phase -= TAU * 64;
    c.b = (c.b + dt * 0.1) % 1;

    // depth slowly settles toward the species band
    const bandMid = (s.band[0] + s.band[1]) * 0.5;
    c.depth = damp(c.depth, clamp(c.y / this.height + (bandMid - 0.5) * 0.2, 0.04, 1), 0.35, dt);
    // Re-tinting means six hex mixes per animal; only worth it when the depth
    // has actually moved enough to see.
    if (Math.abs(c.depth - c.tintDepth) > 0.012) this.applyTint(c);
  }

  /* ---------------------------- intents ---------------------------- */

  private fishIntent(
    c: Creature,
    dx: number,
    dy: number,
    speed: number,
    turn: number,
    dt: number,
  ): { dx: number; dy: number; speed: number; turn: number } {
    const s = c.species;
    if (c.state === 'seek') {
      const p = this.pursue(c);
      dx += p.ax;
      dy += p.ay;
      speed = p.speed;
      turn = p.turn;
      this.biteCheck(c);
    } else if (c.state === 'flee') {
      speed = s.baseSpeed * (this.height / 800) * 1.5;
      if (c.panic < 0.05 && c.stateTime > 1.2) c.state = 'cruise';
    }

    // schooling — a fish with food in sight has no interest in its shoal
    const flock = s.flock;
    if (flock > 0.05 && c.state === 'cruise') {
      const r = this.height * SIM.flockRadius;
      this.grid.near(c.x, c.y, r, this.scratch);
      let cx = 0;
      let cy = 0;
      let ax = 0;
      let ay = 0;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const o of this.scratch) {
        if (o === c || o.species.id !== s.id) continue;
        const d2 = dist2(c.x, c.y, o.x, o.y);
        if (d2 > r * r) continue;
        cx += o.x;
        cy += o.y;
        ax += o.vx;
        ay += o.vy;
        n++;
        const d = Math.sqrt(d2) || 1;
        if (d < r * 0.5) {
          const k = (1 - d / (r * 0.5)) * 1.5;
          sx += ((c.x - o.x) / d) * k;
          sy += ((c.y - o.y) / d) * k;
        }
      }
      if (n > 0) {
        const coh = 0.6 * flock;
        const ali = 0.5 * flock;
        dx += ((cx / n - c.x) / (r || 1)) * coh * 2 + sx;
        dy += ((cy / n - c.y) / (r || 1)) * coh * 2 + sy;
        const mag = Math.hypot(ax, ay) || 1;
        dx += (ax / mag) * ali;
        dy += (ay / mag) * ali;
      }
    }
    void dt;
    return { dx, dy, speed, turn };
  }

  private sharkIntent(
    c: Creature,
    dx: number,
    dy: number,
    speed: number,
    turn: number,
  ): { dx: number; dy: number; speed: number; turn: number } {
    const s = c.species;
    if (c.state === 'seek') {
      const a = Math.atan2(c.ty - c.y, c.tx - c.x);
      dx += Math.cos(a) * 3.2;
      dy += Math.sin(a) * 3.2;
      speed = s.baseSpeed * (this.height / 800) * 1.7;
      turn = s.turn * 1.6;
      if (c.stateTime > 3.4) c.state = 'cruise';
    }
    const base = s.baseSpeed * (this.height / 800);
    speed = c.state === 'seek' ? speed : base * (c.a > 0 ? 1.55 : 1);
    // occasional investigative dash
    if (c.state !== 'seek' && c.a <= 0 && this.rng.next() < 0.0016 * (1 + c.attention)) {
      const target = this.rng.chance(0.5) ? this.camera : undefined;
      if (target && this.camera.active) {
        c.tx = target.wx;
        c.ty = target.wy;
      } else {
        // Relative to the window: an absolute target would send every fish
        // dashing back toward the world origin, which is nowhere near the view
        // once the tank has been scrolled.
        c.tx = this.view.x + this.rng.range(this.width * 0.2, this.width * 0.8);
        c.ty = this.rng.range(this.height * 0.25, this.height * 0.65);
      }
      c.state = 'seek';
      c.stateTime = 0;
    }
    c.a = c.state === 'seek' ? 1 : Math.max(0, c.a - 0.001);
    return { dx, dy, speed, turn };
  }

  private jellyIntent(
    c: Creature,
    dx: number,
    dy: number,
    speed: number,
  ): { dx: number; dy: number; speed: number } {
    // pulse and coast: propulsion only near the top of the contraction, and the
    // contraction lifts the bell — a jelly climbs on the push, then sinks.
    const pulse = Math.cos(c.phase);
    const thrust = Math.max(0, pulse) ** 2;
    speed = c.species.baseSpeed * (this.height / 800) * (0.5 + thrust * 1.9);
    dy += Math.sin(this.time * 0.5 + c.tint * 6) * 0.35 - thrust * 0.75;
    c.a = thrust;
    return { dx, dy, speed };
  }

  private squidIntent(
    c: Creature,
    dx: number,
    dy: number,
    speed: number,
    dt: number,
  ): { dx: number; dy: number; speed: number } {
    const s = c.species;
    // jet: short burst up the arc, then a glide
    c.a = Math.max(0, c.a - dt * 1.6);
    if (c.a <= 0 && this.rng.next() < 0.02) {
      c.a = 1;
      c.stateTime = 0;
      const a = Math.atan2(c.ty - c.y, c.tx - c.x);
      c.vx += Math.cos(a) * 90 * (this.height / 800);
      c.vy += Math.sin(a) * 70 * (this.height / 800) - 34 * (this.height / 800);
      if (c.panic > 0.3 || this.camera.active) {
        // ink puff when startled or when you get too close
        for (let i = 0; i < 5; i++) {
          this.particles.push({
            x: c.x,
            y: c.y,
            vx: this.rng.range(-18, 18),
            vy: this.rng.range(-14, 14),
            r: this.height * this.rng.range(0.006, 0.014),
            life: 2.4,
            maxLife: 2.4,
            color: 'rgba(28,34,60,0.5)',
            kind: 'crumb',
            seed: this.rng.next(),
          });
        }
      }
    }
    if (c.state === 'seek') {
      const p = this.pursue(c);
      dx += p.ax;
      dy += p.ay;
      this.biteCheck(c);
    }
    speed = s.baseSpeed * (this.height / 800) * (0.5 + c.a * 2.2);
    return { dx, dy, speed };
  }

  private turtleIntent(
    c: Creature,
    dx: number,
    dy: number,
    speed: number,
    turn: number,
  ): { dx: number; dy: number; speed: number; turn: number } {
    if (c.state === 'seek' && c.sated <= 0) {
      const p = this.pursue(c);
      dx += p.ax * 0.7;
      dy += p.ay * 0.7;
      speed = p.speed * 0.85;
      turn = p.turn * 0.8;
      this.biteCheck(c);
    } else if (c.sated <= 0) {
      c.state = 'cruise';
    }
    return { dx, dy, speed, turn };
  }

  private rayIntent(
    c: Creature,
    dx: number,
    dy: number,
    speed: number,
  ): { dx: number; dy: number; speed: number } {
    // glides its lane low over the sand, weaving as it goes
    dy += Math.sin(this.time * 0.5 + c.tint * TAU) * 0.4;
    speed = c.species.baseSpeed * (this.height / 800);
    return { dx, dy, speed };
  }

  private mermaidIntent(
    c: Creature,
    dx: number,
    dy: number,
    speed: number,
    dt: number,
  ): { dx: number; dy: number; speed: number } {
    // She crosses the lagoon on her own lane, rising and sinking with each
    // stretch of her tail, and comes over to look if you get close enough.
    c.a = (c.a + dt * 0.85) % 1;
    const beat = Math.max(0, Math.sin(c.a * TAU));
    dy -= beat * 0.5;
    if (this.camera.active && c.attention > 0.25) {
      const a = Math.atan2(this.camera.wy - c.y, this.camera.wx - c.x);
      dx += Math.cos(a) * c.attention * 1.1;
      dy += Math.sin(a) * c.attention * 1.1;
    }
    speed = c.species.baseSpeed * (this.height / 800) * (0.7 + c.attention * 0.6) * (0.85 + beat * 0.3);
    return { dx, dy, speed };
  }

  private seahorseIntent(
    c: Creature,
    dx: number,
    dy: number,
    speed: number,
  ): { dx: number; dy: number; speed: number } {
    // hovers upright, drifting slowly, never in a hurry
    dx += Math.sin(this.time * 0.3 + c.tint * TAU) * 0.4;
    if (c.state === 'seek') {
      const p = this.pursue(c);
      dx += p.ax;
      dy += p.ay;
      speed = p.speed * 1.3;
      this.biteCheck(c);
    } else {
      dy += Math.sin(this.time * 0.5 + c.tint * 5) * 0.5 + 0.06;
      speed = c.species.baseSpeed * (this.height / 800) * 0.5;
    }
    return { dx, dy, speed };
  }

  private octopusIntent(
    c: Creature,
    dx: number,
    dy: number,
    speed: number,
    dt: number,
  ): { dx: number; dy: number; speed: number } {
    // creeps along the rocks, and swims its arc on slow siphon pulses: arms
    // gather, water goes out, and the animal rises as the arms sweep back.
    const pulse = (c.a + dt * 0.5) % 1;
    c.a = pulse;
    const stroke = Math.max(0, Math.sin(pulse * TAU));
    dy -= stroke * 0.6;
    if (c.panic > 0.25) {
      c.a = Math.min(1, c.a + dt * 2);
      const a = Math.atan2(c.y - this.camera.wy, c.x - this.camera.wx);
      dx += Math.cos(a) * 3;
      dy += Math.sin(a) * 3;
      speed = c.species.baseSpeed * (this.height / 800) * 2.4;
      if (this.rng.next() < 0.04) {
        this.particles.push({
          x: c.x,
          y: c.y,
          vx: this.rng.range(-14, 14),
          vy: this.rng.range(-12, 10),
          r: this.height * this.rng.range(0.006, 0.012),
          life: 2.2,
          maxLife: 2.2,
          color: 'rgba(20,16,40,0.45)',
          kind: 'crumb',
          seed: this.rng.next(),
        });
      }
    } else {
      speed = c.species.baseSpeed * (this.height / 800) * (0.55 + stroke * 0.9);
    }
    if (c.state === 'seek') {
      const p = this.pursue(c);
      dx += p.ax * 0.6;
      dy += p.ay * 0.6;
      this.biteCheck(c);
    }
    return { dx, dy, speed };
  }

  /**
   * A whale does not chase crumbs, does not school and does not hurry. It runs
   * its lane at a steady slow pace, and blows when it is near the surface —
   * the bubbles are the tell, so the blow is a real event in the water rather
   * than a drawn-on puff.
   */
  private whaleIntent(
    c: Creature,
    dx: number,
    dy: number,
    speed: number,
    dt: number,
  ): { dx: number; dy: number; speed: number } {
    speed = c.species.baseSpeed * (this.height / 800);
    const before = c.a;
    c.a = (c.a + dt * 0.14) % 1;
    if (before > c.a && c.y < this.height * 0.3 && this.bubbles.length < 120) {
      const blowX = c.x + c.flip * this.bodyLen(c) * 0.24;
      const blowY = c.y - this.bodyLen(c) * 0.05;
      for (let i = 0; i < 7; i++) {
        this.bubbles.push({
          x: blowX + this.rng.range(-6, 6),
          y: blowY + this.rng.range(-4, 4),
          vx: this.rng.range(-14, 14),
          vy: -this.rng.range(30, 70) * (this.height / 800),
          r: this.rng.range(1.6, 4.2) * (this.height / 800),
          wobble: this.rng.range(0, TAU),
          life: this.rng.range(1.6, 3.4),
          maxLife: 3.4,
          seed: this.rng.next(),
        });
      }
    }
    void dx;
    void dy;
    return { dx: 0, dy: 0, speed };
  }

  private crabIntent(
    c: Creature,
    dx: number,
    dy: number,
    speed: number,
    dt: number,
  ): { dx: number; dy: number; speed: number } {
    // scuttles sideways along the sand after any crumb
    const floor = this.reef.floor(c.x);
    c.y = damp(c.y, floor - this.height * 0.006, 4, dt);
    if (c.state === 'seek') {
      dx += Math.sign(c.tx - c.x) * 3;
      speed = c.species.baseSpeed * (this.height / 800) * 1.6;
      c.phase += 3;
      this.biteCheck(c);
    } else {
      speed = c.species.baseSpeed * (this.height / 800) * 0.6;
    }
    // No downward bias: the damp above already holds it on the sand, and
    // pushing down as well just bounces it off the floor clamp every frame.
    return { dx, dy, speed };
  }

  private starfishIntent(
    c: Creature,
    dx: number,
    dy: number,
    speed: number,
    dt: number,
  ): { dx: number; dy: number; speed: number } {
    const floor = this.reef.floor(c.x);
    c.y = damp(c.y, floor - this.height * 0.004, 3, dt);
    speed = c.species.baseSpeed * (this.height / 800) * 0.22;
    return { dx, dy, speed };
  }

  /* -------------------------- shared helpers -------------------------- */

  /**
   * Where an animal holds its depth. Every lane is derived from the species'
   * band, so a goby stays on the sand and a snapper stays in open water.
   */
  private bandForSpecies(species: Species, x: number): { top: number; bottom: number } {
    const [b0, b1] = species.band;
    const top = this.height * (0.05 + b0 * 0.75);
    const bottom = Math.min(
      this.height * (0.1 + b1 * 0.82),
      this.reef.floor(x) - this.height * 0.03,
    );
    return { top, bottom: Math.max(top + 12, bottom) };
  }

  private bandFor(c: Creature): { top: number; bottom: number } {
    return this.bandForSpecies(c.species, c.x);
  }

  /**
   * The traffic system. Fish hold a roughly level lane and travel left or
   * right; jellies, squid and the mermaid run a shallow diagonal lane across
   * the lower tank. Nothing is tied to a spot in the middle, so the water
   * reads as a slice of open ocean rather than a box with walls.
   */
  private travel(c: Creature, dt: number): void {
    const s = c.species;
    const band = this.bandFor(c);
    c.txTime -= dt;

    if (c.txTime <= 0) {
      c.txTime = this.rng.range(3.5, 9);
      if (s.travel === 'cross') {
        // Aim the far end of the lane somewhere else in the band, reflecting
        // off the edges so the sweeps zig-zag instead of all sinking.
        let next = c.laneEndY + this.rng.bell() * this.height * 0.3;
        if (next < band.top) next = band.top + (band.top - next);
        if (next > band.bottom) next = band.bottom - (next - band.bottom);
        c.laneEndY = clamp(next, band.top, band.bottom);
      } else if (this.rng.chance(0.16)) {
        c.flip = -c.flip; // a change of mind: it turns and goes back
      } else {
        c.laneY = clamp(c.laneY + this.rng.bell() * this.height * 0.18, band.top, band.bottom);
      }
    }

    c.tx = c.x + c.flip * this.width * 0.5;
    if (this.benthic(c)) {
      // The sand decides its depth, not the species band — steering it up
      // would only fight the clamps in the crab and starfish intents.
      c.ty = c.y;
    } else if (s.travel === 'cross') {
      // Progress across the *window*, not across the world: measured from the
      // origin, a crosser in a scrolled tank is permanently at the end of its
      // lane and the arch it sweeps disappears.
      const p = clamp((c.x - this.view.x) / Math.max(1, this.width), 0, 1);
      const arch = Math.sin(p * Math.PI) * this.height * 0.05 * Math.sin(c.tint * TAU);
      c.ty = clamp(lerp(c.laneY, c.laneEndY, p) + arch, band.top, band.bottom);
    } else if (s.travel === 'drift') {
      // Tentacle propulsion: down, then up, then sideways. The lane itself
      // rises and falls in a long slow arc around where the animal was put,
      // and the intent only decides how hard it pushes along that arc.
      const swing = c.laneEndY - c.laneY;
      const arc = Math.sin(this.time * 0.34 + c.tint * TAU);
      c.ty = clamp(c.laneY + swing * arc * 0.5 + arc * this.height * 0.1, band.top, band.bottom);
    } else {
      c.ty = c.laneY + Math.sin(this.time * 0.4 + c.tint * TAU) * this.height * 0.014;
    }
  }

  /** Animals that live on the sea bed rather than choosing a depth. */
  private benthic(c: Creature): boolean {
    return this.benthicKind(c.species.kind);
  }

  private benthicKind(kind: CreatureKind): boolean {
    return kind === 'crab' || kind === 'starfish';
  }

  /** How much of the frame this animal covers along its direction of travel. */
  private bodyLen(c: Creature): number {
    return this.unit * c.species.size * c.sizeMul * RIG_EXTENT[c.species.kind].len;
  }

  /** True while the animal is close enough to the view to be worth keeping. */
  private inPlay(c: Creature): boolean {
    const margin = this.width * CULL;
    return c.x > this.view.x - margin && c.x < this.view.x + this.width + margin;
  }

  /**
   * Keep the water populated around wherever the window happens to be.
   *
   * The tank has no far wall any more, so nothing turns around: an animal
   * swims off the edge of the world as far as the viewer is concerned and is
   * retired, and a fresh one is introduced on the other side. That is what
   * makes scrolling worth doing — you are not panning over a fixed cast, you
   * are meeting new animals.
   *
   * Work is spread over frames: at most a handful of arrivals per tick, so a
   * fast scroll never lands as a hitch.
   */
  private populateAroundView(): void {
    const margin = this.width * POPULATE;
    const lo = this.view.x - margin;
    const hi = this.view.x + this.width + margin;

    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      // A rare guest is retired by its own diary, not by the crowd control —
      // though one summoned by hand is nobody's guest and leaves like anyone.
      if (this.guests.some((g) => g.c === c)) continue;
      if (!this.inPlay(c)) {
        this.release(c);
        this.creatures.splice(i, 1);
      }
    }

    // A hard scroll can outrun the traffic: everything that was in front of the
    // viewer is suddenly far behind, and the replacements are still swimming in
    // from off screen. Rather than show a stretch of empty water, call up
    // arrivals directly — but off the edge, never in the middle of the view.
    //
    // They have to *count*, though. The trigger is what the viewer can see plus
    // what is already on its way in, and an arrival parked outside the counted
    // window leaves the tank looking empty, so the top-up fires every frame
    // until five hundred animals. The population ceiling is the belt to that.
    const arrivalMargin = this.width * 0.2;
    let onScreen = 0;
    let inbound = 0;
    const counts = new Map<string, number>();
    for (const c of this.creatures) {
      if (c.x >= this.view.x && c.x <= this.view.x + this.width) onScreen++;
      if (c.x > this.view.x - arrivalMargin && c.x < this.view.x + this.width + arrivalMargin) inbound++;
      if (c.x >= lo && c.x <= hi) counts.set(c.species.id, (counts.get(c.species.id) ?? 0) + 1);
    }
    const ceiling = this.screenTarget() * 2;
    const wanted = this.screenTarget() * 0.55;
    // Arrivals on their way in count for half: that keeps a hard scroll from
    // being treated as an empty tank for the seconds it takes them to arrive,
    // without letting the top-up chase a number it can never see.
    if (onScreen + inbound * 0.5 < wanted && this.creatures.length < ceiling) {
      const picked: Species[] = [];
      for (const s of SPECIES) {
        if (s.visitor) continue;
        for (let i = 0; i < s.population; i++) picked.push(s);
      }
      for (let i = 0; i < 4 && picked.length; i++) {
        const s = this.rng.pick(picked);
        this.creatures.push(this.incoming(s));
      }
    }

    // Work is spread over frames, but a window that is nearly empty is worth
    // hurrying for: it is the difference between a drag that shows water and one
    // that shows a tank.
    let budget = onScreen < wanted * 0.5 ? 6 : 3;
    for (let k = 0; k < SPECIES.length && budget > 0; k++) {
      const s = SPECIES[(this.spawnCursor + k) % SPECIES.length];
      if (s.visitor) continue;
      const want = this.targetFor(s);
      let have = counts.get(s.id) ?? 0;
      while (have < want && budget > 0) {
        this.creatures.push(this.incoming(s));
        have++;
        budget--;
      }
      if (budget < 3) this.spawnCursor = (this.spawnCursor + k + 1) % SPECIES.length;
    }
  }

  /** How many animals one screenful should be holding, across all species. */
  private screenTarget(): number {
    let n = 0;
    for (const s of SPECIES) if (!s.visitor) n += s.population;
    return (n * this.width) / 1500;
  }

  /**
   * How many of a species should be living in the window. The authored
   * `population` was written for one screen, so it is scaled by how many
   * screens the window covers, and every species keeps at least one so a rare
   * animal is still findable by scrolling.
   */
  private targetFor(s: Species): number {
    const screens = (this.width * (1 + 2 * POPULATE)) / 1500;
    return Math.max(1, Math.round(s.population * screens));
  }

  /**
   * A brand-new animal just outside the view, already heading into it.
   *
   * It has to land *inside* the window the spawner counts, or the spawner
   * cannot see it, decides the species is under target, and adds another one
   * every frame until the tank is full of them. POPULATE is that window, and
   * `out` stays comfortably within it while still being off screen.
   */
  private incoming(s: Species): Creature {
    const dir = this.rng.chance(0.5) ? 1 : -1;
    // Close enough that an arrival reaches the glass in a few seconds.
    const out = this.width * 0.2;
    const x = dir > 0 ? this.view.x - out : this.view.x + this.width + out;
    const c = this.spawn(s.id, { x, y: this.height * 0.5 });
    c.flip = dir;
    c.facing = dir;
    c.laneY = clamp(c.y, this.bandFor(c).top, this.bandFor(c).bottom);
    c.laneEndY = clamp(c.laneY + this.rng.bell() * this.height * 0.16, this.bandFor(c).top, this.bandFor(c).bottom);
    const speed = s.baseSpeed * (this.height / 800);
    c.vx = dir * speed;
    c.vy = 0;
    return c;
  }

  /**
   * The public way in: an animal that swims on from off screen. Used by "Add an
   * animal" and by the busier moods, so nothing ever pops into existence in
   * front of the viewer.
   */
  introduce(speciesId: string): Creature {
    const s = SPECIES.find((x) => x.id === speciesId) ?? SPECIES[0];
    return this.incoming(s);
  }

  /**
   * The rare animals keep their own diaries.
   *
   * A shark, a mermaid or a 24 metre whale that was simply always somewhere in
   * view would stop being an event, so each one is held out of the standing
   * population (`visitor` in the species table) and let in on a schedule: it
   * arrives off the edge, crosses the window it arrived into, and leaves. The
   * first visit of each is deliberately early — nobody should have to take it
   * on faith that the tank has a whale in it.
   */
  private visitors(dt: number): void {
    for (const g of this.guests) {
      const here = g.c;
      if (here) {
        if (!this.inPlay(here)) {
          const i = this.creatures.indexOf(here);
          if (i >= 0) this.creatures.splice(i, 1);
          g.c = null;
          // Long enough to stay an event, short enough to see twice in a visit.
          g.timer = this.rng.range(g.gap[0], g.gap[1]);
        }
        continue;
      }
      g.timer -= dt;
      if (g.timer > 0) continue;
      const s = SPECIES_BY_ID[g.id];
      if (!s) continue;
      const c = this.incoming(s);
      // It swims a long, slow, almost level line, rising and dipping a little.
      const band = this.bandFor(c);
      c.laneY = clamp(this.height * this.rng.range(g.lane[0], g.lane[1]), band.top, band.bottom);
      c.laneEndY = clamp(c.laneY + this.rng.bell() * this.height * 0.18, band.top, band.bottom);
      c.y = c.laneY;
      c.txTime = this.rng.range(6, 10);
      this.creatures.push(c);
      g.c = c;
      this.onNotice?.(g.notice);
    }
  }

  private edgeSteer(c: Creature): { x: number; y: number } {
    const mt = this.height * 0.05;
    const floor = this.reef.floor(c.x);
    const mb = this.height * 0.05;
    let x = 0;
    let y = 0;
    // Horizontal steering is only for an animal chasing food. Anyone else is
    // free to swim out of shot — or up to the glass and turn — which `boundary`
    // owns outright. Two systems fighting over the same wall deadlocks.
    // The window, not the world: there is no world origin to steer against any
    // more, and a fixed left/right test against `width` meant every fish past
    // the first screenful was pushed left forever — which quietly stopped them
    // ever closing on a crumb again.
    if (c.state === 'seek') {
      const m = this.width * 0.08;
      const dx0 = c.x - this.view.x;
      if (dx0 < m) x += (1 - dx0 / m) * 2.6;
      if (dx0 > this.width - m) x -= (1 - (this.width - dx0) / m) * 2.6;
    }
    if (c.y < mt) y += (1 - c.y / mt) * 2.6;
    // Floor dwellers are already pinned to the sand by their own intent;
    // pushing them up here only leaves them hovering with an upward velocity.
    if (!this.benthic(c) && c.y > floor - mb) y -= (1 - (floor - c.y) / mb) * 2.2;
    return { x, y };
  }

  /** Distance at which an animal can reach a pellet, in px. */
  private biteReach(c: Creature): number {
    const scale = this.unit * c.species.size * c.sizeMul;
    return Math.max(scale * 0.5, this.height * 0.012) + 3;
  }

  private vision(c: Creature): number {
    const s = c.species;
    switch (s.kind) {
      case 'shark':
        return 0;
      case 'turtle':
      case 'ray':
        return this.height * 0.1;
      case 'crab':
      case 'starfish':
        return this.height * 0.14;
      case 'mermaid':
        return this.height * 0.06;
      default:
        return this.height * (0.22 + s.appetite * 0.18);
    }
  }

  private nearestPellet(c: Creature, radius: number): Pellet | null {
    if (radius <= 0 || this.pellets.length === 0) return null;
    // Bottom dwellers only notice food that has reached the sand.
    const bottomOnly = c.species.kind === 'crab' || c.species.kind === 'starfish';
    let best: Pellet | null = null;
    let bestD = radius * radius;
    for (const p of this.pellets) {
      if (p.eaten) continue;
      // Someone else got there first. A fish will still take a crumb off
      // another fish's nose if it is close enough to touch, but it will not
      // swim across the tank to shadow it, which is what made a feeding click
      // look like a single magnet instead of a scramble. A claim held by an
      // animal that has since left the tank is not a claim at all.
      if (p.claim !== 0 && p.claim !== c.id) {
        const rival = this.byId.get(p.claim);
        if (!rival) {
          p.claim = 0;
        } else if (dist2(c.x, c.y, p.x, p.y) > (this.bodyLen(c) * 1.3 + p.r * 2) ** 2) {
          continue;
        }
      }
      if (bottomOnly) {
        const floor = this.reef.floor(p.x);
        if (p.y < floor - this.height * 0.035) continue;
      }
      const d = dist2(c.x, c.y, p.x, p.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Commit to a crumb: hold it until it is eaten, gone, or taken. */
  private claim(c: Creature): void {
    this.release(c);
    const target = this.nearestPellet(c, this.vision(c));
    if (target) {
      target.claim = c.id;
      c.target = target;
    }
  }

  private release(c: Creature): void {
    if (c.target && c.target.claim === c.id) c.target.claim = 0;
    c.target = null;
  }

  /**
   * Steering for an animal that has decided to eat a particular crumb.
   *
   * Two things separate this from a magnet. The aim point is where the crumb
   * *will* be by the time the fish arrives — crumbs sink and sway, so pointing
   * straight at them makes a fish curve along behind and orbit. And speed eases
   * off over roughly the last body length, so it closes and takes the crumb
   * instead of ramming through it and shooting past.
   */
  private pursue(c: Creature): { ax: number; ay: number; speed: number; turn: number } {
    const s = c.species;
    const base = s.baseSpeed * (this.height / 800);
    const p = c.target;
    if (!p) return { ax: 0, ay: 0, speed: base, turn: s.turn };

    const d = Math.sqrt(dist2(c.x, c.y, p.x, p.y));
    const eta = Math.min(SIM.leadTime, d / Math.max(40, base * 1.6));
    const aimX = p.x + p.vx * eta;
    const aimY = p.y + p.vy * eta;
    const a = Math.atan2(aimY - c.y, aimX - c.x);

    const reach = Math.max(this.bodyLen(c) * 1.1, this.height * 0.05);
    const ease = smoothstep(clamp(d / reach, 0, 1));
    return {
      ax: Math.cos(a) * SIM.foodPull,
      ay: Math.sin(a) * SIM.foodPull,
      speed: base * lerp(SIM.chaseCreep, SIM.chaseBurst, ease),
      turn: s.turn * lerp(1.1, SIM.chaseTurn, ease),
    };
  }

  /** Eat if the committed crumb is within reach. */
  private biteCheck(c: Creature): boolean {
    const p = c.target;
    if (!p || p.eaten) return false;
    const reach = this.biteReach(c);
    if (dist2(c.x, c.y, p.x, p.y) > reach * reach) return false;
    this.eat(c, p.x, p.y);
    return true;
  }

  private eat(c: Creature, x: number, y: number): void {
    let eaten: Pellet | null = null;
    const reach = this.biteReach(c);
    for (const p of this.pellets) {
      if (p.eaten) continue;
      if (dist2(p.x, p.y, x, y) < reach * reach * 1.6) {
        p.eaten = true;
        eaten = p;
        break;
      }
    }
    if (!eaten) return;
    if (eaten.claim === c.id) eaten.claim = 0;
    this.release(c);
    this.meals++;
    c.sated = SIM.satedTime * (c.species.kind === 'shark' ? 0.2 : 1);
    c.joy = 1;
    c.state = 'cruise';
    const rng = this.rng;
    const s = this.height / 800;
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, TAU);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * rng.range(10, 40) * s,
        vy: Math.sin(a) * rng.range(10, 30) * s,
        r: rng.range(1, 2.4) * s,
        life: rng.range(0.4, 0.9),
        maxLife: 0.9,
        color: rng.chance(0.5) ? '#ffd977' : '#fff3d0',
        kind: 'crumb',
        seed: rng.next(),
      });
    }
    if (c.species.kind === 'fish' && c.species.size > this.height * 0.08) {
      this.particles.push({
        x: c.x,
        y: c.y - this.height * 0.05,
        vx: 0,
        vy: -18 * s,
        r: this.height * 0.012,
        life: 1.3,
        maxLife: 1.3,
        color: '#ff6b9d',
        kind: 'heart',
        seed: rng.next(),
      });
    }
  }

  /* --------------------------- pellets/life --------------------------- */

  private updatePellets(dt: number): void {
    const sink = this.height * SIM.sinkRate;
    for (let i = this.pellets.length - 1; i >= 0; i--) {
      const p = this.pellets[i];
      if (p.eaten) {
        this.pellets.splice(i, 1);
        continue;
      }
      p.life -= dt;
      p.fresh = Math.max(0, p.fresh - dt * 1.4);
      const floor = this.reef.floor(p.x);
      const onFloor = p.y >= floor - 2;
      if (!onFloor) {
        p.vy = damp(p.vy, sink, 1.6, dt);
        p.vx = damp(p.vx, Math.sin(this.time * 1.6 + p.seed) * 7, 1.1, dt);
      } else {
        p.y = floor - 1.5;
        p.vy = 0;
        p.vx = damp(p.vx, 0, 3, dt);
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // crumbs bounce off the glass either side of the viewer
      const left = this.view.x + 2;
      const right = this.view.x + this.width - 2;
      if (p.x < left || p.x > right) p.vx *= -0.6;
      // food slowly dissolves so the tank self-cleans
      if (p.life <= 0) this.pellets.splice(i, 1);
    }
  }

  private updateBubbles(dt: number): void {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.life -= dt;
      b.vy = damp(b.vy, -this.height * 0.055, 1.2, dt);
      b.vx = damp(b.vx, Math.sin(this.time * 2 + b.wobble) * 12, 0.8, dt);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.wobble += dt * 3;
      if (b.life <= 0 || b.y < -10) this.bubbles.splice(i, 1);
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'crumb') {
        p.vx = damp(p.vx, 0, 1.2, dt);
        p.vy = damp(p.vy, -12 * (this.height / 800), 1, dt);
        p.r = Math.max(0.6, p.r + dt * this.height * 0.004);
      } else if (p.kind === 'heart') {
        p.vy = damp(p.vy, -22 * (this.height / 800), 1.4, dt);
      } else {
        p.vx *= 1 - dt * 2;
        p.vy = damp(p.vy, 6, 1, dt);
      }
      if (p.life <= 0) {
        if (p.kind === 'sand') this.motes--;
        this.particles.splice(i, 1);
      }
    }
  }

  /** Ambient life: dust, drifting bubbles from the reef, occasional fry. */
  private ambient(dt: number): void {
    const rng = this.rng;
    void dt;
    const want = this.height > 700 ? 70 : 44;
    if (this.motes < want && rng.next() < 0.5) {
      this.motes++;
      const dustX = this.view.x + rng.range(0, this.width);
      this.particles.push({
        x: dustX,
        y: rng.range(0, this.reef.floor(dustX)),
        vx: rng.range(-6, 6) * (this.height / 800),
        vy: rng.range(-3, 3) * (this.height / 800),
        r: rng.range(0.6, 1.8) * (this.height / 800),
        life: rng.range(9, 22),
        maxLife: 22,
        color: 'rgba(255,255,255,0.5)',
        kind: 'sand',
        seed: rng.next(),
      });
    }
    // The vents are baked once per tile, so their stored x is tile-local: the
    // copy that belongs in the tile being looked at is the one to breathe from,
    // otherwise every stream in the tank is back at the world origin.
    const tile = this.reef.tile;
    const viewMid = this.view.x + this.width * 0.5;
    for (const v of this.reef.vents) {
      const vx = v.x + Math.round((viewMid - v.x) / tile) * tile;
      if (rng.next() < v.rate * dt * 2.2) {
        this.bubbles.push({
          x: vx + rng.range(-8, 8),
          y: v.y,
          vx: rng.range(-6, 6),
          vy: -rng.range(24, 52) * (this.height / 800),
          r: rng.range(1.2, 3.6) * (this.height / 800),
          wobble: rng.range(0, TAU),
          life: rng.range(3, 7),
          maxLife: 7,
          seed: rng.next(),
        });
      }
    }
    if (this.bubbles.length > 140) this.bubbles.splice(0, this.bubbles.length - 140);
    if (this.particles.length > 260) {
      const dropped = this.particles.splice(0, this.particles.length - 260);
      for (const p of dropped) if (p.kind === 'sand') this.motes--;
    }
  }

  /* ------------------------------ queries ------------------------------ */

  /** Nearest animal to the pointer — used by the guide readout. */
  pick(x: number, y: number): Creature | null {
    let best: Creature | null = null;
    let bestD = (this.height * 0.09) ** 2;
    for (const c of this.creatures) {
      const r = this.unit * c.species.size * c.sizeMul * 0.5;
      const d = dist2(x, y, c.x, c.y);
      if (d < Math.max(bestD, r * r)) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }
}

/* ------------------------------------------------------------------ *
 * Small vector helpers
 * ------------------------------------------------------------------ */

function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

function normalizeAngle(a: number): number {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x < -Math.PI) x += TAU;
  return x;
}
