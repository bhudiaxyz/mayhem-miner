# Mayhem Miner

A single-screen cavern platformer for the browser, built with Three.js, TypeScript and Vite. Pip, a night-shift miner, is sealed in a played-out hill with a leaking air tank. Every cavern holds a handful of glowing crystals. Collect them all and the portal lights up, taking you one cavern deeper. Run out of air, touch a guardian, land on spikes or fall too far and you lose a life.

The game is inspired by the early-1980s single-screen platformers, chiefly Matthew Smith's _Manic Miner_ (ZX Spectrum, 1983) and its later Commodore Amiga releases. Their richer colour and music suggested the copper-bar backdrops and chiptune soundtrack here. The caverns, characters, art, sound and code are all original.

## Highlights

- **Twenty hand-built caverns**, each one screen in size, each with its own name, layout and colour theme.
- **Endless generated caverns** after the twentieth. A procedural generator builds each one and a built-in solver proves every crystal and the portal can be reached before you see it.
- **Air is the clock**: the tank drains steadily, and whatever is left when you reach the portal is paid out as bonus points.
- **Classic platforming rules**: a fixed-arc jump you commit to, one-way ledges you jump up through, and falls that kill if they're too long.
- **Cavern hazards**: crumbling ledges, conveyor belts, spikes, and levers that open sealed doors.
- **Guardians** on fixed patrols: walkers that pace their ledges, fliers that sweep the cavern, and lifts that rise and fall in shafts.
- **Voxel look with an Amiga accent**: chunky 3D blocks, glowing crystals with bloom, copper-bar backdrops and a lamp that lights the rock as you move.
- **Synthesised sound and music**: every effect and a chiptune soundtrack, which speeds up as your air runs low, are generated live with WebAudio. There are no audio files.
- **Extra life every 10,000 points**, a saved best score, and Continue from the deepest cavern you've reached.
- **Desktop, tablet and phone alike**: keyboard, touch or gamepad, in either orientation. On touch screens the controls get their own strip or side gutters, so your thumbs never cover the cavern. Rendering quality adapts to the device (override with `?tier=high|mobile-high|mid|low`).

## Controls

| Action         | Keyboard                       | Touch                  | Gamepad                |
| -------------- | ------------------------------ | ---------------------- | ---------------------- |
| Walk           | ← → · A D · O P                | ◀ ▶ (slide between)    | Left stick · d-pad ← → |
| Jump           | Space · ↑ · W (hold to repeat) | ▲, or slide up off ◀ ▶ | A · B · d-pad ↑        |
| Pause / resume | Esc                            | ❚❚                     | Start                  |
| Sound on / off | M                              | Pause menu             | Pause menu             |
| Restart cavern | R (while paused)               | Pause menu             | Pause menu             |
| Menus          | Arrows · Enter · Esc           | Tap                    | D-pad or stick · A · B |

Choose the jump direction before you take off: once you're in the air the arc is fixed.

Setup, architecture and all technical detail are in [DESIGN.md](DESIGN.md).

## License

Released under the [MIT License](LICENSE).
