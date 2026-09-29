import type { Creature } from '../sim/types';
import {
  dot,
  drawEye,
  finPath,
  OUTLINE,
  polyPath,
  spinePoints,
  spineStroke,
  type Ctx,
} from './art';
import { hashRng, paintFish, type FishColors } from './fish';

export interface PaintArgs {
  ctx: Ctx;
  creature: Creature;
  colors: FishColors;
  /** Global seconds, for ambient idle motion. */
  time: number;
  /** 0..1 — 1 is a full-speed dash, 0 is a lazy hover. */
  speed01: number;
  /** Smoothed pointer interest, 0..1. */
  attention: number;
  /**
   * Level of detail, 0..2. Small or distant animals drop the marks that would
   * be sub-pixel anyway — which is also most of the per-frame cost.
   */
  detail?: number;
  /** Floor for outline width, in body-length units. */
  ink?: number;
}

/** Count scaled to the level of detail. */
function n(detail: number, full: number, mid: number, low: number): number {
  return detail >= 2 ? full : detail === 1 ? mid : low;
}

/** Body length of the fish rig in body-length units. See `RIG_EXTENT.fish`. */
const FISH_RIG_LEN = 1.05;

/** Paint any creature in body-length units, nose/front at +x.
 *  `paintCreatureUpright` handles animals drawn standing up rather than
 *  streamlined along their direction of travel. */
export function paintCreature(args: PaintArgs): void {
  const rig = args.creature.species.body.rig;
  switch (rig) {
    case 'fish':
      // `paintFish` is authored nose at 0, tail at +1 — the mirror image of
      // every other rig, which is drawn nose at +x and centred on the point the
      // simulation steers. Mirror it, once, and shift by half a body, so a fish
      // swimming right is drawn head first *and* sits centred where the sim says
      // it is, instead of being towed backwards.
      args.ctx.save();
      args.ctx.scale(-1, 1);
      args.ctx.translate(-FISH_RIG_LEN / 2, 0);
      paintFish(
        args.ctx,
        args.creature.species,
        args.colors,
        args.creature.phase,
        args.speed01,
        args.detail ?? 2,
        args.ink,
        args.creature.bite,
      );
      args.ctx.restore();
      return;
    case 'jelly':
      paintJelly(args);
      return;
    case 'octopus':
      paintOctopus(args);
      return;
    case 'turtle':
      paintTurtle(args);
      return;
    case 'shark':
      paintShark(args);
      return;
    case 'whale':
      paintWhale(args);
      return;
    case 'ray':
      paintRay(args);
      return;
    case 'mermaid':
      paintMermaid(args);
      return;
    case 'squid':
      paintSquid(args);
      return;
    case 'seahorse':
      paintSeahorse(args);
      return;
    case 'crab':
      paintCrab(args);
      return;
    case 'starfish':
      paintStarfish(args);
      return;
    default:
      return;
  }
}

