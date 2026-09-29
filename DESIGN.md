# Design notes

Why the reef looks and behaves the way it does. Read this before changing the art
or the interface, so the next decision starts from the same place.

## The read

The reference is a flat-vector cartoon fish tank: a bright cyan water column going
deeper and bluer toward the floor, bold dark outlines, saturated candy colours, big
expressive eyes, and a plain diagonal sunbeam across the top. It has no texture, no
gradients inside the animals, and no realism — the charm is entirely in the
silhouettes and the palette.

So: **rich, not realistic.** The water can be a smooth gradient; the animals cannot
be shaded mush. Every creature is a bold outline plus flat colour plus one or two
marking patterns, and the eye does the acting.

## Palette

| Token | Value | Role |
| --- | --- | --- |
| Water 1 | `#25c2ee` | surface |
| Water 2 | `#0596cf` | upper mid |
| Water 3 | `#0d7fbd` | lower mid |
| Deep | `#0b5288` | just above the floor |
| Sand | `#f2d9a4` | sea bed, with `#fff0cb` crest and `#d7b478` trough |
| Rock | `#2f6b7c` | with `#1f4e60` shadow and `#57a3a6` light |
| Coral | `#ff7d6b` `#ffb45c` `#e5619a` `#8f6bd8` `#3fc9b0` `#ff9ec4` | fans, anemones, clusters |
| Weed | `#2f8f6a` `#3fae72` `#57c27f` `#1f7a63` | kelp and algae |
| Ray | `#eafcff` | god rays and caustics, always additive |
| Ink | `#0d2438` | every creature's outline |

Animal colours are per-species, authored in `src/sim/species.ts`. The rule that keeps
them readable: **the outline is always darker than the body**, and there is a test
that enforces it. Depth tints a distant animal toward the water colour by up to 34%
and never touches its outline, so silhouettes survive into the haze.

Chrome colours are the same water, one step darker and glassy: surfaces sit at
`rgba(7,47,84,0.52)` over the water with a light hairline edge, text at `#f2fbff`,
and a single warm accent `#ffd977` for the primary action — the same gold as the
treasure and the seahorse, so the interface reads as part of the tank rather than a
panel laid over it.

## Type

- **Fredoka** (500/600) for the display: rounded, geometric, friendly — the letterform
  equivalent of the art.
- **Nunito** (400/700) for everything else: a humanist sans with a rounded terminal,
  so the body copy sits next to Fredoka without looking corporate.

Both from Google Fonts, with a system fallback. Type scale is small and tight:
brand at `clamp(19px, 2.4vw, 25px)`, controls at 13.5px, labels at 10–12.5px in
uppercase with `0.09em` tracking.

## Structure

The tank is the page. There is no hero, no sections, no scroll. The chrome is two
rows pinned to the top and bottom edges, and every element is either a status readout
(meals, animals, fps) or a control (feed, add, new reef, busyness, sound, guide).

Two deliberate choices:

- **The field guide is a dialog, not a page.** Looking up an animal should not take
  you out of the water.
- **The hint explains feeding once** and then changes what it says after your first
  click, rather than staying a permanent instruction.

## An endless tank

The tank has no far wall. It scrolls horizontally without limit, and the population is
managed around wherever the viewer is looking.

**The reef repeats.** Everything the reef places is authored inside one tile — two
screens wide — and drawn again at whole-tile intervals, so two `drawImage` calls cover
the viewport and the seam never shows. Two things had to be written as functions of x
rather than as random walks, because a walk cannot be made to land back where it
started: the sand line is a sum of sines whose periods all divide the tile, and the
distant rock ridge is sampled from the same kind of sum. Kelp, coral, fans, anemones
and the chest are placed inside the tile and drawn with their wrapped copies. The
lighting is deliberately *not* tiled: the sun and the moon stay where they are and the
water moves under them.

The first attempt left a bald patch in the middle of every tile, because the old kelp
placement clustered stems towards the edges of a single screen to keep its centre open.
In an endless reef there is no screen centre, so they are spread evenly instead.

