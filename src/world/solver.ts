/**
 * Solver — proves a cavern can be finished, by searching every state the miner can reach.
 *
 * Purpose
 *   Hand-drawn and generated caverns alike must be completable. Rather than trusting the
 *   author's eye (or the generator's), the solver runs the game's own movement code over every
 *   reachable state and reports which crystals, levers and the portal can be touched.
 *
 * Operations
 *   - solve(cv): breadth-first search over miner states (x, y, mode, jump index, jump
 *     direction, apex) from the start, trying the six meaningful inputs each tick (idle, left,
 *     right, jump, jump-left, jump-right) through physics.stepBody(). States that die (fall too
 *     far, touch spikes) are dropped. If a lever is reachable, the search runs again with the
 *     doors open, and the two results are merged.
 *   - Returns { crystals: boolean[], lever, portal, states }.
 *
 * Usage
 *   scripts/check.ts asserts every hand-built cavern solves fully; world/generate.ts drops
 *   unreachable crystals and rejects layouts whose portal is out of reach.
 *
 * Highlights
 *   - Guardians and the air clock are ignored, and crumbling ledges are treated as permanent:
 *     the solver answers "is there a route", not "is it easy". Timing is the player's job.
 *   - Grounded states are normalised (no jump index, direction or apex), which keeps the state
 *     count to tens of thousands and a full solve to a few tens of milliseconds.
 *
 * See also: core/physics.ts, world/generate.ts, scripts/check.ts; DESIGN.md "6. Solver".
 */
import { stepBody, hitsCell, inPortal, touching, type Body, type Input } from "../core/physics";
import type { Cavern } from "./caverns";

const INPUTS: Input[] = [
    { left: false, right: false, jump: false },
    { left: true, right: false, jump: false },
    { left: false, right: true, jump: false },
    { left: false, right: false, jump: true },
    { left: true, right: false, jump: true },
    { left: false, right: true, jump: true },
];
const MODES = ["ground", "jump", "fall"] as const;

export interface Solution {
    crystals: boolean[];
    lever: boolean;
    portal: boolean;
    states: number;
}

export function solve(cv: Cavern): Solution {
    const out: Solution = { crystals: cv.crystals.map(() => false), lever: false, portal: false, states: 0 };
    search(cv, cv.tiles.split(""), out);
    if (out.lever) search(cv, cv.tiles.replace(/D/g, ".").split(""), out);
    return out;
}

function key(b: Body) {
    const g = b.mode === "ground";
    let k = (b.x * 128 + b.y) * 3 + MODES.indexOf(b.mode);
    k = (k * 25 + (g ? 0 : b.t)) * 3 + (g ? 1 : b.dir + 1);
    return k * 128 + (g ? 0 : b.apex);
}

function search(cv: Cavern, tiles: string[], out: Solution) {
    const start: Body = { x: cv.start.c * 8, y: (cv.start.r - 1) * 8, mode: "ground", t: 0, dir: 0, apex: 0, face: 1 };
    const seen = new Set<number>([key(start)]);
    const queue: Body[] = [start];
    const p = cv.portal;
    for (let i = 0; i < queue.length; i++) {
        const s = queue[i];
        cv.crystals.forEach(([c, r], j) => {
            if (!out.crystals[j] && hitsCell(s.x, s.y, c, r, 1)) out.crystals[j] = true;
        });
        for (const [c, r] of cv.levers) if (hitsCell(s.x, s.y, c, r, 1)) out.lever = true;
        if (inPortal(s.x, s.y, p.c, p.r)) out.portal = true;
        // In the air the jump is committed, so every input gives the same next state.
        for (const inp of s.mode === "ground" ? INPUTS : INPUTS.slice(0, 1)) {
            const b = { ...s };
            if (stepBody(b, inp, tiles) === "dead" || touching(tiles, b.x, b.y, "^", 2) >= 0) continue;
            const k = key(b);
            if (seen.has(k)) continue;
            seen.add(k);
            queue.push(b);
        }
    }
    out.states += queue.length;
}