function fs(ctx: Ctx, color: string, width = 0.01, outline = OUTLINE, alpha = 1): void {
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

function eyes(ctx: Ctx, x: number, y: number, r: number) {
  drawEye(ctx, { x, y, r, lookX: 0.2, lookY: 0.05 });
}

/* ------------------------------------------------------------------ *
 * Blue whale — nose at +0.5, flukes at -0.5
 * ------------------------------------------------------------------ */

/**
 * The largest animal that has ever lived, drawn as flat vector: a long
 * streamlined body, a broad blunt rostrum, a tiny hooked dorsal fin, and
 * flukes that sweep back with a notch between them. The whole point of it in
 * the tank is scale — nothing else is close — so it is built to read as one
 * silhouette at a glance rather than to carry detail.
 */
function paintWhale({ ctx, creature, colors, time, detail = 2 }: PaintArgs): void {
  const w = 0.009;
  const swish = Math.sin(creature.phase);
  const swish2 = Math.sin(creature.phase - 0.9);
  const slow = Math.sin(time * 0.35 + creature.phase * 0.2);

  // flukes
  ctx.save();
  ctx.translate(-0.47, 0);
  ctx.rotate(swish * 0.16);
  ctx.beginPath();
  ctx.moveTo(0.01, 0);
  ctx.quadraticCurveTo(-0.07, -0.06, -0.14, -0.15);
  ctx.quadraticCurveTo(-0.06, -0.1, -0.004, -0.042);
  ctx.quadraticCurveTo(0.006, -0.018, 0.01, 0);
  ctx.quadraticCurveTo(-0.004, 0.042, -0.14, 0.15);
  ctx.quadraticCurveTo(-0.07, 0.06, 0.01, 0);
  ctx.closePath();
  fs(ctx, colors.fin, w, colors.outline, 0.96);
  ctx.restore();

  // dorsal fin — a small hooked nub three quarters back
  ctx.beginPath();
  ctx.moveTo(-0.13, -0.078);
  ctx.quadraticCurveTo(-0.19, -0.108, -0.25, -0.104);
  ctx.quadraticCurveTo(-0.2, -0.094, -0.19, -0.072);
  ctx.closePath();
  fs(ctx, colors.fin, w * 0.9, colors.outline, 0.96);

  // pectoral fin
  ctx.save();
  ctx.rotate(swish2 * 0.1 + 0.45);
  finPath(
    ctx,
    [
      { x: 0.2, y: 0.06 },
      { x: 0.13, y: 0.11 },
      { x: 0.11, y: 0.14 },
    ],
    0.55,
  );
  fs(ctx, colors.fin, w * 0.85, colors.outline, 0.9);
  ctx.restore();

  /* ------------------------------ body ------------------------------ */
  ctx.beginPath();
  ctx.moveTo(0.5, 0);
  ctx.bezierCurveTo(0.42, -0.056, 0.26, -0.088, 0.08, -0.09);
  ctx.bezierCurveTo(-0.1, -0.092, -0.3, -0.062, -0.47, -0.02);
  ctx.lineTo(-0.47, 0.02);
  ctx.bezierCurveTo(-0.3, 0.056, -0.1, 0.084, 0.08, 0.082);
  ctx.bezierCurveTo(0.26, 0.08, 0.42, 0.05, 0.5, 0);
  ctx.closePath();
  fs(ctx, colors.body, w, colors.outline);

  ctx.save();
  ctx.clip();
  // dark back
  ctx.beginPath();
  ctx.moveTo(0.5, -0.01);
  ctx.bezierCurveTo(0.26, -0.1, -0.1, -0.11, -0.47, -0.03);
  ctx.lineTo(-0.5, -0.3);
  ctx.lineTo(0.55, -0.3);
  ctx.closePath();
  ctx.fillStyle = 'rgba(12,32,58,0.3)';
  ctx.fill();
  // pale belly
  ctx.beginPath();
  ctx.moveTo(0.5, 0.005);
  ctx.bezierCurveTo(0.26, 0.086, -0.1, 0.09, -0.47, 0.026);
  ctx.lineTo(-0.5, 0.3);
  ctx.lineTo(0.55, 0.3);
  ctx.closePath();
  ctx.fillStyle = colors.belly ?? '#e8f1f8';
  ctx.globalAlpha = 0.72;
  ctx.fill();
  ctx.globalAlpha = 1;
  // mottling along the flank
  if (detail >= 1) {
    const spots = n(detail, 16, 8, 0);
    const rng = hashRng('whale');
    ctx.fillStyle = colors.pattern;
    for (let i = 0; i < spots; i++) {
      dot(ctx, -0.42 + rng() * 0.8, -0.07 + rng() * 0.09, 0.006 + rng() * 0.008);
      ctx.globalAlpha = 0.22;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // ventral pleats along the throat
  if (detail >= 1) {
    ctx.strokeStyle = colors.outline;
    ctx.globalAlpha = 0.24;
    ctx.lineWidth = 0.004;
    const pleats = n(detail, 7, 4, 0);
    for (let i = 0; i < pleats; i++) {
      const y = 0.03 + i * 0.012;
      ctx.beginPath();
      ctx.moveTo(0.47, y * 0.5);
      ctx.quadraticCurveTo(0.36, y * 1.5, 0.22, y * 1.9);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // jaw line, running most of the length of the head
  ctx.beginPath();
  ctx.moveTo(0.49, 0.006);
  ctx.quadraticCurveTo(0.38, 0.036 + slow * 0.002, 0.24, 0.05);
  ctx.lineWidth = 0.01;
  ctx.strokeStyle = colors.outline;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.7;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // blowhole
  if (detail >= 1) {
    dot(ctx, 0.23, -0.083, 0.008);
    ctx.fillStyle = colors.outline;
    ctx.globalAlpha = 0.6;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // eye, small and set well back above the jaw
  eyes(ctx, 0.315, -0.008, 0.017);
}

/* ------------------------------------------------------------------ *
 * Jellyfish — bell at +x, tentacles trailing to -x
 * ------------------------------------------------------------------ */

function paintJelly({ ctx, creature, colors, time, speed01, detail = 2 }: PaintArgs): void {
  const pulse = Math.sin(creature.phase);
  const contract = 0.5 + 0.5 * Math.cos(creature.phase);
  const bellW = 0.34 + 0.06 * pulse;
  const bellH = 0.3 - 0.05 * pulse;
  const bellX = 0.42 - pulse * 0.02;
  const w = 0.012;

  // trailing tentacles first
  const tent = n(detail, 9, 6, 4);
  for (let i = 0; i < tent; i++) {
    const t = i / (tent - 1);
    const yBase = (t - 0.5) * bellH * 1.5;
    const len = 0.7 + Math.sin(creature.phase * 0.7 + i) * 0.18 + t * 0.14;
    const sway = Math.sin(time * 1.1 + i * 0.9 + creature.phase * 0.4) * 0.28;
    spineStroke(ctx, bellX - bellW * 0.5 + 0.03, yBase, len / 5, [0.5 + sway, 0.42 + sway * 0.8, 0.5 + sway * 0.6, 0.6, 0.7], {
      w: 0.028 - t * 0.008,
      wEnd: 0.008,
      color: colors.fin,
      edge: colors.outline,
      edgeWidth: 0.006,
      alpha: 0.72,
    });
  }
  // frilly oral arms
  const arms = n(detail, 4, 3, 2);
  for (let i = 0; i < arms; i++) {
    const t = i / (arms - 1);
    const yBase = (t - 0.5) * bellH * 0.9;
    const sway = Math.sin(time * 1.5 + i * 1.3) * 0.34;
    spineStroke(ctx, bellX - 0.04, yBase, 0.13, [0.9 + sway, 0.7 + sway * 0.6, 0.8], {
      w: 0.05,
      wEnd: 0.02,
      color: colors.belly ?? colors.body,
      edge: colors.outline,
      edgeWidth: 0.006,
      alpha: 0.85,
    });
  }

  // bell
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bellX - bellW, 0);
  ctx.bezierCurveTo(bellX - bellW * 1.05, -bellH * 1.9, bellX + bellW * 1.05, -bellH * 1.9, bellX + bellW, 0);
  // scalloped rim, pulled in as the bell contracts
  const rim = 6;
  for (let i = 0; i <= rim; i++) {
    const t = 1 - i / rim;
    const x = bellX - bellW + t * bellW * 2;
    const dip = Math.sin(i * Math.PI) * (0.05 - contract * 0.02);
    ctx.quadraticCurveTo(x + bellW / rim, dip, x, 0);
  }
  ctx.closePath();
  fs(ctx, colors.body, w, colors.outline, 0.94);
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(bellX + 0.06, -bellH * 0.36, bellW * 0.5, bellH * 0.44, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(bellX, 0.02, bellW * 1.05, bellH * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = colors.pattern;
  ctx.globalAlpha = 0.32;
  ctx.fill();
  ctx.globalAlpha = 1;
  // gonad rings on the underside
  const rings = n(detail, 4, 4, 0);
  for (let i = 0; i < rings; i++) {
    const a = (i / rings) * Math.PI * 2 + time * 0.2;
    dot(ctx, bellX + Math.cos(a) * bellW * 0.42, -bellH * 0.1 + Math.sin(a) * bellH * 0.3, bellW * 0.16);
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = 0.01;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.restore();

  if (speed01 > 0.02) {
    // trailing water disturbance
    ctx.beginPath();
    ctx.ellipse(-0.35, 0, 0.16, bellH * 0.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
  }
}

/* ------------------------------------------------------------------ *
 * Octopus — mantle at +x, arms trailing
 * ------------------------------------------------------------------ */

function paintOctopus({ ctx, creature, colors, time, detail = 2 }: PaintArgs): void {
  const w = 0.012;
  const excite = Math.max(creature.panic, creature.attention * 0.6);
  const body = excite > 0.35 ? colors.pattern : colors.body;
  const headR = 0.28 + excite * 0.02;
  const headX = 0.2;
  // 0..1 siphon pulse: the arms gather, then sweep back and drive the animal up
  const stroke = Math.max(0, Math.sin(creature.a * Math.PI * 2));

  // arms — the sucker dots are the first thing to go at low detail
  const arms = n(detail, 8, 6, 4);
  const suckers = detail >= 2;
  for (let i = 0; i < arms; i++) {
    const t = i / (arms - 1);
    const spread = (t - 0.5) * 1.5;
    const baseY = (t - 0.5) * 0.3;
    const sway = Math.sin(time * 1.6 + i * 1.7 + creature.phase * 0.9);
    const curl = 0.55 + Math.abs(t - 0.5) * 0.9 - excite * 0.22 + stroke * 0.3;
    const seg = 0.1;
    const angles = [
      Math.PI + spread * 0.55 + sway * 0.1,
      spread * 0.35 + curl * 0.35 + sway * 0.16,
      curl * 0.4 + sway * 0.2,
      curl * 0.36 + sway * 0.22,
      curl * 0.3 + sway * 0.2,
    ];
    const startX = headX - headR * 0.5;
    spineStroke(ctx, startX, baseY, seg, angles, {
      w: 0.058 - t * 0.006,
      wEnd: 0.012,
      color: i % 2 === 0 ? body : colors.fin,
      edge: colors.outline,
      edgeWidth: 0.007,
      alpha: 1,
    });
    // suckers
    if (!suckers) continue;
    const pts = spinePoints(startX, baseY, 0.1, angles);
    ctx.fillStyle = colors.accent;
    for (let p = 1; p < pts.length; p++) {
      ctx.globalAlpha = 0.6 - p * 0.06;
      dot(ctx, pts[p].x + 0.012, pts[p].y + 0.014, 0.008);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // mantle
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(headX + headR * 0.2, headR * 0.72);
  ctx.bezierCurveTo(headX + headR * 1.5, headR * 0.96, headX + headR * 1.65, -headR * 0.5, headX + headR * 0.5, -headR * 0.92);
  ctx.bezierCurveTo(headX - headR * 0.2, -headR * 1.05, headX - headR * 0.85, -headR * 0.5, headX - headR * 0.72, headR * 0.1);
  ctx.bezierCurveTo(headX - headR * 0.6, headR * 0.7, headX - headR * 0.3, headR * 0.82, headX + headR * 0.2, headR * 0.72);
  ctx.closePath();
  fs(ctx, body, w, colors.outline);
  ctx.save();
  ctx.clip();
  const spots = n(detail, 26, 12, 0);
  const spotRng = hashRng('octo');
  for (let i = 0; i < spots; i++) {
    const a = spotRng() * Math.PI * 2;
    const rr = spotRng() * headR * 0.9;
    dot(ctx, headX + Math.cos(a) * rr, Math.sin(a) * rr * 0.8, 0.008 + spotRng() * 0.01);
    ctx.fillStyle = colors.pattern;
    ctx.globalAlpha = 0.35;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (detail >= 1) {
    ctx.beginPath();
    ctx.ellipse(headX + headR * 0.4, -headR * 0.5, headR * 0.5, headR * 0.24, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();

  // eyes — big, with a brow when excited
  const eyeR = 0.088;
  const eyeX = headX + headR * 0.24;
  eyes(ctx, eyeX, -headR * 0.22, eyeR);
  eyes(ctx, eyeX - eyeR * 1.15, -headR * 0.34, eyeR * 0.82);
  if (excite > 0.2) {
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = 0.014;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(eyeX - eyeR * 0.9, -headR * 0.22 - eyeR * 1.5);
    ctx.lineTo(eyeX + eyeR * 1.05, -headR * 0.22 - eyeR * 1.9);
    ctx.stroke();
  }
  // siphon
  ctx.beginPath();
  ctx.moveTo(headX - headR * 0.6, -headR * 0.34);
  ctx.quadraticCurveTo(headX - headR * 1.1, -headR * 0.6, headX - headR * 1.25, -headR * 0.16);
  ctx.lineWidth = 0.034;
  ctx.strokeStyle = colors.fin;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/* ------------------------------------------------------------------ *
 * Sea turtle
 * ------------------------------------------------------------------ */

function paintTurtle({ ctx, creature, colors, time }: PaintArgs): void {
  const w = 0.009;
  const paddle = Math.sin(creature.phase);
  const paddle2 = Math.sin(creature.phase - 0.9);

  // rear flippers
  drawFlipper(ctx, -0.34, 0.14, 0.2, 0.22, -0.5 + paddle2 * 0.3, colors.fin, w);
  drawFlipper(ctx, -0.34, -0.14, 0.2, 0.22, 0.5 - paddle2 * 0.3, colors.fin, w);

  // shell
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.42, 0.34, 0, 0, Math.PI * 2);
  fs(ctx, colors.body, w * 1.2, colors.outline);
  ctx.save();
  ctx.clip();
  // scute pattern
  ctx.strokeStyle = colors.pattern;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 0.012;
  for (let i = 0; i < 5; i++) {
    const x = -0.26 + i * 0.13;
    ctx.beginPath();
    ctx.ellipse(x, 0, 0.055, 0.26 - Math.abs(x) * 0.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.4, 0.15, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // rim shading
  ctx.beginPath();
  ctx.ellipse(-0.06, 0, 0.46, 0.38, 0, 0, Math.PI * 2);
  ctx.lineWidth = 0.06;
  ctx.strokeStyle = 'rgba(20,60,40,0.22)';
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0.06, -0.16, 0.27, 0.1, -0.25, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fill();
  ctx.restore();
  ctx.restore();

  // front flippers
  drawFlipper(ctx, 0.16, 0.2, 0.34, 0.2, 0.85 - paddle * 0.55, colors.fin, w);
  drawFlipper(ctx, 0.16, -0.2, 0.34, 0.2, -0.85 + paddle * 0.55, colors.fin, w);

  // head
  ctx.save();
  ctx.translate(0.46, 0);
  ctx.beginPath();
  ctx.ellipse(0.06, 0, 0.13, 0.1, 0, 0, Math.PI * 2);
  fs(ctx, colors.body, w, colors.outline);
  ctx.beginPath();
  ctx.moveTo(0.15, 0.03);
  ctx.quadraticCurveTo(0.2, 0.0, 0.15, -0.03);
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = colors.outline;
  ctx.stroke();
  eyes(ctx, 0.07, -0.03, 0.042);
  ctx.restore();

  // tail
  ctx.beginPath();
  ctx.moveTo(-0.4, -0.06);
  ctx.quadraticCurveTo(-0.5, 0, -0.52, 0.02);
  ctx.quadraticCurveTo(-0.48, 0.05, -0.4, 0.05);
  fs(ctx, colors.fin, w * 0.8);

  if (Math.sin(time * 0.6 + creature.phase) > 0.98) {
    // occasional bubble from the nostrils
    dot(ctx, 0.62, -0.04, 0.02);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fill();
  }
}

function drawFlipper(
  ctx: Ctx,
  x: number,
  y: number,
  len: number,
  wide: number,
  angle: number,
  color: string,
  w: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -wide * 0.4);
  ctx.quadraticCurveTo(len * 0.6, -wide, len, -wide * 0.28);
  ctx.quadraticCurveTo(len * 1.05, wide * 0.3, len * 0.6, wide * 0.62);
  ctx.quadraticCurveTo(len * 0.2, wide * 0.6, 0, wide * 0.4);
  ctx.closePath();
  fs(ctx, color, w);
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Reef shark — nose at +0.5
 * ------------------------------------------------------------------ */

function paintShark({ ctx, creature, colors, time }: PaintArgs): void {
  const w = 0.011;
  const swish = Math.sin(creature.phase);
  const swish2 = Math.sin(creature.phase - 0.8);

  // tail
  ctx.save();
  ctx.translate(-0.5, 0);
  ctx.rotate(swish * 0.22);
  ctx.beginPath();
  ctx.moveTo(0, -0.02);
  ctx.quadraticCurveTo(-0.06, -0.2, -0.02, -0.34);
  ctx.quadraticCurveTo(0.03, -0.18, 0.06, -0.02);
  ctx.quadraticCurveTo(0.09, 0.1, 0.02, 0.2);
  ctx.quadraticCurveTo(-0.03, 0.12, 0, -0.02);
  ctx.closePath();
  fs(ctx, colors.fin, w);
  ctx.restore();

  // dorsal
  ctx.beginPath();
  ctx.moveTo(0.02, -0.16);
  ctx.quadraticCurveTo(0.0, -0.4, -0.12, -0.42);
  ctx.quadraticCurveTo(-0.06, -0.26, -0.1, -0.14);
  ctx.closePath();
  fs(ctx, colors.fin, w);

  // pectoral
  ctx.save();
  ctx.rotate(swish2 * 0.12 + 0.3);
  finPath(
    ctx,
    [
      { x: 0.06, y: 0.1 },
      { x: -0.06, y: 0.3 },
      { x: -0.2, y: 0.28 },
    ],
    0.5,
  );
  fs(ctx, colors.fin, w);
  ctx.restore();

  // anal + pelvic
  ctx.beginPath();
  ctx.moveTo(-0.3, 0.12);
  ctx.quadraticCurveTo(-0.34, 0.24, -0.42, 0.22);
  ctx.quadraticCurveTo(-0.36, 0.14, -0.34, 0.1);
  ctx.closePath();
  fs(ctx, colors.fin, w);

  // body
  ctx.beginPath();
  ctx.moveTo(0.5, 0.0);
  ctx.bezierCurveTo(0.42, -0.16, 0.2, -0.2, -0.04, -0.17);
  ctx.bezierCurveTo(-0.24, -0.14, -0.38, -0.08, -0.5, -0.02);
  ctx.lineTo(-0.5, 0.02);
  ctx.bezierCurveTo(-0.38, 0.08, -0.24, 0.14, -0.04, 0.17);
  ctx.bezierCurveTo(0.2, 0.2, 0.42, 0.14, 0.5, 0.0);
  ctx.closePath();
  fs(ctx, colors.body, w, colors.outline);
  ctx.save();
  ctx.clip();
  // white belly
  ctx.beginPath();
  ctx.moveTo(0.48, 0.06);
  ctx.bezierCurveTo(0.2, 0.24, -0.2, 0.2, -0.5, 0.04);
  ctx.lineTo(-0.5, 0.4);
  ctx.lineTo(0.54, 0.4);
  ctx.closePath();
  ctx.fillStyle = colors.belly ?? '#ffffff';
  ctx.fill();
  // back shading
  ctx.beginPath();
  ctx.moveTo(0.5, -0.02);
  ctx.bezierCurveTo(0.2, -0.24, -0.2, -0.22, -0.5, -0.03);
  ctx.lineTo(-0.5, -0.4);
  ctx.lineTo(0.54, -0.4);
  ctx.closePath();
  ctx.fillStyle = 'rgba(10,26,44,0.3)';
  ctx.fill();
  ctx.restore();

  // gill slits
  ctx.strokeStyle = colors.outline;
  ctx.lineWidth = 0.012;
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < 5; i++) {
    const x = 0.24 - i * 0.035;
    ctx.beginPath();
    ctx.moveTo(x, -0.1);
    ctx.quadraticCurveTo(x - 0.02, 0, x, 0.1);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // mouth + eye
  const gape = 0.02 + Math.max(0, Math.sin(time * 0.5 + creature.phase * 0.3)) * 0.02;
  ctx.beginPath();
  ctx.moveTo(0.5, 0.05);
  ctx.quadraticCurveTo(0.4, 0.09 + gape, 0.28, 0.07);
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = colors.outline;
  ctx.lineCap = 'round';
  ctx.stroke();
  eyes(ctx, 0.36, -0.05, 0.032);
  // black fin tips
  ctx.beginPath();
  ctx.moveTo(0.02, -0.16);
  ctx.quadraticCurveTo(-0.04, -0.34, -0.12, -0.42);
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = colors.accent;
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ *
 * Eagle ray — gliding wings
 * ------------------------------------------------------------------ */

function paintRay({ ctx, creature, colors, time, detail = 2 }: PaintArgs): void {
  const w = 0.011;
  const flap = Math.sin(creature.phase);
  const flap2 = Math.sin(creature.phase - 0.7);
  const span = 0.52;
  const nose = 0.42;

  // tail
  ctx.beginPath();
  ctx.moveTo(-0.3, 0);
  ctx.quadraticCurveTo(-0.5, 0.02 + flap * 0.02, -0.72, 0.06 + flap2 * 0.05);
  ctx.lineWidth = 0.03;
  ctx.strokeStyle = colors.fin;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.lineWidth = 0.008;
  ctx.strokeStyle = colors.outline;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // wings + disc
  ctx.beginPath();
  ctx.moveTo(nose, 0);
  ctx.bezierCurveTo(nose * 0.6, -0.12 - flap * 0.03, 0.1, -0.3 - flap * 0.06, -0.12, -span - flap * 0.07);
  ctx.quadraticCurveTo(-0.28, -0.34 - flap * 0.04, -0.34, -0.06);
  ctx.lineTo(-0.34, 0.06);
  ctx.quadraticCurveTo(-0.28, 0.34 + flap2 * 0.04, -0.12, span + flap2 * 0.07);
  ctx.bezierCurveTo(0.1, 0.3 + flap2 * 0.06, nose * 0.6, 0.12 + flap2 * 0.03, nose, 0);
  ctx.closePath();
  fs(ctx, colors.body, w, colors.outline);

  ctx.save();
  ctx.clip();
  // pale underside glow along the leading edge
  ctx.beginPath();
  ctx.ellipse(nose * 0.4, 0, 0.2, 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(240,248,255,0.28)';
  ctx.fill();
  // spots
  const rng = hashRng('ray');
  const spots = n(detail, 22, 10, 0);
  for (let i = 0; i < spots; i++) {
    const x = -0.28 + rng() * 0.6;
    const y = (rng() * 2 - 1) * 0.34;
    dot(ctx, x, y, 0.012 + rng() * 0.014);
    ctx.fillStyle = colors.pattern;
    ctx.globalAlpha = 0.7;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // cephalic fins + eyes on top of the disc
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(nose * 0.9, s * 0.06);
    ctx.rotate(s * 0.5);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(0.08, -0.02, 0.1, 0.03);
    ctx.quadraticCurveTo(0.04, 0.05, 0, 0.02);
    ctx.closePath();
    fs(ctx, colors.fin, w * 0.8);
    ctx.restore();
  }
  eyes(ctx, nose * 0.72, -0.08, 0.032);
  eyes(ctx, nose * 0.72, 0.08, 0.032);
  // pale shimmer sweep with the flap
  ctx.beginPath();
  ctx.ellipse(-0.02, 0, 0.3, 0.1 + Math.abs(flap) * 0.03, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  void time;
}

/* ------------------------------------------------------------------ *
 * Squid — mantle cone at +x, arms at -x
 * ------------------------------------------------------------------ */

function paintSquid({ ctx, creature, colors, time, detail = 2 }: PaintArgs): void {
  const w = 0.012;
  const jet = creature.a; // 0..1 mantle contraction state
  const mantleLen = 0.58 - jet * 0.1;
  const mantleH = 0.15 + jet * 0.05;

  // arms + two long tentacles
  const armCount = n(detail, 10, 7, 5);
  for (let i = 0; i < armCount; i++) {
    const t = i / (armCount - 1);
    const spread = (t - 0.5) * 1.7;
    const isTentacle = i === 3 || i === 6;
    const len = isTentacle ? 0.5 : 0.28;
    const sway = Math.sin(time * 3 + i * 1.9) * 0.3;
    spineStroke(ctx, -mantleLen * 0.5 - 0.02, (t - 0.5) * mantleH * 1.1, len / 4, [
      Math.PI + spread * 0.5,
      spread * 0.3 + sway * 0.3,
      spread * 0.2 + sway * 0.3,
      sway * 0.3,
    ], {
      w: isTentacle ? 0.016 : 0.03,
      wEnd: 0.005,
      color: colors.belly ?? colors.body,
      edge: colors.outline,
      edgeWidth: 0.006,
      alpha: 0.95,
    });
  }

  // mantle
  ctx.beginPath();
  ctx.moveTo(-mantleLen * 0.5, mantleH);
  ctx.bezierCurveTo(mantleLen * 0.1, mantleH * 1.2, mantleLen * 0.5, mantleH * 0.4, mantleLen * 0.55, 0);
  ctx.bezierCurveTo(mantleLen * 0.5, -mantleH * 0.4, mantleLen * 0.1, -mantleH * 1.2, -mantleLen * 0.5, -mantleH);
  ctx.quadraticCurveTo(-mantleLen * 0.6, 0, -mantleLen * 0.5, mantleH);
  ctx.closePath();
  fs(ctx, colors.body, w, colors.outline);
  ctx.save();
  ctx.clip();
  const rng = hashRng('squid');
  const flecks = n(detail, 20, 9, 0);
  for (let i = 0; i < flecks; i++) {
    dot(ctx, -mantleLen * 0.45 + rng() * mantleLen * 0.9, (rng() * 2 - 1) * mantleH * 0.85, 0.008 + rng() * 0.01);
    ctx.fillStyle = i % 3 === 0 ? colors.accent : colors.pattern;
    ctx.globalAlpha = 0.35 + jet * 0.3;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.ellipse(mantleLen * 0.14, -mantleH * 0.5, mantleLen * 0.24, mantleH * 0.3, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fill();
  ctx.restore();

  // fins
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(mantleLen * 0.2, s * mantleH * 0.7);
    ctx.quadraticCurveTo(mantleLen * 0.5, s * mantleH * 2.6, mantleLen * 0.62, s * mantleH * 1.1);
    ctx.quadraticCurveTo(mantleLen * 0.5, s * mantleH * 0.5, mantleLen * 0.2, s * mantleH * 0.7);
    ctx.closePath();
    fs(ctx, colors.fin, w * 0.9, OUTLINE, 0.9);
  }

  eyes(ctx, mantleLen * 0.3, -mantleH * 0.35, 0.055);
  eyes(ctx, mantleLen * 0.3, mantleH * 0.35, 0.055);
}

/* ------------------------------------------------------------------ *
 * Mermaid — drawn upright: head at +y, tail hanging below
 * ------------------------------------------------------------------ */

function paintMermaid({ ctx, creature, colors, time, attention }: PaintArgs): void {
  const w = 0.011;
  const swim = Math.sin(creature.phase);
  const swim2 = Math.sin(creature.phase - 0.9);
  const swim3 = Math.sin(creature.phase - 1.8);
  const hair = colors.pattern;
  const tailColor = colors.fin;
  const skin = colors.body;
  const hipY = -0.04;

  /* ------------------------------ tail ------------------------------ */
  // A long S-curve from the hips down to the fluke, so she reads as a
  // mermaid rather than a fish with a head on.
  ctx.save();
  const tailLen = 0.42;
  const tipX = -0.1 + swim3 * 0.05;
  const tipY = hipY + tailLen;
  ctx.beginPath();
  ctx.moveTo(-0.075, hipY);
  ctx.bezierCurveTo(
    -0.13 + swim * 0.03, hipY + tailLen * 0.3,
    -0.04 + swim2 * 0.05, hipY + tailLen * 0.62,
    tipX - 0.028, tipY,
  );
  ctx.lineTo(tipX + 0.028, tipY);
  ctx.bezierCurveTo(
    0.05 + swim2 * 0.05, hipY + tailLen * 0.6,
    -0.005 + swim * 0.03, hipY + tailLen * 0.3,
    0.075, hipY,
  );
  ctx.closePath();
  fs(ctx, tailColor, w * 0.85, colors.outline);

  // scales, clipped to the tail
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-0.075, hipY);
  ctx.bezierCurveTo(
    -0.13 + swim * 0.03, hipY + tailLen * 0.3,
    -0.04 + swim2 * 0.05, hipY + tailLen * 0.62,
    tipX - 0.028, tipY,
  );
  ctx.lineTo(tipX + 0.028, tipY);
  ctx.bezierCurveTo(
    0.05 + swim2 * 0.05, hipY + tailLen * 0.6,
    -0.005 + swim * 0.03, hipY + tailLen * 0.3,
    0.075, hipY,
  );
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = colors.accent;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 0.007;
  for (let i = 0; i < 5; i++) {
    const y = hipY + 0.06 + i * 0.07;
    for (let r = 0; r < 2; r++) {
      ctx.beginPath();
      ctx.arc(-0.035 + r * 0.07 + swim2 * 0.02, y, 0.032, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  // sheen down the front of the tail
  ctx.beginPath();
  ctx.ellipse(-0.03 + swim2 * 0.02, hipY + tailLen * 0.4, 0.02, tailLen * 0.3, 0.15, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fill();
  ctx.restore();

  // fluke
  ctx.save();
  ctx.translate(tipX, tipY - 0.01);
  ctx.rotate(swim3 * 0.35);
  ctx.beginPath();
  ctx.moveTo(0, -0.02);
  ctx.quadraticCurveTo(-0.1, 0.02, -0.15, 0.13);
  ctx.quadraticCurveTo(-0.05, 0.09, 0, 0.06);
  ctx.quadraticCurveTo(0.05, 0.09, 0.15, 0.13);
  ctx.quadraticCurveTo(0.1, 0.02, 0, -0.02);
  ctx.closePath();
  fs(ctx, tailColor, w * 0.85, colors.outline);
  ctx.restore();
  ctx.restore();

  /* ------------------------------ hair ------------------------------ */
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-0.07, -0.26);
  ctx.bezierCurveTo(-0.16, -0.24 + swim2 * 0.03, -0.2, -0.14 + swim3 * 0.05, -0.19, -0.02 + swim3 * 0.07);
  ctx.bezierCurveTo(-0.12, -0.06 + swim3 * 0.05, -0.05, -0.12 + swim2 * 0.03, 0.0, -0.2);
  ctx.closePath();
  fs(ctx, hair, w * 0.75, colors.outline, 0.95);
  ctx.restore();

  /* ------------------------------ torso ------------------------------ */
  ctx.beginPath();
  ctx.moveTo(-0.055, -0.2);
  ctx.quadraticCurveTo(0.06, -0.22, 0.062, -0.12);
  ctx.quadraticCurveTo(0.055, hipY - 0.02, 0.03, hipY + 0.01);
  ctx.lineTo(-0.03, hipY + 0.01);
  ctx.quadraticCurveTo(-0.058, hipY - 0.02, -0.062, -0.12);
  ctx.quadraticCurveTo(-0.062, -0.22, -0.055, -0.2);
  ctx.closePath();
  fs(ctx, skin, w * 0.8, colors.outline);

  // shell top
  ctx.beginPath();
  ctx.moveTo(-0.055, -0.2);
  ctx.quadraticCurveTo(0, -0.24, 0.055, -0.2);
  ctx.quadraticCurveTo(0, -0.16, -0.055, -0.2);
  ctx.closePath();
  fs(ctx, colors.accent, w * 0.7, colors.outline);

  // tail-fin jewels at the hip line
  ctx.beginPath();
  ctx.moveTo(-0.062, hipY - 0.02);
  ctx.quadraticCurveTo(0, hipY - 0.06, 0.062, hipY - 0.02);
  ctx.quadraticCurveTo(0, hipY + 0.01, -0.062, hipY - 0.02);
  ctx.closePath();
  fs(ctx, colors.accent, w * 0.6, colors.outline, 0.9);

  /* ------------------------------ arms ------------------------------ */
  const wave = attention > 0.35 ? Math.sin(time * 4) * 0.5 : 0;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * 0.055, -0.19);
    ctx.quadraticCurveTo(
      s * (0.1 + wave * 0.04), -0.14 + s * 0.01,
      s * (0.115 + wave * 0.05), -0.07 - wave * 0.06,
    );
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = skin;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineWidth = w * 0.55;
    ctx.strokeStyle = colors.outline;
    ctx.globalAlpha = 0.45;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* ------------------------------ head ------------------------------ */
  ctx.save();
  ctx.translate(0, -0.28);
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.062, 0.062, 0, 0, Math.PI * 2);
  fs(ctx, skin, w * 0.75, colors.outline);
  // hair cap with a parting
  ctx.beginPath();
  ctx.moveTo(-0.065, 0.005);
  ctx.quadraticCurveTo(-0.05, -0.075, 0.03, -0.06);
  ctx.quadraticCurveTo(0.07, -0.05, 0.065, 0.0);
  ctx.quadraticCurveTo(0.03, -0.045, -0.01, -0.03);
  ctx.quadraticCurveTo(-0.04, -0.02, -0.065, 0.005);
  ctx.closePath();
  fs(ctx, hair, w * 0.55, colors.outline);
  // flower
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    dot(ctx, -0.045 + Math.cos(a) * 0.014, -0.052 + Math.sin(a) * 0.014, 0.013);
    ctx.fillStyle = colors.accent;
    ctx.fill();
  }
  dot(ctx, -0.045, -0.052, 0.01);
  ctx.fillStyle = '#ffd977';
  ctx.fill();
  eyes(ctx, -0.026, -0.005, 0.017);
  eyes(ctx, 0.024, -0.005, 0.017);
  ctx.beginPath();
  ctx.arc(0, 0.022, 0.018, 0.2, Math.PI - 0.2);
  ctx.lineWidth = w * 0.8;
  ctx.strokeStyle = colors.outline;
  ctx.stroke();
  ctx.restore();

  // bubbles from her, when she has been visited
  if (attention > 0.45) {
    const t = (time * 0.6) % 1;
    dot(ctx, 0.05, -0.34 - t * 0.12, 0.012 * (1 - t * 0.4));
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();
  }
}

/* ------------------------------------------------------------------ *
 * Seahorse — upright, head at +x top
 * ------------------------------------------------------------------ */

function paintSeahorse({ ctx, creature, colors, time }: PaintArgs): void {
  const w = 0.014;
  const bob = Math.sin(creature.phase * 0.9);
  const curl = Math.sin(time * 1.4 + creature.phase * 0.4) * 0.14;
  const body = colors.body;

  // curled tail
  ctx.save();
  ctx.translate(-0.06, 0.16);
  const angles = [
    Math.PI * 0.92 + curl,
    -0.55 - curl * 0.5,
    -0.7 - curl * 0.4,
    -0.8,
    -0.9,
    -1.0,
  ];
  const pts = spinePoints(0, 0, 0.07, angles);
  ctx.beginPath();
  polyPath(ctx, pts, false);
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = body;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineWidth = 0.012;
  ctx.strokeStyle = colors.outline;
  ctx.globalAlpha = 0.75;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  // dorsal fin
  ctx.save();
  ctx.translate(-0.14, 0);
  ctx.rotate(Math.sin(time * 6) * 0.14);
  ctx.beginPath();
  ctx.moveTo(0, -0.06);
  ctx.quadraticCurveTo(-0.1, -0.02, -0.11, 0.05);
  ctx.quadraticCurveTo(-0.04, 0.08, 0, 0.06);
  ctx.closePath();
  fs(ctx, colors.fin, w * 0.8, OUTLINE, 0.9);
  ctx.restore();

  // body tube (S curve)
  ctx.beginPath();
  ctx.moveTo(0.1, -0.16);
  ctx.bezierCurveTo(0.02, -0.1, 0.02, -0.02, 0.0, 0.04);
  ctx.bezierCurveTo(-0.02, 0.12, -0.02, 0.16, -0.04, 0.2);
  ctx.bezierCurveTo(0.02, 0.22, 0.05, 0.2, 0.06, 0.16);
  ctx.bezierCurveTo(0.08, 0.08, 0.12, 0.0, 0.16, -0.05);
  ctx.bezierCurveTo(0.2, -0.1, 0.18, -0.18, 0.1, -0.16);
  ctx.closePath();
  fs(ctx, body, w, colors.outline);

  // ribbing
  ctx.strokeStyle = colors.pattern;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 0.01;
  for (let i = 0; i < 6; i++) {
    const y = -0.1 + i * 0.05;
    ctx.beginPath();
    ctx.moveTo(0.01, y);
    ctx.lineTo(0.1 - i * 0.006, y - 0.012);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // head + snout
  ctx.beginPath();
  ctx.moveTo(0.1, -0.16);
  ctx.bezierCurveTo(0.08, -0.24, 0.16, -0.28, 0.2, -0.24);
  ctx.bezierCurveTo(0.24, -0.2, 0.22, -0.14, 0.16, -0.12);
  ctx.closePath();
  fs(ctx, body, w, colors.outline);
  ctx.beginPath();
  ctx.moveTo(0.2, -0.22);
  ctx.lineTo(0.32, -0.24);
  ctx.quadraticCurveTo(0.34, -0.22, 0.32, -0.21);
  ctx.lineTo(0.2, -0.19);
  ctx.closePath();
  fs(ctx, body, w * 0.85, colors.outline);
  // coronet
  ctx.beginPath();
  ctx.moveTo(0.13, -0.25);
  ctx.lineTo(0.15, -0.32);
  ctx.lineTo(0.19, -0.26);
  ctx.closePath();
  fs(ctx, colors.fin, w * 0.7, colors.outline);
  eyes(ctx, 0.16, -0.2, 0.03);
  // cheek fin
  ctx.save();
  ctx.translate(0.11, -0.17);
  ctx.rotate(Math.sin(time * 7) * 0.3);
  ctx.beginPath();
  ctx.ellipse(-0.03, 0.02, 0.035, 0.018, 0.4, 0, Math.PI * 2);
  fs(ctx, colors.accent, w * 0.6, OUTLINE, 0.9);
  ctx.restore();
  void bob;
}

/* ------------------------------------------------------------------ *
 * Crab — front view, walks sideways
 * ------------------------------------------------------------------ */

function paintCrab({ ctx, creature, colors, time, speed01 }: PaintArgs): void {
  const w = 0.016;
  const step = Math.sin(creature.phase * 2);
  const step2 = Math.sin(creature.phase * 2 + Math.PI);
  const clawSnap = Math.max(0, Math.sin(time * 2 + creature.phase)) * (0.2 + creature.attention * 0.5);

  // legs (three per side)
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const swing = (i % 2 === 0 ? step : step2) * (0.25 + speed01 * 0.35);
      const ax = -0.1 + i * 0.08;
      const ay = s * 0.1;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(s * (0.9 + i * 0.18) + swing * s);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0.11, s * 0.02);
      ctx.lineTo(0.16, s * 0.09);
      ctx.lineWidth = 0.028;
      ctx.strokeStyle = colors.fin;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.lineWidth = 0.008;
      ctx.strokeStyle = colors.outline;
      ctx.globalAlpha = 0.8;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  // claws
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(0.14, s * 0.13);
    ctx.rotate(s * 0.45 + clawSnap * s * 0.25);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(0.07, s * 0.03, 0.1, s * -0.01);
    ctx.lineWidth = 0.026;
    ctx.strokeStyle = colors.fin;
    ctx.lineCap = 'round';
    ctx.stroke();
    // pincers
    ctx.beginPath();
    ctx.moveTo(0.08, s * -0.02);
    ctx.quadraticCurveTo(0.17, s * -0.06, 0.2, s * 0.0);
    ctx.quadraticCurveTo(0.15, s * 0.0, 0.08, s * 0.03);
    ctx.closePath();
    fs(ctx, colors.body, w * 0.8, colors.outline);
    ctx.beginPath();
    ctx.moveTo(0.09, s * 0.02);
    ctx.quadraticCurveTo(0.16, s * 0.04, 0.19, s * 0.03);
    ctx.quadraticCurveTo(0.15, s * 0.07, 0.09, s * 0.05);
    ctx.closePath();
    fs(ctx, colors.fin, w * 0.8, colors.outline);
    ctx.restore();
  }

  // shell
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.19, 0.14, 0, 0, Math.PI * 2);
  fs(ctx, colors.body, w, colors.outline);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.19, 0.14, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(0.04, -0.03, 0.12, 0.08, -0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fill();
  ctx.strokeStyle = colors.pattern;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 0.01;
  ctx.beginPath();
  ctx.ellipse(0, 0.05, 0.2, 0.12, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  // eye stalks
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0.06, s * 0.08);
    ctx.lineTo(0.09, s * 0.12);
    ctx.lineWidth = 0.016;
    ctx.strokeStyle = colors.fin;
    ctx.stroke();
    eyes(ctx, 0.1, s * 0.13, 0.026);
  }
  // mouth
  ctx.beginPath();
  ctx.moveTo(0.11, 0.05);
  ctx.quadraticCurveTo(0.16, 0.06, 0.18, 0.03);
  ctx.lineWidth = 0.01;
  ctx.strokeStyle = colors.outline;
  ctx.stroke();
}

/* ------------------------------------------------------------------ *
 * Starfish — top-down, creeping over the sand
 * ------------------------------------------------------------------ */

function paintStarfish({ ctx, creature, colors, time, detail = 2 }: PaintArgs): void {
  const w = 0.014;
  const arms = 5;
  const len = 0.5;
  const creep = Math.sin(time * 0.7 + creature.phase) * 0.04;

  ctx.beginPath();
  for (let i = 0; i <= arms * 4; i++) {
    const a = (i / (arms * 4)) * Math.PI * 2 - Math.PI / 2;
    const armIndex = (i % 4) / 4;
    const arm = Math.round(i / 4) % 5;
    const bulge = 0.42 + 0.16 * Math.cos(armIndex * Math.PI * 2);
    const wobble = 1 + Math.sin(time * 1.2 + arm) * 0.03;
    const r = len * (armIndex > 0.5 ? bulge * 0.55 : 1) * wobble + creep;
    const x = Math.cos(a) * r * (1 + 0.04 * Math.sin(armIndex * Math.PI));
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  fs(ctx, colors.body, w, colors.outline);

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, len * 0.5, 0, Math.PI * 2);
  ctx.clip();
  const rng = hashRng('star');
  const marks = n(detail, 40, 14, 0);
  for (let i = 0; i < marks; i++) {
    dot(ctx, (rng() * 2 - 1) * 0.4, (rng() * 2 - 1) * 0.4, 0.008 + rng() * 0.012);
    ctx.fillStyle = colors.pattern;
    ctx.globalAlpha = 0.5;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // central disc
  dot(ctx, 0, 0, 0.1);
  fs(ctx, colors.belly ?? colors.body, w * 0.8, colors.outline, 0.9);
  dot(ctx, 0, 0, 0.045);
  ctx.fillStyle = colors.pattern;
  ctx.fill();
}
