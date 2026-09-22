/**
 * Small math + colour utilities. Kept dependency-free and allocation-light:
 * the simulation runs at 60fps and touches most of these thousands of times
 * per second, so nothing in here creates objects it doesn't have to.
 */

export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent approach toward a target. `rate` is 1/seconds-ish. */
export const damp = (a: number, b: number, rate: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-rate * dt));

/**
 * The step to advance the simulation by, from the raw seconds between frames.
 *
 * `requestAnimationFrame` reports when the frame *started*, so a timestamp can
 * arrive earlier than the clock read when a long synchronous block finished —
 * after an on-demand check or a gc pause, `raw` comes back negative, and a
 * negative step runs the tank backwards (ripples grow an inside-out radius,
 * food gets un-eaten). Anything outside a plausible frame is therefore read as
 * a discontinuity and advanced by a nominal frame rather than by a jump.
 */
export const frameDelta = (raw: number, nominal = 1 / 60, max = 0.25): number =>
  raw > 0 && raw < max ? raw : nominal;

/** Shortest signed angular difference from `a` to `b`, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Rotate `a` toward `b` by at most `maxStep` radians. */
export function approachAngle(a: number, b: number, maxStep: number): number {
  const d = angleDelta(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

/** Smooth 0..1 ease. */
export const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
};

export const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.sqrt(dist2(ax, ay, bx, by));

interface RGB {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }: RGB): string {
  const c = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Blend two hex colours. `t` of 0 returns `a`, 1 returns `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({
    r: lerp(ca.r, cb.r, t),
    g: lerp(ca.g, cb.g, t),
    b: lerp(ca.b, cb.b, t),
  });
}

/** Multiply a hex colour's brightness (for quick shading passes). */
export function shadeHex(hex: string, amount: number): string {
  if (amount >= 0) return mixHex(hex, '#ffffff', amount);
  return mixHex(hex, '#000000', -amount);
}

/** Perceptual luminance-sorted lightening, used for belly gradients. */
export function lighten(hex: string, amount: number): string {
  return mixHex(hex, '#ffffff', clamp(amount, 0, 1));
}

export function darken(hex: string, amount: number): string {
  return mixHex(hex, '#000226', clamp(amount, 0, 1));
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

/** Sample a multi-stop gradient defined over 0..1. */
export function sampleGradient(stops: Array<[number, string]>, t: number): string {
  const x = clamp(t, 0, 1);
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (x >= p0 && x <= p1) {
      const span = p1 - p0 || 1;
      return mixHex(c0, c1, (x - p0) / span);
    }
  }
  return stops[stops.length - 1][1];
}
