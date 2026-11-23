/**
 * Main — composition root: boot, menus and run flow, commands, the frame loop, event routing.
 *
 * Purpose
 *   Wires the pure Game to the View, HUD, menus, input and audio. Owns the flow:
 *   boot → main menu (over a live attract cavern) → run → pause / game over → menu.
 *
 * Operations
 *   - startup(): the boot sequence behind the splash, one STEPS stage at a time: detect the tier
 *     (or explain a missing WebGL2), build the View, build the attract cavern, pre-compile the
 *     shaders (view.warmup), wait for fonts (capped at 1.5 s), then show the main menu. step()
 *     fills the splash's air gauge, names the stage, and yields two frames so it paints even on
 *     slow devices, where each stage can take a noticeable moment.
 *   - showMenu() / startRun(n): switch between the splash menu and a run. Continue starts at
 *     the deepest cavern reached; Cavern select lists every one reached so far.
 *   - onEvent(e): Game events → sfx, sparks, HUD messages, progress saves, game over.
 *   - frame(): rAF loop — update the run (unless paused) or the attract game, drive the HUD
 *     and music intensity (from low air), and view.sync().
 *   - Commands: Esc / Start pause, M mute, R restart (paused), arrows / d-pad in menus.
 *
 * Usage
 *   index.html loads this module; nothing imports it.
 *
 * Highlights
 *   - The attract game cycles through the hand-built caverns every 6 s behind the menu.
 *   - A hidden tab or lost focus pauses a run, and releases held keys.
 *   - window.__game exposes the live Game read-only for browser smoke tests.
 *
 * See also: core/game.ts, render/view.ts, ui/menu.ts, ui/hud.ts, player/input.ts, fx/audio.ts;
 * DESIGN.md "3. Architecture" and "10. UI, menus and progress".
 */
import "./styles.css";
import { Game, type GameEvent } from "./core/game";
import { applyUiColors, COLORS } from "./core/palette";
import { markHelpSeen, record, save } from "./core/save";
import { isMuted, setMusicIntensity, sfx, toggleMute, unlock } from "./fx/audio";
import { clearInput, HELP, isTouch, pollPads, readInput, setPadHandler, setupInput } from "./player/input";
import { detectTier, TIER_SETTINGS } from "./render/tier";
import { animatePreviews } from "./render/preview";
import { View } from "./render/view";
import { drawHud, message } from "./ui/hud";
import {
    cavernSelectBody,
    closeSheet,
    carouselsHelp,
    hideIntro,
    wireCarousels,
    HOWTO,
    menuBack,
    menuNav,
    menuSelect,
    renderButtons,
    renderMainMenu,
    sheetOpen,
    showIntro,
    showSheet,
} from "./ui/menu";

const IDLE = { left: false, right: false, jump: false };
const ATTRACT_SECONDS = 6;
/** Menu focus directions (dx, dy) for arrow keys and pad d-pad / stick. */
const PAD_DIRS: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const ARROWS: Record<string, [number, number]> = {
    ArrowUp: PAD_DIRS.up,
    ArrowDown: PAD_DIRS.down,
    ArrowLeft: PAD_DIRS.left,
    ArrowRight: PAD_DIRS.right,
};

let view: View;
let attract: Game;
let game: Game | null = null;
let paused = false;
let startN = 0;
let shownN = -1;
let last = performance.now();

const $ = (sel: string) => document.querySelector<HTMLElement>(sel)!;
const body = document.body;

/** Boot stages, in order. The splash's air gauge fills one stage at a time. */
const STEPS = [
    "Lighting the lamps",
    "Shoring up the tunnels",
    "Charting cavern 1",
    "Polishing the crystals",
    "Painting the signs",
];