**The population moves with you.** An animal that swims beyond the buffer is retired,
and a new one — often a different species, always a different individual — is
introduced just off the opposite edge and swims in. What you are watching is never the
same shoal twice.

Three bugs worth remembering, all of the same shape. The first: arrivals were placed
outside the window the spawner counts, so it never saw them, decided the species was
under target, and added another one every frame until the tank held four hundred fish.
The second: a hard scroll outran the traffic entirely, leaving the viewer looking at
empty water for ten seconds while the replacements swam in from off screen. The fix is
a second, blunter spawner that seeds the periphery of the *view* directly whenever it
has fallen below half its target — invisible in normal use, and the difference between
an endless tank and an empty one after a fast flick. The third is that fix turning on
itself: the stopgap arrivals were parked just *outside* the window, so they could never
raise the on-screen count that was asking for them, and the top-up ran every frame until
the tank held five hundred animals. They now land hard against the glass, nose in, with
a population ceiling as the belt to that braces.

**Every coordinate that means "the window" has to say so.** This is the trap the
endless tank sets, and it bit four separate places, each invisible near the world origin
and each fatal a few screens out:

- the horizontal steering that keeps a chasing fish off the glass compared against
  `width` as if it were a fixed tank, so past the first screenful *every* hungry fish was
  pushed left forever — which is why food stopped being eaten anywhere but at x≈0;
- an investigative dash aimed at a random x in [0.2, 0.8] of the tank, i.e. back at the
  origin, so fish kept swimming off to visit somewhere they had long left;
- the diagonal `cross` lane's arch, whose progress was `x / width`, pinned at 1 for
  anything past the first screenful — the animals that used it swept flat instead of
  arcing (they run the `drift` lane now, which measures from the window);
- drifting dust spawned in [0, width], and reef-vent bubbles spawned at their tile-local
  x, so both existed only in the first tile.

The rule that came out of it: the reef is periodic, so anything baked from it must be
wrapped into the tile being looked at (`x + round((viewMid − x) / tile) · tile`), and
anything the simulation steers against must be measured from `view.x`.

A tile is wider than the screen, so painting every tile that overlaps the view draws
two tiles' worth of plants every frame. Each pass is handed the slice of the tile it is
responsible for and skips the rest.

## Head first

A side-on fish that reverses should not rotate through 180 degrees. Rotating makes it
swim briefly backwards and sideways while it comes about, and at any real turn rate it
reads as a sprite being spun rather than a fish turning. So direction is a *mirror*:

- `facing` is ±1, taken from the sign of the horizontal velocity, and the art is scaled
  by it.
- What is left of the rotation is `pitch`: the tilt of the nose as the animal climbs or
  dives, clamped to ±0.5 radians and damped, with a `+ base * 0.25` guard on the
  denominator so a fish that has almost stopped does not flip nose-up.

`scale(facing, 1)` is applied *before* `rotate(pitch)`. That ordering matters: composed
the other way round the tilt points the wrong way when mirrored, and a fish swimming
down-left climbs.

Two rigs are exempt. Crabs and starfish are drawn from above, where rotating genuinely
is how they turn; the mermaid is upright and is mirrored with her own small lean.

Everything else is authored nose at +x, and the mirror is the *only* thing that decides
which way it is drawn — so a rig authored the other way round swims tail first no matter
how right the simulation is. That is exactly what had happened to the fish: `paintFish`
is built nose at 0, tail at +1, the mirror image of every other rig, and nothing noticed
because `facing` and `vx` agreed with each other. The fix is two lines in the dispatch —
`scale(-1, 1)` and a half-body shift — and it puts every fish back on its nose, centred
where the simulation steers it. The lesson is in the wiring, not the geometry: a number
that only ever gets compared with another number the same code produced can be wrong
forever.

## The rare three

The whale, the shark and the mermaid are guests, not cast. Each is a `visitor` in the
species table, which keeps it out of the population counts and out of the seed, and each
keeps a diary: a first visit that is deliberately early — nobody should have to take it
on faith that the tank has a whale in it — and then a long gap measured in tens of
seconds.

| | first visit | then | lane |
| --- | --- | --- | --- |
| blue whale | 12s | 55–120s | mid water |
| reef shark | 26s | 45–95s | upper middle |
| mermaid | 40s | 60–130s | lower half |

