/**
 * How much canvas the renderer is allowed to fill.
 *
 * Canvas2D prices nearly everything by destination pixel, so the backbuffer
 * size is the single biggest lever on frame time. A retina laptop asks for
 * five megapixels and gets a slideshow; the same machine at three megapixels
 * is comfortably inside a 60fps budget and looks no different at normal
 * viewing distance. Kept free of DOM and React so it can be unit-tested.
 */

/** Ceiling on the canvas backbuffer, in device pixels. */
export const MAX_PIXELS = 3_200_000;
/** Never render below this, however slow the machine. */
export const MIN_DPR = 0.75;

export function renderDpr(
  width: number,
  height: number,
  devicePixelRatio: number,
  cap = MAX_PIXELS,
): number {
  const wanted = Math.min(Math.max(devicePixelRatio || 1, 1), 2);
  const area = Math.max(1, width * height);
  return Math.max(MIN_DPR, Math.min(wanted, Math.sqrt(cap / area)));
}
