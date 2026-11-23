/**
 * Input — keyboard, touch buttons and gamepads merged into one Input { left, right, jump }.
 *
 * Purpose
 *   The game never sees devices. This module keeps the held state of every source and hands
 *   main.ts one merged snapshot per frame.
 *
 * Operations
 *   - setupInput(): key listeners (KeyboardEvent.code, so layouts don't matter) and the
 *     #touch [data-k] buttons, tracked per finger by position: a thumb can slide from ◀ to ▶,
 *     and sliding up off ◀ / ▶ adds jump (a diagonal jump with one thumb).
 *   - readInput(): held keys and buttons OR'd with every connected gamepad (left stick or
 *     d-pad to walk; A, B or d-pad up to jump), plus a 100 ms jump buffer for early taps.
 *   - pollPads(): edge-detected pad buttons (and the stick as a d-pad) for menus and pause.
 *   - clearInput(): releases everything (window blur).
 *   - HELP: [key, action] rows for this device type, rendered by main.ts.
 *
 * Usage
 *   main.ts: setupInput(); each frame game.update(dt, readInput()).
 *
 * Highlights
 *   - Mapped keys preventDefault, so Space and the arrows never scroll the page or press a
 *     focused button.
 *   - Holding jump keeps jumping on every landing, as in the classic genre.
 *
 * See also: core/physics.ts (Input), main.ts (pause / menu keys), index.html (#touch); DESIGN.md "13. Input".
 */
import type { Input } from "../core/physics";

export const isTouch = matchMedia("(pointer: coarse)").matches;

const held: Input = { left: false, right: false, jump: false };
/** Keys held by each active touch pointer (pointerId → keys under, or slid up from, it). */
const touches = new Map<number, (keyof Input)[]>();
const touchHeld: Input = { left: false, right: false, jump: false };
/** A jump press is remembered this long, so a tap just before landing still jumps (4 ticks). */
const JUMP_BUFFER_MS = 100;
let jumpAt = -Infinity;

export const KEYS: Record<string, keyof Input> = {
    ArrowLeft: "left",
    KeyA: "left",
    KeyO: "left",
    ArrowRight: "right",
    KeyD: "right",
    KeyP: "right",
    Space: "jump",
    ArrowUp: "jump",
    KeyW: "jump",
};

const KEY_HELP = [
    ["← → · A D", "Walk"],
    ["Space · ↑ · W", "Jump (hold to keep jumping)"],
    ["Esc", "Pause"],
    ["M", "Sound on / off"],
];
const TOUCH_HELP = [
    ["◀ ▶", "Walk (slide between them)"],
    ["▲", "Jump"],
    ["◀ ▶ slide up", "Jump that way"],
    ["❚❚", "Pause"],
];
export const HELP = isTouch ? TOUCH_HELP : KEY_HELP;

export type PadButton = "pause" | "up" | "down" | "left" | "right" | "select" | "back";
const padPrev = new Map<number, boolean[]>();
let onPadButton: (b: PadButton) => void = () => {};

export function setPadHandler(fn: typeof onPadButton) {
    onPadButton = fn;
}

/** Keys for a touch at (x, y): the button under it, or walk + jump when slid up off ◀ / ▶. */
function keysAt(x: number, y: number): (keyof Input)[] {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("#touch [data-k]");
    if (el) return [el.dataset.k as keyof Input];
    for (const b of document.querySelectorAll<HTMLElement>('#touch [data-k="left"], #touch [data-k="right"]')) {
        const r = b.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y < r.top && y > r.top - r.height * 1.5)
            return [b.dataset.k as keyof Input, "jump"];
    }
    return [];
}

function syncTouch() {
    const wasJump = touchHeld.jump;
    touchHeld.left = touchHeld.right = touchHeld.jump = false;
    for (const ks of touches.values()) for (const k of ks) touchHeld[k] = true;
    if (touchHeld.jump && !wasJump) jumpAt = performance.now();
    document
        .querySelectorAll<HTMLElement>("#touch [data-k]")
        .forEach((b) => b.classList.toggle("on", touchHeld[b.dataset.k as keyof Input]));
}

export function setupInput() {
    addEventListener("keydown", (e) => {
        const k = KEYS[e.code];
        if (!k || (e.target instanceof HTMLButtonElement && !document.body.classList.contains("playing"))) return;
        if (k === "jump" && !e.repeat) jumpAt = performance.now();
        held[k] = true;
        e.preventDefault();
    });
    addEventListener("keyup", (e) => {
        const k = KEYS[e.code];
        if (k) held[k] = false;
    });
    // Track each finger by position, not by the button it went down on, so a thumb can roll
    // from ◀ to ▶ (or up off them into a diagonal jump) without lifting.
    document.querySelector("#touch")!.addEventListener("pointerdown", (e) => {
        const p = e as PointerEvent;
        const btn = (p.target as HTMLElement).closest<HTMLElement>("[data-k]");
        if (!btn) return;
        p.preventDefault();
        touches.set(p.pointerId, [btn.dataset.k as keyof Input]);
        syncTouch();
    });
    addEventListener("pointermove", (e) => {
        if (!touches.has(e.pointerId)) return;
        touches.set(e.pointerId, keysAt(e.clientX, e.clientY));
        syncTouch();
    });
    const end = (e: PointerEvent) => touches.delete(e.pointerId) && syncTouch();
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
}

export function clearInput() {
    held.left = held.right = held.jump = false;
    touches.clear();
    syncTouch();
    jumpAt = -Infinity;
}

/** Edge-detected gamepad buttons; movement is OR'd into `out` when given. */
export function pollPads(out?: Input) {
    for (const pad of navigator.getGamepads?.() ?? []) {
        if (!pad) continue;
        const b = pad.buttons.map((x) => x.pressed || x.value > 0.5);
        const x = pad.axes[0] ?? 0,
            y = pad.axes[1] ?? 0;
        // Virtual buttons past the standard 17: the left stick as a d-pad, for menus.
        b[20] = y < -0.6;
        b[21] = y > 0.6;
        b[22] = x < -0.6;
        b[23] = x > 0.6;
        const prev = padPrev.get(pad.index) ?? [];
        const edge = (i: number) => b[i] && !prev[i];
        if (edge(9)) onPadButton("pause");
        if (edge(12) || edge(20)) onPadButton("up");
        if (edge(13) || edge(21)) onPadButton("down");
        if (edge(14) || edge(22)) onPadButton("left");
        if (edge(15) || edge(23)) onPadButton("right");
        if (edge(0)) onPadButton("select");
        if (edge(1)) onPadButton("back");
        if (edge(0) || edge(1) || edge(12)) jumpAt = performance.now();
        padPrev.set(pad.index, b);
        if (!out) continue;
        out.left ||= x < -0.4 || !!b[14];
        out.right ||= x > 0.4 || !!b[15];
        out.jump ||= !!b[0] || !!b[1] || !!b[12];
    }
}

export function readInput(): Input {
    const out = {
        left: held.left || touchHeld.left,
        right: held.right || touchHeld.right,
        jump: held.jump || touchHeld.jump,
    };
    pollPads(out);
    out.jump ||= performance.now() - jumpAt < JUMP_BUFFER_MS;
    return out;
}
