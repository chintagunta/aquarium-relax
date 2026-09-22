/**
 * Low-level canvas drawing vocabulary for the reef.
 *
 * Two conventions run through the whole art library:
 *   1. Everything is painted in *body-length units* — the nose sits at the
 *      origin and the body runs along +x, ending at x = 1. The caller scales.
 *   2. Big animals are drawn with flat fills plus a few soft rgba highlights
 *      rather than per-frame gradients, which keeps 60fps while still reading
 *      as the glossy flat-vector look of the reference art.
 */

export type Ctx = CanvasRenderingContext2D;

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EyeSpec extends Pt {
  r: number;
  pupil?: number;
  lookX?: number;
  lookY?: number;
  /** Closed = happy blink / sleeping. */
  closed?: boolean;
  /** 0..1 — how far the eyelid has dropped. */
  lid?: number;
  ring?: string;
}

export interface SpineOpts {
  /** Half-width at the base, in local units. */
  w: number;
  /** Half-width at the tip. */
  wEnd?: number;
  color: string;
  edge?: string;
  edgeWidth?: number;
  alpha?: number;
  tipRound?: boolean;
}

export const OUTLINE = '#0d2438';

/* ------------------------------------------------------------------ *
 * Path builders
 * ------------------------------------------------------------------ */

export function polyPath(ctx: Ctx, pts: readonly Pt[], close = true): void {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (close) ctx.closePath();
}

export function dot(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.001, r), 0, Math.PI * 2);
  ctx.closePath();
}

export function ellipsePath(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot = 0,
  start = 0,
  end = Math.PI * 2,
  ccw = false,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.001, rx), Math.max(0.001, ry), rot, start, end, ccw);
}

/** Generic fish body seen from the side: rounded snout, tapered peduncle. */
export function fishBodyPath(
  ctx: Ctx,
  hh: number,
  peak: number,
  tip: number,
  ped: number,
  noseBulge = 0.34,
): void {
  const px = Math.min(tip - 0.08, peak);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(px * noseBulge, -hh * 0.94, px * 0.74, -hh, px, -hh);
  const shoulder = px + (tip - px) * 0.36;
  ctx.bezierCurveTo(
    shoulder + (tip - shoulder) * 0.5, -hh,
    tip - (tip - shoulder) * 0.28, -hh * 0.62,
    tip, -ped,
  );
  ctx.lineTo(tip, ped);
  ctx.bezierCurveTo(
    tip - (tip - shoulder) * 0.28, hh * 0.62,
    shoulder + (tip - shoulder) * 0.5, hh,
    px, hh,
  );
  ctx.bezierCurveTo(px * 0.74, hh, px * noseBulge, hh * 0.94, 0, 0);
  ctx.closePath();
}

/**
 * A simple triangular-ish fin: base line from (x0,y0) to (x1,y1) with a
 * control point for the outer edge. Coordinates are local; pass absolute
 * values derived from the body path.
 */
export function finPath(ctx: Ctx, pts: readonly Pt[], bulge = 0.5): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 3) {
    ctx.quadraticCurveTo(
      pts[1].x + (pts[2].x - pts[0].x) * bulge * 0.25,
      pts[1].y,
      pts[2].x,
      pts[2].y,
    );
  } else {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.closePath();
}

/**
 * Tapered appendage (tentacle, arm, flipper). `angles` are cumulative from the
 * base so callers can drive a swimming wave straight through.
 */
export function spineStroke(
  ctx: Ctx,
  x0: number,
  y0: number,
  segment: number,
  angles: readonly number[],
  opts: SpineOpts,
): Pt {
  const pts: Pt[] = [{ x: x0, y: y0 }];
  let a = 0;
  let x = x0;
  let y = y0;
  for (let i = 0; i < angles.length; i++) {
    a += angles[i];
    x += Math.cos(a) * segment;
    y += Math.sin(a) * segment;
    pts.push({ x, y });
  }
  const n = pts.length;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const half = (opts.w + ((opts.wEnd ?? opts.w * 0.2) - opts.w) * t) * (1 - 0.12 * Math.sin(t * Math.PI));
    const p = pts[i];
    const q = pts[Math.min(n - 1, i + 1)];
    const r = pts[Math.max(0, i - 1)];
    const ang = Math.atan2(q.y - r.y, q.x - r.x) + Math.PI / 2;
    left.push({ x: p.x + Math.cos(ang) * half, y: p.y + Math.sin(ang) * half });
    right.push({ x: p.x - Math.cos(ang) * half, y: p.y - Math.sin(ang) * half });
  }
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  ctx.beginPath();
  polyPath(ctx, left, false);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fillStyle = opts.color;
  ctx.fill();
  if (opts.edge) {
    ctx.lineWidth = opts.edgeWidth ?? 0.008;
    ctx.strokeStyle = opts.edge;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
  return pts[n - 1];
}