A guest arrives off the edge, crosses the window it arrived into and leaves; if you
scroll away from it, it is gone and its clock resets. That is what keeps a 24 metre
animal an event rather than furniture, and it is also what makes the shark frightening
again: it is not permanently on patrol, so when the small fish scatter there is
something to scatter from. One summoned by hand from "Add an animal" is nobody's guest
and leaves like anybody else.

A blue whale is 24 metres — fifteen times the blacktip reef shark and three hundred
times the smallest damselfish. At the tank's compression that still comes out at 1.6
tank units, wider than the tank is tall, so `sizeForCm` has a ceiling and the whale is
the one species that hits it. It is drawn at 0.95 units: the biggest thing in the water
by a factor of four, and still small enough to read as an animal rather than as scenery.
It ignores food, does not school, and runs its lane at a steady forty pixels a second,
blowing a column of bubbles when it comes near the surface.

Both physical facts are stated where a visitor can see them: the field guide prints
"2400 cm" next to its name.

## Real scale

Every species declares its typical adult length in centimetres, and that is the only place a
size is written down. `sizeForCm` derives the drawn size:

```
size = 0.030 * (cm / 8) ^ 0.7
```

The cast runs from a royal gramma at 8 cm to a spotted eagle ray at 180 — 22×. Drawn
literally, the gramma would be about three pixels across and the ray would fill the tank, so
the range is compressed by the exponent. That preserves the *order* and the feel of the real
proportions — the ray and the mermaid lead, the shark and turtle follow, the parrotfish is the
biggest fish, the damselfish are minnows — while leaving every animal legible. It turns 22×
into 8.7×.

The exponent is deliberately a single exported constant. Set `SIZE_EXP = 1` and the tank
becomes a literal-scale model; the roster tests assert the ordering, that the drawn range is
narrower than the real one, and that it is still wider than 4× so the cast does not flatten
into one size. The field guide prints each animal's real length next to its name, so the
compression is visible to the visitor rather than hidden in the code.

Two consequences worth knowing. A fish's on-screen size drives its level of detail, so the
smallest fish are drawn with body, tail, dorsal and eye and nothing else. And the size *unit*
is capped at the geometric mean of the viewport, so a portrait phone does not inflate a
170 cm mermaid to a third of the screen width.

## Motion

Motion here is the subject, not decoration, so the discipline is the opposite of a
marketing page: the animals move continuously and the interface barely moves at all.

- Chrome enters once with a 520 ms rise, staggered 80 ms apart, and then stops.
- Presses move 1px. Hovers change background and border over 180–200 ms.
- Nothing in the chrome loops except the sound equaliser, which is feedback for a
  state you turned on.
- `prefers-reduced-motion` removes the entrance animation entirely and damps the
  simulation to 75% speed. It does not freeze the tank — a still aquarium is a
  broken one.

In the water, motion carries meaning: fin beat rate scales with swim speed, the tail
leads the body with a lag, jellyfish only gain speed at the top of the bell
contraction, the squid jets in bursts, weed sways on two sine frequencies, and the
light shafts drift on a 45-second cycle.

**Direction is a lane, not a target.** The first version gave every animal a random
wander target a short distance away, which made the whole tank mill about in the
middle like a bag of marbles. Now each animal holds a *lane* — a depth — and travels
along it:

- `swim` (most things): a level lane inside the species' depth band, drifting up or
  down slowly, occasionally changing its mind and turning around. Fish stream left to
  right and right to left.
- `drift` (octopus, squid, both jellies, the mermaid): the same sideways journey, but
  the lane itself climbs and sinks in long arcs — down, then up, then sideways — and
  the animal is driven along it by its own propulsion, which is what makes the motion
  read as *pushing* rather than as gliding: the jelly only gains speed at the top of
  the bell contraction, the squid and the octopus leave in jets and glide between them,
  the mermaid rises on each stretch of her tail. Measured over a minute, a drifter
  covers a median 157px of depth and 862px of ground.