/** Show boot stage i, then yield two frames so the gauge and tip actually paint (slow devices). */
async function step(i: number) {
    $(".ls-gauge span").style.width = `${(i / STEPS.length) * 100}%`;
    $(".ls-tip").textContent = i < STEPS.length ? `${STEPS[i]}…` : "Ready";
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function bootError(sub: string, tip: string) {
    $(".ls-sub").textContent = sub;
    $(".ls-sub").classList.add("error");
    $(".ls-tip").textContent = tip;
}

async function startup() {
    await step(0);
    const tier = detectTier();
    if (tier === "none")
        return bootError(
            "This game needs WebGL2, which this browser doesn't provide.",
            "Try a current Chrome, Edge, Firefox or Safari."
        );
    document.documentElement.dataset.tier = tier;
    await step(1);
    view = new View($("#app"), TIER_SETTINGS[tier]);
    await step(2);
    attract = new Game(0, { demo: true });
    view.sync(attract, 0);
    await step(3);
    await view.warmup();
    await step(4);
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    await step(STEPS.length);
    requestAnimationFrame(frame);
    showMenu();
}

function showMenu() {
    game = null;
    paused = false;
    body.classList.remove("playing");
    $("#pause").classList.remove("open");
    $("#hud").hidden = true;
    hideIntro();
    $("#boot").classList.add("ready");
    $(".ls-best").textContent = save.best ? `Best ${save.best}` : "";
    renderMainMenu([
        ...(save.reached > 0
            ? [{ label: "Continue", hint: `Cavern ${save.reached + 1}`, action: () => startRun(save.reached) }]
            : []),
        { label: "New game", action: () => (save.seenHelp ? startRun(0) : howTo(() => startRun(0))) },
        { label: "Cavern select", disabled: save.reached === 0, action: cavernSelect },
        { label: "How to play", action: () => howTo() },
        { label: isMuted() ? "Sound: off" : "Sound: on", action: () => (toggleMute(), showMenu()) },
    ]);
}

function cavernSelect() {
    showSheet({
        title: "Cavern select",
        body: cavernSelectBody(save.reached, (n) => (closeSheet(), startRun(n))),
        actions: [{ label: "Back", kbd: "Esc", action: closeSheet }],
    });
}

function howTo(then?: () => void) {
    let stopPreviews = () => {};
    const done = () => {
        stopPreviews();
        closeSheet();
        markHelpSeen();
        then?.();
    };
    showSheet({
        title: "How to play",
        body: HOWTO + carouselsHelp() + bindings(),
        actions: [{ label: then ? "Start" : "Back", primary: true, action: done }],
        onBack: done,
    });
    wireCarousels($("#sheet .sheet-body"));
    stopPreviews = animatePreviews($("#sheet .sheet-body"));
}

function bindings() {
    return `<dl class="bindings">${HELP.map(([k, a]) => `<dt>${k}</dt><dd>${a}</dd>`).join("")}</dl>`;
}

function startRun(n: number) {
    unlock();
    startN = n;
    game = new Game(n);
    game.onEvent = onEvent;
    shownN = -1;
    paused = false;
    clearInput();
    $("#boot").classList.remove("ready");
    $("#pause").classList.remove("open");
    $("#hud").hidden = false;
    body.classList.add("playing");
    if (isTouch) document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
}

function onEvent(e: GameEvent) {
    const g = game!;
    sfx[e]?.();
    const m = g.miner;
    const mx = m.x + 4,
        my = m.y + 8;
    if (e === "crystal" || e === "open") {
        view.burst(mx, my, COLORS.crystalCycle[g.left % 5], 26);
        view.halo(mx, my, COLORS.crystalCycle[g.left % 5]);
    }
    if (e === "open") {
        const p = g.cavern.portal;
        view.burst(p.c * 8 + 8, p.r * 8 + 8, COLORS.helmet, 60, 6);
        message("The portal is open!");
    }
    if (e === "die") {
        view.burst(mx, my, COLORS.helmet, 50, 6);
        view.burst(mx, my, COLORS.overalls, 40, 5);
        navigator.vibrate?.(120);
    }
    if (e === "crumble") view.burst(mx, m.y + 16, 0xc0a080, 10, 2);
    if (e === "land" || e === "jump") view.burst(mx, m.y + 16, COLORS.dust, e === "land" ? 8 : 5, 1.4, 1);
    if (e === "lever") message("Somewhere, doors grind open…");
    if (e === "extra") message("Extra life!");
    if (e === "complete") record(g.score, g.n + 1);
    if (e === "over") {
        record(g.score, g.n);
        showPause("over");
    }
}

function showPause(kind: "pause" | "over") {
    const g = game!;
    paused = true;
    clearInput();
    const el = $("#pause");
    el.dataset.kind = kind;
    $("#pause-title").textContent = kind === "over" ? "Game over" : "Paused";
    $("#pause .p-score").textContent =
        kind === "over"
            ? `Score ${g.score} · best ${Math.max(save.best, g.score)} · reached cavern ${g.n + 1}`
            : `${g.n + 1}. ${g.cavern.name} · score ${g.score}`;
    renderButtons($("#pause nav"), [
        ...(kind === "over"
            ? [{ label: "Play again", kbd: "Enter", primary: true, action: () => startRun(startN) }]
            : [
                  { label: "Resume", kbd: "Esc", primary: true, action: resume },
                  { label: "Restart cavern", kbd: "R", action: restart },
              ]),
        { label: isMuted() ? "Sound: off" : "Sound: on", kbd: "M", action: () => (toggleMute(), showPause(kind)) },
        { label: "Main menu", kbd: "Q", action: showMenu },
    ]);
    $("#pause .bindings").innerHTML = bindings();
    el.classList.add("open");
    el.querySelector<HTMLElement>("nav button")?.focus({ preventScroll: true });
}

function resume() {
    if (!game || game.phase === "over") return;
    paused = false;
    $("#pause").classList.remove("open");
    unlock();
}

function restart() {
    if (!game) return;
    resume();
    if (game.phase === "play") game.die();
}

function togglePause() {
    if (!game || game.phase === "over") return;
    if (paused) resume();
    else showPause("pause");
}

function frame(now: number) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    if (game) {
        if (!paused) game.update(dt, readInput());
        else pollPads();
        if (game.n !== shownN) {
            shownN = game.n;
            const c = game.cavern;
            const feats = [
                c.tiles.includes("~") && "crumbling ledges",
                /[<>]/.test(c.tiles) && "conveyors",
                c.levers.length && "a lever",
            ].filter(Boolean);
            showIntro(game.n, c.name, [`${c.crystals.length} crystals`, `${c.air} s of air`, ...feats].join(" · "));
            record(game.score, game.n);
        }
        drawHud(game, save.best);
        const f = game.air / game.cavern.air;
        setMusicIntensity(game.phase === "play" ? (0.4 - f) / 0.4 : 0);
    } else {
        pollPads();
        attract.update(dt, IDLE);
        if (attract.time > ATTRACT_SECONDS) attract = new Game((attract.n + 1) % 20, { demo: true });
    }
    view.sync(game ?? attract, game && paused ? 0 : dt);
    requestAnimationFrame(frame);
}

