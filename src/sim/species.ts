import type { Species } from '../sim/types';

/* ------------------------------------------------------------------ *
 * Behaviour profiles per motion archetype. Species override the numbers
 * that matter for them.
 * ------------------------------------------------------------------ */

interface MotionProfile {
  baseSpeed: number;
  accel: number;
  turn: number;
  shy: number;
}

const MOTION: Record<Species['motion'], MotionProfile> = {
  cruise: { baseSpeed: 46, accel: 130, turn: 2.4, shy: 0.35 },
  dart: { baseSpeed: 74, accel: 260, turn: 5.2, shy: 0.8 },
  hover: { baseSpeed: 22, accel: 90, turn: 2.2, shy: 0.5 },
  glide: { baseSpeed: 34, accel: 60, turn: 1.1, shy: 0.2 },
  predator: { baseSpeed: 58, accel: 150, turn: 1.5, shy: 0.05 },
  school: { baseSpeed: 62, accel: 220, turn: 4.4, shy: 0.9 },
};

/* ------------------------------------------------------------------ *
 * Real scale
 *
 * Every species declares its typical adult length in centimetres, and its
 * drawn size is derived from that. The cast spans a royal gramma at 8 cm to a
 * blue whale at 2400 cm — a 300x range. Drawn literally the gramma would be
 * three pixels across and the whale would be forty screens long, so the range
 * is compressed by an exponent. That preserves the *order* and the feel of the
 * real proportions while leaving every animal legible, and it is a single
 * knob: set SIZE_EXP to 1 and the tank becomes a literal-scale model.
 * ------------------------------------------------------------------ */

/** Length that `SIZE_AT_8CM` refers to, in cm. */
const REF_CM = 8;
/** Drawn length of a REF_CM animal, as a fraction of the tank's size unit. */
const SIZE_AT_8CM = 0.03;
/** 1 = literal scale; lower flattens the range. 0.7 turns 300x into 54x. */
export const SIZE_EXP = 0.7;
/**
 * Ceiling on the drawn size, in tank units. The exponent alone still leaves a
 * blue whale at 1.6 units — wider than the tank is tall, so it covers the whole
 * frame and stops reading as an animal. The clamp is a second, stronger
 * compression applied to the one species that needs it; the field guide still
 * reports the real 24 metres.
 */
export const MAX_SIZE = 0.95;

export function sizeForCm(cm: number): number {
  return Math.min(MAX_SIZE, SIZE_AT_8CM * Math.pow(Math.max(1, cm) / REF_CM, SIZE_EXP));
}

/* ------------------------------------------------------------------ *
 * The roster. Shapes are authored in body-length units, so `hh: 0.4` is a
 * tall round reef fish and `hh: 0.2` is a slim wrasse.
 * ------------------------------------------------------------------ */

type Recipe = Omit<Species, 'baseSpeed' | 'accel' | 'turn' | 'shy' | 'travel' | 'size' | 'glow' | 'visitor'> &
  Partial<Pick<Species, 'baseSpeed' | 'accel' | 'turn' | 'shy' | 'travel' | 'glow' | 'visitor'>>;

function species(r: Recipe): Species {
  const m = MOTION[r.motion];
  return {
    baseSpeed: r.baseSpeed ?? m.baseSpeed,
    accel: r.accel ?? m.accel,
    turn: r.turn ?? m.turn,
    shy: r.shy ?? m.shy,
    travel: r.travel ?? 'swim',
    glow: r.glow ?? 0,
    size: sizeForCm(r.realCm),
    ...r,
  } as Species;
}