- `cross`: a diagonal lane across the lower tank. No species uses it any more — the
  tentacled animals that did have been moved to `drift` — but the behaviour is still
  there for anything that wants a straight low sweep.

Leaving the tank is not blocked and it is not wrapped either: the world has no far
wall, so an animal that swims a body length past the buffer is simply retired and a
different one is introduced off the opposite edge. Only an animal chasing food holds
station at the glass, which is the one case where swimming off in pursuit of a crumb
would look like a bug. Bottom dwellers are exempt from lanes entirely — the sand
decides their depth.

Nothing is ever placed in the middle of the view. `spawn()` with no coordinates picks a
side, puts the animal 6–20% of a screen outside the frame, gives it a random rung of its
own depth band and points it inward; the population top-up does the same, so a fish
swimming into shot is always a fish that was somewhere else a moment ago.

**Fish are small.** Sizes come from real lengths as above, so the fish run 0.030–0.108 of the
tank unit — a 3.6× spread, with a 50 cm parrotfish at the top and 8 cm damselfish at the
bottom, and the ray four times the largest of them. Because a 24-pixel fish cannot show a
scaled pattern, the renderer derives a level of detail from each animal's on-screen size and
drops the marks that would be sub-pixel — and holds a floor under the outline width so the ink
line survives.

That unit is the tank height on any landscape screen, which is the only framing the
reference art was drawn for. A phone holds a tall narrow tank, and a turtle sized
against the height takes a third of the width, so the unit is capped at the geometric
mean of the viewport: a laptop is pixel-identical, and a 390×844 phone renders the
same cast at about 55% of the size, which is what lets the population still read as a
crowd. Distances, depth bands and speeds stay on height — only bodies change.

## Night

Night is a lighting problem, not a second scene. The whole water pass — the column gradient,
the bloom, the shafts, the caustics, the sand, the rock and the weed — reads its colours out of
one `OceanPalette`, so `NIGHT_PALETTE` relights the entire tank by being swapped in. The reef
is rebuilt because its rocks and sand are baked offscreen in those colours; the animals only
need re-tinting. Nothing is added to the per-frame path for the water at all.

Three things are genuinely new after dark:

- **A moon and a scatter of stars**, drawn right after the water so animals pass in front of
  them. One cached radial-gradient sprite covers the halo, and the disc is a filled circle
  with two faint craters so it does not read as a flat sticker.
- **Bioluminescence.** Anything with a `glow` value carries its own light: a single additive
  blit of the same cached sprite, pulsing on the animal's own phase. Jellies are brightest,
  then the squid, the mermaid's tail, the seahorse and the starfish — the animals that really
  do light up. `glow` is per-species data, so turning a species on is one number.
- **Plankton.** The drifting dust motes switch to additive and render larger and cooler, which
  is the cheapest possible way to make still water feel alive at night.

The chrome follows: the app carries `data-light` and the CSS tokens for glass, text and shadow
swap for a colder, deeper set, so the panels read as part of the scene rather than as a
daylight interface floating on a night tank.

`rayGain` on the palette scales the bloom and the shafts. It exists because the wide soft
shafts that read convincingly as sunbeams in a bright tank read as a grey smudge once
everything around them goes dark, so moonlight is both dimmer and narrower than sunlight.

## Depth

The layered render is the reason a flat 2D scene reads as a volume:

```
water gradient + sun bloom + god rays   (palette-driven: day or night)
caustics (additive, 5 rows)
far reef      parallax ×0.55   pre-rendered at 0.6× → soft
far animals   parallax ×0.70   drawn into a half-res buffer → soft
aerial wash   one translucent fill of water colour
mid reef      parallax ×0.85   pre-rendered at 1.35×
treasure chest
foreground sand strip          parallax ×1.0
reef life (fans, anemones, kelp) + floor caustics
pellets
shadows on the sand
mid animals   parallax ×0.85
foreground weed
near animals  parallax ×1.10
bubbles, crumbs, ripples
night grade (translucent indigo, after dark)
depth wash + vignette
cursor
```

Three rules keep it from looking flat:

1. **Parallax and softness move together.** The further back a layer is, the more it
   shifts with the pointer and the softer it is. Softness alone reads as a smudge;
   softness plus displacement reads as distance.
