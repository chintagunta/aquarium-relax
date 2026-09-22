import type { FishShape, PatternKind, Species } from '../sim/types';
import {
  dot,
  drawEye,
  ellipsePath,
  fishBodyPath,
  finPath,
  OUTLINE,
  type Ctx,
} from './art';

export type FishColors = Species['colors'];
type MouthKind = FishShape['mouth'];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Fill + optional outline in one call. */
function fs(ctx: Ctx, color: string, width = 0.009, outline = OUTLINE, alpha = 1): void {
  ctx.save();
  if (alpha !== 1) ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.fill();
  if (width > 0) {
    ctx.lineWidth = width;
    ctx.strokeStyle = outline;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

/** Deterministic per-species noise so patterns never shimmer between frames. */
export function hashRng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The snout ellipse the body path is built from. */
function snoutEllipse(shape: FishShape) {
  const px = Math.min(shape.tip - 0.08, shape.peak);
  return { cx: (px * 0.74 + px) / 2, rx: Math.abs(px - px * 0.74) / 2, px };
}

/** Half-height of the body outline at x (approximate, good enough for art). */
export function bodyTop(shape: FishShape, x: number): number {
  const { hh } = shape;
  const { cx, rx } = snoutEllipse(shape);
  if (x <= cx + rx) {
    const t = (x - cx) / rx;
    if (t <= -1) return 0;
    return hh * Math.sqrt(Math.max(0, 1 - t * t));
  }
  const tailT = Math.min(1, (x - (cx + rx)) / Math.max(0.001, shape.tip - (cx + rx)));
  return hh * (1 - tailT) + shape.ped * tailT;
}

/**
 * Paint a whole fish in body-length units: nose at (0,0), tail at (1,0).
 * `phase` drives the swim wave, `speed01` (0..1) how hard it is swimming.
 * `detail` (0..2) drops marks that would be invisible at the size the fish is
 * being drawn; `ink` sets a floor on outline width so small fish keep a
 * readable line instead of fading to a smudge.
 */
export function paintFish(
  ctx: Ctx,
  species: Species,
  colors: FishColors,
  phase: number,
  speed01: number,
  detail = 2,
  ink?: number,
  bite = 0,
): void {
  if (species.body.rig !== 'fish') return;
  const shape = species.body.shape;
  const { hh, peak, tip, ped } = shape;
  const w = Math.max(species.weight, ink ?? 0);
  const px = Math.min(tip - 0.08, peak);

  const swish = Math.sin(phase);
  const swish2 = Math.sin(phase - 0.75);
  const swish3 = Math.sin(phase - 1.5);
  const bend = 0.05 + speed01 * 0.15;

  paintTail(ctx, shape, colors, w, swish, bend);
  paintDorsal(ctx, shape, colors, w, swish2);
  if (detail >= 1) {
    paintAnal(ctx, shape, colors, w, swish2);
    paintPelvic(ctx, shape, colors, w, swish3);
  }

  /* ------------------------------ body ------------------------------ */
  fishBodyPath(ctx, hh, peak, tip, ped);
  ctx.fillStyle = colors.body;
  ctx.fill();
  ctx.lineWidth = w;
  ctx.strokeStyle = colors.outline;
  ctx.lineJoin = 'round';
  ctx.stroke();

  if (detail >= 1) {
    ctx.save();
    fishBodyPath(ctx, hh, peak, tip, ped);
    ctx.clip();

    if (colors.belly) {
      ctx.beginPath();
      ctx.ellipse(peak * 0.95, hh * 0.66, tip * 0.66, hh * 0.72, -0.08, 0, Math.PI * 2);
      ctx.fillStyle = colors.belly;
      ctx.globalAlpha = 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (detail >= 2) {
      ctx.beginPath();
      ctx.ellipse(peak * 1.05, -hh * 0.98, tip * 0.72, hh * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(4,32,54,0.20)';
      ctx.fill();
    }

    paintPattern(ctx, species.pattern, hashRng(species.id), shape, colors, detail);

    if (detail >= 2) {
      ctx.beginPath();
      ctx.ellipse(px * 0.95, -hh * 0.5, tip * 0.52, hh * 0.32, -0.12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fill();
    }
    ctx.restore();
  }

  /* --------------------------- gill + pectoral ----------------------- */
  if (detail >= 2) {
    ctx.beginPath();
    ctx.moveTo(px * 1.02, -hh * 0.6);
    ctx.quadraticCurveTo(px * 1.16, 0, px * 1.02, hh * 0.6);
    ctx.lineWidth = w * 0.85;
    ctx.strokeStyle = colors.outline;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (detail >= 1) {
    ctx.save();
    ctx.rotate(swish3 * 0.3 + 0.32);
    finPath(
      ctx,
      [
        { x: px * 1.12, y: hh * 0.06 },
        { x: px * 1.12 + shape.pect * 0.34, y: hh * 0.6 },
        { x: px * 1.12 + shape.pect * 0.14, y: hh * 0.96 },
      ],
      0.5,
    );
    fs(ctx, colors.fin, w * 0.9, OUTLINE, 0.92);
    ctx.restore();
  }

  /* ------------------------------ head ------------------------------ */
  const eyeX = Math.max(0.04, Math.min(0.2, px * 0.36));
  const eyeY = -hh * 0.26;
  const eyeR = shape.eye * 1.3 * species.eyeScale;
  drawEye(ctx, { x: eyeX, y: eyeY, r: eyeR, lookX: 0.3, lookY: 0.12 });
  if (detail >= 1) drawMouth(ctx, shape.mouth, peak, hh, w, colors.outline, eyeR, bite);
}

/* ------------------------------------------------------------------ *
 * Fins
 * ------------------------------------------------------------------ */

function paintTail(
  ctx: Ctx,
  shape: FishShape,
  colors: FishColors,
  w: number,
  swish: number,
  bend: number,
): void {
  const { hh, ped, tail: tl } = shape;
  const th = hh * 1.02;
  ctx.save();
  ctx.translate(shape.tip, 0);
  ctx.rotate(swish * bend * 1.5);
  switch (shape.tailKind) {
    case 'fork': {
      const f = tl * 0.44;
      ctx.beginPath();
      ctx.moveTo(0, -ped);
      ctx.quadraticCurveTo(tl * 0.5, -th * 0.5, tl, -th);
      ctx.quadraticCurveTo(tl - f, -f, tl * 0.52, 0);
      ctx.quadraticCurveTo(tl - f, f, tl, th);
      ctx.quadraticCurveTo(tl * 0.5, th * 0.5, 0, ped);
      ctx.closePath();
      break;
    }
    case 'lunate': {
      const f = tl * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, -ped);
      ctx.quadraticCurveTo(tl * 0.7, -th * 1.05, tl * 1.02, -th * 1.1);
      ctx.quadraticCurveTo(tl - f, -f * 0.6, tl * 0.5, 0);
      ctx.quadraticCurveTo(tl - f, f * 0.6, tl * 1.02, th * 1.1);
      ctx.quadraticCurveTo(tl * 0.7, th * 1.05, 0, ped);
      ctx.closePath();
      break;
    }
    case 'crescent': {
      ctx.beginPath();
      ctx.moveTo(0, -ped);
      ctx.quadraticCurveTo(tl * 0.95, -th * 1.15, tl * 1.1, -th * 0.5);
      ctx.quadraticCurveTo(tl * 0.35, 0, tl * 1.1, th * 0.5);
      ctx.quadraticCurveTo(tl * 0.95, th * 1.15, 0, ped);
      ctx.closePath();
      break;
    }
    case 'pennant': {
      ctx.beginPath();
      ctx.moveTo(0, -ped);
      ctx.quadraticCurveTo(tl * 0.6, -th * 1.5, tl * 1.25, -th * 0.35);
      ctx.quadraticCurveTo(tl * 1.3, th * 0.3, tl * 0.5, 0);
      ctx.quadraticCurveTo(tl * 1.3, th * 0.75, tl * 1.2, th * 1.15);
      ctx.quadraticCurveTo(tl * 0.6, th * 1.5, 0, ped);
      ctx.closePath();
      break;
    }
    case 'round': {
      ctx.beginPath();
      ctx.moveTo(0, -ped);
      ctx.bezierCurveTo(tl * 0.6, -th * 1.15, tl * 1.15, -th * 0.72, tl * 1.08, 0);
      ctx.bezierCurveTo(tl * 1.15, th * 0.72, tl * 0.6, th * 1.15, 0, ped);
      ctx.closePath();
      break;
    }
    case 'fan':
    default: {
      ctx.beginPath();
      ctx.moveTo(0, -ped);
      ctx.quadraticCurveTo(tl * 0.45, -th * 1.02, tl * 1.05, -th * 0.78);
      ctx.quadraticCurveTo(tl * 1.28, 0, tl * 1.05, th * 0.78);
      ctx.quadraticCurveTo(tl * 0.45, th * 1.02, 0, ped);
      ctx.closePath();
      break;
    }
  }
  fs(ctx, colors.fin, w);
  ctx.restore();
}

function paintDorsal(
  ctx: Ctx,
  shape: FishShape,
  colors: FishColors,
  w: number,
  swish: number,
): void {
  const { hh, peak } = shape;
  const x0 = Math.min(shape.tip - 0.08, peak) * 0.6;
  const y0 = -bodyTop(shape, x0);
  const tipX = peak * 0.5 + shape.dorsal * 0.5;
  ctx.save();
  ctx.rotate(swish * 0.05);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(
    x0 + shape.dorsal * 0.12,
    -hh - shape.dorsal * hh * 1.1,
    x0 + shape.dorsal * 0.44,
    -hh - shape.dorsal * hh * 0.9,
  );
  ctx.quadraticCurveTo(
    x0 + shape.dorsal * 0.84,
    -hh - shape.dorsal * hh * 0.4,
    tipX,
    -bodyTop(shape, Math.max(x0 + 0.05, tipX)),
  );
  ctx.closePath();
  fs(ctx, colors.fin, w);
  ctx.restore();
}

function paintAnal(
  ctx: Ctx,
  shape: FishShape,
  colors: FishColors,
  w: number,
  swish: number,
): void {
  const { hh, peak } = shape;
  const x0 = Math.min(shape.tip - 0.08, peak) * 0.68;
  ctx.save();
  ctx.rotate(-swish * 0.06);
  ctx.beginPath();
  ctx.moveTo(x0, bodyTop(shape, x0));
  ctx.quadraticCurveTo(
    x0 + shape.anal * 0.22,
    hh + shape.anal * hh * 0.95,
    x0 + shape.anal * 0.58,
    hh + shape.anal * hh * 0.72,
  );
  ctx.quadraticCurveTo(x0 + shape.anal * 0.5, hh * 0.5, x0 + shape.anal * 0.88, bodyTop(shape, x0 + 0.18));
  ctx.closePath();
  fs(ctx, colors.fin, w);
  ctx.restore();
}

function paintPelvic(
  ctx: Ctx,
  shape: FishShape,
  colors: FishColors,
  w: number,
  swish: number,
): void {
  const { hh, peak } = shape;
  const x = Math.min(shape.tip - 0.08, peak) * 0.7;
  ctx.save();
  ctx.rotate(swish * 0.14 + 0.2);
  finPath(
    ctx,
    [
      { x, y: hh * 0.62 },
      { x: x + shape.pect * 0.4, y: hh + shape.pect * hh * 1.5 },
      { x: x + shape.pect * 0.78, y: hh * 0.58 },
    ],
    0.4,
  );
  fs(ctx, colors.fin, w * 0.95, OUTLINE, 0.95);
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Patterns
 * ------------------------------------------------------------------ */

function paintPattern(
  ctx: Ctx,
  kind: PatternKind,
  rng: () => number,
  shape: FishShape,
  colors: FishColors,
  detail = 2,
): void {
  const { hh, tip } = shape;
  switch (kind) {
    case 'plain':
      return;
    case 'dots': {
      const n = detail >= 2 ? 18 : 7;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = 0.08 + t * (tip - 0.16);
        const top = bodyTop(shape, x) * 0.76;
        const y = (rng() * 2 - 1) * top;
        dot(ctx, x, y, 0.008 + rng() * 0.008);
        ctx.fillStyle = colors.pattern;
        ctx.globalAlpha = 0.45 + rng() * 0.4;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    case 'scales': {
      const cols = detail >= 2 ? 7 : 3;
      const rows = detail >= 2 ? 4 : 3;
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = colors.pattern;
      ctx.lineWidth = 0.006;
      for (let c = 0; c < cols; c++) {
        const x = 0.16 + (c / cols) * (tip - 0.24);
        const top = bodyTop(shape, x);
        for (let r = 0; r < rows; r++) {
          const y = -top * 0.8 + (r / (rows - 1)) * top * 1.6;
          ctx.beginPath();
          ctx.arc(x, y, hh * 0.19, Math.PI * 0.15, Math.PI * 0.85);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      return;
    }
    case 'stripes': {
      ctx.globalAlpha = 0.5;
      const n = detail >= 1 ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const x = 0.22 + (i / n) * (tip - 0.28);
        const top = bodyTop(shape, x);
        ctx.beginPath();
        ctx.moveTo(x - 0.024, -top * 0.96);
        ctx.quadraticCurveTo(x + 0.038, 0, x - 0.024, top * 0.96);
        ctx.lineWidth = 0.009 + (i % 2) * 0.005;
        ctx.strokeStyle = colors.pattern;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
    case 'bars': {
      ctx.globalAlpha = 0.4;
      const n = detail >= 1 ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const x = 0.24 + (i / n) * (tip - 0.32);
        const top = bodyTop(shape, x) * 1.02;
        ctx.beginPath();
        ctx.moveTo(x, -top);
        ctx.lineTo(x + 0.1, -top);
        ctx.quadraticCurveTo(x + 0.08, 0, x + 0.1, top);
        ctx.lineTo(x, top);
        ctx.quadraticCurveTo(x + 0.02, 0, x, -top);
        ctx.closePath();
        ctx.fillStyle = colors.pattern;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    case 'patches': {
      ctx.globalAlpha = 0.38;
      const n = detail >= 1 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const x = 0.32 + i * 0.2;
        const top = bodyTop(shape, x);
        ellipsePath(ctx, x, -top * 0.16 + (i - 1) * hh * 0.3, 0.09, top * 0.32, 0.3);
        ctx.fillStyle = colors.pattern;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    case 'saddle': {
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = colors.pattern;
      const n = detail >= 1 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const x = 0.22 + i * 0.23;
        const top = bodyTop(shape, x) * 1.06;
        ctx.beginPath();
        ctx.moveTo(x, -top);
        ctx.quadraticCurveTo(x + 0.07, -top * 0.42, x + 0.14, -top);
        ctx.quadraticCurveTo(x + 0.07, -top * 0.12, x, -top);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + 0.01, top);
        ctx.quadraticCurveTo(x + 0.08, top * 0.42, x + 0.15, top);
        ctx.quadraticCurveTo(x + 0.08, top * 0.12, x + 0.01, top);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    case 'tiger': {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = colors.pattern;
      ctx.lineWidth = 0.011;
      ctx.lineCap = 'round';
      const n = detail >= 1 ? 7 : 3;
      for (let i = 0; i < n; i++) {
        const x = 0.16 + (i / n) * (tip - 0.16);
        const top = bodyTop(shape, x) * 1.02;
        ctx.beginPath();
        ctx.moveTo(x, -top);
        ctx.quadraticCurveTo(x + 0.05, -top * 0.3, x + 0.02, top * 0.12);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
    case 'spot-eye': {
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = colors.pattern;
      ctx.beginPath();
      ctx.moveTo(0.06, -bodyTop(shape, 0.06) * 1.04);
      ctx.quadraticCurveTo(0.15, 0, 0.22, bodyTop(shape, 0.22) * 1.04);
      ctx.lineTo(0.08, bodyTop(shape, 0.08) * 1.04);
      ctx.lineTo(0.0, -bodyTop(shape, 0.0) * 1.04);
      ctx.closePath();
      ctx.fill();
      dot(ctx, tip - 0.13, -hh * 0.2, hh * 0.32);
      ctx.fill();
      if (detail >= 1) {
        dot(ctx, tip - 0.13, -hh * 0.2, hh * 0.15);
        ctx.fillStyle = colors.accent;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    case 'striped-eye': {
      // The only per-fish gradient in the tank: one species, never scaled up.
      const grad = ctx.createLinearGradient(0, 0, tip * 1.02, 0);
      grad.addColorStop(0, colors.accent);
      grad.addColorStop(0.4, colors.body);
      grad.addColorStop(1, colors.pattern);
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = grad;
      ctx.fillRect(-0.02, -hh * 1.1, tip * 1.05, hh * 2.2);
      ctx.globalAlpha = 1;
      return;
    }
    default:
      return;
  }
}

/* ------------------------------------------------------------------ *
 * Head details
 * ------------------------------------------------------------------ */

function drawMouth(
  ctx: Ctx,
  kind: MouthKind,
  peak: number,
  hh: number,
  w: number,
  outline: string,
  eyeR: number,
  bite = 0,
): void {
  ctx.save();
  ctx.lineWidth = w * 1.15;
  ctx.strokeStyle = outline;
  ctx.lineCap = 'round';
  const mx = Math.max(0.012, peak * 0.12);
  const my = hh * 0.3;
  // A fish taking a crumb opens its jaw: the lip line drops and a dark gap
  // appears behind it. It is the only cue that says *eating* rather than
  // merely arriving, and it costs one extra path.
  const open = clamp01(bite) * hh * 0.42;
  if (open > 0.01) {
    ctx.beginPath();
    ctx.ellipse(mx + 0.03, my + open * 0.5, 0.055, open, 0.18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(38,14,20,0.72)';
    ctx.fill();
  }
  ctx.beginPath();
  switch (kind) {
    case 'grin':
    case 'smile':
      ctx.moveTo(mx - 0.014, my - hh * 0.18);
      ctx.quadraticCurveTo(mx + 0.014, my + hh * 0.14, mx + 0.04, my - hh * 0.06);
      break;
    case 'wide':
      ctx.moveTo(mx - 0.022, my - hh * 0.26);
      ctx.quadraticCurveTo(mx + 0.034, my + hh * 0.2, mx + 0.064, my - hh * 0.18);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx - 0.022, my - hh * 0.26);
      ctx.quadraticCurveTo(mx + 0.02, my - hh * 0.02, mx + 0.064, my - hh * 0.18);
      ctx.closePath();
      ctx.fillStyle = 'rgba(24,12,20,0.45)';
      ctx.fill();
      ctx.restore();
      return;
    case 'frown':
      ctx.moveTo(mx - 0.016, my + hh * 0.04);
      ctx.quadraticCurveTo(mx + 0.014, my - hh * 0.12, mx + 0.04, my + hh * 0.04);
      break;
    case 'beak':
      ctx.moveTo(mx - 0.01, my - hh * 0.32);
      ctx.quadraticCurveTo(mx + 0.044, my - hh * 0.1, mx + 0.03, my + hh * 0.1);
      ctx.quadraticCurveTo(mx + 0.008, my + hh * 0.02, mx - 0.01, my - hh * 0.32);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,236,214,0.92)';
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    case 'pout':
      ctx.moveTo(mx - 0.006, my - hh * 0.04);
      ctx.quadraticCurveTo(mx + 0.022, my + hh * 0.16, mx + 0.048, my - hh * 0.02);
      break;
    case 'tiny':
    default:
      ctx.moveTo(mx - 0.006, my);
      ctx.quadraticCurveTo(mx + 0.014, my + hh * 0.12, mx + 0.032, my);
      break;
  }
  ctx.stroke();
  if (kind === 'grin' || kind === 'smile' || kind === 'tiny') {
    ctx.beginPath();
    ctx.ellipse(mx + 0.06, my + hh * 0.18, eyeR * 0.85, eyeR * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,140,150,0.26)';
    ctx.fill();
  }
  ctx.restore();
}
