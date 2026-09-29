# Yohans' Reef

A living aquarium simulation for the browser: flat-vector reef life in the spirit of
the reference art, with a real food chain. Click the water and the fish turn, swim
over and eat what you dropped.

Built with **React 19 + TypeScript + Canvas 2D**. No 3D engine, no sprite sheets —
every animal, coral and grain of sand is drawn procedurally at runtime, so the whole
thing ships in ~100 kB gzipped.

```bash
npm install
npm run dev      # http://127.0.0.1:5177
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm test` | Unit tests for the simulation's pure logic |
| `npm run typecheck` | `tsc --noEmit` |

## What you can do

- **Feed them.** Click anywhere in the water. Twelve crumbs scatter, sink and sway, and the
  tank smells them: everything that can see the food turns and comes for it — 41 to 53 animals
  answer a typical drop — reading the crumb's sink and sway to aim where it *will* be, then
  easing off over the last body length so it takes the food rather than ramming through it. It
  opens its mouth as it arrives. Up to three fish contest the same crumb, so a feed is a
  scramble with winners and losers rather than a shoal glued to one pellet. Bottom feeders —
  the crab and the starfish — only notice food once it reaches the sand.
- **Swim along the reef.** The tank has no ends: drag the water, scroll, or use the arrow keys
  and it keeps going in both directions, forever. Fish that swim out of view are gone for good
  and new ones swim in to replace them, so the shoal you are watching is one you will not see
  again. The rocks, coral, kelp and the sand line repeat seamlessly, so there is no edge to
  find.
- **Hover an animal** and its name appears in the control bar.
- **Day / Night** relights the whole tank. After dark the water goes indigo, a moon takes over
  from the sun, and the jellies, squid, seahorse, mermaid and starfish carry their own light —
  with the drifting dust turning into glowing plankton. The chrome cools to match.
- **Watch for the rare three.** A blue whale arrives on its own schedule — twenty-four metres
  of it, more than four times the length of the shark — crosses at its own pace, blows near the
  surface, and leaves. It does not care about your food. The reef shark and the mermaid keep
  their own, shorter, diaries.
- **Add an animal** swims a new one in from off screen; **New reef** regrows the rocks, corals,
  weed and the whole cast from a fresh seed.
- **Calm / Lively / Wild** changes how busy the water is.
- **Sound** turns on procedurally synthesised water, bubbles and chomps — no audio
  files. It starts on your click, so browsers allow it.
- **Field guide** lists all 36 species with a live population count and each animal's real
  adult length.
- **Hide info** takes the name, the counters and the how-to off the glass for a tank with
  nothing written on it. The controls stay, because that is where the button that brings the
  words back lives.
- Keyboard: focus the tank and press <kbd>F</kbd> or <kbd>Space</kbd> to scatter food at the
  pointer, or the arrow keys to swim.

## The cast

36 species across twelve creature types, each with its own rig, behaviour and
appetite: 24 reef fish, a reef octopus, an opal squid, a green turtle, a blacktip
reef shark, a **blue whale**, a spotted eagle ray, two jellyfish, a mermaid, a golden
seahorse, a reef crab and a coral starfish — plus coral fans, anemones, kelp, rocks,
sand ripples and a treasure chest spilling coins on every second screen or so.

The animals are not one shape recoloured. Each fish species is authored as anatomy
in body-length units (body depth, where the dorsal peaks, tail shape, mouth type,
fin spread) plus a marking pattern — dots, bars, tiger bands, false eyes, saddles.
The shark cruises and occasionally makes an investigative dash at you; fish panic and
scatter when it comes as close as it does; the squid jets and inks when startled; the
octopus flares red if you crowd it; the mermaid waves back when she notices the cursor.

**How they travel.** Nothing is pinned to a line. Every animal carries a depth it is
working toward and a bob phase of its own, and it moves between depths the way a reef fish
does: a slow weave while it travels, and every few seconds a decision to be somewhere else
in the column, taken as a long diagonal rather than a step. So a fish wanders freely while
its species keeps to the part of the water it belongs in — a goby holds the sand, a
butterflyfish works the mid-water, a chromis rides high — and the band decides where it
*may* go, not the corridor it is glued to. The range is anchored: a fish explores a home
patch around wherever it settled rather than random-walking the whole band over a few
minutes. Measured in the browser, a fish covers about 3% of the tank height in six seconds
while keeping 98% of its motion horizontal — it is going somewhere, and it is going along.

The octopus, the squid, the jellies and the mermaid run a `drift` arc instead: down, then
up, then sideways, driven by their own propulsion — a bell contraction, a jet, a sweep of
the arms, a stretch of the tail. Measured over a minute, a drifter covers a median 157px
of depth on the way past.

**And they arrive from off screen.** Nothing is ever placed in the middle of the view.
A new animal picks a side, starts 6–20% of a screen outside the frame and swims in, so the
fish you are watching was somewhere else a moment ago and the fish that leaves is replaced
by one you have not met.

