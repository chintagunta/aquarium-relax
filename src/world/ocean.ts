import { Rng } from '../core/rng';
import { clamp, lighten, mixHex, withAlpha } from '../core/math';
import { dot, type Ctx } from '../art/art';

/** Samples in the sand-line lookup table. Density matters, not count. */
const LUT_N = 1024;

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */

export interface OceanPalette {
  /** Vertical water column, surface -> sea floor. */
  stops: Array<[number, string]>;
  deepTint: string;
  sand: string;
  sandDark: string;
  sandLight: string;
  rock: string;
  rockDark: string;
  rockLight: string;
  coral: string[];
  weed: string[];
  ray: string;
  bloom: string;
  /**
   * Multiplier on the sun/moon bloom and the shafts of light. Daylight is 1;
   * moonlight is far weaker, and the wide shafts that read as sunbeams in a
   * bright tank read as a smudge once everything around them goes dark.
   */
  rayGain?: number;
}

export const REEF_PALETTE: OceanPalette = {
  stops: [
    [0.0, '#25c2ee'],
    [0.16, '#11b3e2'],
    [0.42, '#0596cf'],
    [0.68, '#0d7fbd'],
    [0.86, '#136da8'],
    [1.0, '#0d5b93'],
  ],
  deepTint: '#0b5288',
  sand: '#f2d9a4',
  sandDark: '#d7b478',
  sandLight: '#fff0cb',
  rock: '#2f6b7c',
  rockDark: '#1f4e60',
  rockLight: '#57a3a6',
  coral: ['#ff7d6b', '#ffb45c', '#e5619a', '#8f6bd8', '#3fc9b0', '#ff9ec4'],
  weed: ['#2f8f6a', '#3fae72', '#57c27f', '#1f7a63'],
  ray: '#eafcff',
  bloom: '#d8f7ff',
};

/**
 * After dark. Same scene, one light source swapped for another: the sun blooms
 * out and a moon takes over, the water goes indigo, and everything that was
 * being lit now has to light itself. Because the whole water pass is
 * palette-driven, recolouring the god rays, the caustics, the sand and the
 * rocks costs one object swap and no per-frame work at all.
 */
export const NIGHT_PALETTE: OceanPalette = {
  stops: [
    [0.0, '#123a6b'],
    [0.16, '#10325f'],
    [0.42, '#0c2a55'],
    [0.68, '#0a2249'],
    [0.86, '#081c3e'],
    [1.0, '#05132e'],
  ],
  deepTint: '#04102a',
  sand: '#5d7099',
  sandDark: '#3f5075',
  sandLight: '#8398bd',
  rock: '#1b3350',
  rockDark: '#0f2035',
  rockLight: '#33587a',
  coral: ['#a84e58', '#b07a45', '#9c4a70', '#5f4a94', '#2f8a80', '#a86a8c'],
  weed: ['#1c5a52', '#256b58', '#2f7d62', '#14454a'],
  ray: '#bcd4ff',
  bloom: '#8fb4ff',
  rayGain: 0.42,
};

/** Colour of the water at a given depth, used to tint distant life. */
export function waterAt(palette: OceanPalette, t: number): string {
  const x = clamp(t, 0, 1);
  for (let i = 0; i < palette.stops.length - 1; i++) {
    const [p0, c0] = palette.stops[i];
    const [p1, c1] = palette.stops[i + 1];
    if (x >= p0 && x <= p1) {
      return mixHex(c0, c1, (x - p0) / Math.max(0.0001, p1 - p0));
    }
  }
  return palette.stops[palette.stops.length - 1][1];
}

/* ------------------------------------------------------------------ *
 * Animated reef pieces
 * ------------------------------------------------------------------ */

export interface Kelp {
  x: number;
  y: number;
  h: number;
  segs: number;
  w: number;
  color: string;
  phase: number;
  lean: number;
}

export interface CoralFan {
  x: number;
  y: number;
  r: number;
  color: string;
  ribs: number;
  phase: number;
  lean: number;
}

export interface Anemone {
  x: number;
  y: number;
  r: number;
  color: string;
  phase: number;
  tendrils: number;
}

export interface Chest {
  x: number;
  y: number;
  s: number;
}

export interface Vent {
  x: number;
  y: number;
  rate: number;
  seed: number;
}

export interface Stone {
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: string;
  dark: string;
  light: string;
  rot: number;
  /** Grain speckles in local coordinates. */
  specks: Array<[number, number, number]>;
}

/* ------------------------------------------------------------------ *
 * The reef: static art cached to offscreen canvases, animated pieces
 * kept as data so they can sway every frame.
 * ------------------------------------------------------------------ */

export class Reef {
  readonly palette: OceanPalette;
  /**
   * The reef repeats every `tile` pixels, so the tank can be scrolled forever
   * without ever reaching an edge. Everything the reef places — sand line,
   * rocks, coral, kelp, weed, the chest — is authored inside one tile and drawn
   * with the wrapped copies, and the sand line is built from sine waves whose
   * periods all divide the tile, so the seam is exact rather than fudged.
   */
  tile = 2400;
  /** Sampled sand line over one tile; index `LUT_N` repeats index 0. */
  private floorLut = new Float64Array(1);
  private baseY = 0;
  private width = 0;
  private height = 0;