/** Return the joint positions of a tapered appendage without drawing it. */
export function spinePoints(
  x0: number,
  y0: number,
  segment: number,
  angles: readonly number[],
): Pt[] {
  const pts: Pt[] = [{ x: x0, y: y0 }];
  let a = 0;
  let x = x0;
  let y = y0;
  for (let i = 0; i < angles.length; i++) {
    a += angles[i];
    x += Math.cos(a) * segment;
    y += Math.sin(a) * segment;
    pts.push({ x, y });
  }
  return pts;
}

/* ------------------------------------------------------------------ *
 * Reusable features
 * ------------------------------------------------------------------ */

export function drawEye(ctx: Ctx, spec: EyeSpec): void {
  const { x, y, r } = spec;
  const pr = spec.pupil ?? r * 0.46;
  const lx = spec.lookX ?? 0;
  const ly = spec.lookY ?? 0;
  if (spec.closed) {
    ctx.beginPath();
    ctx.lineWidth = r * 0.42;
    ctx.strokeStyle = OUTLINE;
    ctx.lineCap = 'round';
    ctx.moveTo(x - r * 0.8, y);
    ctx.quadraticCurveTo(x, y + r * 0.5, x + r * 0.8, y);
    ctx.stroke();
    return;
  }
  dot(ctx, x, y, r);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = Math.max(0.004, r * 0.24);
  ctx.strokeStyle = spec.ring ?? OUTLINE;
  ctx.stroke();

  dot(ctx, x + lx * r * 0.36, y + ly * r * 0.36, pr);
  ctx.fillStyle = '#101c2e';
  ctx.fill();
  // catchlight
  dot(ctx, x + lx * r * 0.36 - pr * 0.32, y + ly * r * 0.36 - pr * 0.36, pr * 0.34);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
  if (spec.lid && spec.lid > 0.02) {
    const lid = Math.min(0.96, spec.lid);
    ctx.save();
    dot(ctx, x, y, r * 1.02);
    ctx.clip();
    ctx.fillStyle = 'rgba(20,40,60,0.85)';
    ctx.fillRect(x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.4 * lid);
    ctx.restore();
  }
}

/** Soft wet highlight along the top of a body. */
export function drawSheen(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha = 0.34,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, w, h, -0.2, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.fill();
  ctx.restore();
}

/** Rounded blob used for shells, mantles, bells and rocks. */
export function blob(ctx: Ctx, x: number, y: number, rx: number, ry: number, squashTop = 1): void {
  ctx.beginPath();
  ctx.moveTo(x - rx, y);
  ctx.bezierCurveTo(x - rx, y - ry * squashTop * 1.3, x + rx, y - ry * squashTop * 1.3, x + rx, y);
  ctx.bezierCurveTo(x + rx, y + ry * 1.15, x - rx, y + ry * 1.15, x - rx, y);
  ctx.closePath();
}

/* ------------------------------------------------------------------ *
 * View transform
 * ------------------------------------------------------------------ */

export interface View {
  /** Scale factor from body-length units to pixels. */
  px: number;
  /** Small extra squash for turning into / away from the viewer. */
  squash: number;
  /** +1 art faces right, -1 art is mirrored. */
  flip: number;
}

export function withView(
  ctx: Ctx,
  x: number,
  y: number,
  angle: number,
  view: View,
  paint: () => void,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(view.px * view.flip, view.px * view.squash);
  paint();
  ctx.restore();
}