**Three of them are rare.** The blue whale, the blacktip reef shark and the mermaid are
guests rather than cast: each arrives on its own schedule — the whale first at about
twelve seconds, then every minute or two — crosses the window it arrived into, and
leaves. Scroll away and it is gone until its next visit.

**They always swim head first.** A fish that changes direction is *mirrored*, never
rotated through 180 degrees. The only rotation left is the tilt of its nose as it
climbs or dives, so it is never seen tail-first, sideways, or pirouetting on the
spot to turn around. Every rig is authored nose at +x for exactly this reason, and
`.qa/verify.mjs` checks it against the canvas rather than against the simulation's own
idea of which way a fish is pointing.

## How it works

```
src/
  core/        seeded RNG, vector/colour maths, render-buffer budget
  art/         canvas drawing vocabulary, fish anatomy, every creature rig
  world/       water gradient, god rays, caustics, sand, rock, coral, kelp, chest
  sim/         species roster, lanes and travel, hunger, feeding, pellets, particles
  render/      layered renderer, level of detail, stage profiler
  audio/       procedural Web Audio
  hooks/       the React ↔ simulation boundary
  components/  HUD, field guide
```

Three ideas carry the whole thing:

**Everything is painted, nothing is loaded.** Each animal is drawn from paths in
body-length units — nose at the origin, tail at `x = 1` — then scaled into place.
Big animals use flat fills with a few soft highlights rather than per-frame
gradients, because that is both faster and closer to the flat-vector look of the
reference art. Because the fish are small, the renderer picks a level of detail
from each animal's on-screen size, and when it does draw a scaled pattern it keeps
a floor under the outline width so the ink line survives at 24 pixels long.

**Sized from real animals.** Every species declares its typical adult length in centimetres —
a royal gramma at 8 cm, a blacktip reef shark at 160, a spotted eagle ray at 180 — and its
drawn size is derived from that, so the tank's proportions are the real ones in order and
roughly in feel. The 22× real range is compressed to about 8.7× by a single exponent, because
drawn literally the gramma would be three pixels across and the ray would fill the screen. The
exponent is the only knob: set `SIZE_EXP = 1` in `src/sim/species.ts` and the tank becomes a
literal-scale model. The field guide shows each animal's real length so the compression is
legible rather than hidden.

**Fish are small, and the tank is a window.** Fish run 0.030–0.108 of the tank's size unit, so
the biggest fish is a 50cm parrotfish and the smallest is a 8cm damselfish. On a phone — where
a tall narrow tank would inflate everything — the unit is capped at the geometric mean of the
viewport instead, which leaves a laptop pixel-identical and keeps the population reading as a
crowd on a small screen.

**Depth is layered, and defocus is baked, never filtered.** The tank is drawn in
passes: water and god rays, the far reef, the far animals, a wash of water, the mid
reef and its corals, the sand, shadows, mid animals, foreground weed, near animals,
then bubbles, ripples and a vignette. The camera shifts each pass by a different
fraction of the pointer offset, so parallax falls out of the same depth value that
tints distant animals toward the water colour. Distant things go soft — but that
softness is baked into the layers at build time (the far reef is pre-rendered at
0.6× and upscaled; the far animals are drawn into a half-resolution buffer and
blitted up), never applied with `ctx.filter` at draw time.

**The simulation owns time, React owns chrome.** React renders the HUD and the field
guide and never re-renders per frame. The reef lives in a `useEffect`, driven by one
`requestAnimationFrame` loop. Stats are pushed into React four times a second.

Behaviour is a small per-species state machine (`cruise → seek → eat`, plus `flee`)
steering a velocity. Neighbour queries go through a uniform grid, so schooling,
separation and predator avoidance stay linear as the tank fills up.

## Performance

Canvas2D is priced by pixel, so the two things that matter are the size of the
backbuffer and never handing a path to a filter. `core/budget.ts` caps the
backbuffer at **3.2 megapixels**: a retina laptop asking for 5.1 gets 3.2, and a
4K display at 0.75×, and neither looks soft at normal viewing distance. On top of
that a watchdog in the hook watches the rolling frame time against a 16.7 ms
budget: past ~21 ms it drops the level of detail, past ~26 ms it starts trimming
resolution, and it walks both back when the machine catches up.

Measured in-page in Chromium at **1512×850 on a 2× display** (3.2 Mpx backbuffer)
via `window.__reef.bench()` and `window.__reef.profile()`:

| Tank | Cost per update + render | of a 16.7 ms budget |
| --- | --- | --- |
| ~70 animals on screen, day | **2.4 ms** | 14% |
| the same, at night | **2.3 ms** | 14% |
| Wild | **2.6 ms** | 15% |

The endless tank holds about 1.5 screens of animals — roughly 110 in the world for
70 in view — so that a hard scroll never outruns the traffic. Off-screen animals
cost simulation but no drawing: the renderer buckets the cast by depth but skips
anyone outside the window before it touches a path.