export const SPECIES: Species[] = [
  /* ------------------------------- fish ------------------------------- */
  species({
    id: 'tang-sunset',
    kind: 'fish',
    label: 'Sunset tang',
    note: 'The bold orange one that never misses a meal.',
    body: {
      rig: 'fish',
      shape: {
        hh: 0.42, peak: 0.44, tip: 0.9, ped: 0.1, tail: 0.28, tailKind: 'fan',
        dorsal: 0.52, anal: 0.3, pect: 0.3, eye: 0.075, snout: 0.12, mouth: 'grin',
      },
    },
    realCm: 18, pattern: 'dots', weight: 0.018, eyeScale: 1,
    colors: { body: '#f7913a', belly: '#ffc46a', fin: '#f8bf3d', accent: '#ffd977', pattern: '#d9660f', outline: '#5c2a08' },
    band: [0.2, 0.72], motion: 'cruise', appetite: 1, population: 4, shadow: 1, flock: 0.1,
  }),
  species({
    id: 'chromis-rose',
    kind: 'fish',
    label: 'Rose chromis',
    note: 'Shoals by the coral fan, turns as one.',
    body: {
      rig: 'fish',
      shape: {
        hh: 0.36, peak: 0.42, tip: 0.92, ped: 0.1, tail: 0.3, tailKind: 'fork',
        dorsal: 0.54, anal: 0.3, pect: 0.28, eye: 0.08, snout: 0.1, mouth: 'tiny',
      },
    },
    realCm: 8, pattern: 'stripes', weight: 0.017, eyeScale: 1,
    colors: { body: '#d6439b', belly: '#f58fd0', fin: '#b32f8c', accent: '#ffd1ec', pattern: '#8e1f6d', outline: '#4d0f38' },
    band: [0.16, 0.56], motion: 'school', appetite: 0.95, population: 8, shadow: 0.8, flock: 1.4,
  }),
  species({
    id: 'damsel-cobalt',
    kind: 'fish',
    label: 'Cobalt damsel',
    note: 'Small, bright, and always underfoot at feeding time.',
    body: {
      rig: 'fish',
      shape: {
        hh: 0.34, peak: 0.42, tip: 0.9, ped: 0.09, tail: 0.26, tailKind: 'round',
        dorsal: 0.46, anal: 0.26, pect: 0.3, eye: 0.085, snout: 0.1, mouth: 'tiny',
      },
    },
    realCm: 8, pattern: 'dots', weight: 0.017, eyeScale: 1,
    colors: { body: '#3f7fe6', belly: '#8dc4ff', fin: '#2f6bd0', accent: '#dff1ff', pattern: '#1f4fae', outline: '#12295f' },
    band: [0.12, 0.6], motion: 'dart', appetite: 1, population: 7, shadow: 0.75, flock: 0.7,
  }),
  species({
    id: 'cardinal-blackfin',
    kind: 'fish',
    label: 'Blackfin cardinal',
    note: 'Holds still in the current, then pounces.',
    body: {
      rig: 'fish',
      shape: {
        hh: 0.4, peak: 0.46, tip: 0.86, ped: 0.11, tail: 0.3, tailKind: 'fork',
        dorsal: 0.6, anal: 0.34, pect: 0.3, eye: 0.11, snout: 0.13, mouth: 'wide',
      },
    },
    realCm: 8, pattern: 'stripes', weight: 0.018, eyeScale: 1.2,
    colors: { body: '#f0f7fb', belly: '#ffffff', fin: '#2b2f45', accent: '#ffe9a8', pattern: '#31374f', outline: '#161a2c' },
    band: [0.2, 0.7], motion: 'hover', appetite: 0.8, population: 2, shadow: 0.9, flock: 0.2,
  }),
  species({
    id: 'wrasse-lemon',
    kind: 'fish',
    label: 'Lemon wrasse',
    note: 'Slim, fast, and nosy about the sea floor.',
    body: {
      rig: 'fish',
      shape: {
        hh: 0.24, peak: 0.44, tip: 0.94, ped: 0.08, tail: 0.26, tailKind: 'fan',
        dorsal: 0.3, anal: 0.18, pect: 0.24, eye: 0.072, snout: 0.14, mouth: 'pout',
      },
    },
    realCm: 12, pattern: 'patches', weight: 0.016, eyeScale: 1,
    colors: { body: '#f7d13f', belly: '#fff0a8', fin: '#ffe27a', accent: '#fff6c9', pattern: '#e0842a', outline: '#6b4708' },
    band: [0.4, 0.86], motion: 'cruise', appetite: 0.9, population: 2, shadow: 0.8, flock: 0.2,
  }),
  species({
    id: 'parrot-aqua',
    kind: 'fish',
    label: 'Aqua parrotfish',
    note: 'Crunches coral with that beak all day.',
    body: {
      rig: 'fish',
      shape: {
        hh: 0.38, peak: 0.42, tip: 0.9, ped: 0.12, tail: 0.3, tailKind: 'lunate',
        dorsal: 0.44, anal: 0.26, pect: 0.32, eye: 0.07, snout: 0.16, mouth: 'beak',
      },
    },
    realCm: 50, pattern: 'scales', weight: 0.016, eyeScale: 0.95,
    colors: { body: '#4ed2d8', belly: '#c6fbf6', fin: '#2ba9c4', accent: '#8ef0e4', pattern: '#1f8fa8', outline: '#0d4a5c' },
    band: [0.35, 0.85], motion: 'cruise', appetite: 0.75, population: 2, shadow: 1.1, flock: 0.15,
  }),
  species({
    id: 'angel-violet',
    kind: 'fish',
    label: 'Violet angelfish',
    note: 'Round, proud, and first to the food.',
    body: {
      rig: 'fish',
      shape: {
        hh: 0.44, peak: 0.4, tip: 0.82, ped: 0.12, tail: 0.34, tailKind: 'pennant',
        dorsal: 0.68, anal: 0.44, pect: 0.3, eye: 0.075, snout: 0.12, mouth: 'tiny',
      },
    },
    realCm: 25, pattern: 'bars', weight: 0.017, eyeScale: 1,
    colors: { body: '#c07ce8', belly: '#ecc9ff', fin: '#9a54cf', accent: '#ffd6f5', pattern: '#7c34a8', outline: '#3d1355' },
    band: [0.26, 0.74], motion: 'hover', appetite: 0.95, population: 2, shadow: 1, flock: 0.2,
  }),
  species({
    id: 'clown-ember',
    kind: 'fish',
    label: 'Ember clown',
    note: 'Never more than a fin-length from its anemone.',
    body: {
      rig: 'fish',
      shape: {
        hh: 0.37, peak: 0.42, tip: 0.9, ped: 0.1, tail: 0.27, tailKind: 'round',
        dorsal: 0.42, anal: 0.24, pect: 0.3, eye: 0.085, snout: 0.11, mouth: 'grin',
      },
    },
    realCm: 8, pattern: 'saddle', weight: 0.017, eyeScale: 1.05,
    colors: { body: '#ff7d3c', belly: '#ffb07a', fin: '#f9642b', accent: '#fff1e0', pattern: '#fff8f0', outline: '#63300c' },
    band: [0.3, 0.8], motion: 'dart', appetite: 1, population: 4, shadow: 0.85, flock: 0.3,
  }),
  species({
    id: 'goby-sand',
    kind: 'fish',
    label: 'Sand goby',
    note: 'Sifts the sea bed, one mouthful at a time.',
    body: {
      rig: 'fish',
      shape: {
        hh: 0.28, peak: 0.48, tip: 0.94, ped: 0.09, tail: 0.24, tailKind: 'fan',
        dorsal: 0.28, anal: 0.2, pect: 0.26, eye: 0.08, snout: 0.14, mouth: 'frown',
      },
    },
    realCm: 10, pattern: 'saddle', weight: 0.016, eyeScale: 1.1,
    colors: { body: '#e8c9a0', belly: '#fff3dd', fin: '#d3a878', accent: '#fff0d0', pattern: '#9c6b3f', outline: '#5a3617' },
    band: [0.6, 0.95], motion: 'hover', appetite: 0.7, population: 2, shadow: 0.7, flock: 0.3,
  }),
  species({
    id: 'snapper-blue',
    kind: 'fish',
    label: 'Blue snapper',
    note: 'A steady mid-water cruiser, always in motion.',
    body: {
      rig: 'fish',
      shape: {
        hh: 0.33, peak: 0.44, tip: 0.92, ped: 0.1, tail: 0.3, tailKind: 'fork',
        dorsal: 0.38, anal: 0.22, pect: 0.28, eye: 0.08, snout: 0.12, mouth: 'grin',
      },
    },
    realCm: 40, pattern: 'scales', weight: 0.016, eyeScale: 1,
    colors: { body: '#4aa8e8', belly: '#c3e6ff', fin: '#2f86c9', accent: '#b9f0ff', pattern: '#2a6fa8', outline: '#123a5c' },
    band: [0.25, 0.72], motion: 'cruise', appetite: 0.85, population: 3, shadow: 1, flock: 0.5,
  }),
  species({
    id: 'gramma-magenta',
    kind: 'fish',
    label: 'Magenta gramma',
    note: 'Shy, jewel-bright, and quick to bolt.',
    body: {
      rig: 'fish',
      shape: {
        hh: 0.35, peak: 0.42, tip: 0.9, ped: 0.09, tail: 0.26, tailKind: 'fork',
        dorsal: 0.4, anal: 0.24, pect: 0.28, eye: 0.085, snout: 0.11, mouth: 'tiny',
      },
    },
    realCm: 8, pattern: 'striped-eye', weight: 0.017, eyeScale: 1.15,
    colors: { body: '#b34ec9', belly: '#e8a6f5', fin: '#8f34ad', accent: '#ffe36e', pattern: '#4b1a68', outline: '#2b0b3d' },
    band: [0.34, 0.82], motion: 'dart', appetite: 0.9, population: 5, shadow: 0.6, flock: 0.6,
  }),
  species({
    id: 'butterfly-gold',
    kind: 'fish',
    label: 'Golden butterflyfish',
    note: 'The false eye on its flank fools bigger fish.',
    body: {
      rig: 'fish',
      shape: {
        hh: 0.43, peak: 0.4, tip: 0.82, ped: 0.11, tail: 0.3, tailKind: 'fan',
        dorsal: 0.5, anal: 0.36, pect: 0.28, eye: 0.07, snout: 0.2, mouth: 'pout',
      },
    },
    realCm: 15, pattern: 'spot-eye', weight: 0.016, eyeScale: 0.95,
    colors: { body: '#ffd23f', belly: '#fff0b8', fin: '#ffc61a', accent: '#fffbe8', pattern: '#2b2f45', outline: '#6b4a05' },
    band: [0.28, 0.74], motion: 'hover', appetite: 0.9, population: 3, shadow: 0.95, flock: 0.25,
  }),
  species({
    id: 'surgeon-teal',
    kind: 'fish',
    label: 'Teal surgeonfish',
    note: 'Wears a scalpel on its tail and knows it.',
    body: {
      rig: 'fish',
      shape: {
        hh: 0.4, peak: 0.42, tip: 0.88, ped: 0.13, tail: 0.32, tailKind: 'lunate',
        dorsal: 0.46, anal: 0.3, pect: 0.32, eye: 0.075, snout: 0.13, mouth: 'tiny',
      },
    },
    realCm: 30, pattern: 'patches', weight: 0.016, eyeScale: 1,
    colors: { body: '#2fb39a', belly: '#a8f0dd', fin: '#1d8f86', accent: '#ffe9a8', pattern: '#12685f', outline: '#0a3b38' },
    band: [0.28, 0.78], motion: 'cruise', appetite: 0.9, population: 3, shadow: 1.05, flock: 0.8,
  }),
  species({
    id: 'hogfish-tiger',
    kind: 'fish',
    label: 'Tiger hogfish',
    note: 'Stalks the reef edge, all stripes and swagger.',
    body: {
      rig: 'fish',
      shape: {
        hh: 0.31, peak: 0.46, tip: 0.94, ped: 0.1, tail: 0.28, tailKind: 'fan',
        dorsal: 0.34, anal: 0.22, pect: 0.28, eye: 0.075, snout: 0.16, mouth: 'frown',
      },
    },
    realCm: 25, pattern: 'tiger', weight: 0.017, eyeScale: 1,
    colors: { body: '#ff8f6b', belly: '#ffd2be', fin: '#f26a48', accent: '#fff2e6', pattern: '#fff4ea', outline: '#5f2313' },
    band: [0.4, 0.84], motion: 'cruise', appetite: 0.9, population: 2, shadow: 0.95, flock: 0.2,
  }),

  /* --------------------------- cephalopods --------------------------- */
  species({
    id: 'octopus-coral',
    kind: 'octopus',
    label: 'Reef octopus',
    note: 'Flares red when it thinks you are watching.',
    body: { rig: 'octopus' },
    realCm: 60, pattern: 'dots', weight: 0.015, eyeScale: 1,
    colors: { body: '#e2603f', belly: '#f4a184', fin: '#b8452a', accent: '#ffd9c4', pattern: '#a83a20', outline: '#4a1608' },
    band: [0.55, 0.95], motion: 'hover', travel: 'drift', appetite: 0.6, population: 2, shadow: 1.2, flock: 0,
  }),
  species({
    id: 'squid-opal',
    kind: 'squid',
    label: 'Opal squid',
    note: 'Jets up and down the reef, inks when startled.',
    body: { rig: 'squid' },
    realCm: 30, pattern: 'dots', weight: 0.014, eyeScale: 1,
    colors: { body: '#c9d8ec', belly: '#ffffff', fin: '#9fb6d6', accent: '#ffd9a8', pattern: '#8aa2c4', outline: '#2c3a52' },
    band: [0.35, 0.9], motion: 'dart', travel: 'drift', appetite: 0.8, population: 2, shadow: 0.6, flock: 0.4, glow: 0.55,
  }),

  /* ----------------------------- reptiles ---------------------------- */
  species({
    id: 'turtle-green',
    kind: 'turtle',
    label: 'Green turtle',
    note: 'Grazes the sea grass, surfaces to breathe.',
    body: { rig: 'turtle' },
    realCm: 110, pattern: 'patches', weight: 0.013, eyeScale: 1,
    colors: { body: '#5c9a5a', belly: '#dbe9b8', fin: '#7fb37a', accent: '#cfe6a6', pattern: '#3d6f45', outline: '#1f3d24' },
    band: [0.5, 0.94], motion: 'glide', appetite: 0.25, population: 1, shadow: 1.6, flock: 0,
  }),

  /* -------------------------- elasmobranchs -------------------------- */
  species({
    id: 'shark-reef',
    kind: 'shark',
    label: 'Blacktip reef shark',
    note: 'Cruises the far edge. Keep your fingers.',
    body: { rig: 'shark' },
    realCm: 160, pattern: 'plain', weight: 0.012, eyeScale: 0.8,
    colors: { body: '#7fa2b8', belly: '#f2f7fa', fin: '#6d90a8', accent: '#27313f', pattern: '#27313f', outline: '#22313d' },
    band: [0.2, 0.6], motion: 'predator', appetite: 0.05, population: 0, visitor: true, shadow: 2.2, flock: 0,
  }),
  species({
    id: 'ray-spotted',
    kind: 'ray',
    label: 'Spotted eagle ray',
    note: 'Flies the sand on slow, easy wings.',
    body: { rig: 'ray' },
    realCm: 180, pattern: 'dots', weight: 0.012, eyeScale: 0.9,
    colors: { body: '#4d6a9c', belly: '#eef3ff', fin: '#3e588a', accent: '#ffffff', pattern: '#f0f4ff', outline: '#1d2c4d' },
    band: [0.72, 0.99], motion: 'glide', appetite: 0.15, population: 1, shadow: 1.8, flock: 0,
  }),
  species({
    id: 'whale-blue',
    kind: 'whale',
    label: 'Blue whale',
    note: 'Twenty-four metres of it, passing through. Ignores your food entirely.',
    body: { rig: 'whale' },
    // The largest animal that has ever lived, and the only species the size
    // clamp in sizeForCm applies to.
    realCm: 2400, pattern: 'plain', weight: 0.012, eyeScale: 0.7,
    colors: { body: '#6f93b4', belly: '#dcebf6', fin: '#5b7f9f', accent: '#bcd6e8', pattern: '#3f6076', outline: '#16304a' },
    band: [0.3, 0.72], motion: 'glide', appetite: 0, population: 0, shadow: 2.6, flock: 0,
    baseSpeed: 40, turn: 0.5, shy: 0, travel: 'swim', visitor: true,
  }),

  /* ---------------------------- cnidarians --------------------------- */
  species({
    id: 'jelly-moon',
    kind: 'jelly',
    label: 'Moon jelly',
    note: 'Sweeps the low water in slow pulses. Harmless.',
    body: { rig: 'jelly' },
    realCm: 25, pattern: 'plain', weight: 0.012, eyeScale: 0,
    colors: { body: '#dcb6ea', belly: '#ffffff', fin: '#f2dcff', accent: '#fff0ff', pattern: '#b98cd0', outline: '#7b52a3' },
    band: [0.55, 0.95], motion: 'hover', travel: 'drift', baseSpeed: 34, appetite: 0.2, population: 3, shadow: 0, flock: 0, glow: 1,
  }),
  species({
    id: 'jelly-ember',
    kind: 'jelly',
    label: 'Ember jelly',
    note: 'Rides the low current across the reef, glowing faint orange.',
    body: { rig: 'jelly' },
    realCm: 15, pattern: 'plain', weight: 0.012, eyeScale: 0,
    colors: { body: '#ffb3c4', belly: '#fff0f3', fin: '#ffd9e2', accent: '#fff6d8', pattern: '#f08aa6', outline: '#a84f6b' },
    band: [0.55, 0.95], motion: 'hover', travel: 'drift', baseSpeed: 34, appetite: 0.15, population: 3, shadow: 0, flock: 0, glow: 0.9,
  }),

  /* ------------------------------ myth ------------------------------- */
  species({
    id: 'mermaid-lagoon',
    kind: 'mermaid',
    label: 'Lagoon mermaid',
    note: 'Surfaces now and then to look at you. Waves back.',
    body: { rig: 'mermaid' },
    realCm: 170, pattern: 'scales', weight: 0.013, eyeScale: 1,
    colors: { body: '#e8b48c', belly: '#ffdcc0', fin: '#2fc4b2', accent: '#ffe9a8', pattern: '#7a4630', outline: '#134c4d' },
    band: [0.4, 0.85], motion: 'hover', travel: 'drift', baseSpeed: 66, appetite: 0.3, population: 0, visitor: true, shadow: 1.4, flock: 0, glow: 0.5,
  }),

  /* --------------------------- syngnathids --------------------------- */
  species({
    id: 'seahorse-gold',
    kind: 'seahorse',
    label: 'Golden seahorse',
    note: 'Anchors to weed with its tail and waits.',
    body: { rig: 'seahorse' },
    realCm: 15, pattern: 'dots', weight: 0.016, eyeScale: 1.05,
    colors: { body: '#f3c04a', belly: '#ffe9ac', fin: '#e0a52c', accent: '#fff6d8', pattern: '#c07f18', outline: '#6b4207' },
    band: [0.4, 0.9], motion: 'hover', appetite: 0.85, population: 2, shadow: 0.5, flock: 0, glow: 0.35,
  }),

  /* ------------------------------ benthic ---------------------------- */
  species({
    id: 'crab-reef',
    kind: 'crab',
    label: 'Reef crab',
    note: 'Sideways, bad-tempered, first to any crumb.',
    body: { rig: 'crab' },
    realCm: 10, pattern: 'plain', weight: 0.016, eyeScale: 1,
    colors: { body: '#e2664a', belly: '#f7b39b', fin: '#c14a32', accent: '#ffd9c4', pattern: '#a83a26', outline: '#4d1608' },
    band: [0.85, 1], motion: 'dart', appetite: 0.95, population: 3, shadow: 0.5, flock: 0,
  }),
  species({
    id: 'starfish-coral',
    kind: 'starfish',
    label: 'Coral starfish',
    note: 'Holds on tight and creeps a few centimetres a day.',
    body: { rig: 'starfish' },
    realCm: 20, pattern: 'dots', weight: 0.015, eyeScale: 0,
    colors: { body: '#f2795a', belly: '#ffc9b3', fin: '#d9553a', accent: '#ffe0cf', pattern: '#ffbe9e', outline: '#5c2110' },
    band: [0.9, 1], motion: 'hover', appetite: 0.1, population: 2, shadow: 0.4, flock: 0, glow: 0.25,
  }),
];

export const SPECIES_BY_ID: Record<string, Species> = Object.fromEntries(
  SPECIES.map((s) => [s.id, s]),
);

/** Handy groupings for the field guide. */
export const SPECIES_GROUPS: Array<{ title: string; ids: string[] }> = [
  { title: 'Reef fish', ids: SPECIES.filter((s) => s.kind === 'fish').map((s) => s.id) },
  { title: 'Cephalopods', ids: ['octopus-coral', 'squid-opal'] },
  { title: 'Turtles & rays', ids: ['turtle-green', 'ray-spotted'] },
  { title: 'Sharks & whales', ids: ['shark-reef', 'whale-blue'] },
  { title: 'Jellies', ids: ['jelly-moon', 'jelly-ember'] },
  { title: 'The myth', ids: ['mermaid-lagoon'] },
  { title: 'Sea floor', ids: ['seahorse-gold', 'crab-reef', 'starfish-coral'] },
];
