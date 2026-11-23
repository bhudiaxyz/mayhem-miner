/**
 * Generate — endless procedural caverns after the twentieth, each proven completable.
 *
 * Purpose
 *   Once the hand-built caverns are cleared the run keeps going. Every generated cavern is
 *   deterministic in its number, gets harder with depth, and is checked by the solver before
 *   it is ever shown, so the generator can be loose and the result still fair.
 *
 * Operations
 *   - cavernFor(n): hand-built cavern n (0-based) if there is one, else generate(n).
 *   - generate(n): seeded generate-and-test. Each attempt builds a layout (below), parses it
 *     with the same parser as the hand-built maps, and solves it. Unreachable crystals are
 *     removed; the attempt is rejected if the portal is unreachable, fewer than five crystals
 *     remain, or a guardian patrols the start. Results are memoised.
 *   - Layout, in order:
 *       1. Ledge bands on rows 12, 9, 6 and 3 (three rows apart: one jump high). Each band is a
 *          run of segments 3-8 cells long with 2-4 cell gaps; a segment is a ledge, a crumbling
 *          ledge, a conveyor or rock, with crumble odds rising with depth.
 *       2. Rock pillars hanging under random segments (blocks walking, forces routes).
 *       3. Spikes: on the floor away from the start, and on the middle of long ledges.
 *       4. Start in a bottom corner; the portal on a ledge or the floor, far from the start.
 *       5. Crystals on cells just above segments, at least three cells apart in a row.
 *       6. Guardians: walkers on long ledges, lifts in open columns, fliers mid-cavern (from
 *          31); then a few become sprinters (from 41).
 *
 * Usage
 *   core/game.ts: this.cavern = cavernFor(n).
 *
 * Highlights
 *   - Generation is ~1-3 solver runs, typically well under 100 ms.
 *   - Difficulty: every knob (air, crystals, guardian counts, crumble and conveyor odds,
 *     spikes, pillars, fliers from 31, sprinters from 41) comes from core/difficulty.ts.
 *
 * See also: world/solver.ts, world/caverns.ts (parse, legend), core/random.ts; DESIGN.md "7. Generation".
 */
import { difficulty, SPRINT } from "../core/difficulty";
import { rng } from "../core/random";
import { CAVERNS, parse, type Cavern } from "./caverns";
import { solve } from "./solver";

const ADJ = [
    "Lower",
    "Upper",
    "Old",
    "Black",
    "Silent",
    "Hollow",
    "Sunken",
    "Copper",
    "Ashen",
    "Bitter",
    "Weeping",
    "Iron",
];
const NOUN = [
    "Drift",
    "Gallery",
    "Stope",
    "Seam",
    "Shaft",
    "Level",
    "Heading",
    "Winze",
    "Cut",
    "Vault",
    "Sump",
    "Adit",
];
const BANDS = [12, 9, 6, 3];

const cache = new Map<number, Cavern>();

export function cavernFor(n: number): Cavern {
    return n < CAVERNS.length ? CAVERNS[n] : generate(n);
}

export function generate(n: number): Cavern {
    const hit = cache.get(n);
    if (hit) return hit;
    for (let attempt = 0; ; attempt++) {
        const cv = build(n, rng(n * 7919 + 1337 + attempt * 104729));
        if (cv) {
            cache.set(n, cv);
            return cv;
        }
    }
}

interface Seg {
    row: number;
    c0: number;
    c1: number;
    kind: string;
}