  deep: HTMLCanvasElement | null = null;
  mid: HTMLCanvasElement | null = null;
  /** The soft foreground sand strip, drawn over the animals' feet. */
  sandCanvas: HTMLCanvasElement | null = null;

  kelp: Kelp[] = [];
  fans: CoralFan[] = [];
  anemones: Anemone[] = [];
  chest: Chest = { x: 0, y: 0, s: 1 };
  vents: Vent[] = [];
  private sandSpecks: Array<[number, number, number, number]> = [];
  private coralClusters: Array<{ x: number; y: number; r: number; color: string; phase: number }> = [];
  private rng: Rng;

  constructor(width: number, height: number, rng: Rng, palette: OceanPalette = REEF_PALETTE) {
    this.rng = rng;
    this.palette = palette;
    this.build(width, height);
  }

  /* --------------------------- geometry --------------------------- */

  private build(width: number, height: number): void {
    this.width = width;
    this.height = height;
    // Wide enough that a viewport never sees the same stretch twice.
    this.tile = Math.max(2200, Math.round(width * 2));
    const rng = this.rng;
    const tile = this.tile;
    // The sand line sits slightly high so the sea bed — and the animals that
    // live on it — stay above the control bar on a laptop screen.
    this.baseY = height * 0.87;

    // Sand line: gentle dunes, every frequency an integer multiple of the
    // tile, so it joins itself perfectly wherever you scroll to.
    this.floorLut = new Float64Array(LUT_N + 1);
    for (let i = 0; i <= LUT_N; i++) {
      const t = (i / LUT_N) * Math.PI * 2;
      this.floorLut[i] =
        this.baseY +
        Math.sin(t + 0.6) * height * 0.018 +
        Math.sin(t * 2 + 2.1) * height * 0.009 +
        Math.sin(t * 3 - 0.4) * height * 0.006 +
        Math.sin(t * 5 + 1.3) * height * 0.003;
    }

    this.sandSpecks = [];
    for (let i = 0; i < 420; i++) {
      this.sandSpecks.push([rng.next() * tile, rng.range(0.55, 1), rng.range(0.6, 2.2), rng.next()]);
    }

    // Kelp beds. Spread evenly across the tile: the old version clustered them
    // towards the edges of a single screen to keep the middle open, but in an
    // endless reef that just leaves a bald patch in the centre of every tile.
    this.kelp = [];
    const kelpCount = Math.round(clamp(tile / 110, 12, 34));
    for (let i = 0; i < kelpCount; i++) {
      const x = (i + rng.range(0.1, 0.9)) * (tile / kelpCount);
      this.kelp.push({
        x,
        y: this.floorAt(x) + rng.range(0, 10),
        h: height * rng.range(0.18, 0.42),
        segs: rng.int(4, 6),
        w: height * rng.range(0.006, 0.013),
        color: rng.pick(this.palette.weed),
        phase: rng.range(0, Math.PI * 2),
        lean: rng.range(-0.24, 0.24),
      });
    }

    // Sea fans, mostly on the rock walls.
    this.fans = [];
    const fanCount = Math.round(clamp(tile / 150, 9, 26));
    for (let i = 0; i < fanCount; i++) {
      const x = (i + rng.range(0.1, 0.9)) * (tile / fanCount);
      this.fans.push({
        x,
        y: this.floorAt(x) - height * rng.range(0.02, 0.12),
        r: height * rng.range(0.05, 0.11),
        color: rng.pick(this.palette.coral),
        ribs: rng.int(7, 12),
        phase: rng.range(0, Math.PI * 2),
        lean: rng.range(-0.4, 0.4),
      });
    }

    this.anemones = [];
    const anemCount = Math.round(clamp(tile / 380, 5, 12));
    for (let i = 0; i < anemCount; i++) {
      const x = rng.range(tile * 0.04, tile * 0.96);
      this.anemones.push({
        x,
        y: this.floorAt(x) + height * 0.004,
        r: height * rng.range(0.022, 0.042),
        color: rng.pick(this.palette.coral),
        phase: rng.range(0, Math.PI * 2),
        tendrils: rng.int(9, 15),
      });
    }

    this.coralClusters = [];
    for (let i = 0; i < Math.round(clamp(tile / 300, 6, 16)); i++) {
      const x = rng.range(tile * 0.03, tile * 0.97);
      this.coralClusters.push({
        x,
        y: this.floorAt(x),
        r: height * rng.range(0.035, 0.075),
        color: rng.pick(this.palette.coral),
        phase: rng.range(0, Math.PI * 2),
      });
    }

    // One treasure chest per tile, so one turns up every couple of screens.
    const chestX = tile * rng.range(0.2, 0.8);
    this.chest = { x: chestX, y: this.floorAt(chestX), s: height * 0.0016 };

    this.vents = [
      { x: chestX - tile * 0.006, y: this.floorAt(chestX) - height * 0.01, rate: 0.5, seed: rng.next() },
      { x: tile * rng.range(0.4, 0.6), y: this.floorAt(tile * 0.5), rate: 0.22, seed: rng.next() },
    ];

    this.paintLayers();
  }

