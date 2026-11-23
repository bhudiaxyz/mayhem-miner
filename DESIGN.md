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
    physics.ts          miner movement: walk, jump table, fall, landing, overlap tests (pure)
    palette.ts          every colour: 12 cavern themes, sprite colours, UI colours → CSS variables
    random.ts           the shared seeded PRNG, mulberry32 (pure)
    save.ts             localStorage: best score, deepest cavern reached, help seen
  world/
    caverns.ts          the 20 hand-built ASCII caverns, the tile legend and the parser (pure)
    solver.ts           breadth-first reachability over miner states (pure)
    generate.ts         endless seeded caverns after the 20th, generate-and-test with the solver (pure)
  player/
    input.ts            keyboard, touch buttons, gamepads → Input; control help text
  render/
    view.ts             three.js scene: voxel cavern, models, crystals, portal, lights, post-FX
    tier.ts             GPU classification + per-tier quality table
  fx/
    effects.ts          pooled additive sparks
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
| miner hitbox                  | `[x+1, x+7) × [y+1, y+16)`                                         |
| `hitsCell(x, y, c, r, inset)` | miner hitbox against cell `(c, r)` shrunk by `inset` px            |
| `touching(t, x, y, "^", 2)`   | any spike cell, inset 2 px (spikes are forgiving at their edges)   |
| crystals, levers              | `hitsCell` with inset 1                                            |
| `inPortal(x, y, c, r)`        | the 2 × 2 portal shrunk by 4 px: you have to step properly into it |
| guardian (in `Game`)          | `[gx+1, gx+7) × [gy+2, gy+15)`                                     |

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

`build()` lays the cavern out in this order, with `depth = n − 20` and `hard = min(1, depth / 30)` scaling the odds:

1. **Ledge bands** on rows 12, 9, 6 and 3 (three rows apart: exactly one jump). Each band is a run of segments 3–8 cells long separated by 2–4 cell gaps. A segment is a crumbling ledge (12% → 32% with depth), a conveyor (≈18%), rock (6%) or a plain ledge.
2. **Start** in a randomly chosen bottom corner (column 1 or 28). Later steps keep spikes and lifts at least four columns away from it.
3. **Pillars**: up to two three-row rock columns hanging under random upper segments, which block walking and force new routes.
4. **Spikes**: 1 to 3–5 on the floor, and on the middle of long plain ledges (25% → 50%).
5. **Portal**: candidate spots are any 2 × 2 of air resting on a non-crumbling segment, or floor spots more than 12 columns from the start. One is chosen among those more than 14 cells (Manhattan) from the start.
6. **Crystals**: 6–8 rising to 6–11, each on a cell just above a segment (sometimes one cell higher, which needs a jump), at least three cells from any other crystal in the same row and never inside the portal.
7. **Guardians**: walkers on segments of five or more cells (more with depth, up to four), up to two lifts in open columns, and from `hard > 0.2` a 50% chance of a flier on rows 6–7.

Names come from the same seeded stream: an adjective and a mining noun, for example "Sunken Winze" or "Copper Heading". Air drops from 60 s to 45 s over the first 30 generated caverns. Results are memoised per `n`, so restarts and the cavern select list are free. Generating caverns 20–59 takes about 0.6 s in total under Node, roughly 15 ms each including retries, so a fresh cavern costs a fraction of a frame budget at load.

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
4. **Guardians** patrol: `x` (walk, fly) or `y` (lift) moves by `guardianSpeed` px/tick and reverses at `min` / `max`. Speed is `0.6 + 0.012 · min(n, 40)` px/tick (24 px/s at cavern 1, about 43 px/s from cavern 40).
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
- **Camera**: perspective, 30° FOV, fixed. `resize()` computes the distance that fits **(32 + 1) × (16 + 3.6)** units into the host element (the extra height is room for the HUD bars), whichever axis is tighter. It raises the camera by 6% of that distance and looks back down at the centre, so ledge tops read as surfaces.
- The canvas fills **`#app`, whose size CSS decides** (§10.3). A `ResizeObserver` on `#app` reframes the camera whenever the layout changes, including rotation and the touch strip appearing.
- **Lights**: a hemisphere light (cool sky, warm ground), a key directional light from upper left, and the **helmet lamp**, a warm point light riding just ahead of the miner's head that lights the surrounding rock as he moves. On high tiers the key light casts PCF shadows (2048² or 1024², a ±20-unit frustum) from blocks, spikes, guardians and the miner onto the back wall.
- **What glows**: ACES Filmic tone mapping, and "neon" materials use `toneMapped: false` with HDR colours (channels above 1), so only they cross the bloom threshold (0.85). They are the crystals, edge strips, the open portal, the lamp, guardian eyes, the lever knob and sparks.

