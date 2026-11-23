/**
 * Game — the rules: one cavern's live state, air, crystals, guardians, lives, score and flow.
 *
 * Purpose
 *   Owns all mutable gameplay state and advances it only through update(dt, input). Pure: no
 *   DOM, no three.js, so it runs headless in scripts/check.ts. Rendering reads it, never writes.
 *
 * Operations
 *   - new Game(n, { demo }): starts at cavern n (0-based). Demo games (the title screen's
 *     attract mode) move guardians and flash crystals but have no miner, air or score.
 *   - update(dt, input): accumulates real time and runs fixed 40 Hz ticks (physics.TICK).
 *   - tick: by phase —
 *       play      air drains; the miner moves (physics.stepBody); crumbling ledges under the
 *                 feet wear down; guardians patrol; then spikes, guardians, crystals, levers
 *                 and the open portal are tested against the miner.
 *       dead      a 1.6 s pause, then the cavern restarts (a life spent) or the game is over.
 *       complete  remaining air drains into the score, then the next cavern loads.
 *       over      final. main.ts shows the game-over card and makes a new Game.
 *   - alpha: how far between ticks the current frame is, so the view can interpolate.
 *   - onEvent(e): one callback for sounds and effects (GameEvent).
 *
 * Usage
 *   main.ts: game.update(dt, readInput()); view.sync(game) every frame.
 *
 * Highlights
 *   - Dying restarts the cavern in full: crystals, crumbled ledges, doors and guardians reset,
 *     as in the classic genre.
 *   - Extra life every 10,000 points. After cavern 20 the run continues into generated caverns.
 *   - Guardian speed rises gently with cavern number, capped at cavern 40.
 *
 * See also: core/physics.ts, world/generate.ts (cavernFor), render/view.ts; DESIGN.md "8. Rules".
 */
import { cavernFor } from "../world/generate";
import { W, type Cavern, type Guardian } from "../world/caverns";
import {
    HIT_TOP,
    TICK,
    footing,
    hitsCell,
    inPortal,
    stepBody,
    touching,
    type Body,
    type Input,
    type Tiles,
} from "./physics";

export type GameEvent =
    "jump" | "land" | "crystal" | "open" | "lever" | "crumble" | "die" | "complete" | "bonus" | "extra" | "over";
export type Phase = "play" | "dead" | "complete" | "over";

export interface Mover extends Guardian {
    /** Position at the previous tick, for interpolation. */
    px: number;
    py: number;
}

export interface Miner extends Body {
    px: number;
    py: number;
    /** Pixels walked, drives the leg animation. */
    walk: number;
}

/** Ticks of standing before a crumbling ledge cell gives way. */
export const CRUMBLE_TICKS = 28;
export const CRYSTAL_POINTS = 100;
export const AIR_POINTS = 20; // per second of air left
export const EXTRA_LIFE = 10000;
export const START_LIVES = 3;

export class Game {
    n = 0;
    cavern!: Cavern;
    tiles!: Tiles;
    /** Per-cell crumble wear in ticks. */
    wear!: Uint8Array;
    got!: boolean[];
    guardians!: Mover[];
    miner!: Miner;
    doorsOpen = false;
    air = 0;
    score = 0;
    lives = START_LIVES;
    phase: Phase = "play";
    /** Seconds in this cavern (animation clock); timer counts down the dead / complete pauses. */
    time = 0;
    timer = 0;
    deaths = 0;
    readonly demo: boolean;
    onEvent: (e: GameEvent) => void = () => {};
    private acc = 0;
    private nextExtra = EXTRA_LIFE;

    constructor(n = 0, opts: { demo?: boolean } = {}) {
        this.demo = !!opts.demo;
        this.load(n);
    }

    get left() {
        return this.got.filter((g) => !g).length;
    }
    get open() {
        return this.left === 0;
    }
    /** 0..1 between the last tick and the next. */
    get alpha() {
        return this.acc / TICK;
    }
    get guardianSpeed() {
        return 0.6 + 0.012 * Math.min(this.n, 40);
    }

