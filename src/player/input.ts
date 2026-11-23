/**
 * Input — keyboard, touch buttons and gamepads merged into one Input { left, right, jump }.
 *
 * Purpose
 *   The game never sees devices. This module keeps the held state of every source and hands
 *   main.ts one merged snapshot per frame.
 *
 * Operations
 *   - setupInput(): key listeners (KeyboardEvent.code, so layouts don't matter), the #t-stick
 *     nipplejs joystick (left / right only: it slides horizontally) and the
 *     #touch [data-k] jump button, tracked per finger.
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
import nipplejs from "nipplejs";
import type { Input } from "../core/physics";

export const isTouch = matchMedia("(pointer: coarse)").matches;

const held: Input = { left: false, right: false, jump: false };
/** Fingers holding the jump button (pointerId). */
const touches = new Set<number>();
/** Keys the joystick is tilted towards. */
let stick: (keyof Input)[] = [];
/** Joystick dead zone, as a fraction of the stick's throw. */
const STICK_WALK = 0.3;
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
    ["Stick ◀ ▶", "Walk"],
    ["▲", "Jump (hold the stick to jump that way)"],
    ["❚❚", "Pause"],
];
export const HELP = isTouch ? TOUCH_HELP : KEY_HELP;

export type PadButton = "pause" | "up" | "down" | "left" | "right" | "select" | "back";
const padPrev = new Map<number, boolean[]>();
let onPadButton: (b: PadButton) => void = () => {};

export function setPadHandler(fn: typeof onPadButton) {
    onPadButton = fn;
}

function syncTouch() {
    const wasJump = touchHeld.jump;
    touchHeld.left = touchHeld.right = false;
    touchHeld.jump = touches.size > 0;
    for (const k of stick) touchHeld[k] = true;
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
    document.querySelector("#touch [data-k=jump]")!.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        touches.add((e as PointerEvent).pointerId);
        syncTouch();
    });
    const end = (e: PointerEvent) => touches.delete(e.pointerId) && syncTouch();
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
    setupStick(document.querySelector<HTMLElement>("#t-stick")!);
}

/** The joystick fills #t-stick. It is rebuilt whenever the zone resizes (shown, rotated). */
function setupStick(zone: HTMLElement) {
    let pad: ReturnType<typeof nipplejs.create> | undefined;
    const set = (keys: (keyof Input)[]) => ((stick = keys), syncTouch());
    new ResizeObserver(() => {
        pad?.destroy();
        pad = undefined;
        set([]);
        if (!zone.clientHeight) return;
        pad = nipplejs.create({
            zone,
            mode: "static",
            position: { left: "50%", top: "50%" },
            size: zone.clientHeight,
            color: { front: "var(--accent)", back: "color-mix(in srgb, var(--ink) 30%, transparent)" },
            // Left / right only: the knob slides horizontally, and jumping is the ▲ button's job.
            lockX: true,
        });
        pad.on("move", (e) => {
            const { x } = e.data.vector;
            set(x < -STICK_WALK ? ["left"] : x > STICK_WALK ? ["right"] : []);
        });
        pad.on("end", () => set([]));
    }).observe(zone);
}

export function clearInput() {
    held.left = held.right = held.jump = false;
    touches.clear();
    stick = [];
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
