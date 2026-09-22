import type { Rng } from '../core/rng';

/* ------------------------------------------------------------------ *
 * Vector / camera primitives
 * ------------------------------------------------------------------ */

export interface Vec2 {
  x: number;
  y: number;
}

/** Everything that moves, drifts or floats around the tank. */
export interface Mover extends Vec2 {
  vx: number;
  vy: number;
}

export interface Camera {
  /** Pointer-influenced look offset, in pixels. */
  x: number;
  y: number;
  /** Smoothed pointer position in screen space (for cursor-reactive life). */
  px: number;
  py: number;
  /** The same pointer in world space, which is what the animals live in. */
  wx: number;
  wy: number;
  /** True once a real pointer has been seen. */
  active: boolean;
}

/** Where the window onto the endless tank currently sits, in world pixels. */
export interface View {
  /** World x of the left edge, eased toward `target`. */
  x: number;
  /** Where the easing is heading — set by wheel, drag and keyboard. */
  target: number;
}

/* ------------------------------------------------------------------ *
 * Species description — the data that makes each animal look and move
 * differently. Kept separate from the instance so the roster is content,
 * not code.
 * ------------------------------------------------------------------ */

export type CreatureKind =
  // fish
  | 'fish'
  // cephalopods
  | 'octopus'
  | 'squid'
  // reptiles
  | 'turtle'
  // elasmobranchs
  | 'shark'
  | 'whale'
  | 'ray'
  // cnidarians
  | 'jelly'
  // myth
  | 'mermaid'
  // syngnathids
  | 'seahorse'
  // benthic
  | 'crab'
  | 'starfish';

export type TailKind = 'fan' | 'fork' | 'crescent' | 'lunate' | 'round' | 'pennant';

export type PatternKind =
  | 'plain'
  | 'dots'
  | 'stripes'
  | 'bars'
  | 'patches'
  | 'scales'
  | 'saddle'
  | 'spot-eye'
  | 'striped-eye'
  | 'tiger';

export type MotionKind = 'cruise' | 'dart' | 'hover' | 'glide' | 'predator' | 'school';

/**
 * How an animal crosses the tank. `swim` holds a roughly level depth and
 * travels left or right; `cross` sweeps a shallow diagonal lane from one
 * bottom corner to the other; `drift` does the same sideways journey but
 * climbs and sinks in long slow arcs on the way, which is how the things that
 * propel themselves with tentacles move — down, then up, then sideways.
 */
export type TravelKind = 'swim' | 'cross' | 'drift';

/** Generic fish anatomy, in body-length units (length = 1). */
export interface FishShape {
  /** Half-height of the body at its deepest point. */
  hh: number;
  /** How far back the deepest point sits (0 nose .. 1 tail). */
  peak: number;
  /** Where the snout tapers behind the dorsal peak. */
  tip: number;
  /** Tail peduncle half-height. */
  ped: number;
  /** Tail width (length units). */
  tail: number;
  tailKind: TailKind;
  dorsal: number;
  anal: number;
  /** Pectoral fin scale. */
  pect: number;
  eye: number;
  snout: number;
  mouth: 'tiny' | 'grin' | 'beak' | 'wide' | 'frown' | 'smile' | 'pout';
}

export type BodyRig =
  | { rig: 'fish'; shape: FishShape }
  | { rig: 'jelly' }
  | { rig: 'octopus' }
  | { rig: 'turtle' }
  | { rig: 'shark' }
  | { rig: 'whale' }
  | { rig: 'ray' }
  | { rig: 'mermaid' }
  | { rig: 'squid' }
  | { rig: 'seahorse' }
  | { rig: 'crab' }
  | { rig: 'starfish' };