    /** Load cavern n; `cv` overrides the cavern itself (a restart reuses the current one). */
    load(n: number, cv = cavernFor(n)) {
        this.n = n;
        this.cavern = cv;
        this.tiles = this.cavern.tiles.split("");
        this.wear = new Uint8Array(this.tiles.length);
        this.got = this.cavern.crystals.map(() => false);
        this.guardians = this.cavern.guardians.map((g) => ({ ...g, px: g.x, py: g.y }));
        const s = this.cavern.start;
        const x = s.c * 8,
            y = (s.r - 1) * 8;
        this.miner = { x, y, px: x, py: y, mode: "ground", t: 0, dir: 0, apex: y, face: 1, walk: 0 };
        this.doorsOpen = false;
        this.air = this.cavern.air;
        this.phase = "play";
        this.time = 0;
        this.timer = 0;
    }

    update(dt: number, input: Input) {
        this.acc += Math.min(dt, 0.25);
        while (this.acc >= TICK) {
            this.acc -= TICK;
            this.tick(input);
        }
    }

    tick(inp: Input) {
        this.time += TICK;
        const m = this.miner;
        m.px = m.x;
        m.py = m.y;
        this.moveGuardians();
        if (this.demo) return;
        if (this.phase === "dead") {
            if ((this.timer -= TICK) > 0) return;
            if (this.lives > 0) this.load(this.n, this.cavern);
            else {
                this.phase = "over";
                this.onEvent("over");
            }
            return;
        }
        if (this.phase === "complete") {
            if (this.air > 0) {
                const d = Math.min(this.air, 1.5);
                this.air -= d;
                this.add(Math.round(d * AIR_POINTS));
                this.onEvent("bonus");
            } else if ((this.timer -= TICK) <= 0) this.load(this.n + 1);
            return;
        }
        if (this.phase !== "play") return;

        if ((this.air -= TICK) <= 0) return this.die();
        const x0 = m.x;
        const ev = stepBody(m, inp, this.tiles);
        m.walk += Math.abs(m.x - x0);
        if (ev === "dead") return this.die();
        if (ev) this.onEvent(ev);

        if (m.mode === "ground" && footing(this.tiles, m.x, m.y).includes("~")) {
            const r = (m.y + 16) >> 3;
            for (let c = m.x >> 3; c <= (m.x + 7) >> 3; c++) {
                const i = r * W + c;
                if (this.tiles[i] !== "~") continue;
                if (++this.wear[i] >= CRUMBLE_TICKS) {
                    this.tiles[i] = ".";
                    this.onEvent("crumble");
                }
            }
        }

        if (touching(this.tiles, m.x, m.y, "^", 2) >= 0) return this.die();
        for (const g of this.guardians)
            if (m.x + 1 < g.x + 7 && m.x + 7 > g.x + 1 && m.y + HIT_TOP < g.y + 15 && m.y + 16 > g.y + 5)
                return this.die();

        this.cavern.crystals.forEach(([c, r], i) => {
            if (this.got[i] || !hitsCell(m.x, m.y, c, r, 1)) return;
            this.got[i] = true;
            this.add(CRYSTAL_POINTS);
            this.onEvent(this.open ? "open" : "crystal");
        });
        if (!this.doorsOpen && this.cavern.levers.some(([c, r]) => hitsCell(m.x, m.y, c, r, 1))) {
            this.doorsOpen = true;
            for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] === "D") this.tiles[i] = ".";
            this.onEvent("lever");
        }
        const p = this.cavern.portal;
        if (this.open && inPortal(m.x, m.y, p.c, p.r)) {
            this.phase = "complete";
            this.timer = 0.6;
            this.onEvent("complete");
        }
    }

    private moveGuardians() {
        const v = this.guardianSpeed;
        for (const g of this.guardians) {
            g.px = g.x;
            g.py = g.y;
            const k = g.kind === "lift" ? "y" : "x";
            g[k] += g.dir * v;
            if (g[k] >= g.max) ((g[k] = g.max), (g.dir = -1));
            else if (g[k] <= g.min) ((g[k] = g.min), (g.dir = 1));
        }
    }

    /** Lose a life and restart the cavern after a pause (also the pause menu's Restart). */
    die() {
        this.phase = "dead";
        this.timer = 1.6;
        this.lives--;
        this.deaths++;
        this.onEvent("die");
    }

    private add(points: number) {
        this.score += points;
        while (this.score >= this.nextExtra) {
            this.nextExtra += EXTRA_LIFE;
            this.lives++;
            this.onEvent("extra");
        }
    }
}