function build(n: number, r: () => number): Cavern | null {
    const d = difficulty(n);
    const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
    // Inner grid: rows 1..14 of the map → index 0..13, cols 0..29.
    const g = Array.from({ length: 14 }, () => Array<string>(30).fill("."));
    const get = (c: number, row: number) => (c < 0 || c > 29 || row < 1 || row > 14 ? "#" : g[row - 1][c]);
    const set = (c: number, row: number, ch: string) => {
        if (c >= 0 && c <= 29 && row >= 1 && row <= 14) g[row - 1][c] = ch;
    };
    const segs: Seg[] = [];

    // 1. Ledge bands.
    for (const row of BANDS) {
        let c = Math.floor(r() * 3);
        while (c < 30) {
            const len = 3 + Math.floor(r() * 6);
            const roll = r();
            const kind =
                roll < d.crumble
                    ? "~"
                    : roll < d.crumble + d.conveyor
                      ? pick(["<", ">"])
                      : roll < d.crumble + d.conveyor + 0.06
                        ? "#"
                        : "=";
            const c1 = Math.min(29, c + len - 1);
            for (let i = c; i <= c1; i++) set(i, row, kind);
            segs.push({ row, c0: c, c1, kind });
            c = c1 + 3 + Math.floor(r() * 3);
        }
    }

    // 4 (first, so later steps can keep clear of it). Start in a bottom corner.
    const left = r() < 0.5;
    const sc = left ? 1 : 28;
    set(sc, 14, "S");
    const nearStart = (c: number) => Math.abs(c - sc) < 4;

    // 2. Pillars of rock hanging under a few segments.
    for (let i = 0, k = Math.round(d.pillars * (0.5 + 0.5 * r())); i < k; i++) {
        const s = pick(segs);
        const c = s.c0 + Math.floor(r() * (s.c1 - s.c0 + 1));
        if (nearStart(c) || s.row === 12) continue;
        for (let row = s.row; row <= s.row + 2; row++) set(c, row, "#");
    }

    // 3. Spikes.
    for (let i = 0; i < d.floorSpikes; i++) {
        const c = 4 + Math.floor(r() * 24);
        if (!nearStart(c)) set(c, 14, "^");
    }
    for (const s of segs)
        if (s.kind === "=" && s.c1 - s.c0 >= 5 && r() < d.ledgeSpikes) set((s.c0 + s.c1) >> 1, s.row - 1, "^");

    // 4. Portal: on a ledge (2 × 2 of air above two ledge cells) or on the floor.
    const spots: [number, number][] = [];
    for (const s of segs)
        for (let c = s.c0; c < s.c1; c++)
            if (s.kind !== "~" && [0, 1].every((d) => get(c + d, s.row - 1) === "." && get(c + d, s.row - 2) === "."))
                spots.push([c, s.row - 2]);
    for (let c = 1; c < 28; c++)
        if (Math.abs(c - sc) > 12 && get(c, 14) === "." && get(c + 1, 14) === ".") spots.push([c, 13]);
    const far = spots.filter(([c, row]) => Math.abs(c - sc) + Math.abs(row - 14) > 14);
    if (!far.length) return null;
    const [pc, pr] = pick(far);
    set(pc, pr, "P");
    const portalCell = (c: number, row: number) => c >= pc && c <= pc + 1 && row >= pr && row <= pr + 1;

    // 5. Crystals above segments.
    const want = d.crystals + Math.floor(r() * 2);
    const placed: [number, number][] = [];
    for (let tries = 0; placed.length < want && tries < 200; tries++) {
        const s = pick(segs);
        const c = s.c0 + Math.floor(r() * (s.c1 - s.c0 + 1));
        const row = s.row - 1 - (r() < 0.3 ? 1 : 0);
        if (get(c, row) !== "." || portalCell(c, row)) continue;
        if (placed.some(([pc2, pr2]) => pr2 === row && Math.abs(pc2 - c) < 3)) continue;
        set(c, row, "*");
        placed.push([c, row]);
    }

    // 6. Guardians: walkers on long ledges, lifts in open columns, fliers mid-cavern (from 31).
    const long = segs.filter((s) => s.kind !== "#" && s.c1 - s.c0 >= 4).sort(() => r() - 0.5);
    for (let placed = 0, i = 0; placed < d.walkers && i < long.length; i++) {
        const s = long[i];
        const c = s.c0 + 1 + Math.floor(r() * (s.c1 - s.c0 - 1));
        if (get(c, s.row - 1) === "." && get(c, s.row - 2) === ".") (set(c, s.row - 1, pick(["E", "e"])), placed++);
    }
    for (let i = 0; i < d.lifts; i++) {
        const c = 2 + Math.floor(r() * 26);
        const row = 4 + Math.floor(r() * 5);
        if (!nearStart(c) && get(c, row) === "." && get(c, row + 1) === ".") set(c, row, pick(["V", "v"]));
    }
    for (let i = 0; i < d.fliers; i++) {
        const c = 3 + Math.floor(r() * 24),
            row = 6 + Math.floor(r() * 3);
        if ([row - 1, row, row + 1].every((rr) => get(c, rr) === ".")) set(c, row, pick(["E", "e"]));
    }

    const cv = parse({ name: `${pick(ADJ)} ${pick(NOUN)}`, rows: g.map((row) => row.join("")) }, n);
    cv.air = d.air;
    // Sprinters: a few guardians (seeded) move SPRINT times faster.
    [...cv.guardians]
        .sort(() => r() - 0.5)
        .slice(0, d.sprinters)
        .forEach((gd) => (gd.speed = SPRINT));
    if (
        cv.guardians.some((gd) => (gd.kind === "lift" ? Math.abs(gd.x / 8 - sc) < 3 : gd.kind !== "walk" && gd.y >= 96))
    )
        return null;
    const sol = solve(cv);
    if (!sol.portal) return null;
    cv.crystals = cv.crystals.filter((_, i) => sol.crystals[i]);
    return cv.crystals.length >= 5 ? cv : null;
}