### 9.2 Building a cavern

`build(cavern, n)` disposes the previous cavern's group (geometries and materials) and creates:

- **Rock, ledges, crumbling ledges, conveyors and doors** as one `InstancedMesh` each (cubes for `#` and `D`, 0.32-thick slabs for one-way tiles), with a per-instance colour of the theme tint × a seeded ±10% jitter so no two blocks match.
- **Edge strips**: a thin `InstancedMesh` of HDR bars along the front-top edge of every standable tile with air above, in the theme's glow colour. They outline every surface you can land on.
- **Spikes**: two cones per `^` cell, pointing down if they hang from something and up otherwise.
- **Crystals** (octahedra), **levers** (base, arm, glowing knob), the **portal** (four frame bars around a core plane), and one **model per guardian** (§9.3).
- The **backdrop** plane behind everything (§11).

Textures are 16 × 16 greyscale pixel-art tiles painted at start-up into canvases (`textures()`: mottled rock, planked ledge, cracked crumble, chevron belt, banded door). They use nearest filtering with no mipmaps and are tinted per instance, so there are no image files. The two belt directions get their own clone of the belt texture so they can scroll opposite ways.

### 9.3 Models

Every model is a `Group` with its feet at the origin, facing +x, about 1 wide and 2 tall, paired with a `pose(t, moving)` function:

| Model   | Used for                   | Animation                                                   |
| ------- | -------------------------- | ----------------------------------------------------------- |
| miner   | the player                 | legs and arms swing with distance walked; tucked in the air |
| robot   | walkers, caverns n % 3 = 0 | wheel spins, head scans, body bobs                          |
| crawler | walkers, caverns n % 3 = 1 | six legs ripple                                             |
| blob    | walkers, caverns n % 3 = 2 | squash and stretch, eyes ride the squash                    |
| bat     | fliers                     | wings flap, body bobs                                       |
| drone   | lifts                      | core tumbles, glowing ring precesses                        |

Guardian colours are an HSL hue stepped by cavern (`n · 0.137`), offset per guardian kind. Facing is a rotation of ±0.45 rad off side-on, so the models read as 3D.

### 9.4 Per-frame posing (`sync`)

- **Interpolation**: the miner and guardians are drawn at `lerp(previous tick, current tick, game.alpha)`. The game moves in whole pixels at 40 Hz but looks smooth at 60–120 Hz.
- **Crumbling ledges** sink and thin with wear (`scale.y = 1 − 0.8 · wear`) and shake slightly. Once gone they are scaled to zero.
- **Doors** hide once opened; the **lever** arm flips.
- **Crystals** spin, bob and **flash**: their colour steps through `COLORS.crystalCycle` at 8 Hz, each offset by its index. Taken ones hide.
- **Portal**: dark grey while closed; once open, the frame pulses in the theme glow and the core cycles colours.
- **Conveyor** textures scroll at 1.2 tiles/s in their belt direction.
- **Miner**: hidden in demo and `dead` phases; during `complete` it shrinks as the air drains, as if drawn into the portal.

### 9.5 Effects

