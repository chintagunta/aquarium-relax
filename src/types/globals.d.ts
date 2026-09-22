import type { Creature } from '../sim/types';

/**
 * The read-only handle the tank exposes on `window` for diagnostics and
 * automated checks. It never mutates the reef except through `feed` and
 * `splash`, which mirror exactly what a click does.
 */
export interface ReefHandle {
  stats(): {
    meals: number;
    pellets: number;
    creatures: number;
    fps: number;
    /** World size, and the unit an animal's body size is measured in. */
    width: number;
    height: number;
    unit: number;
  };
  kinds(): Record<string, number>;
  species(): Record<string, number>;
  /** Every crumb in the water, for watching a feed crumb by crumb. */
  pellets(): Array<{ x: number; y: number; yToFloor: number; fresh: number; life: number; claim: number }>;
  /** One movement sample per animal, for checking travel and scale. */
  sample(): Array<{
    id: number;
    kind: string;
    travel: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    depth: number;
    bodyPx: number;
    state: string;
    panic: number;
    sated: number;
    facing: number;
    pitch: number;
    goalDist: number;
    claim: number;
  }>;
  frames(): number;
  /** Advance the tank by n fixed steps, rendering each one. */
  render(n?: number, dt?: number): number;
  /** Synchronous ms per update+render pair — the honest frame budget. */
  bench(frames?: number): number;
  /** Average ms per render stage over n frames, largest first. */
  profile(frames?: number): Array<{ stage: string; ms: number }>;
  feed(x?: number, y?: number): void;
  /** The splash a click makes, without dropping any food. */
  splash(x: number, y: number): void;
  /** Switch the tank between daylight and moonlight. */
  night(on: boolean): void;
  /** Where the endless tank is looking, and how to move it. */
  view(): { x: number; target: number; width: number };
  scrollBy(dx: number): void;
  scrollTo(x: number): void;
  /** The whole cast, including the part of it that is off screen. */
  population(): {
    total: number;
    onScreen: number;
    whales: number;
    particles: number;
    bubbles: number;
    pellets: number;
    ripples: number;
  };
}

declare global {
  interface Window {
    __reef?: ReefHandle;
    __REEF_ERRORS__?: string[];
    __reefProbe?: () => void;
  }
}

export type { Creature };
