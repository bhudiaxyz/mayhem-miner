# Mayhem Miner: Design

This document covers how the game is built: module layout, the tile grid and cavern format, movement, the reachability solver, procedural generation, the game rules, rendering, UI, palette, quality tiers, input, audio, tooling and deployment. The [README](README.md) covers what the game is and how to play it.

## Contents

1. [Goals and constraints](#1-goals-and-constraints)
2. [Stack and project layout](#2-stack-and-project-layout)
3. [Architecture](#3-architecture)
4. [Caverns and the tile grid (`world/caverns.ts`)](#4-caverns-and-the-tile-grid-worldcavernsts)
5. [Movement (`core/physics.ts`)](#5-movement-corephysicsts)
6. [The solver (`world/solver.ts`)](#6-the-solver-worldsolverts)
7. [Procedural generation (`world/generate.ts`)](#7-procedural-generation-worldgeneratets)
8. [Game rules (`core/game.ts`)](#8-game-rules-coregamets)
9. [Rendering (`render/view.ts`, `fx/effects.ts`)](#9-rendering-renderviewts-fxeffectsts)
10. [UI, menus and progress](#10-ui-menus-and-progress)
11. [Palette and themes (`core/palette.ts`)](#11-palette-and-themes-corepalettets)
12. [Quality tiers and performance](#12-quality-tiers-and-performance)
13. [Input (`player/input.ts`)](#13-input-playerinputts)
14. [Audio (`fx/audio.ts`)](#14-audio-fxaudiots)
15. [Frame loop and boot (`main.ts`)](#15-frame-loop-and-boot-maints)
16. [Checks and tooling](#16-checks-and-tooling)
17. [Build and deployment](#17-build-and-deployment)
18. [Tuning reference](#18-tuning-reference)
19. [Known limits and extension points](#19-known-limits-and-extension-points)

---

## 1. Goals and constraints

- **The genre's core feel**: single-screen caverns, a committed fixed-arc jump, fatal falls, an air supply that is also the clock, and guardians on fixed patrols. Precision and route-finding, not reflexes alone.
- **Original content**: the name, the hero (Pip), all twenty cavern layouts and names, the guardians, art, music and code were made for this project. The early-1980s single-screen platformers, chiefly _Manic Miner_ (ZX Spectrum, 1983), inspired the mechanics. Its Commodore Amiga releases suggested the copper-bar backdrops and the chiptune voice.
- **Fair content, provably**: every cavern, hand-built or generated, is checked by a solver that runs the game's own movement code (§6), so no layout can be impossible.
- **Small, plain code**: about 3,200 lines of TypeScript in 16 modules across six folders, following the sibling _thrust-force_ project's layout. There's no game engine, no ECS and no physics library. Rules are plain functions over plain objects.
- **Testable core**: physics, caverns, solver, generator and rules (`core/physics`, `core/game`, `core/random`, `world/*`) touch no DOM and run headless under Node.
- **Everywhere, equally well**: desktop, tablet and phone in either orientation, with keyboard, touch or gamepad. Static hosting on GitHub Pages.

## 2. Stack and project layout

| Piece      | Choice                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------- |
| Rendering  | three.js r185 (`WebGLRenderer`, `EffectComposer` on a multisampled target, `UnrealBloomPass`) |
| Language   | TypeScript 5, `strict`, ES2022 modules, bundler resolution                                    |
| Build      | Vite 8 (`base: '/mayhem-miner/'`, three.js split into its own chunk)                          |
| Sound      | WebAudio, synthesised at runtime (no audio files)                                             |
| Fonts      | Press Start 2P (pixel display) and Inter (body), from Google Fonts                            |
| Checks     | Node's native TypeScript runner + `node:assert`; Python Playwright for the browser smoke test |
| Formatting | Prettier per `.prettierrc` (4-space, double quotes, ES5 trailing commas, 120 columns)         |

```text
index.html              DOM shell: #app, #hud, #touch, #boot (splash + main menu), #pause, #sheet, #intro
public/
  icons/                icon.svg (source) + 192 / 512 / maskable / apple-touch PNGs rendered from it
  manifest.webmanifest  installable web app (fullscreen, landscape)
src/
  main.ts               composition root: boot, menus and run flow, commands, frame loop, event routing
  styles.css            theme variables, responsive layout (strip / gutters), HUD, touch, menus, dialogs
  core/
    game.ts             rules: cavern state, air, crystals, guardians, lives, score, phases (pure)
    difficulty.ts       the difficulty curve: bands of ten, every per-cavern knob (pure)
    physics.ts          miner movement: walk, jump table, fall, landing, overlap tests (pure)
    palette.ts          every colour: a theme per cavern (+ seeded ones), sprite colours, UI colours
    random.ts           the shared seeded PRNG, mulberry32 (pure)
    save.ts             localStorage: best score, deepest cavern reached, help seen
  world/
    caverns.ts          the 20 hand-built ASCII caverns, the tile legend and the parser (pure)
    solver.ts           breadth-first reachability over miner states (pure)
    generate.ts         endless seeded caverns after the 20th, generate-and-test with the solver (pure)
  player/
    input.ts            keyboard, touch buttons, gamepads → Input; control help text
  render/
    view.ts             three.js scene: voxel cavern, crystals, portal, lights, post-FX
    characters.ts       voxel miner + guardians: part builder, joints, poses, helmet torch
    paint.ts            procedural canvas textures: rock tiles and the layered back wall
    preview.ts          animated turntable for How to play's carousels (one small renderer)
    props.ts            shared prop geometry (crumbling ledge) + How to play obstacle dioramas
    tier.ts             GPU classification + per-tier quality table
  fx/
    effects.ts          pooled additive sparks, voxel pickup halos, ambient motes
    audio.ts            WebAudio effects and the procedural chiptune
  ui/
    hud.ts              HUD writer (DOM writes only on change)
    menu.ts             main menu, sheets (cavern select, how to play), intro card, menu navigation
scripts/
  check.ts              headless asserts (npm run check)
  smoke.py              Playwright smoke test: desktop, portrait phone, landscape phone
  ts-resolve.mjs        Node resolve hook: lets scripts import extensionless src/ modules
.github/workflows/deploy-pages.yml   build + deploy to GitHub Pages on push to main
```

Every source file opens with a header in the same shape: a summary line, then **Purpose**, **Operations**, **Usage**, **Highlights** and **See also**. Start there when reading a module. Inside each file the order is imports → constants → `let` state → functions and classes.

## 3. Architecture

One rule: **simulation and presentation don't share state they both write.**

```text
   keyboard / touch / gamepad ─► player/input.ts ─► readInput() : Input {left, right, jump}
                                                        │
                                                        ▼
 main.ts ──────────────────────────────► Game.update(dt, input) ─► Game state (plain objects)
    ▲                                            │                        │ read-only
    │                                     onEvent(e)                       ├─► ui/hud.ts (DOM)
    │                                            ▼                         └─► View.sync ─► WebGL
    └── fx/audio.ts sfx[e] ◄────────────── main.ts ──► View.burst ─► fx/effects.ts

 world/caverns.ts (20 ASCII maps) ─┐
 world/generate.ts (n ≥ 20) ───────┴─► cavernFor(n) : Cavern ─► Game.load(n)
                     └── world/solver.ts ◄── core/physics.ts ──► Game.tick
```

- **`Game`** owns all mutable gameplay state: the miner, guardians, the cavern's live tiles (crumbled ledges, opened doors), crystal flags, air, score, lives and phase. It advances only through `update(dt, input)`.
- **`physics.ts`** is the single movement model. `Game` and the solver both call `stepBody()`, so "the solver can reach it" and "the player can reach it" mean the same thing.
- **`View`** reads a `Game` every frame and poses meshes to match. It never writes game state. It rebuilds its meshes only when `game.cavern` changes identity.
- **Events** carry the one-way information that can't be polled: jumps, pickups, deaths, completions. `Game.onEvent(e)` is one callback; `main.ts` maps each event to a sound (`sfx[e]`), sparks (`View.burst`), a HUD message or a save.
- **Content is data**: `cavernFor(n)` returns a parsed `Cavern` for any `n`. Hand-built for 0–19, generated (deterministically) beyond.
- **Flow belongs to main.ts**: menu → run → pause / game over → menu. `ui/menu.ts` only renders and reports choices; `core/save.ts` remembers progress.

The split keeps the logic checkable without a browser, and lets the title screen draw a live "attract" `Game` (guardians patrolling, crystals flashing, no miner) through the same `View`.

## 4. Caverns and the tile grid (`world/caverns.ts`)

### 4.1 Grid and coordinates

- A cavern is **32 × 16 cells**; a cell is **8 game pixels**, so the playfield is 256 × 128 px. All game positions are integer pixels with **y growing downwards** (row 0 is the top), matching the ASCII maps.
- Row 0 is a solid ceiling, row 15 a solid floor, and columns 0 and 31 solid walls. The parser adds all four; authors draw only the inner **30 × 14**.
- `tiles` is a 512-character row-major string, `tiles[r * 32 + c]`. `Game` copies it into a mutable `string[]` so ledges can crumble and doors can open.
- The miner and walking guardians are **1 cell wide and 2 tall** (8 × 16 px). A position `(x, y)` is the top-left pixel of that box.

### 4.2 Legend

| Char      | Meaning                                                                          |
| --------- | -------------------------------------------------------------------------------- |
| `#`       | Rock: blocks from every side, can be stood on                                    |
| `=`       | Ledge: one-way, stand on it, jump up through it                                  |
| `~`       | Crumbling ledge: one-way, wears away while stood on                              |
| `<` `>`   | Conveyor: one-way ledge that carries you left / right                            |
| `^`       | Spikes: fatal on touch                                                           |
| `D`       | Door: solid until any lever is pulled                                            |
| `k`       | Lever: touch to open every door                                                  |
| `*`       | Crystal                                                                          |
| `P`       | Portal: top-left cell of a 2 × 2 gate                                            |
| `S`       | Start: the miner's lower body cell                                               |
| `E` / `e` | Walking guardian (lower cell), starting right / left; flies if no ledge under it |
| `V` / `v` | Vertical guardian ("lift", upper cell), starting down / up                       |

Two derived sets drive everything else: `SOLID = "#D"` (blocks movement) and `SUPPORT = "#D=~<>"` (can be stood on).

### 4.3 Parsing

`parse(def, n)` pads each inner row with `.` to 30 cells, wraps it in walls, adds ceiling and floor, then lifts every marker (`S P * k E e V v`) out of the grid into typed fields (`start`, `portal`, `crystals`, `levers`, `guardians`), leaving air behind. Rows that are too long, or the wrong row count, throw.

**Guardian patrols are derived, not authored**:

- **Walkers** (`kind: "walk"`, a support tile below the start cell) extend left and right while the next column is free of `# D ^` in both body rows _and_ still has support underneath, so they pace their ledge and turn at walls, spikes and ledge ends.
- **Fliers** (`kind: "fly"`, no support below) extend until `# D ^` only: they sweep their two rows wall to wall.
- **Lifts** (`kind: "lift"`) extend up and down their column until any structural tile (`# D = ~ < > ^`), so authors bound them by placing ledges above and below.

The result is `min` / `max` in pixels along the moving axis.

### 4.4 The twenty caverns

Each map is drawn so standard ledge bands sit three rows apart (one jump high) and neighbouring ledges overlap or sit within jump reach. Features are introduced one at a time: plain ledges (1), crumbling ledges and spikes (2), conveyors and a lift (3), a rock wall that forces an over-the-top route (4), conveyor runs (5), lever and doors guarding the portal (6), then combinations, ending with a crystal sealed in a door vault (20). Air is `75 − n` seconds (75 s for cavern 1, 56 s for cavern 20).

## 5. Movement (`core/physics.ts`)

### 5.1 Fixed timestep

`Game.update(dt)` accumulates real time (capped at 0.25 s so a stalled tab can't spiral) and runs `tick()` at **40 Hz** (`TICK`). Every movement value is a whole number of pixels per tick, so results are identical on every machine and display refresh rate. The view interpolates between ticks (§9.4).

### 5.2 `stepBody(b, input, tiles)`

The body is `{ x, y, mode, t, dir, apex, face }`, where `mode` is `ground`, `jump` or `fall`. One tick:

1. **Ground.** `footing()` reads the support tiles under the feet (only when the feet are exactly on a cell boundary, `(y + 16) % 8 === 0`).
    - No footing: switch to `fall`, record `apex = y`, no sideways motion.
    - Jump held: switch to `jump`, `t = 0`, commit `dir` to the held direction (−1, 0 or +1), record `apex`. Return `"jump"` and fall through to the airborne step this same tick.
    - Otherwise walk 1 px towards the input, unless `blocked()`. **Conveyors**: on `<` or `>` footing, the belt's direction wins; holding against it stands still, holding with it moves at belt speed.
2. **Airborne.** In `jump`, the vertical delta is `JUMP[t++]` and the body moves 1 px along `dir` (unless blocked). When the table runs out the body falls. In `fall`, the delta is `FALL_SPEED` (4 px) straight down.
3. **Rising** moves 1 px at a time; rock or a door above (`blocked(x, y − 1)`) cancels the jump into a straight fall. `apex` tracks the highest point.
4. **Descending** moves 1 px at a time, checking `footing()` before each pixel. That makes landing pixel-exact and stops a fast fall from skipping through a ledge. On landing, a drop of more than `FALL_LIMIT` (48 px, six cells) measured **from the apex** returns `"dead"`; otherwise the body is grounded and `"land"` is returned.

The jump table is `[-4,-4,-3,-3,-3,-2,-2,-2,-1,-1,-1,0, 0,1,1,1,2,2,2,3,3,3,4,4]`: 26 px up and back down in 24 ticks (0.6 s), covering 24 px (three cells) sideways. Consequences that the cavern design relies on:

- A ledge **three rows** above (24 px) is reachable; four rows is not.
- A gap of **up to three cells** at the same height can be crossed.
- Walking off a ledge survives a **six-cell** drop. Jumping down survives about two rows, because the rise counts too.

### 5.3 Overlap tests

| Test                          | Rectangle                                                          |
| ----------------------------- | ------------------------------------------------------------------ |
| `blocked(t, x, y)`            | the full 8 × 16 box against `SOLID` cells                          |
| miner touch hitbox            | `[x+1, x+7) × [y+HIT_TOP, y+16)`, `HIT_TOP` = 4 (§9.3)             |
| `hitsCell(x, y, c, r, inset)` | miner hitbox against cell `(c, r)` shrunk by `inset` px            |
| `touching(t, x, y, "^", 2)`   | any spike cell, inset 2 px (spikes are forgiving at their edges)   |
| crystals, levers              | `hitsCell` with inset 1                                            |
| `inPortal(x, y, c, r)`        | the 2 × 2 portal shrunk by 4 px: you have to step properly into it |
| guardian (in `Game`)          | `[gx+1, gx+7) × [gy+5, gy+15)`                                     |

## 6. The solver (`world/solver.ts`)

`solve(cavern)` answers "can every crystal, every lever and the portal be touched?" by **breadth-first search over miner states**, using `stepBody()` itself as the transition function.

- **State** is `(x, y, mode, t, dir, apex)`, packed into one number for a `Set`. **Grounded states are normalised**: `t`, `dir` and `apex` don't affect the future of a grounded body, so they're zeroed, which collapses most duplicates.
- **Branching**: grounded states try six inputs (idle, left, right, jump, jump-left, jump-right); airborne states try one, because a committed jump ignores input.
- **Pruning**: successors that die (fatal fall) or touch spikes are dropped.
- **Recording**: each dequeued state marks any crystal, lever or the portal it overlaps.
- **Doors**: the first search runs with doors closed. If a lever was reached, a second search runs with every `D` turned to air, and the results are merged.
- **Deliberately optimistic**: guardians and air are ignored, and crumbling ledges never crumble. The solver proves a **route exists**; executing it under time pressure, past guardians and before ledges give way, is the game.

Typical cost: 25,000–65,000 states and 6–30 ms per cavern under Node (printed by `npm run check`).

## 7. Procedural generation (`world/generate.ts`)

`cavernFor(n)` returns hand-built cavern `n` for `n < 20` and `generate(n)` after that, so a run never ends. Generation is **seeded generate-and-test**:

```text
for attempt = 0, 1, 2 …:
    r = rng(n · 7919 + 1337 + attempt · 104729)
    layout = build(n, r)            // ASCII rows, same legend as the hand-built maps
    cavern = parse(layout, n)       // same parser
    reject if a guardian patrols the start
    s = solve(cavern)
    reject if !s.portal
    drop crystals s says are unreachable
    accept if ≥ 5 crystals remain
```

### 7.1 The difficulty curve (`core/difficulty.ts`)

Like thrust-force, `difficulty(n)` returns every per-cavern knob, climbing in **bands of 10 caverns** (`BAND`) up to **cavern 100** (`MAX_DIFFICULTY_AT`) and holding there. With `band = ⌊n / 10⌋` and `within = (n mod 10) / 9`, progress is `t = (band + 0.2·within) / 9.2`: inside a band difficulty creeps up only 20% of a band step, and each new band is a clear step up. Each knob is a blend `a + (b − a)·t`:

| Knob            | Cavern 1     | Cavern 100 | Applies to  | Effect                               |
| --------------- | ------------ | ---------- | ----------- | ------------------------------------ |
| `guardianSpeed` | 0.5          | 1.15       | all caverns | guardian px/tick                     |
| `airBonus`      | +15 s        | 0          | hand-built  | band 1's cushion (very easy start)   |
| `air`           | 66 s         | 40 s       | generated   | seconds of air                       |
| `crystals`      | 5            | 12         | generated   | crystals wanted (+0–1)               |
| `walkers`       | 1            | 5          | generated   | ledge walkers                        |
| `lifts`         | 0            | 3          | generated   | lift attempts                        |
| `fliers`        | 0 (until 31) | 1 → 3      | generated   | fliers mid-cavern                    |
| `sprinters`     | 0 (until 41) | 1 → 3      | generated   | guardians at `SPRINT` (1.5×) speed   |
| `crumble`       | 6%           | 40%        | generated   | chance a segment crumbles            |
| `conveyor`      | 10%          | 24%        | generated   | chance a segment is a belt           |
| `floorSpikes`   | 1            | 7          | generated   | floor spike attempts                 |
| `ledgeSpikes`   | 15%          | 55%        | generated   | spike on a long ledge                |
| `pillars`       | 0            | 4          | generated   | hanging rock pillars (50–100% of it) |

Bands 1–2 are the hand-built caverns, whose authored layouts already rise in complexity. The curve makes band 1 very easy (slow guardians, 15 s of extra air) and steps band 2 up. Generated caverns start in band 3. **New mechanics arrive at the start of a band**, so each is met on its own: fliers in generated caverns from 31 (band 4) and sprinting guardians from 41 (band 5). **New creatures** arrive by band too (§9.3). The intro card names the band: Very easy, Easy, Steady, Tricky, Hard, Harder, Very hard, Brutal, Fiendish, Mayhem (`BAND_NAMES`). `check.ts` asserts no knob ever eases from one cavern to the next, the curve saturates at 100, band 1 stays gentle, each band is a clear step up, and fliers and sprinters never appear early (§16).

### 7.2 Layout

`build()` lays the cavern out in this order, with the knobs above:

1. **Ledge bands** on rows 12, 9, 6 and 3 (three rows apart: exactly one jump). Each band is a run of segments 3–8 cells long separated by 2–4 cell gaps. A segment is a crumbling ledge (`crumble`), a conveyor (`conveyor`), rock (6%) or a plain ledge.
2. **Start** in a randomly chosen bottom corner (column 1 or 28). Later steps keep spikes and lifts at least four columns away from it.
3. **Pillars**: `pillars` three-row rock columns hanging under random upper segments, which block walking and force new routes.
4. **Spikes**: `floorSpikes` on the floor, and on the middle of long plain ledges (`ledgeSpikes`).
5. **Portal**: candidate spots are any 2 × 2 of air resting on a non-crumbling segment, or floor spots more than 12 columns from the start. One is chosen among those more than 14 cells (Manhattan) from the start.
6. **Crystals**: `crystals` (+0–1), each on a cell just above a segment (sometimes one cell higher, which needs a jump), at least three cells from any other crystal in the same row and never inside the portal.
7. **Guardians**: `walkers` on segments of five or more cells, `lifts` in open columns, and `fliers` on rows 6–8 (from 31). Then `sprinters` of them (from 41, seeded) get `speed = SPRINT`.

Names come from the same seeded stream: an adjective and a mining noun, for example "Sunken Winze" or "Copper Heading". Air follows `air`. Results are memoised per `n`, so restarts and the cavern select list are free. Generating caverns 20–109 takes about 1.3 s in total under Node, roughly 15 ms each including retries, so a fresh cavern costs a fraction of a frame budget at load.

## 8. Game rules (`core/game.ts`)

### 8.1 Phases

| Phase      | Meaning                                  | Exit                                                    |
| ---------- | ---------------------------------------- | ------------------------------------------------------- |
| `play`     | normal play                              | a death → `dead`; touching the open portal → `complete` |
| `dead`     | 1.6 s pause, miner hidden, sparks        | lives left → the same cavern reloads; none → `over`     |
| `complete` | air drains into the score (1.5 s / tick) | air empty, then 0.6 s → `load(n + 1)`                   |
| `over`     | final; main.ts shows the game-over card  | main.ts creates a new `Game`                            |

Guardians keep moving in every phase, so the cavern stays alive behind dialogs. A **demo** game (`{ demo: true }`, the title screen) only moves guardians.

### 8.2 One `play` tick, in order

1. **Air** drops by one tick; at zero, die.
2. **Movement**: `stepBody()`; a `"dead"` result dies; `jump` and `land` become events. `walk` accumulates pixels walked (it drives the leg animation).
3. **Crumbling**: while grounded on `~`, each `~` cell under the feet gains one tick of `wear`. At `CRUMBLE_TICKS` (28 ticks, 0.7 s) it becomes air and a `crumble` event fires.
4. **Guardians** patrol: `x` (walk, fly) or `y` (lift) moves by `guardianSpeed` px/tick and reverses at `min` / `max`. Speed is `difficulty(n).guardianSpeed` px/tick (0.5 at cavern 1, 20 px/s, rising band by band to 1.15, 46 px/s, at cavern 100), times the guardian's `speed` (1.5 for sprinters).
5. **Hazards**: spikes, then guardians: die.
6. **Crystals**: each one touched scores 100 and fires `crystal`, or `open` if it was the last.
7. **Levers**: the first touch opens every door (`D` → air) and fires `lever`.
8. **Portal**: once every crystal is taken, stepping into it fires `complete`.

### 8.3 Lives, score and restart

- Three lives; a death spends one and **reloads the cavern in full**: crystals, crumbled ledges, doors and guardian positions all reset. `load(n, cavern)` reuses the same `Cavern` object, which also tells the view nothing needs rebuilding.
- Points: 100 per crystal, plus 20 per second of air left at the portal. An **extra life every 10,000 points** (`extra` event).
- The pause menu's **Restart cavern** calls `die()`: it costs a life, so it can't be used to dodge the air clock for free.
- Positions from the previous tick (`px`, `py`) are kept on the miner and every guardian for interpolation; `alpha` is the fraction of a tick since the last one.

## 9. Rendering (`render/view.ts`, `fx/effects.ts`)

### 9.1 Scene and camera

- Game pixels map to world units as `x / 8` and `16 − y / 8`: one cell is one unit, and y flips so up is up. Blocks are 1 × 1 × 1.2 deep (`DEPTH`), centred on z = 0.
- **Camera**: perspective, 30° FOV, fixed. `resize()` computes the distance that fits **(32 + 1) × (16 + 3.6)** units into the host element (the extra height is room for the HUD bars), whichever axis is tighter. It raises the camera by 6% of that distance and looks back down at the centre, so ledge tops read as surfaces. In play the camera **drifts** up to 0.4 × 0.25 units toward the miner (eased, off under `prefers-reduced-motion`), so the diorama shows its depth.
- The canvas fills **`#app`, whose size CSS decides** (§10.3). A `ResizeObserver` on `#app` reframes the camera whenever the layout changes, including rotation and the touch strip appearing.
- **Lights**: a hemisphere light (cool sky, warm ground), a key directional light from upper left, and the **helmet lamp**, a warm point light riding just ahead of the miner's head that lights the surrounding rock as he moves; it blinks red once a fall is already fatal, and dims and gutters under 20% air. A **portal light** in the theme glow lights the cavern around the portal once it opens. On high tiers the key light casts PCF shadows (2048² or 1024², a ±20-unit frustum) from blocks, spikes, guardians and the miner onto the back wall.
- **What glows**: ACES Filmic tone mapping, and "neon" materials use `toneMapped: false` with HDR colours (channels above 1), so only they cross the bloom threshold (0.85). They are the crystals, edge strips, the open portal, the lamp, guardian eyes, the lever knob and sparks.

### 9.2 Building a cavern

`build(cavern, n)` disposes the previous cavern's group (geometries and materials) and creates:

- **Rock, ledges, crumbling ledges, conveyors and doors** as one `InstancedMesh` each (slightly rounded cubes for `#` and `D`, 0.32-thick rounded slabs for ledges and belts, from `RoundedBoxGeometry`, so every edge catches a highlight), with a per-instance colour of the theme tint × a seeded ±10% jitter so no two blocks match. **Crumbling ledges look unsafe at a glance**: `crumbleGeometry()` (render/props.ts) breaks the slab into four uneven voxel chunks with gaps and a few crumbs hanging below, under a rubble texture of chips, cracks and pits.
- **Edge strips**: a thin `InstancedMesh` of HDR bars along the front-top edge of every standable tile with air above, in the theme's glow colour. They outline every surface you can land on. Crumbling cells get their own **broken, dimmer strip** (three dashes at `CRUMBLE_STRIP` = 55%), posed with the cell's wear each frame, so it sinks with the ledge and vanishes with it (it used to be left floating).
- **Spikes**: two cones per `^` cell, pointing down if they hang from something and up otherwise.
- **Crystals** (octahedra), **levers** (base, arm, glowing knob), the **portal** (four frame bars around a core plane), and one **model per guardian** (§9.3).
- A **patrol zone** per guardian: a faint plane in its colour on the back wall over the box it sweeps, so routes can be planned at a glance.
- **Ground-level shadows on every tier**: a soft dark blob on the first surface below the miner, each creature, every crystal and lever, the portal and each spike cell. They are read from the live tiles, so they drop when a ledge crumbles or a door opens; they shrink and fade with height, so fliers and lifts read as airborne; and they are lighter (40% vs 70%) on tiers that also have shadow maps. Each is tilted 20° toward the camera (`BLOB_TILT`), which sees ledge tops almost edge-on, so it reads as a contact shadow from the fixed viewpoint. Moving ones are placed each frame (`placeBlob`), static ones at build.
- The **backdrop** plane behind everything (§11).

Textures are 16 × 16 greyscale pixel-art tiles painted into canvases: the ledge, crumble, belt and door tiles once at start-up (`tileTextures()`, render/paint.ts), and the rock tile per cavern in its theme's style (`rockTexture`, §11). They use nearest filtering with no mipmaps and are tinted per instance, so there are no image files. Each texture is also its material's `bumpMap`, so the grit reacts to the lamp. The two belt directions get their own clone of the belt texture so they can scroll opposite ways.

### 9.3 Models

Every character lives in `render/characters.ts` and is **built from voxel cubes**: one voxel is 1/8 unit, so a 1 × 2 cell character is 8 × 16 voxels, the same grid as the game's pixels. Each body part is a list of boxes (later boxes paint details over earlier ones). `voxelFaces()` fills a grid from them and emits only the faces exposed to air, with a small per-voxel brightness jitter so the cubes read individually. Glowing voxels (eyes, lamp lens, antenna tips) go into a second, unlit HDR mesh, so a part is at most two draw calls. Parts hang from **joints** (hips, shoulders, neck, wing roots, rotor hub), and `pose(state)` only rotates or moves joints. The state is `{ dt, t, phase, mode, land }`: `phase` is the walk cycle driven by distance moved (so feet match the ground), `mode` is `idle | walk | rise | fall | flail`, and `land` is a landing squash (0–1, clamped). The view times it against `game.time`, which restarts at 0 on every cavern load and restart, so a landing remembered from before is dropped when the clock goes backwards. Without that, the next cavern drew a giant, flipped miner until its first landing. The miner eases toward each mode's target pose by `dt`, so transitions blend instead of snapping, and everything freezes while paused (`dt` = 0).

All characters face +x with their feet at the origin. The miner, guardians and crystals are drawn at **`SPRITE` = 75%** of their size, scaled from the feet, so they sit comfortably inside their 1 × 2 cell box. Movement still uses the full 8 × 16 px box against rock (so cavern clearances, and the solver's proofs, are unchanged), but every _touch_ test (spikes, guardians, crystals, levers, the portal) uses the shrunken box: `HIT_TOP` (4 px) trims the top of the miner's, and the guardian box starts 5 px down, so what you see touching is what kills.

| Model      | Kind | From cavern | Joints and animation                                                                       |
| ---------- | ---- | ----------- | ------------------------------------------------------------------------------------------ |
| miner      | you  | —           | legs, arms, torso, head. Walk swing + bob + lean; idle breathe + look; tuck; flail; squash |
| slime      | walk | 1           | hops along, squashing and stretching (translucent); darker base, lighter crown             |
| beetle     | walk | 1           | six legs in a tripod gait, shell bobs; dark legs, mid head, lit shell ridge                |
| bat        | fly  | 1           | wings flap from the shoulders, body bobs; ears, pale belly                                 |
| drone      | lift | 1           | rotor spins, core bobs and sways, thruster glows                                           |
| mole       | walk | 11          | big front claws paddle, hind feet push, body rolls; pink glowing snout                     |
| mine robot | walk | 21          | stiff legs and arms swing, torso bobs, visor head scans                                    |
| spider     | lift | 21          | hangs on a silk thread up to the top of its range (`PoseState.reach`); legs splay, twitch  |
| worm       | walk | 31          | ringed segments inch along in a wave, rearing toward the head                              |
| moth       | fly  | 41          | wings flap through a raised V (readable side-on), body bobs                                |

`CREATURES` (end of characters.ts) is the roster: each entry has its kind, the band it arrives in, the Help text and a preview colour. `guardianModel(kind, n, colour)` picks from the creatures of that kind its band allows, newest first, so a band's newcomer is the one most often met. Every creature uses at least three tones of its colour (light, mid, dark) so its body parts read apart.

**The helmet torch.** The miner's helmet carries a steel housing with a glowing lens. A soft additive cone (vertex-faded, no texture) shines from it, and a `SpotLight` kept in the scene (never hidden, so shaders never recompile) is aimed each frame from the lens toward a point ahead of the head, so it follows bob, lean and look. Two independent knobs set the strength: `MINER_GLOW` (view.ts) for the warm halo point light around the miner, and `TORCH_GLOW` (characters.ts) for the spotlight, beam and lens. Both fade through a death and gutter on low air. Crystals glow at `CRYSTAL_GLOW` (view.ts).

**Crystal pickup halo.** `Effects.halo()` adds a blocky halo: two rings of glowing cubes (16 outer, 8 inner a beat later) snapped to the voxel grid so they read as pixel-art circles. They burst outward, shrinking and spinning as they fade over 0.6 s, with a flash of point light in the crystal's colour. It is one `InstancedMesh` shared by up to four halos.

**Creature colours** are a palette per cavern, seeded by its name: a hue family set opposite the back wall's hue (+0.35 to +0.65 round the wheel), so creatures always stand out, with a cavern-wide saturation and lightness. Kinds sit apart in hue (fliers +0.14, lifts −0.14), and each creature gets its own slight shade. HSL is read as sRGB. Patrol zones use the same colour at 7% opacity. Facing is a rotation of ±0.45 rad off side-on, so the models read as 3D. Turns ease between the two angles through facing the camera rather than snapping.

### 9.4 Per-frame posing (`sync`)

- **Interpolation**: the miner and guardians are drawn at `lerp(previous tick, current tick, game.alpha)`. The game moves in whole pixels at 40 Hz but looks smooth at 60–120 Hz.
- **Crumbling ledges** sink and thin with wear (`scale.y = 1 − 0.8 · wear`) and shake slightly. Once gone they are scaled to zero.
- **Doors** hide once opened; the **lever** arm flips.
- **Crystals** spin, bob and **flash**: their colour steps through `COLORS.crystalCycle` at 8 Hz, each offset by its index. Taken ones hide.
- **Portal**: dark grey while closed; once open, the frame pulses in the theme glow and the core cycles colours.
- **Conveyor** textures scroll at 1.2 tiles/s in their belt direction.
- **Miner**: hidden in demo; on a death it hops, spins and shrinks away over 0.8 s (`TUMBLE`) of the `dead` pause; during `complete` it shrinks as the air drains, as if drawn into the portal. The leg swing uses distance walked interpolated to the drawn position. While a fall is already fatal (`y − apex > FALL_LIMIT`) it flails.

### 9.5 Effects

`Effects` is one additive `Points` layer over a fixed pool (200–600 sparks by tier). `burst()` adds sparks with random direction and speed, and a full pool overwrites random slots. Each frame `update()` integrates gravity, fades colour by remaining life, and **compacts** live sparks to the front so the draw range is exactly the live set. main.ts fires bursts for crystals (in the crystal's colour), the portal opening, deaths (helmet yellow and overall blue), crumbles, and a little low-gravity dust on every jump and landing. There is no per-frame allocation.

**Ambient motes** are a second additive `Points` layer that persists for the cavern: `motes(kind, colour, count)` scatters them, and each kind moves its own way. Dust drifts sideways, spores and bubbles rise with a wobble, embers rise fast and flicker, drips fall, and glints hang and twinkle. They wrap inside the border rock. The count is the tier's particle budget / 8 (25 to 75).

### 9.6 Post-processing

`EffectComposer` renders into a **HalfFloat render target with MSAA samples** from the tier (4 / 2 / 2 / 0), so HDR neon survives above 1 for bloom. The canvas itself has no MSAA, since it's only a copy target. Passes: `RenderPass` → `GTAOPass` (ambient occlusion, radius 0.6, blend 0.8; `high` tier only) → `UnrealBloomPass` (strength 0.7, radius 0.4, threshold 0.85; skipped on low) → `OutputPass` (tone mapping, sRGB).

## 10. UI, menus and progress

Plain DOM over the canvas, styled by `styles.css`. Everything is ordinary buttons, so mouse, touch, keyboard (Tab, ↑ ↓, Enter, Esc) and gamepads (d-pad, A, B) all work.

### 10.1 Screens

- **Splash** (`#boot`, after thrust-force's, rethemed): a dark cavern with drifting copper bars and twinkling crystal glints; an emblem of the portal arch on a glowing ledge with a crystal bobbing and shimmering inside it and air bubbles rising; the title, a crystal-studded rule and the tagline. Below them the **air gauge** is the loading bar: it fills one boot stage at a time while the tip line names the stage (§15.1), so slow and older devices show steady progress rather than a frozen page. Inline critical CSS in `index.html` keeps the page dark and the dialogs hidden in the moment before `styles.css` (which loads with the JS) arrives.
- **Main menu**: once booted (`#boot.ready`) the gauge gives way to the menu and the splash turns translucent over the live attract cavern: **Continue** (the deepest cavern reached, fresh lives and score), **New game** (How to play first on the first run), **Cavern select** (every cavern reached so far, by name), **How to play**, **Sound**. On short screens the emblem and tagline hide and the menu wraps into two columns, so every item stays on screen (the smoke test asserts this).
- **Sheets** (`#sheet`, `ui/menu.ts` `showSheet`): one modal dialog for cavern select and How to play, with the device's bindings. How to play has two **carousels** (`carouselsHelp` / `wireCarousels`), each one animated preview at a time with ◀ ▶ buttons, a name, a tag line, a description and a counter:
    - **Who's down here**: Pip, then each creature in the order it arrives, with what it does, the cavern it first appears in, and what to watch for.
    - **Obstacles & dangers**: crystal, portal, crumbling ledge, conveyor belt, spikes, and sealed door with lever, each a small looping diorama from `propModel()` (render/props.ts) built from the game's own geometry and textures. The "from cavern N" tag is read from the hand-built maps, so it stays true if caverns change. A note covers long falls and air.

    `render/preview.ts` animates both with **one** small WebGL renderer that exists only while the sheet is open (main.ts `howTo()` starts it and stops it on close, so there's no boot step and no cost during play). Each frame it reads each canvas's `data-preview`, so a carousel only changes the attribute. Models are built on first view and cached, and everything (renderer, geometry, materials, textures, context) is freed on close. The CSS is shared with the pause dialog through `:is(#pause, #sheet)`.

- **Cavern intro card** (`#intro`): for 2.4 s on each cavern load, the number ("Cavern 7 of 20", or "· uncharted" for generated ones), the name, crystal count, air and features (crumbling ledges, conveyors, a lever).
- **HUD** (`ui/hud.ts`): the cavern name at the top; air bar, score, best, crystals left and lives at the bottom. The air bar blinks red under 20%. It writes to the DOM **only when a value changes**, because identical writes still trigger style recalculation, which shows up as jank on phones. A fading message line announces the portal opening, doors and extra lives.
- **Pause and game over** (`#pause`): Resume (Esc), Restart cavern (R), Sound (M), Main menu (Q), with the device's bindings. As the **game-over** card (`data-kind="over"`) it shows score, best and the cavern reached, with **Play again** from the same starting cavern.

### 10.2 Progress (`core/save.ts`)

One JSON record in `localStorage['mm-save']`: `best`, `reached` (the deepest cavern index) and `seenHelp`. Loading merges over defaults, so new fields never break an old save, and every read and write is try/caught (private mode, quota). Progress is recorded on each cavern load, on completion and at game over. Mute lives separately in `localStorage['mm-muted']`.

### 10.3 Layout across devices

The rule is that **touch controls never cover the cavern**. `#app` (the canvas host) and `#hud` share an inset driven by three CSS variables:

| Situation                         | Inset                                                 | Buttons                                             |
| --------------------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| Desktop / fine pointer            | none                                                  | none                                                |
| Touch, portrait (phones, tablets) | `--strip`: a bottom strip of button height + 40 px    | stick bottom-left, ▲ bottom-right, inside the strip |
| Touch, landscape                  | `--side-l` / `--side-r`: gutters sized to the buttons | stick in the left gutter, ▲ in the right            |

Button size is `--btn`: `clamp(60px, 11vmax, 96px)` in portrait and `clamp(56px, 15vmin, 88px)` in landscape, so tap targets stay at least 44 px everywhere. Safe-area insets (notches, home bars) are respected. Pause (❚❚) sits top-right. Keyboard hints (`kbd`) hide on coarse pointers. Because the view watches `#app`'s size, the camera simply refits the cavern into whatever room is left.

### 10.4 Accessibility basics

`role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-live` regions for the HUD message and intro, labelled touch buttons, focus moved into each dialog, visible focus outlines, and `prefers-reduced-motion` stops the copper-bar animation, the air blink and the intro slide.

## 11. Palette and themes (`core/palette.ts`)

All colours live here; the only exceptions are the pre-JS splash background in `index.html` and the icon SVG.

- **A theme per cavern.** Each of the twenty hand-built caverns has its own theme in `THEMES`, chosen to suit its name (The Pithead is warm umber with drifting dust, Glowworm Grotto is near-black blue with glowworm stars, The Crucible is ember red with rising sparks). Generated caverns get `generatedTheme(n)`: a seeded theme whose hue steps by the golden ratio, so neighbouring caverns sit far apart on the colour wheel, with randomly picked styles. `themeFor(n)` returns one or the other. (HSL is converted with `SRGBColorSpace`; three.js's default would read it as linear and wash the colours out.)
- **What a theme sets**:

    | Field                           | Effect                                                                                                   |
    | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
    | `rock` `ledge` `crumble` `belt` | block tints                                                                                              |
    | `glow`                          | ledge edge strips, the open portal and its light, ore veins                                              |
    | `bars`                          | five back-wall gradient stops, top to bottom                                                             |
    | `rockStyle`                     | rock tile pattern: mottled, strata, fractured, cobble or crystal                                         |
    | `wall`                          | back-wall rock: rock, stone (boulders), rubble, marble, mud or fissured                                  |
    | `back`                          | back-wall feature: bars (none), strata waves, cave stalactites, glowworm stars, hanging roots, ore veins |
    | `motes` / `mote`                | ambient particles and their colour: dust, spores, embers, drips, bubbles or glints                       |
    | `sky` / `ground`                | hemisphere light tints from above and below                                                              |

- **The back wall** (`render/paint.ts`, `backdropTextures`) is painted at 16 px a cell in three layers. (1) The theme gradient, **quantised into 8 px bands** of flat colour (the Amiga copper-bar look: its copper co-processor changed palette registers every scan line) and desaturated to `BACKDROP_SATURATION` (0.65). (2) Natural rock in the theme's `wall` style, **mottled with soft patches of a second style**, all as light and dark overlays so the gradient tints it. There is no masonry: these are caves. (3) The `back` feature. Layers 2 and 3 are blended in at `BACKDROP_DETAIL` (0.45), and the wall material is dimmed to `BACKDROP_BRIGHTNESS` (0.45, view.ts). **The wall must always stay pale and dull** so the level in front of it is the focus. Glowing features (stars, veins) also go to an emissive map, shown at `BACKDROP_GLOW` (0.35).
- **Seeded by name.** Every painted texture (rock tile, back wall, mottling) is seeded from `seedOf(cavern.name)`, an FNV-1a hash, so a cavern looks the same on every visit. The rock and back-wall textures are rebuilt and disposed with each cavern.
- **Fixed colours** (`COLORS`): the miner's overalls, shirt, skin, helmet, boots and lamp; spikes; lever; door; closed portal; guardian eyes; the five-colour `crystalCycle`; UI colours.
- `hdr(hex, k)` returns a linear colour × k for bloom materials. `applyUiColors()` writes `COLORS.ui` into CSS custom properties at start-up; `styles.css` keeps the same values as fallbacks and derives tints with `color-mix()`.

## 12. Quality tiers and performance

### 12.1 Tiers (`render/tier.ts`)

`detectTier()` probes `UNMASKED_RENDERER_WEBGL` from a throwaway WebGL2 context (`powerPreference: 'high-performance'`), detects mobile by user agent (plus iPadOS via `maxTouchPoints`), and `classifyGpu()` maps the renderer string to a tier. `?tier=` overrides it. Without WebGL2, boot explains why instead of failing obscurely.

| Tier          | Typical hardware                                                    | DPR (pixel budget) | MSAA | Bloom | Shadows           | AO  | Sparks | Frame cap |
| ------------- | ------------------------------------------------------------------- | ------------------ | ---- | ----- | ----------------- | --- | ------ | --------- |
| `high`        | desktop discrete GPU, Apple Silicon Mac                             | 2 (8.3 MP)         | 4×   | ✓     | 2048 soft + torch | ✓   | 600    | display   |
| `mobile-high` | flagship phones and tablets (Galaxy S22 Ultra), every iPad / iPhone | 2 (3.7 MP)         | 2×   | ✓     | 1024 soft         | –   | 400    | 60 fps    |
| `mid`         | modern integrated GPUs, 2019–21 phones, Intel Macs in Safari        | 1.5 (2.1 MP)       | 2×   | ✓     | –                 | –   | 400    | 60 fps    |
| `low`         | older Intel UHD / HD, budget phones (PowerVR), software GL, ≤ 2 GB  | 1 (1.3 MP)         | –    | –     | –                 | –   | 200    | 60 fps    |

Classifier rules worth knowing: every iOS / iPadOS device reports "Apple GPU" and starts at `mobile-high`; Safari on a Mac also says "Apple GPU", so 8+ cores (Apple Silicon) is `high` and fewer (Intel) is `mid`; Adreno 7xx, Xclipse and Immortalis are `mobile-high`, Adreno 630+ and Mali-G76+ `mid`, older and PowerVR `low`; GTX 9xx / 1030–1050 / MX / GT are `mid`; 2 GB of device memory or less is always `low`. `check.ts` asserts these on real devices' strings (§16).

**Device-proofing on top of the guess:**

- **Pixel budget**: DPR is the tier cap, lowered further on big screens to stay under the tier's budget (an iPad Pro at DPR 2 would be 5.6 MP; it renders at ~1.6 instead).
- **Frame cap**: non-desktop tiers render at most 60 fps, even on 90 / 120 Hz screens (S22 Ultra, iPad Pro). The game ticks at 40 Hz, so more frames would only cost heat and battery. Time owed carries over, so a 90 Hz screen still averages 60.
- **Governor** (`Governor`, main.ts): fed the time between rendered frames during steady play, it steps quality down when the average stays slower than 38 ms (about 26 fps) for 3 s, cheapest-to-lose first: ambient occlusion, resolution (×0.8 a step down to DPR 1), bloom, then shadows (`View.degrade`). It never steps back up, so quality can't oscillate; its threshold is below iOS Low Power Mode's 30 fps cap; frames over 250 ms count as 250, so one stall cannot trigger a step but a very slow device still does; it resets on cavern changes and tab switches. Each step is logged to the console.
- **Context loss**: mobile browsers can drop the WebGL context in the background or under memory pressure. The view calls `preventDefault` so it can be restored (three.js re-uploads lazily), skips rendering while lost, and main.ts pauses the run.
- **8-bit fallback**: the post-processing target is half-float only where the GPU can render to it (`EXT_color_buffer_float` / `_half_float`); otherwise 8-bit, so older Android GPUs don't show a black screen.

### 12.2 Keeping frames smooth

- **Fixed 40 Hz simulation** with render interpolation: the game behaves the same at any refresh rate, and `dt` is capped at 50 ms so a hitch can't skip collisions.
- **Rebuild only on cavern change**: deaths and restarts reuse every mesh; per-frame state is read from the `Game`.
- **Instancing**: a whole cavern is about a dozen draw calls for the blocks, plus a handful per model.
- **Shader warm-up at boot** (§15.1): every program is compiled behind the splash, not mid-play.
- **No per-frame allocation** in `View.sync` or `Effects.update`; scratch matrices and vectors are reused.
- **HUD writes only on change** (§10.1).
- **Generated caverns** take about 15 ms and are memoised (§7).

## 13. Input (`player/input.ts`)

All devices feed one `Input { left, right, jump }`:

- **Keyboard**: `KEYS` maps `KeyboardEvent.code`, so bindings are layout-independent: ← → / A D / O P to walk, Space / ↑ / W to jump. Mapped keys `preventDefault` (no page scrolling). A key on a focused menu button is left alone outside a run, so Space and Enter still press menu buttons. Commands (Esc pause, M mute, R restart and Q menu while paused, ↑ ↓ in menus) are handled in `main.ts`.
- **Touch joystick** (`#t-stick`, [nipplejs](https://github.com/yoannmoinet/nipplejs) in `static` mode): a stick filling the zone's height. It moves **left and right only** (`lockX`: the knob slides horizontally); tilting past 0.3 of its throw walks. Jumping is the ▲ button's job, so hold the stick and press ▲ for a jump that way. A `ResizeObserver` rebuilds it when the zone appears or the screen rotates (its size is `--btn`).
- **Jump button** (`#touch [data-k=jump]`): held while any finger (`pointerId`) that went down on it is still down. The controls show only during a run on coarse pointers.
- **Gamepads** (standard mapping, polled every frame): left stick (±0.4 dead zone) or d-pad ← → to walk; A, B or d-pad ↑ to jump. Start, the d-pad, the stick (past ±0.6, as virtual buttons) and A / B also fire edge-triggered `onPadButton` events that main.ts uses to pause and to move through menus.
- `readInput()` returns a copy of the held state OR'd with the pads. **Holding jump keeps jumping** on every landing, as in the classic genre. A **jump buffer** keeps any fresh jump press alive for 100 ms (4 ticks), so a tap just before landing still jumps. It lives in input, not `stepBody`, so the solver's movement is unchanged.
- **Menu focus is spatial** (`menuNav(dx, dy)`): arrows, d-pad and stick move to the nearest control in that direction, so the two-column short-screen menu and the cavern grid work in all four directions; with nothing that way, focus steps through document order (wrapping). `clearInput()` releases everything on blur and when dialogs open.
- `HELP` holds the device's `[key, action]` rows (touch or keyboard). main.ts renders it into the splash hint line, How to play and the pause dialog.

## 14. Audio (`fx/audio.ts`)

- The `AudioContext` is created by `unlock()` on the first user gesture (starting a run), as browsers require. Before that every call is a silent no-op.
- `tone()` is an oscillator with an exponential pitch glide and decay. `noise()` plays a slice of a shared 1 s noise buffer through a low-pass sweeping down to 60 Hz. Effects and music go through separate gains into a master gain; mute sets the master to 0.
- `sfx` has one entry per `GameEvent`: a rising square blip for jumps, a two-note chirp per crystal, an arpeggio when the portal opens, a clunk for levers, noise for crumbles, a long falling sawtooth for deaths, a fanfare for completion, rapid ticks while air drains into the score, and a falling phrase for game over.
- **Music**: an original 8-bar loop in A natural minor. A look-ahead scheduler runs every 25 ms and schedules notes 0.12 s ahead on the **audio clock**, so the beat stays steady even when frames hitch. Each eighth note plays the pulse-wave lead from `MELODY` (scale degrees, 0 = rest); every other eighth adds a triangle bass on the bar's chord root (Am F C G Am F E E) or a noise hi-hat. `setMusicIntensity()` eases the tempo from 120 to 168 BPM and brightens the hats. main.ts drives it from air: zero above 40% air, rising to 1 as the tank empties.

## 15. Frame loop and boot (`main.ts`)

### 15.1 Boot

`startup()` is an async sequence of `STEPS`. Before each one, `step(i)` sets the splash's air gauge to `i / 5`, names the stage in the tip line and **yields two animation frames**, so the gauge and text really paint before the next blocking piece of work. On a fast desktop the gauge fills in a blink; on an older phone each stage is visible.

| Stage                  | Work                                                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lighting the lamps     | `detectTier()`; without WebGL2, explain and stop                                                                                                                                                         |
| Shoring up the tunnels | `new View`: renderer, lights, textures, composer                                                                                                                                                         |
| Charting cavern 1      | the attract `Game` and its first `sync` (builds every cavern mesh)                                                                                                                                       |
| Polishing the crystals | `view.warmup()`: `renderer.compileAsync` over the whole scene plus one composer render, with one invisible spark so the particle shader compiles too; no compile stall on the first frame or first burst |
| Painting the signs     | `document.fonts.ready`, capped at 1.5 s, so menu labels don't reflow                                                                                                                                     |

Then the gauge reads full ("Ready"), the loop starts and the main menu shows. Any error lands in the splash subtitle (in red) with a hint (`?tier=low`).

### 15.2 Frame

`requestAnimationFrame` → `dt = min(Δ, 50 ms)`:

- **In a run**: unless paused, `game.update(dt, readInput())`; when paused, poll pads for menu buttons only. On a new cavern number, show the intro card and record progress. Then the HUD, and music intensity from air.
- **In the menu**: poll pads; advance the attract game and switch to the next hand-built cavern every 6 s.
- Then `view.sync(game ?? attract, dt)`, with `dt = 0` while paused so particles freeze.

### 15.3 Run flow and events

`startRun(n)` unlocks audio, creates `Game(n)`, hides the splash, shows the HUD, sets `body.playing` (which reveals the touch controls and their layout inset) and, on touch devices, requests full screen. `onEvent` routes events (§3). On `over` it records progress and opens the game-over card. A hidden tab or lost focus pauses a running game and releases held keys. `window.__game` is a read-only getter for the smoke test.

## 16. Checks and tooling

- **`npm run check`** (`scripts/check.ts`, Node's native TypeScript; `ts-resolve.mjs` adds `.ts` to extensionless imports) asserts:
    1. There are 20 hand-built caverns; each parses to 32 × 16, starts on solid ground, has at least five crystals and no guardian sweeping within two cells of the start, and **the solver reaches every crystal, every lever and the portal**. It prints per-cavern crystal, guardian and state counts with timings.
    2. Generated caverns 20–109 are produced, have at least five crystals, solve, and round-trip through the parser. The difficulty curve never eases from one cavern to the next, saturates at cavern 100, keeps band 1 gentle and steps up each band; no fliers before cavern 31, no sprinters before 41, and both do appear in their band.
    3. Movement: a standing jump rises exactly 26 px and lands where it started; a belt carries you and walking against it holds still; a six-cell drop is survived and an eight-cell drop kills.
    4. Rules, on small lab caverns: crystals score and the last one opens the portal; the portal completes the cavern, air is paid out as bonus and the next cavern loads; crumbling ledges give way; levers open doors; spikes, guardians and running out of air kill; deaths spend lives and the last one ends the game; an extra life arrives at 10,000.
    5. Voxel characters: the face builder emits only air-facing faces and puts glowing voxels in their own set.
- **`python scripts/smoke.py [out_dir]`**: Playwright (Chromium on SwiftShader) against `npm run preview` at `?tier=low`, on a 1280 × 720 desktop, a 412 × 860 portrait touch phone and an 860 × 412 landscape touch phone. Each run boots to the menu with every item on screen, starts a new game, walks (keyboard, or by dragging the touch joystick; the jump button presses and releases), jumps (desktop), pauses and resumes, with no page errors. Screenshots go to `shots/` (git-ignored). Software GL is slow, so the checks poll `window.__game` instead of sleeping.
- **`npm run typecheck`** and **`npm run format`** (Prettier with the repo's `.prettierrc`).

## 17. Build and deployment

```bash
npm install
npm run dev        # http://localhost:5191/mayhem-miner/ (strict port: fails if 5191 is taken)
npm run check      # headless asserts
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ (then: python scripts/smoke.py)
```

- `npm run build` is `tsc --noEmit && vite build`. `dist/` holds about 53 kB of game JS (19 kB gzipped) and a separate 550 kB three.js chunk (136 kB gzipped), split so browsers keep three.js cached across game updates.
- `vite.config.ts` sets `base: '/mayhem-miner/'` to match `https://<user>.github.io/mayhem-miner/`. If you rename the repo, change `base`.
- **Icons**: `public/icons/icon.svg` is the source (a faceted crystal in a portal arch over copper bars). The PNGs (192, 512, maskable 512 with safe padding, 180 apple-touch) were rendered from it with headless Chromium. Regenerate them if the SVG changes. `.gitignore` ignores images in general but whitelists `public/icons/`.
- `.github/workflows/deploy-pages.yml` runs on every push to `main` (or manually): checkout → Node 22 → `npm ci` → `npm run build` → upload `dist` → `actions/deploy-pages`. In the repo settings, set Pages → Source to **GitHub Actions**.
- Licence: MIT (`LICENSE`).

## 18. Tuning reference

| Constant                     | Where                  | Value                              | Effect                                     |
| ---------------------------- | ---------------------- | ---------------------------------- | ------------------------------------------ |
| `TICK`                       | `core/physics.ts`      | 1/40 s                             | simulation rate                            |
| walk speed                   | `stepBody`             | 1 px/tick (5 cells/s)              | also conveyor speed                        |
| `JUMP`                       | `core/physics.ts`      | 24 ticks, 26 px high               | jump height, length and timing             |
| `FALL_SPEED`                 | `core/physics.ts`      | 4 px/tick                          | straight fall speed                        |
| `FALL_LIMIT`                 | `core/physics.ts`      | 48 px (6 cells)                    | longest survivable fall, from the apex     |
| `CRUMBLE_TICKS`              | `core/game.ts`         | 28 ticks (0.7 s)                   | how long a crumbling cell holds you        |
| `guardianSpeed`              | `core/difficulty.ts`   | 0.5 → 1.15 (bands of 10, to 100)   | guardian px/tick                           |
| air                          | `parse`, `difficulty`  | 75 − n (+15 in band 1); 66 → 40 s  | hand-built; generated                      |
| `BAND` / `MAX_DIFFICULTY_AT` | `core/difficulty.ts`   | 10 / 100                           | caverns per band; where the curve tops out |
| `SPRINT`                     | `core/difficulty.ts`   | 1.5                                | sprinter speed multiplier (from 41)        |
| `CRYSTAL_POINTS`             | `core/game.ts`         | 100                                | per crystal                                |
| `AIR_POINTS`                 | `core/game.ts`         | 20                                 | per second of air left                     |
| `EXTRA_LIFE`                 | `core/game.ts`         | 10,000                             | points per extra life                      |
| `START_LIVES`                | `core/game.ts`         | 3                                  | lives per run                              |
| `DEAD_PAUSE`                 | `core/game.ts`         | 1.6 s                              | before the cavern restarts                 |
| `TUMBLE`                     | `render/view.ts`       | 0.8 s                              | death tumble before the miner vanishes     |
| jump buffer                  | `player/input.ts`      | 100 ms                             | early jump taps still count on landing     |
| `BANDS`                      | `world/generate.ts`    | rows 12, 9, 6, 3                   | generated ledge bands (one jump apart)     |
| `ATTRACT_SECONDS`            | `main.ts`              | 6 s                                | title-screen cavern cycle                  |
| bloom                        | `render/view.ts`       | `BLOOM_STRENGTH` 0.45 / 0.4 / 0.85 | strength / radius / threshold              |
| `EDGE_GLOW`                  | `render/view.ts`       | 1.05                               | ledge edge strip HDR strength              |
| `CRYSTAL_GLOW`               | `render/view.ts`       | 2.4 × 0.85                         | crystal HDR strength                       |
| `MINER_GLOW`                 | `render/view.ts`       | 0.75                               | warm halo light around the miner           |
| `TORCH_GLOW`                 | `render/characters.ts` | 1                                  | helmet torch: spotlight, beam and lens     |
| `BACKDROP_BRIGHTNESS`        | `render/view.ts`       | 0.45                               | back wall brightness                       |
| `BACKDROP_GLOW`              | `render/view.ts`       | 0.35                               | glowworms / veins on the back wall         |
| `BACKDROP_DETAIL`            | `render/paint.ts`      | 0.45                               | strength of back-wall rock and features    |
| `BACKDROP_SATURATION`        | `render/paint.ts`      | 0.65                               | back-wall gradient saturation              |
| `FOV`                        | `render/view.ts`       | 30°                                | camera field of view                       |
| `SPRITE`                     | `render/view.ts`       | 0.75                               | drawn size of miner, guardians, crystals   |
| `HIT_TOP`                    | `core/physics.ts`      | 4 px                               | touch hitbox trimmed to match the sprites  |

## 19. Known limits and extension points

- **The solver ignores timing.** It proves a route exists but not that it's humane: guardians, air and crumbling are left to playtesting for hand-built caverns. A stricter mode could add guardian positions to the state (they're periodic) at a large multiplier on state count.
- **Generated caverns have no levers or doors.** Adding them needs the generator to place a door that actually gates something (for example, sealing the portal) and the lever outside it. The solver already handles the two-phase search.
- **One lever opens every door** in a cavern. Per-lever door groups would need a pairing in the legend (for example digits).
- **No high-score table or replays**: `save.ts` keeps one best score. The deterministic 40 Hz simulation would make input-log replays straightforward.
- **Test hook**: `window.__game` is a read-only getter for the smoke test. It's harmless in production and exposes nothing that isn't already in memory.