export interface Species {
  id: string;
  kind: CreatureKind;
  /** Shown in the field guide, never as a floating label. */
  label: string;
  /** Latin-ish flavour line for the guide. */
  note: string;
  body: BodyRig;
  /**
   * Typical adult length in centimetres — the single source of truth for how
   * big a species is. `size` is derived from it (see `sizeForCm`), so the
   * tank's proportions follow the real animals even though the whole scene is
   * compressed to fit on a screen.
   */
  realCm: number;
  /** Body length as a fraction of the tank's size unit. Derived from `realCm`. */
  size: number;
  colors: {
    body: string;
    belly?: string;
    fin: string;
    accent: string;
    pattern: string;
    outline: string;
  };
  pattern: PatternKind;
  /** Ink width in body-length units. */
  weight: number;
  eyeScale: number;
  baseSpeed: number;
  /** Pixels/sec^2 available for steering. */
  accel: number;
  /** How hard it turns. */
  turn: number;
  /** 0..1 — how brightly it lights up after dark. */
  glow: number;
  /** Depth band bias: 0 = surface, 1 = sea floor. */
  band: [number, number];
  motion: MotionKind;
  /** Level crossing, or a diagonal sweep across the lower tank. */
  travel: TravelKind;
  /** Interaction temperament. */
  shy: number;
  /** 0 = ignores food, 1 = obsessed. */
  appetite: number;
  /** Count spawned in a fresh tank. */
  population: number;
  /** Scale of the faint shadow it casts on the sand. */
  shadow: number;
  /** Schooling weight — high values hold formation with their own kind. */
  flock: number;
  /**
   * Arrives on its own schedule rather than belonging to the tank's standing
   * population. The whale is the only one: a 24 metre animal that was simply
   * always somewhere in view would stop being an event.
   */
  visitor?: boolean;
}

/* ------------------------------------------------------------------ *
 * Simulation entities
 * ------------------------------------------------------------------ */

export type CreatureState = 'cruise' | 'seek' | 'eat' | 'flee' | 'rest' | 'graze';

export interface Creature {
  id: number;
  species: Species;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Facing, radians. 0 = right. */
  angle: number;
  /**
   * Which way it is drawn facing: +1 to the right, -1 to the left. Art is
   * mirrored rather than turned through 180°, so a fish that reverses is always
   * seen head first instead of spinning on the spot or swimming tail first.
   */
  facing: number;
  /** Nose-up/down tilt, radians, clamped so a slow turn never reads as a spin. */
  pitch: number;
  /** Depth 0..1 — drives size, blur, parallax and colour. */
  depth: number;
  /** Multiplier on species.size for individual variety. */
  sizeMul: number;
  /** Animation phase of the swimming cycle. */
  phase: number;
  /** Cycle speed, radians/sec. */
  fin: number;
  state: CreatureState;
  stateTime: number;
  /** Seconds until it will chase food again. */
  sated: number;
  /** Transient behavioural modifiers. */
  panic: number;
  /** Wander target. */
  tx: number;
  ty: number;
  txTime: number;
  /** Depth it is holding on this leg of its crossing, in px. */
  laneY: number;
  /** Depth it is heading for at the far side of the tank, in px. */
  laneEndY: number;
  /** Per-individual hue-ish tweak (index into palette swap). */
  tint: number;
  /** Depth at which `palette` was last recomputed — tints are not free. */
  tintDepth: number;
  /** Per-individual palette, pre-tinted for how deep it is swimming. */
  palette: Species['colors'];
  /** Direction flip memory for mirrored art. */
  flip: number;
  /** Behaviour scratch: ink, jet, blink, curl… */
  a: number;
  b: number;
  /** Pointer interest — how close the cursor is, smoothed. */
  attention: number;
  /** Set when the creature has been fed in this pass (drives a little heart). */
  joy: number;
  /** The crumb it has committed to eating, held until it is gone. */
  target: Pellet | null;
  /** 0..1 — how far the mouth is open, for the lunge at the end of a chase. */
  bite: number;
}

export interface Pellet extends Mover {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Scale in pixels. */
  r: number;
  life: number;
  /** Phase for the sink wobble. */
  seed: number;
  eaten: boolean;
  /** Brightness pulse right after being dropped. */
  fresh: number;
  /**
   * id of the animal that has claimed this crumb, or 0. Claiming stops two
   * fish from twitching between the same two crumbs and makes a feeding
   * frenzy read as competition rather than as a magnet.
   */
  claim: number;
}

export interface Bubble extends Mover {
  r: number;
  wobble: number;
  life: number;
  maxLife: number;
  seed: number;
}

export interface Ripple {
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
  strength: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  maxLife: number;
  color: string;
  kind: 'crumb' | 'sparkle' | 'heart' | 'sand';
  seed: number;
}

export interface SpawnContext {
  rng: Rng;
  width: number;
  height: number;
}

export type { Rng };
