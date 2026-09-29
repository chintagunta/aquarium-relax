import { clamp, TAU, withAlpha } from '../core/math';
import { dot, type Ctx } from '../art/art';
import { paintCreature } from '../art/creatures';
import type { Aquarium } from '../sim/aquarium';
import type { Creature, Pellet } from '../sim/types';

export interface RenderOptions {
  /** 0.6 (fast) .. 1 (full quality). */
  quality: number;
  /** Shows the cursor's feeding zone. */
  showCursor: boolean;
  /** Frames drawn so far, surfaced for the in-page self check. */
  frame?: number;
  /**
   * Accumulate per-stage timings into `renderer.timings`. Off by default, so
   * the shipping loop pays nothing but a boolean test per stage.
   */
  profile?: boolean;
  /** Moonlight instead of sunlight, plus everything that glows in it. */
  night?: boolean;
}

/** Which depth bucket an animal belongs in, for the soft-focus passes. */
type Slice = 'far' | 'mid' | 'near';

/**
 * Depth decides the pass, with one exception: a showpiece is never demoted to
 * the far bucket. That pass runs at half resolution and behind a wash of
 * water, which is right for a distant school and wrong for the shark.
 */
function sliceOf(c: Creature): Slice {
  if (c.species.size >= 0.2) return c.depth < 0.4 ? 'mid' : 'near';
  if (c.depth < 0.46) return 'far';
  if (c.depth < 0.74) return 'mid';
  return 'near';
}

export class Renderer {
  private ctx: Ctx;
  private canvas: HTMLCanvasElement;
  private far: Creature[] = [];
  private mid: Creature[] = [];
  private near: Creature[] = [];
  /** Animals each pass put on the canvas this frame. See `drawnCounts()`. */
  private painted = { far: 0, mid: 0, near: 0 };

  /**
   * Half-resolution buffer for the far animals. Drawing the distant school in
   * here and blowing it up to full size defocuses it in one `drawImage`
   * instead of a `ctx.filter` blur per path — which is the difference between
   * 60fps and 2fps on a retina display.
   */
  private farLayer: HTMLCanvasElement | null = null;
  private farCtx: Ctx | null = null;
  /** Soft vertical wash that pushes everything behind it into the distance. */
  private hazeGrad: CanvasGradient | null = null;
  private gradKey = '';
  /** Deep indigo grade laid over everything after dark. */
  private nightGrad: CanvasGradient | null = null;
  /** Radial glow reused by every bioluminescent animal and by the moon. */
  private glowSprite: HTMLCanvasElement | null = null;
  /** Set per frame from `RenderOptions.night`; read by the animal pass. */
  private nightMode = false;

  /** Per-stage milliseconds from the last profiled frame. See `RenderOptions.profile`. */
  readonly timings: Record<string, number> = {};
  /** Accumulated milliseconds since the last `resetTimings()`. */
  readonly totals: Record<string, number> = {};
  profiledFrames = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d canvas context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  resetTimings(): void {
    for (const k of Object.keys(this.totals)) delete this.totals[k];
    for (const k of Object.keys(this.timings)) delete this.timings[k];
    this.profiledFrames = 0;
  }

  private mark(label: string, t0: number): number {
    const now = performance.now();
    const dt = now - t0;
    this.timings[label] = (this.timings[label] ?? 0) + dt;
    this.totals[label] = (this.totals[label] ?? 0) + dt;
    return now;
  }

  resize(width: number, height: number, dpr: number): void {
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    // The far pass runs at half of CSS resolution — that is the defocus.
    const fw = Math.max(1, Math.round(width * 0.5));
    const fh = Math.max(1, Math.round(height * 0.5));
    if (!this.farLayer) this.farLayer = document.createElement('canvas');
    this.farLayer.width = fw;
    this.farLayer.height = fh;
    this.farCtx = this.farLayer.getContext('2d');
    this.hazeGrad = null;
    this.nightGrad = null;
    this.gradKey = '';
  }