Night costs nothing extra: the water pass is entirely palette-driven, so the moon, the
plankton and the bioluminescence are one translucent fill, one sprite blit per glowing animal,
and no new passes.

Per stage, 1512×850 @2×: mid animals 0.71 ms, near animals 0.51 ms, the reef floor
(sand, fans, anemones, kelp, caustics) 0.40 ms, far animals 0.24 ms, water and god
rays 0.11 ms — everything else under 0.1 ms.

`window.__reef.profile(n)` returns that breakdown live, so the numbers above can be
reproduced rather than taken on trust. Both `bench()` and `profile()` pause the live
`requestAnimationFrame` loop for the duration of the measurement: run alongside it, the
timed iterations queue up behind a frame that is already being presented, and what you
measure is the display's refresh interval rather than the work.

## Verifying it

```bash
npm test                          # 28 unit tests: maths, RNG, palette, budget, real scale, roster
node .qa/verify.mjs               # drives a real Chrome over the DevTools Protocol
node .qa/feed.mjs                 # six drops in six places: does the tank actually eat?
node .qa/chrome.mjs               # the hide switch: are the panels really off the glass?
node .qa/profile.mjs              # the frame-budget breakdown above
node .qa/scene.mjs name "expr"    # screenshot after running expr against the tank
```

`.qa/verify.mjs` expects the dev server on `http://127.0.0.1:5177` and a Chrome
started with `--remote-debugging-port=9333` (`.qa/chrome.ps1` does that on Windows).
It boots the app, advances time through the app's own fixed-step hook (a headless tab
throttles `requestAnimationFrame` to a crawl, which would make real-time observations
meaningless), checks the frame clock across a blocking call, watches the whole cast for
twelve seconds to check that the fish hold a horizontal heading and that nobody leaves
the tank, scrolls the endless tank and confirms it stays populated, switches to night and
confirms the tank actually went dark, dispatches a genuine trusted click to feed —
asserting that one click produces exactly one handful — counts how many crumbs get eaten,
exercises the controls, switches to the `Wild` tank, emulates a 390×844 phone, and writes
screenshots plus `report.json` to `.qa/out/`.

`.qa/feed.mjs` answers the one question a single drop cannot: it scrolls between drops, so
it catches the class of bug where feeding works near the world origin and nowhere else.
It fails the run if any drop is ignored or if the cast grows while scrolling.

`.qa/chrome.mjs` tests the hide switch by reading computed style rather than trusting the
class name: opacity, `visibility`, `pointer-events`, and the layout box each panel keeps
while it is hidden. Two traps are worth knowing if you extend it. `visibility: hidden`
does not collapse a layout box in Chrome, so "the panel is gone" must not be written as a
zero-size test; and `getBoundingClientRect` is post-transform, so a panel that scales to
0.98 as it retreats reports a 2% smaller box and looks like a reflow. It reads
`offsetWidth`/`offsetHeight` for that reason, and checks the other half of the promise
too — the controls row has to survive the hide, or there is no way back.

While the cast was being reworked, `verify.mjs` grew the checks that would have caught the
problems it found. The fish check is per *animal*, not per species: a span taken across
every fish of a kind measures how spread out the shoal is, not how much any one fish swims,
so a school holding station forever still shows a huge spread. Per animal, the motion probe
accumulates how much depth that fish actually covered — under 0.6% of the tank height in six
seconds means the fish are welded to a line, and over 25% means they are milling rather than
swimming. The level-fraction check (horizontal speed must dominate) is what exposed glide
species climbing at 0.42, faster across than along.

The frame budget in that report is retried and the cheapest observation kept, because
this machine is shared with a dev server and a browser: contention can only ever add
time, and a reading that is still high is labelled as contended rather than presented
as the tank's frame cost.

One caveat about the harness: driving thousands of frames inside a *single*
`__reef.render(n)` call starves the browser's event loop and the population drifts
away, which is an artefact of the measurement, not the tank. Verify and the probes
step in chunks, which is also how the real loop works. A long single call is also one
protocol request that has to finish before anything else can be asked, so with a full cast
of hunting fish it runs past the protocol timeout and looks like a harness crash.

The page also carries a small self-check in `index.html` that records anything which
throws during startup into `window.__REEF_ERRORS__`.

## Accessibility & responsiveness

The tank is focusable and keyboard-feedable, every control is a real `<button>` with
a visible focus ring, the field guide is a native `<dialog>` (so Escape and focus
trapping come from the platform), and `prefers-reduced-motion` switches off the CSS
entrance animations and damps the simulation. The HUD reflows for phones, and the
canvas is sized to the window with device-pixel-ratio backing.

## Notes on the art

There are no image assets and no stock photography. Every creature, rock and coral
is drawn with canvas paths at runtime, and all sound is synthesised with Web Audio.
The palette is grounded in the reference image: a cyan-to-deep-blue water column,
warm sand, and saturated coral pinks, oranges, magentas, aquas and violets for the
animals.
