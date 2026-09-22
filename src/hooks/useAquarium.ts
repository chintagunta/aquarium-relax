import { useCallback, useEffect, useRef, useState } from 'react';
import { Aquarium } from '../sim/aquarium';
import { Renderer } from '../render/renderer';
import { SoundEngine } from '../audio/sound';
import { renderDpr } from '../core/budget';
import { frameDelta } from '../core/math';
import type { Creature } from '../sim/types';

export type Mood = 'calm' | 'lively' | 'wild';

export interface AquariumStats {
  meals: number;
  creatures: number;
  pellets: number;
  fps: number;
}

export interface AquariumApi {
  stats: AquariumStats;
  /** Throws food at the pointer (or a given world point). */
  feed: (x?: number, y?: number) => void;
  /** Adds one animal, drawn from the roster. */
  addCreature: () => string;
  /** Rebuilds the reef from a new seed. */
  newReef: () => void;
  setMood: (mood: Mood) => void;
  mood: Mood;
  setSound: (on: boolean) => void;
  sound: boolean;
  /** Moonlight instead of sunlight. */
  setNight: (on: boolean) => void;
  night: boolean;
  /** Name of the animal currently under the pointer, if any. */
  hovered: string | null;
  /** Snapshot of the tank's population, for the field guide. */
  getCreatures: () => Creature[];
}

interface Options {
  onNotice?: (text: string) => void;
}

/**
 * Owns the simulation, the canvas and the animation loop. The React tree only
 * ever reads numbers out of here — the reef itself never re-renders React.
 */
