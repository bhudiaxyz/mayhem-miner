/**
 * Input — keyboard, touch buttons and gamepads merged into one Input { left, right, jump }.
 *
 * Purpose
 *   The game never sees devices. This module keeps the held state of every source and hands
 *   main.ts one merged snapshot per frame.
 *
 * Operations
 *   - setupInput(): key listeners (KeyboardEvent.code, so layouts don't matter) and the
 *     #touch [data-k] buttons (pointer capture, so sliding a thumb off still releases).
 *   - readInput(): held keys and buttons OR'd with every connected gamepad (left stick or
 *     d-pad to walk; A, B or d-pad up to jump).
 *   - pollPads(): edge-detected pad buttons for menus and pause → onPadButton().
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
    ["◀ ▶", "Walk"],
    ["▲", "Jump"],
    ["❚❚", "Pause"],
];
export const HELP = isTouch ? TOUCH_HELP : KEY_HELP;

const padPrev = new Map<number, boolean[]>();
let onPadButton: (b: "pause" | "up" | "down" | "select" | "back") => void = () => {};

export function setPadHandler(fn: typeof onPadButton) {
    onPadButton = fn;
}

export function setupInput() {
    addEventListener("keydown", (e) => {
        const k = KEYS[e.code];
        if (!k || (e.target instanceof HTMLButtonElement && !document.body.classList.contains("playing"))) return;
        held[k] = true;
        e.preventDefault();
    });
    addEventListener("keyup", (e) => {
        const k = KEYS[e.code];
        if (k) held[k] = false;
    });
    document.querySelectorAll<HTMLElement>("#touch [data-k]").forEach((btn) => {
        const k = btn.dataset.k as keyof Input;
        const set = (v: boolean) => (e: PointerEvent) => {
            e.preventDefault();
            held[k] = v;
            btn.classList.toggle("on", v);
        };
        btn.addEventListener("pointerdown", (e) => {
            btn.setPointerCapture(e.pointerId);
            set(true)(e);
        });
        btn.addEventListener("pointerup", set(false));
        btn.addEventListener("pointercancel", set(false));
    });
}

export function clearInput() {
    held.left = held.right = held.jump = false;
    document.querySelectorAll("#touch .on").forEach((b) => b.classList.remove("on"));
}

/** Edge-detected gamepad buttons; movement is OR'd into `out` when given. */
export function pollPads(out?: Input) {
    for (const pad of navigator.getGamepads?.() ?? []) {
        if (!pad) continue;
        const b = pad.buttons.map((x) => x.pressed || x.value > 0.5);
        const prev = padPrev.get(pad.index) ?? [];
        const edge = (i: number) => b[i] && !prev[i];
        if (edge(9)) onPadButton("pause");
        if (edge(12)) onPadButton("up");
        if (edge(13)) onPadButton("down");
        if (edge(0)) onPadButton("select");
        if (edge(1)) onPadButton("back");
        padPrev.set(pad.index, b);
        if (!out) continue;
        const x = pad.axes[0] ?? 0;
        out.left ||= x < -0.4 || !!b[14];
        out.right ||= x > 0.4 || !!b[15];
        out.jump ||= !!b[0] || !!b[1] || !!b[12];
    }
}

export function readInput(): Input {
    const out = { ...held };
    pollPads(out);
    return out;
}
