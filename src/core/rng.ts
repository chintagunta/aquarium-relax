/**
 * Deterministic RNG (mulberry32). Every reef is generated from a seed so a
 * "new reef" is a real, reproducible thing rather than a re-roll of Math.random.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  /** Uniform integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Roughly bell-shaped value in [-1, 1] (sum of three uniforms). */
  bell(): number {
    return (this.next() + this.next() + this.next()) / 1.5 - 1;
  }

  /** Angle in radians. */
  angle(): number {
    return this.next() * Math.PI * 2;
  }
}