2. **A pass shares its cost.** Animals are bucketed by depth into three passes so
   per-animal work can be chosen once rather than per path — and a showpiece is never
   demoted to the far bucket, because a half-resolution shark is just a blurry shark.
3. **Never `ctx.filter`.** This is not a preference, it is the load-bearing rule.
   Handing a path or an image to `blur()` or `drop-shadow()` makes the compositor
   allocate a layer the size of the destination *per drawing operation*. On a retina
   laptop that measured **429 ms a frame** — 2 fps, and enough memory pressure to
   crash the tab outright. Defocus is baked instead: the far reef is pre-rendered at
   0.6× and upscaled, the far animals go through a half-resolution buffer, and
   "distance" is finished off with a single translucent fill of water colour, which is
   the same cue atmospheric perspective has always used. Same frame, **2.4 ms**.

The static layers (far reef, mid reef, sand strip) are painted once into offscreen
canvases and blitted each frame, tiled across the viewport; the animated reef life
(kelp, fans, anemones) is kept as data and drawn live so it can sway.

## Feeding, in detail

The first version of this was a magnet. Every hungry fish looked up the nearest crumb every
frame and pulled straight at it at full speed, which produced three visible tells: fish
twitching between two equidistant crumbs, the whole shoal converging on one pellet, and each
fish ramming through the food at flank speed and shooting out the other side.

What it does now:

1. A click in the water calls `feed()` — 12 crumbs scattered in a 46px radius, and `splash()`
   — a ripple ring, 10 bubbles and a gentle nudge that stirs everything within 16% of the
   tank height. It used to be four times that impulse, which threw the fish nearest the
   click *away* from the food an instant before the food appeared.
2. Crumbs sink at 5.5% of the tank height per second with a sine sway, and settle on the sand
   line where they dissolve after 38–62 seconds. The pellet pool is capped at 160.
3. Each tick, an animal with `appetite > 0.3` that is not sated looks for a crumb within its
   vision radius. That radius is 30–52% of the tank height plus up to 42% more as `scent`
   builds, so a click is noticed immediately by the fish on top of it and by the rest of the
   tank within a couple of seconds: food carries in water. The crab and starfish only consider
   crumbs that have reached the sand.
4. **Everything that can see a crumb comes for it, and up to three animals will contest the
   same one.** The cap is what keeps a click a scramble with winners and losers instead of the
   whole shoal glued to a single pellet, and it is what stops a fish from being pulled off the
   food by the other fish around it. A claim held by an animal that has since left the tank is
   not a claim.
5. The approach is a pursuit, not a beeline. The aim point is where the crumb *will* be by the
   time the fish arrives — crumbs sink and sway, and pointing straight at them makes a fish
   curve along behind and orbit. Speed eases from 1.8× down to 0.55× over roughly the last body
   length, so it closes and takes the crumb instead of ramming through it. Turn authority eases
   the same way, which is what produces the banked arc of a real strike.
6. A chasing animal is exempt from the pointer-shyness term. Otherwise a click puts the cursor
   exactly on the food and the shy half of the cast spends the whole frenzy being pushed off it.
7. The mouth opens over that final approach, which is the only cue that says *eating* rather
   than merely arriving.
8. Within bite reach — half its body length, minimum 1.2% of tank height — it eats. That
   increments the meal count, hides the crumb, releases the claim, spawns crumbs and sparks,
   sets `sated` for 3.4s (0.2s for the shark, which barely cares), and floats a heart if the
   animal is big enough to be worth celebrating.
9. A feeding fish ignores its shoal: schooling is suspended for anyone in `seek`, because a
   fish with food in sight has no interest in holding formation.

Turn authority also came down generally — from `turn × 3.2` radians/sec to `turn × 2` — which
was the single biggest reason the shoal read as sprites being dragged rather than fish
swimming. A damselfish used to be able to pivot about five times a second.