  /**
   * Height of the sand at any world x, scrolling or not — the tile is looked
   * up rather than interpolated across a fixed tank, so the sea bed runs on
   * forever and joins itself exactly at every tile boundary.
   */
  private floorAt(x: number): number {
    const t = ((x % this.tile) + this.tile) % this.tile;
    const f = (t / this.tile) * LUT_N;
    const i = Math.floor(f);
    const a = this.floorLut[i];
    const b = this.floorLut[i + 1];
    return a + (b - a) * (f - i);
  }

  /** Public: where the sand surface is under a given x. */
  floor(x: number): number {
    return this.floorAt(x);
  }

  /* --------------------------- rendering --------------------------- */

  private makeLayer(scale: number, w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(w * scale));
    canvas.height = Math.max(1, Math.ceil(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.scale(scale, scale);
    return { canvas, ctx };
  }

  /**
   * Paint the three static layers, each exactly one tile wide.
   *
   * Anything that crosses the left or right edge of a tile is drawn again one
   * tile over, so the layer joins itself and can be scrolled forever. Things
   * that have to be *continuous* across the seam — the sand line, the distant
   * rock ridge — are written as periodic functions of x rather than as random
   * walks, because a walk cannot be made to land back where it started.
   */
  private paintLayers(): void {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    const tile = this.tile;
    const h = this.height;
    const wrap = [0, -tile, tile];

    /* ---- far layer: silhouette rocks + dark distant reef ---- */
    {
      // Baked at 0.6x on purpose: this layer is meant to be soft and out of
      // focus, and upscaling it 1.7x buys that defocus for free. Blurring it
      // per frame with ctx.filter cost ~900ms a frame at 5 megapixels and
      // could take the whole tab down with it.
      const { canvas, ctx } = this.makeLayer(0.6, tile, h * 1.15);
      const rng = new Rng(0x5eed1);
      ctx.save();
      ctx.translate(0, h * 0.075);

      // A distant rock ridge, kept low and hazy so it reads as depth rather
      // than as a shape in its own right. Periodic, so it has no seam.
      ctx.beginPath();
      ctx.moveTo(0, h * 1.1);
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * tile;
        const t = (i / steps) * Math.PI * 2;
        const y =
          h *
          (0.8 +
            Math.sin(t * 2 + 0.7) * 0.055 +
            Math.sin(t * 3 - 1.1) * 0.035 +
            Math.sin(t * 7 + 2.4) * 0.022 +
            Math.sin(t * 11 + 0.3) * 0.012);
        if (i === 0) ctx.lineTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(tile, h * 1.1);
      ctx.closePath();
      ctx.fillStyle = withAlpha(this.palette.rockDark, 0.34);
      ctx.fill();

      // a few dark coral silhouettes
      for (let i = 0; i < 26; i++) {
        const cx = rng.range(0, tile);
        const cy = h * rng.range(0.88, 0.99);
        const r = h * rng.range(0.018, 0.05);
        for (const dx of wrap) {
          ctx.beginPath();
          ctx.moveTo(cx + dx - r, cy);
          ctx.bezierCurveTo(cx + dx - r * 0.4, cy - r * 2.2, cx + dx + r * 0.4, cy - r * 2.2, cx + dx + r, cy);
          ctx.closePath();
          ctx.fillStyle = withAlpha('#0a3f63', 0.34);
          ctx.fill();
        }
      }
      ctx.restore();
      this.deep = canvas;
    }

    /* ---- mid layer: rock formations, corals, sea bed ---- */
    {
      // Baked a little under the device ratio — the slight softness reads as
      // water between you and the rocks, and it keeps the composite cheap on
      // big displays.
      const { canvas, ctx } = this.makeLayer(clamp(dpr, 1, 1.35), tile, h * 1.1);
      const rng = new Rng(0x5eed2);
      ctx.save();
      ctx.translate(0, h * 0.03);

      const stones = this.makeStones(rng, tile, h);
      for (const s of stones) {
        for (const dx of wrap) this.paintStone(ctx, { ...s, x: s.x + dx }, h);
      }
      for (const c of this.coralClusters) {
        for (const dx of wrap) this.paintCoralCluster(ctx, c.x + dx, c.y, c.r, c.color, rng);
      }
      // The sea bed is a periodic function of x, so one pass covers the tile.
      this.paintSand(ctx, tile, h, rng, stones);
      ctx.restore();
      this.mid = canvas;
    }

    /* ---- floor layer: the soft foreground sand the animals sit on ---- */
    {
      const { canvas, ctx } = this.makeLayer(clamp(dpr, 1, 1.5), tile, h * 0.24);
      const rng = new Rng(0x5eed3);
      ctx.translate(0, -h * 0.76);
      this.paintSand(ctx, tile, h, rng, []);
      ctx.restore();
      this.sandCanvas = canvas;
    }
  }

  private makeStones(rng: Rng, w: number, h: number): Stone[] {
    const stones: Stone[] = [];
    const count = Math.round(clamp(w / 190, 5, 13));
    for (let i = 0; i < count; i++) {
      const edge = rng.chance(0.62);
      const x = edge
        ? rng.chance(0.5)
          ? rng.range(-w * 0.02, w * 0.24)
          : rng.range(w * 0.74, w * 1.03)
        : rng.range(w * 0.2, w * 0.8);
      const rx = h * rng.range(0.024, 0.075);
      const ry = rx * rng.range(0.5, 0.85);
      const shade = rng.range(-0.1, 0.16);
      stones.push({
        x,
        y: this.floorAt(clamp(x, 0, w)) - ry * rng.range(0.1, 0.5),
        rx,
        ry,
        color: mixHex(this.palette.rock, shade > 0 ? this.palette.rockLight : this.palette.rockDark, Math.abs(shade)),
        dark: this.palette.rockDark,
        light: this.palette.rockLight,
        rot: rng.range(-0.2, 0.2),
        specks: Array.from({ length: 14 }, () => [
          rng.range(-1, 1),
          rng.range(-1, 1),
          rng.range(0.02, 0.09),
        ] as [number, number, number]),
      });
    }
    return stones;
  }

  private paintStone(ctx: Ctx, s: Stone, h: number): void {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    // bulky bottom shape
    ctx.beginPath();
    ctx.moveTo(-s.rx, 0);
    ctx.bezierCurveTo(-s.rx * 1.05, -s.ry * 1.2, -s.rx * 0.5, -s.ry * 1.9, 0, -s.ry * 1.75);
    ctx.bezierCurveTo(s.rx * 0.55, -s.ry * 1.65, s.rx * 1.08, -s.ry * 1.05, s.rx, 0);
    ctx.lineTo(s.rx, s.ry * 0.6);
    ctx.lineTo(-s.rx, s.ry * 0.6);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.lineWidth = h * 0.0012;
    ctx.strokeStyle = withAlpha(s.dark, 0.85);
    ctx.stroke();
    // top light
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(-s.rx * 0.15, -s.ry * 1.25, s.rx * 0.8, s.ry * 0.42, -0.1, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(s.light, 0.45);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s.rx * 0.35, s.ry * 0.15, s.rx * 0.9, s.ry * 0.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(s.dark, 0.35);
    ctx.fill();
    for (const [sx, sy, sr] of s.specks) {
      dot(ctx, sx * s.rx, sy * s.ry - s.ry * 0.5, sr * s.rx * 0.5);
      ctx.fillStyle = withAlpha(s.dark, 0.3);
      ctx.fill();
    }
    ctx.restore();
    // algae fringe
    ctx.beginPath();
    ctx.moveTo(-s.rx, 0);
    ctx.quadraticCurveTo(0, -s.ry * 0.25, s.rx, 0);
    ctx.lineWidth = h * 0.0022;
    ctx.strokeStyle = withAlpha(this.palette.weed[0], 0.75);
    ctx.stroke();
    ctx.restore();
  }

  private paintCoralCluster(ctx: Ctx, x: number, y: number, r: number, color: string, rng: Rng): void {
    ctx.save();
    ctx.translate(x, y);
    const arms = rng.int(5, 9);
    for (let i = 0; i < arms; i++) {
      const a = -Math.PI / 2 + (i - (arms - 1) / 2) * 0.24 + rng.range(-0.06, 0.06);
      const len = r * rng.range(0.8, 1.9);
      const w = r * rng.range(0.07, 0.14);
      ctx.save();
      ctx.rotate(a + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.quadraticCurveTo(-w * 0.7, -len * 0.6, -w * 0.25, -len);
      ctx.quadraticCurveTo(0, -len * 1.14, w * 0.25, -len);
      ctx.quadraticCurveTo(w * 0.7, -len * 0.6, w, 0);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = r * 0.03;
      ctx.strokeStyle = withAlpha('#3a1030', 0.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, -len, w * 0.3, w * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = lighten(color, 0.35);
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.8, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(this.palette.sandDark, 0.5);
    ctx.fill();
    ctx.restore();
  }

  private paintSand(ctx: Ctx, w: number, h: number, rng: Rng, stones: Stone[]): void {
    // main sand body following the dune line
    ctx.beginPath();
    ctx.moveTo(0, h * 1.2);
    ctx.lineTo(0, this.floorAt(0));
    const n = Math.max(24, Math.round(w / 40));
    for (let i = 0; i < n; i++) {
      const x0 = (i / n) * w;
      const x1 = ((i + 1) / n) * w;
      const y0 = this.floorAt(x0);
      const y1 = this.floorAt(x1);
      ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 - h * 0.004, x1, y1);
    }
    ctx.lineTo(w, h * 1.2);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, this.floorAt(0) - h * 0.02, 0, h * 1.15);
    grad.addColorStop(0, this.palette.sandLight);
    grad.addColorStop(0.18, this.palette.sand);
    grad.addColorStop(0.7, this.palette.sandDark);
    grad.addColorStop(1, mixHex(this.palette.sandDark, '#8a6a3c', 0.5));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.save();
    ctx.clip();
    // ripple lines
    ctx.strokeStyle = withAlpha('#b8935a', 0.35);
    for (let i = 0; i < 16; i++) {
      const yy = this.floorAt(0) + (i / 16) * h * 0.22 + rng.range(-2, 2);
      ctx.beginPath();
      ctx.moveTo(-10, yy);
      for (let x = 0; x <= w + 20; x += w / 8) {
        ctx.quadraticCurveTo(x + w / 16, yy + Math.sin(x * 0.02 + i) * h * 0.006, x + w / 8, yy);
      }
      ctx.lineWidth = h * 0.0022;
      ctx.stroke();
    }
    // grain
    for (const [sx, sy, sr, tone] of this.sandSpecks) {
      dot(ctx, sx, this.floorAt(sx) + sy * h * 0.16, sr);
      ctx.fillStyle = tone > 0.5 ? withAlpha('#ffffff', 0.4) : withAlpha('#a67c46', 0.4);
      ctx.fill();
    }
    // pebbles tucked against the stones
    for (const s of stones) {
      for (let i = 0; i < 5; i++) {
        const px = s.x + rng.range(-s.rx * 1.6, s.rx * 1.6);
        const py = this.floorAt(clamp(px, 0, w)) + rng.range(-2, 6);
        const pr = rng.range(0.8, 3);
        dot(ctx, px, py, pr);
        ctx.fillStyle = withAlpha(this.palette.rockLight, 0.5);
        ctx.fill();
      }
    }
    ctx.restore();

    // soft sand shadow line under the crest
    ctx.beginPath();
    ctx.moveTo(0, this.floorAt(0) + h * 0.012);
    const nn = n;
    for (let i = 0; i < nn; i++) {
      const x0 = (i / nn) * w;
      const x1 = ((i + 1) / nn) * w;
      ctx.quadraticCurveTo((x0 + x1) / 2, this.floorAt((x0 + x1) / 2) + h * 0.01, x1, this.floorAt(x1) + h * 0.012);
    }
    ctx.lineWidth = h * 0.006;
    ctx.strokeStyle = withAlpha('#8d6a3a', 0.28);
    ctx.stroke();
  }

  /* --------------------------- animation --------------------------- */

  /**
   * World x positions of every tile that overlaps the view. The tile is wider
   * than any viewport, so this is one or two numbers — the reef life is then
   * painted once per tile and repeats forever.
   */
  private tileOffsets(viewX: number, viewW: number): number[] {
    const first = Math.floor(viewX / this.tile) * this.tile;
    const out: number[] = [];
    for (let base = first; base < viewX + viewW; base += this.tile) out.push(base);
    return out;
  }

  /**
   * Paint the animated reef life: weed, fans, anemones, vents.
   *
   * A tile is wider than the screen, so painting every tile that overlaps the
   * view would draw two tiles' worth of plants every frame. Each pass is given
   * the slice of the tile it is responsible for and skips the rest.
   */
  paintAnimated(ctx: Ctx, time: number, height: number, viewX: number, viewW: number): void {
    for (const base of this.tileOffsets(viewX, viewW)) {
      ctx.save();
      ctx.translate(base, 0);
      this.paintReefLife(ctx, time, height, viewX - base, viewX - base + viewW);
      ctx.restore();
    }
  }

  private paintReefLife(ctx: Ctx, time: number, height: number, lo: number, hi: number): void {
    const pal = this.palette;
    // Generous: a fan or a kelp is at most half a screen tall, and it leans.
    const pad = height * 0.8;
    const near = (x: number, extra = 0) => x > lo - pad - extra && x < hi + pad + extra;

    // sea fans
    for (const f of this.fans) {
      if (!near(f.x, f.r)) continue;
      const sway = Math.sin(time * 0.5 + f.phase) * 0.05;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.lean + sway);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let i = 0; i <= f.ribs; i++) {
        const a = -Math.PI * 0.98 + (i / f.ribs) * Math.PI * 0.96;
        const rr = f.r * (0.86 + 0.14 * Math.sin(i * 1.7 + time * 0.6));
        ctx.lineTo(Math.cos(a) * rr * 0.35, Math.sin(a) * rr * 0.35);
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        ctx.lineTo(Math.cos(a) * rr * 0.35, Math.sin(a) * rr * 0.35);
      }
      ctx.closePath();
      ctx.fillStyle = withAlpha(f.color, 0.72);
      ctx.fill();
      ctx.lineWidth = height * 0.0016;
      ctx.strokeStyle = withAlpha(mixHex(f.color, '#3a1030', 0.5), 0.9);
      ctx.stroke();
      // veins
      ctx.strokeStyle = withAlpha(lighten(f.color, 0.4), 0.55);
      ctx.lineWidth = height * 0.0011;
      for (let i = 0; i <= f.ribs; i++) {
        const a = -Math.PI * 0.98 + (i / f.ribs) * Math.PI * 0.96;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        const rr = f.r * 0.9;
        ctx.quadraticCurveTo(Math.cos(a) * rr * 0.5, Math.sin(a) * rr * 0.5 + rr * 0.06, Math.cos(a) * rr, Math.sin(a) * rr);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(0, 0, f.r * 0.12, f.r * 0.05, 0, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(mixHex(f.color, '#000000', 0.4), 0.8);
      ctx.fill();
      ctx.restore();
    }

    // anemones
    for (const an of this.anemones) {
      if (!near(an.x, an.r * 2)) continue;
      ctx.save();
      ctx.translate(an.x, an.y);
      ctx.beginPath();
      ctx.ellipse(0, 0, an.r * 0.7, an.r * 0.26, 0, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(mixHex(an.color, '#5a1a40', 0.45), 0.85);
      ctx.fill();
      for (let i = 0; i < an.tendrils; i++) {
        const a = -Math.PI + (i / (an.tendrils - 1)) * Math.PI;
        const sway = Math.sin(time * 1.1 + an.phase + i * 0.6) * 0.18;
        const len = an.r * (1.5 + 0.35 * Math.sin(i * 2.1));
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(
          Math.cos(a) * len * 0.5,
          Math.sin(a) * len * 0.5 - len * 0.2,
          Math.cos(a + sway) * len * 0.85,
          Math.sin(a + sway) * len * 0.85 - len * 0.25,
        );
        ctx.lineWidth = an.r * 0.16;
        ctx.lineCap = 'round';
        ctx.strokeStyle = withAlpha(lighten(an.color, 0.18), 0.9);
        ctx.stroke();
        dot(ctx, Math.cos(a + sway) * len * 0.85, Math.sin(a + sway) * len * 0.85 - len * 0.25, an.r * 0.1);
        ctx.fillStyle = withAlpha(lighten(an.color, 0.6), 0.9);
        ctx.fill();
      }
      ctx.restore();
    }

    // kelp: a pair of ribbons per stem that sway with depth-based lag
    for (const k of this.kelp) {
      if (!near(k.x, k.h * 0.8)) continue;
      const sway = Math.sin(time * 0.42 + k.phase) * 0.16 + Math.sin(time * 0.9 + k.phase * 1.7) * 0.05;
      const tipX = k.x + (k.lean + sway) * k.h * 0.55;
      const tipY = k.y - k.h;
      ctx.beginPath();
      ctx.moveTo(k.x - k.w, k.y);
      const c1x = k.x - k.w + (k.lean + sway) * k.h * 0.14;
      const c2x = tipX - k.w * 0.6;
      ctx.bezierCurveTo(c1x, k.y - k.h * 0.4, c2x, k.y - k.h * 0.75, tipX - k.w * 0.35, tipY);
      ctx.lineTo(tipX + k.w * 0.35, tipY);
      ctx.bezierCurveTo(c2x + k.w * 1.6, k.y - k.h * 0.75, c1x + k.w * 2, k.y - k.h * 0.4, k.x + k.w, k.y);
      ctx.closePath();
      ctx.fillStyle = withAlpha(k.color, 0.9);
      ctx.fill();
      ctx.lineWidth = k.w * 0.3;
      ctx.strokeStyle = withAlpha(mixHex(k.color, '#0c3a2c', 0.6), 0.7);
      ctx.stroke();
      // blades along the stem
      for (let s = 1; s <= k.segs; s++) {
        const t = s / (k.segs + 1);
        const bx = k.x + (k.lean + sway) * k.h * 0.55 * t * t;
        const by = k.y - k.h * t;
        const side = s % 2 === 0 ? 1 : -1;
        const blade = k.h * 0.13 * (1 - t * 0.45);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(
          bx + side * blade * 0.7,
          by - blade * 0.35 + Math.sin(time * 1.3 + k.phase + s) * blade * 0.12,
          bx + side * blade * (0.95 + Math.sin(time * 1.1 + s) * 0.12),
          by - blade * (1.1 + Math.sin(time * 0.9 + s * 1.4) * 0.14),
        );
        ctx.quadraticCurveTo(bx + side * blade * 0.5, by - blade * 0.55, bx, by);
        ctx.closePath();
        ctx.fillStyle = withAlpha(lighten(k.color, 0.18), 0.92);
        ctx.fill();
      }
    }

    // vents (fine sand puffs) — no bubbles here, the sim owns those
    for (const v of this.vents) {
      if (!near(v.x, height * 0.1)) continue;
      const t = (time * v.rate + v.seed) % 1;
      ctx.beginPath();
      ctx.ellipse(v.x, v.y - t * height * 0.06, height * 0.006 + t * height * 0.02, height * 0.004 + t * height * 0.012, 0, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(pal.sandLight, 0.16 * (1 - t));
      ctx.fill();
    }
  }

  /**
   * Foreground weed, drawn in front of the animals. Deliberately sparse: heavy
   * silhouettes here read as smudges rather than depth, and they hide the fish.
   * It lives in world space like everything else, so it drifts past as you
   * scroll instead of pinning itself to the edges of your screen.
   */
  paintForeground(ctx: Ctx, time: number, height: number, width: number, viewX: number): void {
    for (const base of this.tileOffsets(viewX, width)) {
      ctx.save();
      ctx.translate(base, 0);
      this.paintNearWeed(ctx, time, height, viewX - base, viewX - base + width);
      ctx.restore();
    }
  }

  private paintNearWeed(ctx: Ctx, time: number, height: number, lo: number, hi: number): void {
    const rng = new Rng(0xf0e6);
    const n = Math.round(clamp(this.tile / 260, 4, 12));
    const pad = height * 0.5;
    for (let i = 0; i < n; i++) {
      const x = rng.range(0, this.tile);
      if (x < lo - pad || x > hi + pad) continue;
      const y = this.floorAt(x) + height * 0.02;
      const h = height * rng.range(0.16, 0.3);
      const w = height * rng.range(0.006, 0.012);
      const phase = rng.range(0, 6.28);
      const sway = Math.sin(time * 0.36 + phase) * 0.2;
      const color = 'rgba(9,74,62,0.72)';
      const bladeColor = 'rgba(16,104,82,0.72)';
      const tipX = x + sway * h * 0.6;
      const tipY = y - h;
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.bezierCurveTo(x - w + sway * h * 0.16, y - h * 0.4, tipX - w * 0.5, y - h * 0.78, tipX - w * 0.3, tipY);
      ctx.lineTo(tipX + w * 0.3, tipY);
      ctx.bezierCurveTo(tipX + w * 1.6, y - h * 0.78, x + w * 2.2, y - h * 0.4, x + w, y);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      for (let s = 1; s <= 4; s++) {
        const t = s / 5;
        const bx = x + sway * h * 0.6 * t * t;
        const by = y - h * t;
        const side = s % 2 === 0 ? 1 : -1;
        const blade = h * 0.09 * (1 - t * 0.4);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(
          bx + side * blade * 0.7,
          by - blade * 0.3,
          bx + side * blade,
          by - blade * 1.1,
        );
        ctx.quadraticCurveTo(bx + side * blade * 0.5, by - blade * 0.5, bx, by);
        ctx.closePath();
        ctx.fillStyle = bladeColor;
        ctx.fill();
      }
    }
  }

  /* ---------------------------- treasure ---------------------------- */

  /** One chest per tile, so one turns up every couple of screens of scroll. */
  paintChest(ctx: Ctx, time: number, viewX: number, viewW: number): void {
    for (const base of this.tileOffsets(viewX, viewW)) {
      const local = this.chest.x + base;
      if (local < viewX - 120 || local > viewX + viewW + 120) continue;
      ctx.save();
      ctx.translate(base, 0);
      this.paintOneChest(ctx, time);
      ctx.restore();
    }
  }

  private paintOneChest(ctx: Ctx, time: number): void {
    const { x, y, s } = this.chest;
    const breathe = 1 + Math.sin(time * 0.9) * 0.02;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s * breathe, s * breathe);
    const W = 100;
    const H = 56;
    // shadow
    ctx.beginPath();
    ctx.ellipse(0, 4, W * 0.62, 12, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(60,40,10,0.28)';
    ctx.fill();
    // body
    ctx.beginPath();
    ctx.roundRect(-W / 2, -H, W, H, 6);
    ctx.fillStyle = '#8a5a2b';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#4d2d10';
    ctx.stroke();
    // lid
    ctx.beginPath();
    ctx.moveTo(-W / 2 - 3, -H);
    ctx.quadraticCurveTo(0, -H - 34, W / 2 + 3, -H);
    ctx.closePath();
    ctx.fillStyle = '#a06a34';
    ctx.fill();
    ctx.stroke();
    // gold bands
    ctx.fillStyle = '#f0c04a';
    ctx.fillRect(-W / 2 - 3, -H - 4, 12, H + 8);
    ctx.fillRect(W / 2 - 9, -H - 4, 12, H + 8);
    ctx.fillRect(-W / 2, -H - 2, W, 8);
    // lock
    ctx.beginPath();
    ctx.roundRect(-11, -H + 4, 22, 24, 4);
    ctx.fillStyle = '#ffd977';
    ctx.fill();
    ctx.strokeStyle = '#8a6412';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -H + 16, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#6b4a08';
    ctx.fill();
    // coins spilling out
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + time * 0.2;
      const rx = W * 0.42;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * rx * 0.9, -6 + Math.sin(a) * 4, 9, 4.5, Math.sin(a) * 0.4, 0, Math.PI * 2);
      const g = ctx.createLinearGradient(-8, 0, 8, 0);
      g.addColorStop(0, '#c99a1e');
      g.addColorStop(0.5, '#ffe38a');
      g.addColorStop(1, '#c99a1e');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = '#8a6412';
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ------------------------- background water ------------------------ */

  paintWater(ctx: Ctx, width: number, height: number, time: number, light: { x: number; y: number }): void {
    const pal = this.palette;
    const gain = pal.rayGain ?? 1;
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    for (const [p, c] of pal.stops) grad.addColorStop(p, c);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Sun bloom near the surface light source.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bloom = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, height * 0.85);
    bloom.addColorStop(0, withAlpha(pal.bloom, 0.34 * gain));
    bloom.addColorStop(0.22, withAlpha(pal.bloom, 0.13 * gain));
    bloom.addColorStop(0.6, withAlpha(pal.bloom, 0.03 * gain));
    bloom.addColorStop(1, withAlpha(pal.bloom, 0));
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, width, height);

    // Broad shafts of light, drawn in screen space so they sweep with the camera.
    const count = 7;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const baseX = light.x + (t - 0.42) * width * 0.85 + Math.sin(time * 0.14 + i * 1.3) * width * 0.014;
      const w = width * (0.045 + 0.05 * ((i * 37) % 7) / 7) * (pal.rayGain !== undefined ? 0.7 : 1);
      const len = height * (0.85 + 0.25 * ((i * 53) % 5) / 5);
      const strength = (0.055 + 0.05 * Math.sin(time * 0.3 + i)) * gain;
      ctx.save();
      ctx.translate(baseX, light.y - height * 0.08);
      ctx.rotate(0.22 + Math.sin(time * 0.11 + i) * 0.015);
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, withAlpha(pal.ray, Math.max(0, strength)));
      g.addColorStop(0.35, withAlpha(pal.ray, Math.max(0, strength * 0.45)));
      g.addColorStop(1, withAlpha(pal.ray, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-w * 0.5, 0);
      ctx.lineTo(w * 0.5, 0);
      ctx.lineTo(w * 1.7, len);
      ctx.lineTo(-w * 1.7, len);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // Depth darkening toward the floor.
    const shade = ctx.createLinearGradient(0, height * 0.55, 0, height);
    shade.addColorStop(0, 'rgba(6,40,80,0)');
    shade.addColorStop(1, 'rgba(6,36,74,0.42)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, height * 0.55, width, height * 0.45);

    // Surface shimmer at the very top.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const y = height * (0.012 + i * 0.016);
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= width; x += width / 24) {
        ctx.quadraticCurveTo(
          x + width / 48,
          y + Math.sin(x * 0.02 + time * 1.2 + i) * height * 0.006,
          x + width / 24,
          y + Math.sin(x * 0.017 + time * 0.9 + i * 2) * height * 0.003,
        );
      }
      ctx.lineWidth = height * 0.004;
      ctx.strokeStyle = withAlpha('#ffffff', 0.14 - i * 0.03);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Caustics: the moving net of light on rock and sand. */
  paintCaustics(
    ctx: Ctx,
    width: number,
    height: number,
    time: number,
    strength = 1,
    region?: { y: number; h: number },
    detail = 1,
  ): void {
    // Caustics are focused sunlight, so they fade with the sun. Left at
    // daylight strength after dark they stop reading as a moving net and start
    // reading as hard horizontal light bars across a dark tank.
    strength *= this.palette.rayGain ?? 1;
    ctx.save();
    if (region) {
      ctx.beginPath();
      ctx.rect(0, region.y, width, region.h);
      ctx.clip();
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const rows = detail > 0.8 ? 5 : 3;
    for (let r = 0; r < rows; r++) {
      const yy = height * (0.16 + r * (0.74 / rows));
      const alpha = (0.035 + 0.03 * Math.sin(r * 2.1)) * strength;
      ctx.strokeStyle = withAlpha('#dffaff', alpha);
      ctx.lineWidth = height * (0.012 + (r % 2) * 0.006);
      ctx.beginPath();
      for (let x = -40; x <= width + 40; x += detail > 0.8 ? 28 : 44) {
        const y =
          yy +
          Math.sin(x * 0.011 + time * 0.55 + r * 1.3) * height * 0.014 +
          Math.sin(x * 0.026 - time * 0.9 + r) * height * 0.007;
        if (x === -40) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // A second, finer net that only touches the floor band.
    if (detail > 0.8) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, height * 0.7, width, height * 0.3);
      ctx.clip();
      for (let i = 0; i < 9; i++) {
        ctx.strokeStyle = withAlpha('#eafcff', 0.05 * strength);
        ctx.lineWidth = height * 0.008;
        ctx.beginPath();
        for (let x = -40; x <= width + 40; x += 26) {
          const y =
            height * 0.8 +
            Math.sin(x * 0.02 + time * 0.8 + i * 2.3) * height * 0.05 +
            i * height * 0.02;
          if (x === -40) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /** Screen-space bubble bokeh for the mid-distance haze. */
  paintHaze(ctx: Ctx, width: number, height: number, time: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const rng = new Rng(0xbeef);
    for (let i = 0; i < 18; i++) {
      const x = rng.range(0, width);
      const baseY = rng.range(0, height);
      const r = rng.range(1, 3.5);
      const y = (baseY - time * rng.range(6, 20)) % (height + 40);
      const yy = y < -20 ? y + height + 40 : y;
      dot(ctx, x + Math.sin(time * 0.5 + i) * 6, yy, r);
      ctx.fillStyle = 'rgba(255,255,255,0.11)';
      ctx.fill();
    }
    ctx.restore();
  }

  /** Where the sun sits, in screen space, given the camera offset. */
  lightSource(width: number, height: number): { x: number; y: number } {
    return { x: width * 0.3, y: -height * 0.04 };
  }

  /** Deep-water colour used to tint life swimming at a given depth (0..1). */
  tintFor(depth: number): string {
    return waterAt(this.palette, 0.5 + clamp(depth, 0, 1) * 0.45);
  }

  get size(): { w: number; h: number } {
    return { w: this.width, h: this.height };
  }
}