function inMenu() {
    return !game || paused || sheetOpen();
}

function wireEvents() {
    addEventListener("keydown", (e) => {
        if (e.repeat) return;
        if (e.code === "Escape") {
            if (menuBack()) return;
            if (game && game.phase !== "over") togglePause();
            return;
        }
        if (e.code === "KeyM") {
            toggleMute();
            if (game && paused) showPause($("#pause").dataset.kind as "pause" | "over");
            else if (!game) showMenu();
        }
        if (game && paused && e.code === "KeyR" && game.phase !== "over") restart();
        if (game && paused && e.code === "KeyQ") showMenu();
        const arrow = ARROWS[e.code];
        if (inMenu() && arrow) {
            e.preventDefault();
            menuNav(...arrow);
        }
    });
    setPadHandler((b) => {
        if (b === "pause") return togglePause();
        if (!inMenu()) return;
        if (b in PAD_DIRS) menuNav(...PAD_DIRS[b]);
        else if (b === "select") menuSelect();
        else if (b === "back" && !menuBack() && game && paused) resume();
    });
    $("#t-pause").addEventListener("pointerdown", (e) => (e.preventDefault(), togglePause()));
    addEventListener("blur", clearInput);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden && game && !paused && game.phase !== "over") showPause("pause");
    });
    $(".ls-controls").textContent = isTouch
        ? "Tap a menu item to begin"
        : HELP.map(([k, a]) => `${k}: ${a}`).join("   ·   ");
    Object.defineProperty(window, "__game", { get: () => game });
}

applyUiColors();
setupInput();
wireEvents();
startup().catch((err) => {
    console.error(err);
    bootError(`Couldn't start: ${err?.message ?? err}`, "Try ?tier=low in the address bar.");
});