Measured: a click in open water gets **12 of 12 crumbs eaten within 5 seconds**, with an
approach speed that falls from ~83 px/s at 150 px out to ~53 px/s at contact — and that
holds wherever the tank has been scrolled to. `.qa/feed.mjs` checks it the only way that
means anything: six drops at six different places in the endless tank, 72/72 crumbs eaten,
with the population steady across the scrolls. It also counts who came: **41 to 53 animals
answer each drop, against 36 to 51 hungry ones in shot** (the extras swim in from off screen),
and no drop is answered by less than 88% of the fish that could see it.

## What was cut, and why

- **No predator eats another animal.** It was tempting, but a tank where your fish
  disappear is a worse toy than one where they thrive. The shark menaces; it does not
  kill.
- **No creature labels floating in the water.** Names live in the hover chip and the
  field guide. Text over the tank breaks the illusion faster than anything.
- **No fish-count sliders.** `Calm / Lively / Wild` is one decision instead of two
  numbers to tune.
- **No depth-of-field filter.** See the depth notes: it is the one effect that could
  not be afforded, so it is baked into the layers instead.
- **No resolution slider.** The backbuffer budget and the frame-time watchdog decide,
  and both are invisible when they are not needed.
- **No vertical scroll.** The water has a surface and a sea bed; the endless direction is
  the one that has no reason to stop.
- **No whale population.** One at a time, on a timer. A whale that was always somewhere
  in view would be furniture.

## When it is too slow

Three defences, in the order they engage:

1. **The backbuffer budget.** `core/budget.ts` caps the canvas at 3.2 megapixels
   regardless of what the display asks for. This is the big one — canvas cost is close
   to linear in pixels, and a 5.1 Mpx retina buffer is 60% more expensive than a
   3.2 Mpx one for no visible gain.
2. **Level of detail.** Each animal's on-screen size picks one of three detail levels,
   dropping sub-pixel marks. Cheap, and invisible by construction.
3. **The watchdog.** A rolling average of real frame time (ignoring backgrounded-tab
   deltas, which are nonsense) walks quality down past 21 ms and resolution down past
   26 ms, and walks both back up when the machine catches up.

The workload also scales with the population, which the visitor controls directly:
`Calm` removes a third of the fish, `Wild` adds fourteen.

## The clock that went backwards

`requestAnimationFrame` hands its callback the time the frame *started*, not the time the
callback runs. Normally the difference is noise. After a second or more of blocked main
thread — a gc pause, a throttled tab, or one of the on-demand checks that step the tank
synchronously (`__reef.bench`, `__reef.render`) — the next frame can arrive carrying a
timestamp from *before* the block finished, and `(now − last) / 1000` comes back
negative. The measurement from the harness is blunt: a 150-frame `render` block was
followed by a frame stamped **3110 ms in the past**.

Stepping the simulation by −3.1 seconds is not a jitter, it is a rewind: food was
un-eaten, satiety timers grew, and a ripple's radius went from +6 to −1100, at which
point `ctx.arc` threw and took the whole frame with it. The guard is one function,
`frameDelta` in `core/math.ts`: anything outside `(0, 0.25)` seconds is read as a
discontinuity and replaced by a nominal frame, so a stale timestamp costs one frame of
motion instead of running the tank backwards. `Aquarium.update` clamps again at its own
door, because a public `update(dt)` should not trust its callers, and the ripple draw
skips a non-positive radius so that no single bad number can kill a frame.

`.qa/verify.mjs` reproduces it deliberately — a pumped 150-frame block, a ripple in the
water, then six live frames — and fails if anything is recorded in `__REEF_ERRORS__`.

## Extending it

Adding a fish species is one entry in `src/sim/species.ts` — shape, colours, pattern, **real
length in cm**, motion archetype, appetite, population. Size follows from the length, so a new
fish is automatically in proportion with everything else. It will appear in the tank and in the
field guide, and the roster tests will check it is coherent: unique id, a plausible length, a
darker outline than its body, a place in the guide groups.

Give it a `glow` value and it lights up after dark for free.

Adding a new *kind* of creature means a rig in `src/art/creatures.ts`, a `scenario`
in the intent switch in `src/sim/aquarium.ts`, and a case in `paintCreature`. The
`starfish` rig is the shortest complete example to copy.