`Effects` is one additive `Points` layer over a fixed pool (200–600 sparks by tier). `burst()` adds sparks with random direction and speed, and a full pool overwrites random slots. Each frame `update()` integrates gravity, fades colour by remaining life, and **compacts** live sparks to the front so the draw range is exactly the live set. main.ts fires bursts for crystals (in the crystal's colour), the portal opening, deaths (helmet yellow and overall blue) and crumbles. There is no per-frame allocation.

### 9.6 Post-processing

`EffectComposer` renders into a **HalfFloat render target with MSAA samples** from the tier (4 / 2 / 2 / 0), so HDR neon survives above 1 for bloom. The canvas itself has no MSAA, since it's only a copy target. Passes: `RenderPass` → `UnrealBloomPass` (strength 0.7, radius 0.4, threshold 0.85; skipped on low) → `OutputPass` (tone mapping, sRGB).

## 10. UI, menus and progress

Plain DOM over the canvas, styled by `styles.css`. Everything is ordinary buttons, so mouse, touch, keyboard (Tab, ↑ ↓, Enter, Esc) and gamepads (d-pad, A, B) all work.

### 10.1 Screens

- **Splash and main menu** (`#boot`): the icon emblem, title and tagline over an animated CSS copper-bar band. Once booted (`#boot.ready`) it turns translucent over the live attract cavern and shows the menu: **Continue** (the deepest cavern reached, fresh lives and score), **New game** (How to play first on the first run), **Cavern select** (every cavern reached so far, by name), **How to play**, **Sound**. On short screens the emblem and tagline hide and the menu wraps into two columns, so every item stays on screen (the smoke test asserts this).
- **Sheets** (`#sheet`, `ui/menu.ts` `showSheet`): one modal dialog for cavern select and How to play, with the device's bindings. The CSS is shared with the pause dialog through `:is(#pause, #sheet)`.
- **Cavern intro card** (`#intro`): for 2.4 s on each cavern load, the number ("Cavern 7 of 20", or "· uncharted" for generated ones), the name, crystal count, air and features (crumbling ledges, conveyors, a lever).
- **HUD** (`ui/hud.ts`): the cavern name at the top; air bar, score, best, crystals left and lives at the bottom. The air bar blinks red under 20%. It writes to the DOM **only when a value changes**, because identical writes still trigger style recalculation, which shows up as jank on phones. A fading message line announces the portal opening, doors and extra lives.
- **Pause and game over** (`#pause`): Resume (Esc), Restart cavern (R), Sound (M), Main menu (Q), with the device's bindings. As the **game-over** card (`data-kind="over"`) it shows score, best and the cavern reached, with **Play again** from the same starting cavern.

### 10.2 Progress (`core/save.ts`)

One JSON record in `localStorage['mm-save']`: `best`, `reached` (the deepest cavern index) and `seenHelp`. Loading merges over defaults, so new fields never break an old save, and every read and write is try/caught (private mode, quota). Progress is recorded on each cavern load, on completion and at game over. Mute lives separately in `localStorage['mm-muted']`.

### 10.3 Layout across devices

The rule is that **touch controls never cover the cavern**. `#app` (the canvas host) and `#hud` share an inset driven by three CSS variables:

| Situation                         | Inset                                                 | Buttons                                           |
| --------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| Desktop / fine pointer            | none                                                  | none                                              |
| Touch, portrait (phones, tablets) | `--strip`: a bottom strip of button height + 40 px    | ◀ ▶ bottom-left, ▲ bottom-right, inside the strip |
| Touch, landscape                  | `--side-l` / `--side-r`: gutters sized to the buttons | ◀ ▶ in the left gutter, ▲ in the right            |

Button size is `--btn`: `clamp(60px, 11vmax, 96px)` in portrait and `clamp(56px, 15vmin, 88px)` in landscape, so tap targets stay at least 44 px everywhere. Safe-area insets (notches, home bars) are respected. Pause (❚❚) sits top-right. Keyboard hints (`kbd`) hide on coarse pointers. Because the view watches `#app`'s size, the camera simply refits the cavern into whatever room is left.

### 10.4 Accessibility basics

`role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-live` regions for the HUD message and intro, labelled touch buttons, focus moved into each dialog, visible focus outlines, and `prefers-reduced-motion` stops the copper-bar animation, the air blink and the intro slide.

## 11. Palette and themes (`core/palette.ts`)

All colours live here; the only exceptions are the pre-JS splash background in `index.html` and the icon SVG.

- **12 cavern themes** (`THEMES`: Umber, Slate, Moss, Rust, Amethyst, Sandstone, Glacier, Ember, Verdigris, Coal, Rose, Indigo); cavern `n` uses `THEMES[n % 12]`. Each has `rock`, `ledge`, `crumble` and `belt` tints, a `glow` accent for edge strips and the open portal, and five **copper-bar stops** (`bars`).
- **Copper bars**: on the Amiga, the copper co-processor could change palette registers on every scan line, giving the platform its signature horizontal colour gradients. `backdrop()` recreates the look: a vertical gradient through the theme's stops, **quantised into 4-pixel bands** of flat colour, with faint brickwork drawn over it at 28% black.
- **Fixed colours** (`COLORS`): the miner's overalls, shirt, skin, helmet, boots and lamp; spikes; lever; door; closed portal; guardian eyes; the five-colour `crystalCycle`; UI colours.
- `hdr(hex, k)` returns a linear colour × k for bloom materials. `applyUiColors()` writes `COLORS.ui` into CSS custom properties at start-up; `styles.css` keeps the same values as fallbacks and derives tints with `color-mix()`.

## 12. Quality tiers and performance

### 12.1 Tiers (`render/tier.ts`)

`classifyGpu` and `detectTier` are the sibling thrust-force project's GPU classifier, unchanged: it probes `UNMASKED_RENDERER_WEBGL` from a throwaway WebGL2 context with `powerPreference: 'high-performance'`, detects mobile by user agent (plus iPadOS via `maxTouchPoints`), and maps renderer strings to tiers. `?tier=` overrides it. A single screen of voxels is cheap, so the tiers only trade resolution, anti-aliasing, bloom, shadows and spark count:

| Tier          | Typical hardware                                        | DPR | MSAA | Bloom | Shadows | Sparks |
| ------------- | ------------------------------------------------------- | --- | ---- | ----- | ------- | ------ |
| `high`        | desktop discrete GPU, Apple Silicon Mac                 | 2   | 4×   | ✓     | 2048    | 600    |
| `mobile-high` | flagship phones and tablets, every WebGL2 iPad / iPhone | 2   | 2×   | ✓     | 1024    | 400    |
| `mid`         | modern integrated GPUs, 2019–21 phones                  | 1.5 | 2×   | ✓     | –       | 400    |
| `low`         | older Intel UHD / HD, budget phones, software GL        | 1   | –    | –     | –       | 200    |

Without WebGL2, boot explains why instead of failing obscurely.

### 12.2 Keeping frames smooth

- **Fixed 40 Hz simulation** with render interpolation: the game behaves the same at any refresh rate, and `dt` is capped at 50 ms so a hitch can't skip collisions.
- **Rebuild only on cavern change**: deaths and restarts reuse every mesh; per-frame state is read from the `Game`.
- **Instancing**: a whole cavern is about a dozen draw calls for the blocks, plus a handful per model.
- **No per-frame allocation** in `View.sync` or `Effects.update`; scratch matrices and vectors are reused.
- **HUD writes only on change** (§10.1).
- **Generated caverns** take about 15 ms and are memoised (§7).

## 13. Input (`player/input.ts`)

All devices feed one `Input { left, right, jump }`:

- **Keyboard**: `KEYS` maps `KeyboardEvent.code`, so bindings are layout-independent: ← → / A D / O P to walk, Space / ↑ / W to jump. Mapped keys `preventDefault` (no page scrolling). A key on a focused menu button is left alone outside a run, so Space and Enter still press menu buttons. Commands (Esc pause, M mute, R restart and Q menu while paused, ↑ ↓ in menus) are handled in `main.ts`.
- **Touch buttons** (`#touch [data-k]`): `pointerdown` with `setPointerCapture` sets the field and `pointerup` / `pointercancel` clear it, so sliding a thumb off a button still releases it. They show only during a run on coarse pointers.
- **Gamepads** (standard mapping, polled every frame): left stick (±0.4 dead zone) or d-pad ← → to walk; A, B or d-pad ↑ to jump. Start, d-pad ↑ ↓, A and B also fire edge-triggered `onPadButton` events that main.ts uses to pause and to move through menus.
- `readInput()` returns a copy of the held state OR'd with the pads. **Holding jump keeps jumping** on every landing, as in the classic genre. `clearInput()` releases everything on blur and when dialogs open.
- `HELP` holds the device's `[key, action]` rows (touch or keyboard). main.ts renders it into the splash hint line, How to play and the pause dialog.

## 14. Audio (`fx/audio.ts`)

- The `AudioContext` is created by `unlock()` on the first user gesture (starting a run), as browsers require. Before that every call is a silent no-op.
- `tone()` is an oscillator with an exponential pitch glide and decay. `noise()` plays a slice of a shared 1 s noise buffer through a low-pass sweeping down to 60 Hz. Effects and music go through separate gains into a master gain; mute sets the master to 0.
- `sfx` has one entry per `GameEvent`: a rising square blip for jumps, a two-note chirp per crystal, an arpeggio when the portal opens, a clunk for levers, noise for crumbles, a long falling sawtooth for deaths, a fanfare for completion, rapid ticks while air drains into the score, and a falling phrase for game over.
- **Music**: an original 8-bar loop in A natural minor. A look-ahead scheduler runs every 25 ms and schedules notes 0.12 s ahead on the **audio clock**, so the beat stays steady even when frames hitch. Each eighth note plays the pulse-wave lead from `MELODY` (scale degrees, 0 = rest); every other eighth adds a triangle bass on the bar's chord root (Am F C G Am F E E) or a noise hi-hat. `setMusicIntensity()` eases the tempo from 120 to 168 BPM and brightens the hats. main.ts drives it from air: zero above 40% air, rising to 1 as the tank empties.

## 15. Frame loop and boot (`main.ts`)

### 15.1 Boot

`startup()`: detect the tier (or explain the missing WebGL2), create the `View` and an attract `Game` (cavern 1, demo), draw one frame, wait for fonts (capped at 1.5 s, so menu labels don't reflow), then start the loop and show the main menu. Any error lands in the splash subtitle with a hint (`?tier=low`).

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
    2. Generated caverns 20–59 are produced, have at least five crystals, solve, and round-trip through the parser.
    3. Movement: a standing jump rises exactly 26 px and lands where it started; a belt carries you and walking against it holds still; a six-cell drop is survived and an eight-cell drop kills.
    4. Rules, on small lab caverns: crystals score and the last one opens the portal; the portal completes the cavern, air is paid out as bonus and the next cavern loads; crumbling ledges give way; levers open doors; spikes, guardians and running out of air kill; deaths spend lives and the last one ends the game; an extra life arrives at 10,000.
- **`python scripts/smoke.py [out_dir]`**: Playwright (Chromium on SwiftShader) against `npm run preview` at `?tier=low`, on a 1280 × 720 desktop, a 412 × 860 portrait touch phone and an 860 × 412 landscape touch phone. Each run boots to the menu with every item on screen, starts a new game, walks (keyboard or the ▶ touch button, checking it releases), jumps (desktop), pauses and resumes, with no page errors. Screenshots go to `shots/` (git-ignored). Software GL is slow, so the checks poll `window.__game` instead of sleeping.
- **`npm run typecheck`** and **`npm run format`** (Prettier with the repo's `.prettierrc`).

## 17. Build and deployment

```bash
npm install
npm run dev        # http://localhost:5191/mayhem-miner/
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

| Constant          | Where               | Value                    | Effect                                 |
| ----------------- | ------------------- | ------------------------ | -------------------------------------- |
| `TICK`            | `core/physics.ts`   | 1/40 s                   | simulation rate                        |
| walk speed        | `stepBody`          | 1 px/tick (5 cells/s)    | also conveyor speed                    |
| `JUMP`            | `core/physics.ts`   | 24 ticks, 26 px high     | jump height, length and timing         |
| `FALL_SPEED`      | `core/physics.ts`   | 4 px/tick                | straight fall speed                    |
| `FALL_LIMIT`      | `core/physics.ts`   | 48 px (6 cells)          | longest survivable fall, from the apex |
| `CRUMBLE_TICKS`   | `core/game.ts`      | 28 ticks (0.7 s)         | how long a crumbling cell holds you    |
| `guardianSpeed`   | `core/game.ts`      | 0.6 + 0.012 · min(n, 40) | guardian px/tick                       |
| air               | `parse`, `generate` | 75 − n s; 60 → 45 s      | hand-built; generated                  |
| `CRYSTAL_POINTS`  | `core/game.ts`      | 100                      | per crystal                            |
| `AIR_POINTS`      | `core/game.ts`      | 20                       | per second of air left                 |
| `EXTRA_LIFE`      | `core/game.ts`      | 10,000                   | points per extra life                  |
| `START_LIVES`     | `core/game.ts`      | 3                        | lives per run                          |
| dead pause        | `Game.die`          | 1.6 s                    | before the cavern restarts             |
| `BANDS`           | `world/generate.ts` | rows 12, 9, 6, 3         | generated ledge bands (one jump apart) |
| `ATTRACT_SECONDS` | `main.ts`           | 6 s                      | title-screen cavern cycle              |
| bloom             | `render/view.ts`    | 0.7 / 0.4 / 0.85         | strength / radius / threshold          |
| `FOV`             | `render/view.ts`    | 30°                      | camera field of view                   |

## 19. Known limits and extension points

- **The solver ignores timing.** It proves a route exists but not that it's humane: guardians, air and crumbling are left to playtesting for hand-built caverns. A stricter mode could add guardian positions to the state (they're periodic) at a large multiplier on state count.
- **Generated caverns have no levers or doors.** Adding them needs the generator to place a door that actually gates something (for example, sealing the portal) and the lever outside it. The solver already handles the two-phase search.
- **One lever opens every door** in a cavern. Per-lever door groups would need a pairing in the legend (for example digits).
- **No high-score table or replays**: `save.ts` keeps one best score. The deterministic 40 Hz simulation would make input-log replays straightforward.
- **Test hook**: `window.__game` is a read-only getter for the smoke test. It's harmless in production and exposes nothing that isn't already in memory.