export function useAquarium(canvasRef: React.RefObject<HTMLCanvasElement | null>, opts: Options = {}): AquariumApi {
  const aquariumRef = useRef<Aquarium | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const soundRef = useRef<SoundEngine | null>(null);
  const noticeRef = useRef(opts.onNotice);
  noticeRef.current = opts.onNotice;

  const [stats, setStats] = useState<AquariumStats>({ meals: 0, creatures: 0, pellets: 0, fps: 60 });
  const [mood, setMoodState] = useState<Mood>('lively');
  const [sound, setSoundState] = useState(false);
  const [night, setNightState] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  const moodRef = useRef<Mood>('lively');
  const mealsRef = useRef(0);
  const nightRef = useRef(false);

  /* ---------------------------- boot ---------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const initialW = Math.max(320, canvas.clientWidth || window.innerWidth);
    const initialH = Math.max(320, canvas.clientHeight || window.innerHeight);
    // resize() owns width, height and the size unit, and rebuilds the reef for
    // them. Assigning width/height first — as this used to — makes the call a
    // no-op, leaving a reef baked at the default size and stretched.
    const aquarium = new Aquarium(20260920);
    aquarium.resize(initialW, initialH);
    aquarium.populate();
    aquariumRef.current = aquarium;

    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;
    const sound = new SoundEngine();
    soundRef.current = sound;

    let dpr = renderDpr(initialW, initialH, window.devicePixelRatio || 1);
    renderer.resize(initialW, initialH, dpr);

    /**
     * The tank holds 60fps by watching its own frame time and giving up
     * decoration — not animals — when it runs out of budget. `quality` scales
     * the level of detail and the number of effects; `dprScale` trims
     * resolution, which is the last resort because it is the most visible.
     */
    let quality = 1;
    let dprScale = 1;
    let frameAvg = 16.7;

    let raf = 0;
    let last = performance.now();
    let fpsAccum = 0;
    let fpsFrames = 0;
    let fpsValue = 60;
    let statTimer = 0;
    let frameCount = 0;
    /**
     * While this is set the live loop stands down, so an on-demand check can
     * drive the tank itself without the two competing for the same frame.
     */
    let paused = false;
    const withLoopPaused = <T,>(fn: () => T): T => {
      const was = paused;
      paused = true;
      try {
        return fn();
      } finally {
        paused = was;
        last = performance.now();
      }
    };

    // A small, read-only handle so automated checks (and anyone with the
    // console open) can see what the tank is doing.
    window.__reef = {
      stats: () => ({
        meals: aquarium.meals,
        pellets: aquarium.pellets.length,
        creatures: aquarium.creatures.length,
        fps: Math.round(fpsValue),
        /** World size and the unit bodies are measured in, for layout checks. */
        width: Math.round(aquarium.width),
        height: Math.round(aquarium.height),
        unit: Math.round(aquarium.unit),
      }),
      kinds: () => {
        const out: Record<string, number> = {};
        for (const c of aquarium.creatures) out[c.species.kind] = (out[c.species.kind] ?? 0) + 1;
        return out;
      },
      species: () => {
        const out: Record<string, number> = {};
        for (const c of aquarium.creatures) out[c.species.id] = (out[c.species.id] ?? 0) + 1;
        return out;
      },
      /** Every crumb in the water, so a feed can be watched crumb by crumb. */
      pellets: () =>
        aquarium.pellets.map((p) => ({
          x: Math.round(p.x),
          y: Math.round(p.y),
          yToFloor: Math.round(aquarium.reef.floor(p.x) - p.y),
          fresh: +p.fresh.toFixed(2),
          life: Math.round(p.life),
          claim: p.claim,
        })),
      /** One movement sample per animal — used to check how the tank travels. */
      sample: () =>
        aquarium.creatures.map((c) => ({
          id: c.id,
          kind: c.species.kind,
          travel: c.species.travel,
          x: c.x,
          y: c.y,
          vx: c.vx,
          vy: c.vy,
          depth: c.depth,
          bodyPx: aquarium.unit * c.species.size * c.sizeMul,
          state: c.state,
          /** Short-term mood: 0 is calm, 1 is bolting. */
          panic: +c.panic.toFixed(2),
          /** Seconds of "just ate" left, during which food is ignored. */
          sated: +c.sated.toFixed(2),
          /** Which way the art is mirrored, and how far its nose is tilted. */
          facing: c.facing,
          pitch: +c.pitch.toFixed(3),
          /** How far it still has to swim to the crumb it is after, or -1. */
          goalDist: c.target
            ? Math.sqrt((c.target.x - c.x) ** 2 + (c.target.y - c.y) ** 2)
            : -1,
          claim: c.target ? c.target.claim : 0,
          /** Which soft-focus pass the renderer puts it in. */
          slice: c.species.size >= 0.2 ? (c.depth < 0.4 ? 'mid' : 'near') : c.depth < 0.46 ? 'far' : c.depth < 0.74 ? 'mid' : 'near',
        })),
      frames: () => frameCount,
      /**
       * Advances the tank by `n` fixed steps and renders each one, on demand.
       * The live loop is throttled by the browser whenever the tab is not
       * visible (and in headless it barely runs at all), so automated checks
       * and screenshots drive time from here instead.
       */
      render: (n = 60, dt = 1 / 60) => {
        withLoopPaused(() => {
          for (let i = 0; i < n; i++) {
            aquarium.update(dt);
            renderer.render(aquarium, { quality: 1, showCursor: true, night: nightRef.current });
          }
        });
        frameCount += n;
        return n;
      },
      /**
       * Synchronous cost of one update+render pair, in ms.
       *
       * The live loop is paused for the measurement, which is the whole point:
       * run alongside it, these iterations queue up behind a frame that is
       * already being presented and the number you get back is the display's
       * refresh interval, not the work. That mistake made the same build
       * measure 2ms and 15ms on alternate runs.
       */
      bench: (n = 90) =>
        withLoopPaused(() => {
          const start = performance.now();
          for (let i = 0; i < n; i++) {
            aquarium.update(1 / 60);
            renderer.render(aquarium, { quality: 1, showCursor: false, night: nightRef.current });
          }
          return (performance.now() - start) / n;
        }),
      /**
       * Where the frame budget actually goes. Runs the real loop with stage
       * timers on and reports the average cost of each pass, so a claim about
       * frame rate can be checked rather than believed.
       */
      profile: (n = 60) =>
        withLoopPaused(() => {
          renderer.resetTimings();
          for (let i = 0; i < n; i++) {
            aquarium.update(1 / 60);
            renderer.render(aquarium, { quality: 1, showCursor: false, night: nightRef.current, profile: true });
          }
          return Object.entries(renderer.timings)
            .map(([stage, total]) => ({ stage, ms: total / Math.max(1, renderer.profiledFrames) }))
            .sort((a, b) => b.ms - a.ms);
        }),
      feed: (x?: number, y?: number) => {
        aquarium.feed(x, y);
        aquarium.splash(x ?? aquarium.camera.px, y ?? aquarium.camera.py);
      },
      splash: (x: number, y: number) => aquarium.splash(x, y),
      night: (on: boolean) => {
        nightRef.current = on;
        aquarium.setNight(on);
      },
      /** Where the endless tank is currently looking, and how to move it. */
      view: () => ({
        x: Math.round(aquarium.view.x),
        target: Math.round(aquarium.view.target),
        width: aquarium.width,
      }),
      scrollBy: (dx: number) => aquarium.scrollBy(dx, true),
      scrollTo: (x: number) => aquarium.scrollTo(x, true),
      /** How much of the cast is actually in front of the viewer. */
      population: () => ({
        total: aquarium.creatures.length,
        onScreen: aquarium.creatures.filter(
          (c) => c.x >= aquarium.view.x && c.x <= aquarium.view.x + aquarium.width,
        ).length,
        whales: aquarium.creatures.filter((c) => c.species.kind === 'whale').length,
        particles: aquarium.particles.length,
        bubbles: aquarium.bubbles.length,
        pellets: aquarium.pellets.length,
        ripples: aquarium.ripples.length,
      }),
    };

    const reduceMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dtRaw = (now - last) / 1000;
      last = now;
      // An on-demand check owns the tank right now; do not step on its toes.
      if (paused) return;
      // `now` is the *frame start* time, so after a long block on the main
      // thread (an on-demand check, a gc pause, a throttled tab) it can arrive
      // earlier than the `last` we recorded when the block finished. Stepping a
      // negative or enormous delta runs the tank backwards — ripples grew an
      // inside-out radius and the draw threw — so a frame outside the plausible
      // range is treated as a discontinuity and advanced by a nominal frame.
      const dt = frameDelta(dtRaw);
      frameCount++;

      aquarium.update(dt * (reduceMotion ? 0.75 : 1));

      // sound reacts to the sim, not the other way round
      if (aquarium.meals > mealsRef.current) {
        const gained = aquarium.meals - mealsRef.current;
        mealsRef.current = aquarium.meals;
        if (gained > 0) sound.chomp();
        if (gained >= 3 && gained % 3 === 0) sound.bubble(1.4);
      }

      renderer.render(aquarium, {
        quality: moodRef.current === 'wild' ? Math.min(quality, 0.75) : quality,
        showCursor: true,
        night: nightRef.current,
        frame: frameCount,
      });

      // --- frame budget watchdog -------------------------------------------
      // Only real frames count: a backgrounded tab reports absurd deltas and
      // must not be allowed to drag the tank down to its lowest settings.
      if (dtRaw > 0.004 && dtRaw < 0.25) {
        frameAvg += (dtRaw * 1000 - frameAvg) * 0.06;
        if (frameAvg > 21 && quality > 0.7) {
          quality = 0.7;
        } else if (frameAvg > 26 && dprScale > 0.72) {
          dprScale = Math.max(0.72, dprScale - 0.14);
          renderer.resize(aquarium.width, aquarium.height, dpr * dprScale);
        } else if (frameAvg < 13.5 && dprScale < 1) {
          dprScale = Math.min(1, dprScale + 0.14);
          renderer.resize(aquarium.width, aquarium.height, dpr * dprScale);
        } else if (frameAvg < 12 && quality < 1) {
          quality = 1;
        }
      }

      fpsAccum += dtRaw;
      fpsFrames++;
      statTimer += dtRaw;
      if (statTimer > 0.4) {
        // A throttled tab (backgrounded, or headless) is not a frame budget the
        // visitor can act on, so report "unknown" rather than a scary zero.
        fpsValue = dtRaw > 0.5 ? -1 : fpsFrames / Math.max(0.0001, fpsAccum);
        fpsAccum = 0;
        fpsFrames = 0;
        statTimer = 0;
        setStats({
          meals: aquarium.meals,
          creatures: aquarium.creatures.length,
          pellets: aquarium.pellets.length,
          fps: Math.round(fpsValue),
        });
      }
    };
    raf = requestAnimationFrame(frame);

    /* ------------------------- resize handling ------------------------- */
    let resizeTimer = 0;
    const applySize = () => {
      const w = Math.max(320, canvas.clientWidth || window.innerWidth);
      const h = Math.max(320, canvas.clientHeight || window.innerHeight);
      if (Math.abs(w - aquarium.width) < 2 && Math.abs(h - aquarium.height) < 2) return;
      aquarium.resize(w, h);
      dpr = renderDpr(w, h, window.devicePixelRatio || 1);
      renderer.resize(w, h, dpr * dprScale);
    };
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(applySize, 140);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.clearTimeout(resizeTimer);
      sound.dispose();
      delete window.__reef;
      aquariumRef.current = null;
      rendererRef.current = null;
      soundRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------- pointer input -------------------------- */
  const feed = useCallback(
    (x?: number, y?: number) => {
      const a = aquariumRef.current;
      if (!a) return;
      const point =
        x === undefined || y === undefined
          ? a.camera.active
            ? { x: a.camera.wx, y: a.camera.wy }
            : { x: a.view.x + a.width * 0.5, y: a.height * 0.42 }
          : { x, y };
      a.feed(point.x, point.y);
      a.splash(point.x, point.y);
      soundRef.current?.bubble(1);
      soundRef.current?.bubble(1.5);
      setStats((s) => ({ ...s, pellets: a.pellets.length }));
    },
    [],
  );

  /**
   * Pointer, drag-to-scroll and wheel, all in one place.
   *
   * A press is ambiguous: it might be a click to feed or the start of a drag to
   * explore. Rather than guess, the press is remembered and only becomes a feed
   * if it is released without having travelled — so dragging never scatters
   * food, and clicking is still a click.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let lastPointer = 0;
    let drag: { x: number; y: number; scroll: number; moved: boolean } | null = null;
    const DRAG_SLOP = 6;

    const local = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onMove = (e: PointerEvent) => {
      const a = aquariumRef.current;
      if (!a) return;
      const { x, y } = local(e);
      if (drag) {
        const dx = x - drag.x;
        if (Math.abs(dx) > DRAG_SLOP || Math.abs(y - drag.y) > DRAG_SLOP) drag.moved = true;
        if (drag.moved) {
          a.scrollTo(drag.scroll - dx, true);
          canvas.style.cursor = 'grabbing';
          return;
        }
      }
      a.pointer(x - a.camera.x, y - a.camera.y, true);
      const now = performance.now();
      if (now - lastPointer > 120) {
        lastPointer = now;
        const picked = a.pick(a.camera.wx, a.camera.wy);
        setHovered(picked ? picked.species.label : null);
      }
    };

    const onLeave = () => {
      const a = aquariumRef.current;
      if (a) a.camera.active = false;
      setHovered(null);
      drag = null;
      canvas.style.cursor = '';
    };

    const onDown = (e: PointerEvent) => {
      const a = aquariumRef.current;
      if (!a) return;
      const { x, y } = local(e);
      a.pointer(x - a.camera.x, y - a.camera.y, true);
      drag = { x, y, scroll: a.view.target, moved: false };
      canvas.setPointerCapture?.(e.pointerId);
    };

    const onUp = (e: PointerEvent) => {
      const a = aquariumRef.current;
      canvas.style.cursor = '';
      if (!a || !drag) return;
      const wasDrag = drag.moved;
      drag = null;
      if (!wasDrag) {
        // A plain click: throw food exactly where it was clicked.
        feed(a.camera.wx, a.camera.wy);
      }
      canvas.releasePointerCapture?.(e.pointerId);
    };

    const onWheel = (e: WheelEvent) => {
      const a = aquariumRef.current;
      if (!a) return;
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      a.scrollBy(delta * 1.6);
    };

    const onKey = (e: KeyboardEvent) => {
      const a = aquariumRef.current;
      if (!a) return;
      const step = a.width * 0.28;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        a.scrollBy(step);
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        a.scrollBy(-step);
      }
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKey);
    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
    };
  }, [canvasRef, feed]);

  /* --------------------------- reef actions --------------------------- */

  const addCreature = useCallback((): string => {
    const a = aquariumRef.current;
    if (!a) return '';
    // weighted toward fish, with the showpieces as rare draws
    const kind = Math.random();
    const fishIds = a.creatures
      .map((c) => c.species)
      .filter((s) => s.kind === 'fish')
      .map((s) => s.id);
    const rare = ['octopus-coral', 'turtle-green', 'jelly-moon', 'jelly-ember', 'mermaid-lagoon', 'squid-opal', 'seahorse-gold'];
    const pickId =
      kind < 0.72 && fishIds.length > 0
        ? fishIds[Math.floor(Math.random() * fishIds.length)]
        : rare[Math.floor(Math.random() * rare.length)];
    const c = a.introduce(pickId);
    a.creatures.push(c);
    soundRef.current?.chime();
    noticeRef.current?.(`${c.species.label} joined the reef`);
    setStats((s) => ({ ...s, creatures: a.creatures.length }));
    return c.species.label;
  }, []);

  const newReef = useCallback(() => {
    const a = aquariumRef.current;
    if (!a) return;
    a.reseed(Math.floor(Math.random() * 1e9));
    mealsRef.current = 0;
    soundRef.current?.chime();
    noticeRef.current?.('A new reef has grown');
    setStats({ meals: 0, creatures: a.creatures.length, pellets: 0, fps: 60 });
  }, []);

  const setMood = useCallback((next: Mood) => {
    const a = aquariumRef.current;
    if (!a) return;
    moodRef.current = next;
    setMoodState(next);
    if (next === 'calm') {
      const remove = Math.floor(a.creatures.length * 0.35);
      for (let i = 0; i < remove; i++) {
        const idx = a.creatures.findIndex((c) => c.species.kind === 'fish');
        if (idx >= 0) a.creatures.splice(idx, 1);
      }
    } else if (next === 'wild') {
      const ids = ['chromis-rose', 'damsel-cobalt', 'gramma-magenta', 'snapper-blue', 'surgeon-teal'];
      for (let i = 0; i < 14; i++) {
        a.creatures.push(a.introduce(ids[i % ids.length]));
      }
    }
    setStats((s) => ({ ...s, creatures: a.creatures.length }));
  }, []);

  const setNight = useCallback((on: boolean) => {
    nightRef.current = on;
    setNightState(on);
    const a = aquariumRef.current;
    if (!a) return;
    a.setNight(on);
    noticeRef.current?.(on ? 'The reef settles into moonlight' : 'The sun comes back up');
  }, []);

  const setSound = useCallback((on: boolean) => {
    setSoundState(on);
    const engine = soundRef.current;
    if (!engine) return;
    if (on) {
      void engine.start().then(() => engine.setMuted(false));
    } else {
      engine.setMuted(true);
    }
  }, []);

  const getCreatures = useCallback((): Creature[] => aquariumRef.current?.creatures.slice() ?? [], []);

  return {
    stats,
    feed,
    addCreature,
    newReef,
    setMood,
    mood,
    setSound,
    sound,
    setNight,
    night,
    hovered,
    getCreatures,
  };
}