  /**
   * A soft round light. One sprite serves every glowing animal, the moon and
   * the plankton — a radial gradient per glowing creature would undo the whole
   * point of the filter-free renderer.
   */
  private glow(): HTMLCanvasElement {
    if (this.glowSprite) return this.glowSprite;
    const s = 128;
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const g = c.getContext('2d');
    if (g) {
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(196,236,255,0.66)');
      grad.addColorStop(0.2, 'rgba(132,208,255,0.32)');
      grad.addColorStop(0.5, 'rgba(84,156,240,0.12)');
      grad.addColorStop(1, 'rgba(60,120,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    }
    this.glowSprite = c;
    return c;
  }

  private night(w: number, h: number): CanvasGradient {
    const key = `n${w}x${h}`;
    if (this.nightGrad && this.gradKey === key) return this.nightGrad;
    const g = this.ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(24,52,120,0.20)');
    g.addColorStop(0.55, 'rgba(10,24,72,0.34)');
    g.addColorStop(1, 'rgba(3,8,30,0.52)');
    this.nightGrad = g;
    this.gradKey = key;
    return g;
  }

  /**
   * Aerial perspective. Two translucent fills — one over everything drawn so
   * far, one over the whole tank — do the job the blur filters used to do:
   * distant things lose contrast because water is in the way.
   */
  private haze(w: number, h: number): CanvasGradient {
    const key = `${w}x${h}`;
    if (this.hazeGrad && this.gradKey === key) return this.hazeGrad;
    const g = this.ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(126,226,255,0.5)');
    g.addColorStop(0.45, 'rgba(32,152,210,0.62)');
    g.addColorStop(1, 'rgba(14,104,168,0.62)');
    this.hazeGrad = g;
    this.gradKey = key;
    return g;
  }

  /** Pellets get a pre-rendered glow sprite — a radial gradient per crumb is too slow. */
  private pelletSprite(): HTMLCanvasElement {
    if (this.sprite) return this.sprite;
    const size = 32;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    if (g) {
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, '#fff4cf');
      grad.addColorStop(0.32, '#ffcc5c');
      grad.addColorStop(0.62, '#d9871f');
      grad.addColorStop(1, 'rgba(120,64,8,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
    this.sprite = c;
    return c;
  }
  private sprite: HTMLCanvasElement | null = null;

  render(a: Aquarium, opts: RenderOptions): void {
    const { ctx } = this;
    const w = a.width;
    const h = a.height;
    const dpr = this.canvas.width / Math.max(1, w);
    const time = a.time;
    const light = a.reef.lightSource(w, h);
    const cam = a.camera;
    const quality = clamp(opts.quality, 0.5, 1);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const prof = opts.profile === true;
    const night = opts.night === true;
    this.nightMode = night;
    const tile = a.reef.tile;
    /** World scroll of a layer, plus its own pointer parallax. */
    const slide = (k: number, p: number) => -(a.view.x * k + cam.x * p);
    let t = prof ? performance.now() : 0;

    /* ------------------------- water + far light ------------------------- */
    // Lighting is screen space on purpose: the sun and the moon do not scroll
    // past when you swim, they stay where they are and the water moves under
    // them. Caustics too — they are light on the surface, not a texture.
    a.reef.paintWater(ctx, w, h, time, light);
    a.reef.paintCaustics(ctx, w, h, time, 0.55, undefined, quality);
    if (night) this.paintMoon(ctx, w, h, light, time);
    if (prof) t = this.mark('water', t);

    /* ------------------------------ far reef ----------------------------- */
    if (a.reef.deep) {
      this.drawTiled(ctx, a.reef.deep, tile, h * 1.15, slide(0.55, 0.4), -h * 0.075, w);
    }
    if (prof) t = this.mark('farReef', t);

    /* ------------------------------ far life ----------------------------- */
    // Animals are pinned to the world, not to a parallax factor: their *own*
    // x is where they are, the same x the food, the shadows and the sand use.
    // Sliding a pass at anything but 1.0 puts its transform at odds with the
    // window it culls against, so past a screenful of scroll every animal was
    // drawn off stage while the simulation happily reported it on screen. The
    // reef layers can afford a factor — a tile is periodic, so a slower scroll
    // just shows the pattern later — but a fish cannot. Depth is carried by the
    // pass, the haze, the size and the tint instead, plus the small pointer
    // parallax here, which is local enough to be harmless.
    this.bucket(a, a.view.x, w);
    ctx.save();
    ctx.translate(slide(1, 0.55), -cam.y * 0.55);
    this.painted.far = this.paintFarSlice(a, time, quality);
    ctx.restore();

    // Push the far band back: one translucent fill, no filters.
    ctx.save();
    ctx.translate(slide(1, 0.55), -cam.y * 0.55);
    ctx.fillStyle = this.haze(w, h);
    ctx.globalAlpha = 0.16;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    if (prof) t = this.mark('farLife', t);

    /* ------------------------------ mid reef ----------------------------- */
    if (a.reef.mid) {
      this.drawTiled(ctx, a.reef.mid, tile, h * 1.1, slide(0.85, 0.7), -h * 0.03, w);
    }
    if (prof) t = this.mark('midReef', t);

    /* --------------------- chest, then the sand surface ------------------- */
    ctx.save();
    ctx.translate(slide(1, 1), -cam.y);
    a.reef.paintChest(ctx, time, a.view.x, w);
    ctx.restore();

    if (a.reef.sandCanvas) {
      const fh = a.reef.sandCanvas.height / dpr;
      this.drawTiled(ctx, a.reef.sandCanvas, tile, fh, slide(1, 1), h - fh, w);
    }

    // reef life that lives on the sand: fans, anemones, weed
    ctx.save();
    ctx.translate(slide(1, 1), -cam.y);
    a.reef.paintAnimated(ctx, time, h, a.view.x, w);
    ctx.restore();
    // caustics bound to the floor band, screen space like the rest of the light
    a.reef.paintCaustics(ctx, w, h, time, 1, { y: h * 0.68, h: h * 0.32 }, quality);
    if (prof) t = this.mark('floor', t);

    /* ------------------------------- pellets ----------------------------- */
    ctx.save();
    ctx.translate(slide(1, 1), -cam.y);
    this.paintPellets(a, time);
    ctx.restore();

    /* --------------------------- shadows on sand ------------------------- */
    ctx.save();
    ctx.translate(slide(1, 1), -cam.y);
    this.paintShadows(a);
    ctx.restore();
    if (prof) t = this.mark('pellets', t);

    /* ------------------------------- mid life ---------------------------- */
    ctx.save();
    ctx.translate(slide(1, 0.7), -cam.y * 0.7);
    this.painted.mid = this.paintSlice(ctx, a, this.mid, time, quality, a.view.x, w);
    ctx.restore();
    if (prof) t = this.mark('midLife', t);

    /* ------------------------------ foreground --------------------------- */
    // World-locked like everything the animals stand among. It used to slide at
    // 1.1 for a nearer-is-faster feel, which cannot work: the sand it grows out
    // of slides at 1.0, so the further you scroll the further the weed floats
    // off its own sea bed. The two baked ridge layers keep their parallax —
    // they are periodic and drawn full width, so a slower scroll costs nothing.
    ctx.save();
    ctx.translate(slide(1, 0.9), -cam.y * 0.9);
    a.reef.paintForeground(ctx, time, h, w, a.view.x);
    ctx.restore();

    /* ------------------------------- near life --------------------------- */
    ctx.save();
    ctx.translate(slide(1, 0.9), -cam.y * 0.9);
    this.painted.near = this.paintSlice(ctx, a, this.near, time, quality, a.view.x, w);
    ctx.restore();
    if (prof) t = this.mark('nearLife', t);

    /* --------------------------- particles + water ----------------------- */
    ctx.save();
    ctx.translate(slide(1, 1), -cam.y);
    this.paintParticles(a);
    this.paintBubbles(a);
    this.paintRipples(a);
    ctx.restore();

    a.reef.paintHaze(ctx, w, h, time);
    if (prof) t = this.mark('fx', t);

    /* ------------------------- depth wash + vignette --------------------- */
    if (night) {
      // One translucent indigo fill does the whole grade: everything drawn so
      // far loses warmth and contrast together, which is what dusk looks like.
      ctx.fillStyle = this.night(w, h);
      ctx.fillRect(0, 0, w, h);
    }
    const wash = ctx.createLinearGradient(0, 0, 0, h);
    wash.addColorStop(0, 'rgba(120,225,255,0.05)');
    wash.addColorStop(0.5, 'rgba(10,110,180,0.03)');
    wash.addColorStop(1, 'rgba(4,44,96,0.16)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);

    const vig = ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.28, w * 0.5, h * 0.5, h * 0.92);
    vig.addColorStop(0, 'rgba(0,20,44,0)');
    vig.addColorStop(1, 'rgba(0,22,48,0.34)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    /* ------------------------------ cursor ------------------------------ */
    if (opts.showCursor && cam.active) {
      this.paintCursor(cam.px, cam.py, time);
    }
    if (prof) {
      this.mark('grade', t);
      this.profiledFrames++;
    }

    if (opts.frame !== undefined) {
      this.canvas.dataset.frames = String(opts.frame);
      if (opts.frame % 20 === 0) window.__reefProbe?.();
    }
  }

  /* --------------------------- layers/life --------------------------- */

  /**
   * Blit a periodic world layer across the viewport. `shift` is where the world
   * has slid to, so the first copy starts part-way through the tile and the
   * rest follow at whole-tile intervals — two draws at most, because a tile is
   * wider than any viewport.
   */
  private drawTiled(
    ctx: Ctx,
    img: HTMLCanvasElement,
    tile: number,
    drawH: number,
    shift: number,
    drawY: number,
    viewW: number,
  ): void {
    let x = -(((shift % tile) + tile) % tile);
    for (; x < viewW; x += tile) ctx.drawImage(img, x, drawY, tile, drawH);
  }

  /** The moon, and a scatter of stars. Drawn early so animals cross in front. */
  private paintMoon(ctx: Ctx, w: number, h: number, light: { x: number; y: number }, time: number): void {
    const glow = this.glow();
    const x = w * 0.74;
    const y = h * 0.14;
    const r = h * 0.028;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = r * 9;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(glow, x - halo, y - halo, halo * 2, halo * 2);
    ctx.globalAlpha = 0.95;
    dot(ctx, x, y, r);
    ctx.fillStyle = '#eef4ff';
    ctx.fill();
    // a couple of crater-ish shadows so it is not a flat disc
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#7f93bd';
    dot(ctx, x - r * 0.3, y - r * 0.24, r * 0.3);
    ctx.fill();
    dot(ctx, x + r * 0.34, y + r * 0.28, r * 0.2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // stars
    for (let i = 0; i < 26; i++) {
      const sx = ((i * 2654435761) % 1000) / 1000;
      const sy = ((i * 40503) % 700) / 700;
      const tw = 0.35 + 0.35 * Math.sin(time * 1.3 + i * 2.1);
      ctx.globalAlpha = tw * (0.5 - sy * 0.3);
      dot(ctx, sx * w, sy * h * 0.55, 1 + (i % 3) * 0.4);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    void light;
    ctx.restore();
  }

  private bucket(a: Aquarium, viewX: number, viewW: number): void {
    this.far.length = 0;
    this.mid.length = 0;
    this.near.length = 0;
    const lo = viewX - viewW * 0.2;
    const hi = viewX + viewW * 1.2;
    for (const c of a.creatures) {
      // Off the edges of the window entirely: nothing to draw. This matters
      // now that the world is endless — half the cast can be off screen.
      if (c.x < lo || c.x > hi) continue;
      const s = sliceOf(c);
      if (s === 'far') this.far.push(c);
      else if (s === 'mid') this.mid.push(c);
      else this.near.push(c);
    }
  }

  /**
   * The distant school, drawn small and blown up. Everything in this pass gets
   * the lowest level of detail and a flat wash of water over the top, so the
   * far band reads as distance without costing a filter.
   */
  private paintFarSlice(a: Aquarium, time: number, quality: number): number {
    const layer = this.farLayer;
    const lctx = this.farCtx;
    if (!layer || !lctx) {
      return this.paintSlice(this.ctx, a, this.far, time, quality, a.view.x, a.width);
    }
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.save();
    lctx.scale(0.5, 0.5);
    lctx.translate(-a.view.x, 0);
    const painted = this.paintSlice(lctx, a, this.far, time, quality, a.view.x, a.width);
    lctx.restore();

    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(layer, 0, 0, a.width, a.height);
    ctx.restore();
    return painted;
  }

  private paintSlice(
    ctx: Ctx,
    a: Aquarium,
    list: Creature[],
    time: number,
    quality: number,
    viewX: number,
    viewW: number,
    detail?: number,
  ): number {
    const lo = viewX - viewW * 0.15;
    const hi = viewX + viewW * 1.15;
    let painted = 0;
    for (const c of list) {
      if (c.x < lo || c.x > hi) continue;
      this.paintCreature(ctx, a, c, time, detail ?? this.lodFor(a, c, quality));
      painted++;
    }
    return painted;
  }

  /**
   * How many animals each pass actually put on the canvas this frame. The sim
   * knowing where a fish is and the renderer drawing it there are two different
   * claims, and this is the second one — a pass whose transform and culling
   * disagree can skip every animal while the population report insists they are
   * all in shot.
   */
  drawnCounts(): { far: number; mid: number; near: number; total: number } {
    return { ...this.painted, total: this.painted.far + this.painted.mid + this.painted.near };
  }

  /** Level of detail follows the on-screen size of the animal. */
  private lodFor(a: Aquarium, c: Creature, quality: number): number {
    const px = a.unit * c.species.size * c.sizeMul;
    const natural = px > 62 ? 2 : px > 30 ? 1 : 0;
    return quality < 0.7 ? Math.min(natural, 1) : natural;
  }

  private paintCreature(ctx: Ctx, a: Aquarium, c: Creature, time: number, lod: number): void {
    const px = a.unit * c.species.size * c.sizeMul;
    const speedRef = c.species.baseSpeed * (a.height / 800) * 1.1;
    const speed01 = clamp(Math.hypot(c.vx, c.vy) / Math.max(1, speedRef), 0, 1);

    // After dark, anything bioluminescent carries its own light. One sprite
    // blit per glowing animal, and only at night.
    const glow = c.species.glow;
    if (this.nightMode && glow > 0) {
      const sprite = this.glow();
      const pulse = 0.62 + 0.38 * Math.sin(time * 1.4 + c.tint * TAU);
      const r = px * (1.35 + glow * 0.8) * pulse;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.2 + glow * 0.3;
      ctx.drawImage(sprite, c.x - r, c.y - r, r * 2, r * 2);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(c.x, c.y);
    const facing = c.facing >= 0 ? 1 : -1;
    if (c.species.body.rig === 'mermaid') {
      // She hangs upright in the water like a swimmer, drifting with a slight
      // lean, and is mirrored rather than turned when she changes direction.
      ctx.scale(facing, 1);
      ctx.rotate(0.04 * Math.sin(time * 0.7 + c.tint * 6));
    } else if (c.species.kind === 'crab' || c.species.kind === 'starfish') {
      // Top-down animals: seen from above, so rotating really is how they turn.
      ctx.rotate(-c.angle);
      ctx.scale(1, 0.92);
    } else {
      // Everything else is a side view: mirror for direction, and use what is
      // left of the rotation only for the tilt of the nose as it climbs or
      // dives. `scale` before `rotate` keeps that tilt pointing the same way
      // in both facings.
      ctx.scale(facing, 1);
      ctx.rotate(c.pitch);
    }
    ctx.scale(px, px);
    paintCreature({
      ctx,
      creature: c,
      colors: c.palette,
      time,
      speed01,
      attention: c.attention,
      detail: lod,
      // Keep a hairline of ink on the smallest fish: scaled outlines vanish.
      ink: Math.max(c.species.weight, 1.2 / Math.max(8, px)),
    });
    ctx.restore();

    if (c.joy > 0.02) this.paintJoy(ctx, c, a);
  }

  private paintJoy(ctx: Ctx, c: Creature, a: Aquarium): void {
    const t = 1 - c.joy;
    const y = c.y - a.height * 0.045 - t * a.height * 0.03;
    const x = c.x + Math.sin(t * 6) * a.height * 0.008;
    const s = a.height * 0.011 * (0.7 + c.joy * 0.6);
    ctx.save();
    ctx.globalAlpha = clamp(c.joy * 1.6, 0, 1);
    ctx.fillStyle = '#ff7fb0';
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.4, y - s * 0.3, x - s * 0.5, y - s * 1.2, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.5, y - s * 1.2, x + s * 1.4, y - s * 0.3, x, y + s * 0.9);
    ctx.fill();
    ctx.restore();
  }

  private paintShadows(a: Aquarium): void {
    const { ctx } = this;
    const soft = a.height * 0.9;
    ctx.save();
    for (const c of a.creatures) {
      const s = c.species.shadow;
      if (s <= 0) continue;
      const floor = a.reef.floor(c.x);
      if (floor - c.y > soft * 0.55) continue;
      const depthRatio = clamp(1 - (floor - c.y) / (soft * 0.55), 0, 1);
      const r = a.unit * c.species.size * c.sizeMul * 0.85 * s;
      ctx.save();
      ctx.translate(c.x + a.height * 0.012, floor + 2);
      ctx.scale(1, 0.26);
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.7 + depthRatio * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(10,44,74,${0.07 + 0.13 * depthRatio})`;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /* ------------------------------ pellets ------------------------------ */

  private paintPellets(a: Aquarium, time: number): void {
    if (a.pellets.length === 0) return;
    const { ctx } = this;
    const sprite = this.pelletSprite();
    ctx.save();
    for (const p of a.pellets) {
      if (p.eaten) continue;
      const fade = clamp(p.life / 6, 0, 1);
      const pulse = 1 + p.fresh * 0.5 + Math.sin(time * 4 + p.seed) * 0.06;
      const r = Math.max(3, p.r * 3.4) * pulse;
      // halo
      ctx.globalAlpha = 0.32 * fade * (0.6 + p.fresh * 0.5);
      ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
      // body
      ctx.globalAlpha = 1;
      dot(ctx, p.x, p.y, p.r);
      ctx.fillStyle = '#e08a17';
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, p.r * 0.28);
      ctx.strokeStyle = 'rgba(91,46,4,0.75)';
      ctx.stroke();
      dot(ctx, p.x - p.r * 0.32, p.y - p.r * 0.34, p.r * 0.36);
      ctx.fillStyle = 'rgba(255,246,214,0.9)';
      ctx.fill();
    }
    ctx.restore();
  }

  /* ------------------------------ effects ------------------------------ */

  /**
   * Bubbles are blitted from one small sprite rather than built from three
   * paths each. At a couple of hundred bubbles that is the difference between
   * ~700 path operations a frame and 200 `drawImage` calls.
   */
  private bubbleSprite(): HTMLCanvasElement {
    if (this.bubble) return this.bubble;
    const s = 48;
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const g = c.getContext('2d');
    if (g) {
      const r = s * 0.42;
      const grad = g.createRadialGradient(s * 0.4, s * 0.38, r * 0.1, s * 0.5, s * 0.5, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.30)');
      grad.addColorStop(0.6, 'rgba(214,246,255,0.10)');
      grad.addColorStop(1, 'rgba(255,255,255,0.16)');
      g.beginPath();
      g.arc(s / 2, s / 2, r, 0, Math.PI * 2);
      g.fillStyle = grad;
      g.fill();
      g.lineWidth = s * 0.055;
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.stroke();
      g.beginPath();
      g.arc(s * 0.38, s * 0.36, r * 0.22, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.fill();
    }
    this.bubble = c;
    return c;
  }
  private bubble: HTMLCanvasElement | null = null;

  /** Soft round mote, reused for every speck of drifting matter. */
  private moteSprite(): HTMLCanvasElement {
    if (this.mote) return this.mote;
    const s = 32;
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const g = c.getContext('2d');
    if (g) {
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    }
    this.mote = c;
    return c;
  }
  private mote: HTMLCanvasElement | null = null;

  private paintBubbles(a: Aquarium): void {
    if (a.bubbles.length === 0) return;
    const { ctx } = this;
    const sprite = this.bubbleSprite();
    ctx.save();
    for (const b of a.bubbles) {
      const alpha = clamp(b.life / b.maxLife, 0, 1) * 0.72;
      const r = b.r * 1.5;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, b.x - r, b.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  private paintParticles(a: Aquarium): void {
    if (a.particles.length === 0) return;
    const { ctx } = this;
    const mote = this.moteSprite();
    const nightMode = this.nightMode;
    ctx.save();
    // One composite change for the whole sparkle batch instead of one each.
    ctx.globalCompositeOperation = 'lighter';
    for (const p of a.particles) {
      if (p.kind !== 'sparkle' && !(nightMode && p.kind === 'sand')) continue;
      const t = clamp(p.life / p.maxLife, 0, 1);
      // Drifting dust becomes plankton after dark: bigger, bluer, additive.
      const r = nightMode && p.kind === 'sand' ? p.r * 4.5 : p.r * 3;
      ctx.globalAlpha = (nightMode && p.kind === 'sand' ? t * 0.5 : t * 0.7);
      ctx.drawImage(mote, p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const p of a.particles) {
      if (p.kind === 'sparkle') continue;
      if (nightMode && p.kind === 'sand') continue;
      const t = clamp(p.life / p.maxLife, 0, 1);
      const r = p.r * (p.kind === 'heart' ? 2.6 : p.kind === 'sand' ? 2.4 : 2.2);
      ctx.globalAlpha = p.kind === 'sand' ? t * 0.42 : t * 0.85;
      ctx.drawImage(mote, p.x - r, p.y - r, r * 2, r * 2);
      if (p.kind === 'heart' || p.kind === 'crumb') {
        // tint the soft mote by drawing a colour dot inside it
        ctx.globalAlpha = t * 0.9;
        dot(ctx, p.x, p.y, p.r * 0.72);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private paintRipples(a: Aquarium): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of a.ripples) {
      // `arc` throws on a negative radius, and one bad frame should never take
      // the whole tank down with it.
      if (!(r.r > 0.5)) continue;
      const t = clamp(r.life / r.maxLife, 0, 1);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1, a.height * 0.006 * t);
      ctx.strokeStyle = withAlpha('#eafcff', 0.42 * t * t);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * 0.62, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1, a.height * 0.003 * t);
      ctx.strokeStyle = withAlpha('#ffffff', 0.3 * t * t);
      ctx.stroke();
    }
    ctx.restore();
  }

  private paintCursor(x: number, y: number, time: number): void {
    const { ctx } = this;
    const pulse = 0.5 + 0.5 * Math.sin(time * 3);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.arc(x, y, 22 + pulse * 5, 0, Math.PI * 2);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = time * 0.6 + (i / 4) * Math.PI * 2;
      dot(ctx, x + Math.cos(a) * 26, y + Math.sin(a) * 26, 1.6);
      ctx.fillStyle = 'rgba(220,248,255,0.55)';
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Exposed for tests: which render pass an animal lands in. */
export { sliceOf };
export type { Pellet };
