/**
 * Physics — the miner's movement: walking, the fixed-arc jump, falling, landing, and overlap tests.
 *
 * Purpose
 *   One pure, integer, pixel-stepped movement model shared by the game (core/game.ts) and the
 *   reachability solver (world/solver.ts). Because both run the very same stepBody(), the
 *   solver's verdict "every crystal can be reached" is a statement about the real game.
 *
 * Operations
 *   - stepBody(b, input, tiles): advances the miner one 40 Hz tick and returns "jump",
 *     "land", "dead" (fell too far) or "" (nothing to report).
 *   - blocked(): does an 8 × 16 px body at (x, y) overlap rock or a closed door?
 *   - footing(): the support tiles directly under the feet, or "" when nothing holds you up.
 *   - hitsCell(): body-versus-cell overlap with an inset, used for spikes, crystals, levers.
 *
 * Usage
 *   const r = stepBody(player, input, tiles); positions are px, y grows downwards, 8 px a cell.
 *
 * Highlights
 *   - Movement is whole pixels and vertical motion is applied one pixel at a time, so a fast
 *     fall can never skip through a ledge and results are identical on every machine.
 *   - The jump is a fixed table: once you leave the ground the arc and direction are committed.
 *     Hitting your head turns the jump into a straight fall.
 *   - Fall damage is measured from the highest point of the airborne spell (apex), so jumping
 *     down onto a ledge counts the rise as well as the drop.
 *
 * See also: core/game.ts, world/solver.ts, world/caverns.ts (tile legend); DESIGN.md "5. Movement".
 */
import { SOLID, SUPPORT, W, H } from "../world/caverns";

export const CELL = 8;
/** Simulation tick in seconds (40 Hz). */
export const TICK = 1 / 40;
/** Vertical px per tick over a jump: 26 px up, 26 px down, 24 ticks, 1 px sideways each tick. */
export const JUMP = [-4, -4, -3, -3, -3, -2, -2, -2, -1, -1, -1, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4];
export const FALL_SPEED = 4;
/** Falls longer than this (px, measured from the apex) are fatal: 6 cells. */
export const FALL_LIMIT = 48;

/**
 * Touch hitbox top, in px below the body's top. Sprites are drawn at 75% size from the feet
 * (render/view.ts SPRITE), so touch tests start 4 px down; walls still block the full 8 × 16.
 */
export const HIT_TOP = 4;

export interface Input {
    left: boolean;
    right: boolean;
    jump: boolean;
}

export interface Body {
    x: number;
    y: number;
    mode: "ground" | "jump" | "fall";
    /** Index into JUMP while jumping. */
    t: number;
    /** Committed horizontal direction of the current jump. */
    dir: number;
    /** Highest point (smallest y) since leaving the ground. */
    apex: number;
    face: number;
}

export type Tiles = string[];

export function tileAt(t: Tiles, c: number, r: number) {
    return c < 0 || c >= W || r < 0 || r >= H ? "#" : t[r * W + c];
}

export function blocked(t: Tiles, x: number, y: number) {
    for (let r = y >> 3; r <= (y + 15) >> 3; r++)
        for (let c = x >> 3; c <= (x + 7) >> 3; c++) if (SOLID.includes(tileAt(t, c, r))) return true;
    return false;
}

export function footing(t: Tiles, x: number, y: number) {
    if ((y + 16) & 7) return "";
    const r = (y + 16) >> 3;
    let s = "";
    for (let c = x >> 3; c <= (x + 7) >> 3; c++) {
        const ch = tileAt(t, c, r);
        if (SUPPORT.includes(ch)) s += ch;
    }
    return s;
}

/** Touch hitbox (x+1..x+7, y+HIT_TOP..y+16) against cell (c, r) shrunk by `inset` px on every side. */
export function hitsCell(x: number, y: number, c: number, r: number, inset: number) {
    return (
        x + 1 < c * 8 + 8 - inset && x + 7 > c * 8 + inset && y + HIT_TOP < r * 8 + 8 - inset && y + 16 > r * 8 + inset
    );
}

/** Is the body inside the 2 × 2 cell portal whose top-left cell is (c, r)? (4 px inset) */
export function inPortal(x: number, y: number, c: number, r: number) {
    return x + 1 < c * 8 + 12 && x + 7 > c * 8 + 4 && y + HIT_TOP < r * 8 + 12 && y + 16 > r * 8 + 4;
}

/** First cell index of a `chars` tile the body touches (with inset), or -1. */
export function touching(t: Tiles, x: number, y: number, chars: string, inset: number) {
    for (let r = (y + HIT_TOP) >> 3; r <= (y + 15) >> 3; r++)
        for (let c = (x + 1) >> 3; c <= (x + 6) >> 3; c++)
            if (chars.includes(tileAt(t, c, r)) && hitsCell(x, y, c, r, inset)) return r * W + c;
    return -1;
}

export function stepBody(b: Body, inp: Input, t: Tiles): "jump" | "land" | "dead" | "" {
    const want = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let ev: "jump" | "" = "";
    if (b.mode === "ground") {
        const under = footing(t, b.x, b.y);
        if (!under) {
            b.mode = "fall";
            b.apex = b.y;
            b.dir = 0;
        } else if (inp.jump) {
            b.mode = "jump";
            b.t = 0;
            b.dir = want;
            b.apex = b.y;
            if (want) b.face = want;
            ev = "jump";
        } else {
            const belt = under.includes("<") ? -1 : under.includes(">") ? 1 : 0;
            const dx = belt ? (want === -belt ? 0 : belt) : want;
            if (want) b.face = want;
            if (dx && !blocked(t, b.x + dx, b.y)) b.x += dx;
            return "";
        }
    }
    let dy = FALL_SPEED;
    if (b.mode === "jump") {
        dy = JUMP[b.t++];
        if (b.dir && !blocked(t, b.x + b.dir, b.y)) b.x += b.dir;
        if (b.t >= JUMP.length) b.mode = "fall";
    }
    if (dy < 0) {
        for (let i = 0; i < -dy; i++) {
            if (blocked(t, b.x, b.y - 1)) {
                b.mode = "fall";
                b.dir = 0;
                break;
            }
            b.y--;
        }
        b.apex = Math.min(b.apex, b.y);
        return ev;
    }
    for (let i = 0; i <= dy; i++) {
        if (footing(t, b.x, b.y)) {
            if (b.y - b.apex > FALL_LIMIT) return "dead";
            b.mode = "ground";
            return "land";
        }
        if (i < dy) b.y++;
    }
    return ev;
}
