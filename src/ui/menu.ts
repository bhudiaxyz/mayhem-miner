/**
 * Menu — the main menu, dialog sheets (cavern select, how to play) and the cavern intro card.
 *
 * Purpose
 *   Screen-level UI that isn't the HUD or pause dialog, as small DOM builders over the hosts in
 *   index.html: .ls-menu (the splash doubles as the main menu), #sheet (a modal dialog styled
 *   like #pause) and #intro. main.ts owns the flow; this module only renders and reports choices.
 *   Follows the sibling thrust-force project's menu module.
 *
 * Operations
 *   - renderMainMenu(items): buttons into .ls-menu; the first enabled one takes focus.
 *   - showSheet({ title, body, actions, onBack }): opens #sheet; Esc / gamepad B = onBack.
 *   - renderButtons(host, actions): the shared button row builder (sheets and pause).
 *   - menuNav(dx, dy) / menuSelect() / menuBack(): arrows and gamepad d-pad / stick / A / B
 *     move focus spatially through the top-most menu and press the focused control.
 *   - cavernSelectBody(reached, onPick): a grid of caverns 1 .. reached + 1 with names.
 *   - HOWTO: the How to play body; carouselsHelp() / wireCarousels(): its "Who's down here"
 *     and "Obstacles & dangers" carousels, one animated preview (render/preview.ts) at a time
 *     with ◀ ▶ to step through.
 *   - showIntro(n, name, facts): the 2.4 s cavern title card.
 *
 * Highlights
 *   - Everything is plain buttons, so mouse, touch, keyboard and gamepads all work, and focus
 *     moves into each dialog.
 *   - Names and labels go in through textContent or an escaper; nothing is injected raw.
 *
 * See also: main.ts (flow), index.html, styles.css; DESIGN.md "10. UI, menus and progress".
 */
import { BAND, bandName } from "../core/difficulty";
import { CREATURES } from "../render/characters";
import { CAVERNS } from "../world/caverns";
import { cavernFor } from "../world/generate";

export interface MenuItem {
    label: string;
    hint?: string;
    disabled?: boolean;
    action: () => void;
}

export interface Action {
    label: string;
    kbd?: string;
    primary?: boolean;
    action: () => void;
}

let onSheetBack: (() => void) | null = null;
let introTimer = 0;

const $ = (sel: string) => document.querySelector<HTMLElement>(sel)!;
export const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderMainMenu(items: MenuItem[]) {
    const nav = $(".ls-menu");
    nav.replaceChildren(
        ...items.map((it) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "menu-btn";
            b.disabled = !!it.disabled;
            b.innerHTML = `<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ""}`;
            b.addEventListener("click", (e) => {
                e.stopPropagation();
                it.action();
            });
            return b;
        })
    );
    nav.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus({ preventScroll: true });
}

export function renderButtons(host: HTMLElement, actions: Action[]) {
    host.replaceChildren(
        ...actions.map((a) => {
            const b = document.createElement("button");
            b.type = "button";
            if (a.primary) b.className = "primary";
            b.innerHTML = `<span>${esc(a.label)}</span>${a.kbd ? `<kbd>${esc(a.kbd)}</kbd>` : ""}`;
            b.addEventListener("click", a.action);
            return b;
        })
    );
}

export const sheetOpen = () => $("#sheet").classList.contains("open");

export function showSheet(o: { title: string; body: string | Node; actions: Action[]; onBack?: () => void }) {
    const sheet = $("#sheet");
    $("#sheet-title").textContent = o.title;
    const body = $("#sheet .sheet-body");
    if (typeof o.body === "string") body.innerHTML = o.body;
    else body.replaceChildren(o.body);
    renderButtons($("#sheet .sheet-actions"), o.actions);
    onSheetBack = o.onBack ?? null;
    sheet.classList.add("open");
    (
        sheet.querySelector<HTMLElement>(".sheet-actions .primary") ??
        sheet.querySelector<HTMLElement>(".sheet-body button, .sheet-actions button")
    )?.focus({ preventScroll: true });
}

export function closeSheet() {
    $("#sheet").classList.remove("open");
    onSheetBack = null;
}

function focusables(): HTMLElement[] {
    const root = sheetOpen() ? $("#sheet") : $("#pause").classList.contains("open") ? $("#pause") : $(".ls-menu");
    return [...root.querySelectorAll<HTMLElement>("button:not([disabled])")].filter((e) => e.offsetParent !== null);
}

/**
 * Spatial focus move: the nearest control in direction (dx, dy), so grids and the two-column
 * short-screen menu work with all four arrows. Nothing that way: step through document order.
 */
export function menuNav(dx: number, dy: number) {
    const els = focusables();
    if (!els.length) return;
    const cur = document.activeElement as HTMLElement;
    const i = els.indexOf(cur);
    if (i < 0) return els[0].focus({ preventScroll: true });
    const a = cur.getBoundingClientRect();
    let best: HTMLElement | undefined,
        bestD = Infinity;
    for (const e of els) {
        const b = e.getBoundingClientRect();
        const ex = b.left + b.width / 2 - (a.left + a.width / 2),
            ey = b.top + b.height / 2 - (a.top + a.height / 2);
        const along = ex * dx + ey * dy;
        const d = along + 2 * Math.abs(dx ? ey : ex);
        if (along > 1 && d < bestD) ((bestD = d), (best = e));
    }
    (best ?? els[(i + dx + dy + els.length) % els.length]).focus({ preventScroll: true });
}

export function menuSelect() {
    const el = document.activeElement as HTMLElement | null;
    if (el && focusables().includes(el)) el.click();
}

/** Esc / B on a sheet: run its back action. Returns whether a sheet handled it. */
export function menuBack() {
    if (!sheetOpen()) return false;
    (onSheetBack ?? closeSheet)();
    return true;
}

export function cavernSelectBody(reached: number, onPick: (n: number) => void) {
    const grid = document.createElement("div");
    grid.className = "cavern-grid";
    for (let n = 0; n <= reached; n++) {
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = `<b>${n + 1}</b><span>${esc(cavernFor(n).name)}</span>`;
        b.addEventListener("click", () => onPick(n));
        grid.append(b);
    }
    return grid;
}

export const HOWTO = `
<ol class="howto">
  <li><b>Collect every crystal.</b> They flash. The count is in the bottom bar.</li>
  <li><b>Watch your air.</b> It drains all the time; run out and you lose a life. What's left at the portal becomes bonus points.</li>
  <li><b>Reach the portal.</b> It lights up once the last crystal is taken. Walk into it.</li>
  <li><b>Jumps are committed.</b> Choose your direction before you leave the ground. You can jump up through ledges, but not through rock.</li>
  <li><b>Don't fall too far.</b> Six blocks is the most you'll survive.</li>
  <li><b>Mind the cavern.</b> Crumbling ledges give way, conveyors carry you, spikes and guardians kill, and levers open doors.</li>
</ol>`;

const MOVES = { walk: "walks its ledge", fly: "flies", lift: "rides a shaft" };

interface Slide {
    id: string;
    name: string;
    meta: string;
    blurb: string;
}

/** Help's characters, in order: Pip, then every creature in the order they arrive. */
const CAST: Slide[] = [
    {
        id: "miner",
        name: "Pip (you)",
        meta: "night-shift miner",
        blurb: "The helmet torch lights the way ahead. When it starts to gutter, your air is running low.",
    },
    ...CREATURES.map((c) => ({
        id: c.id,
        name: c.name,
        meta: `${MOVES[c.kind]} · from cavern ${(c.from - 1) * BAND + 1}`,
        blurb: c.blurb,
    })),
];

/** The first hand-built cavern (1-based) with a feature, read from the maps so it stays true. */
const firstWith = (has: (cv: (typeof CAVERNS)[number]) => boolean) => `from cavern ${CAVERNS.findIndex(has) + 1}`;

/** Help's obstacles and dangers, previewed by render/props.ts. */
const HAZARDS: Slide[] = [
    {
        id: "crystal",
        name: "Crystal",
        meta: "collect every one",
        blurb: "They flash through colours. Take them all to light the portal; each one scores 100.",
    },
    {
        id: "portal",
        name: "Portal",
        meta: "the way out",
        blurb: "Dark until the last crystal is taken, then it lights up and pulses. Walk in: air left over is paid as bonus points.",
    },
    {
        id: "crumble",
        name: "Crumbling ledge",
        meta: firstWith((cv) => cv.tiles.includes("~")),
        blurb: "Broken, gritty and dimly edged. It holds you for under a second, then sinks and falls away. Keep moving.",
    },
    {
        id: "belt",
        name: "Conveyor belt",
        meta: firstWith((cv) => /[<>]/.test(cv.tiles)),
        blurb: "Its chevrons scroll the way it carries you. You can't walk against it, but you can jump off it.",
    },
    {
        id: "spikes",
        name: "Spikes",
        meta: firstWith((cv) => cv.tiles.includes("^")),
        blurb: "Deadly to touch, on floors, ledges and ceilings, though forgiving at their very edges.",
    },
    {
        id: "door",
        name: "Sealed door & lever",
        meta: firstWith((cv) => cv.levers.length > 0),
        blurb: "Doors are solid until you touch the lever. One lever opens every door in the cavern.",
    },
];

const SETS: Record<string, Slide[]> = { cast: CAST, hazards: HAZARDS };

/** One carousel: an animated preview (render/preview.ts) with ◀ ▶ to step through a set. */
function carousel(set: string, title: string, note: string) {
    const label = set === "cast" ? "character" : "obstacle";
    return `<h3 class="cr-title">${title}</h3>
<div class="cr-card" data-set="${set}">
  <button class="cr-nav" data-step="-1" aria-label="Previous ${label}">◀</button>
  <canvas data-preview="${SETS[set][0].id}" width="192" height="192" aria-hidden="true"></canvas>
  <button class="cr-nav" data-step="1" aria-label="Next ${label}">▶</button>
  <div class="cr-text" aria-live="polite"><b></b><span class="cr-meta"></span><p></p><span class="cr-count"></span></div>
</div>
<p class="cr-note">${note}</p>`;
}

/** How to play's two carousels: "Who's down here" and "Obstacles & dangers". wireCarousels() hooks them up. */
export function carouselsHelp() {
    return (
        carousel(
            "cast",
            "Who's down here",
            "Touching any creature costs a life, and each one's reach is about a miner's height, even the low ones. The tinted patch behind a creature shows its patrol. From cavern 41 some creatures sprint."
        ) +
        carousel(
            "hazards",
            "Obstacles &amp; dangers",
            "Falls longer than six blocks are fatal, measured from the top of your jump. Air drains all the time: when the torch gutters, hurry."
        )
    );
}

export function wireCarousels(root: HTMLElement) {
    for (const card of root.querySelectorAll<HTMLElement>(".cr-card")) {
        const slides = SETS[card.dataset.set!];
        let i = 0;
        const show = () => {
            const c = slides[i];
            card.querySelector("canvas")!.dataset.preview = c.id;
            card.querySelector(".cr-text b")!.textContent = c.name;
            card.querySelector(".cr-meta")!.textContent = c.meta;
            card.querySelector(".cr-text p")!.textContent = c.blurb;
            card.querySelector(".cr-count")!.textContent = `${i + 1} / ${slides.length}`;
        };
        card.querySelectorAll<HTMLButtonElement>(".cr-nav").forEach((b) =>
            b.addEventListener("click", () => {
                i = (i + Number(b.dataset.step) + slides.length) % slides.length;
                show();
            })
        );
        show();
    }
}

export function showIntro(n: number, name: string, facts: string) {
    $("#intro-num").textContent =
        `${n < 20 ? `Cavern ${n + 1} of 20` : `Cavern ${n + 1} · uncharted`} · ${bandName(n)}`;
    $("#intro-name").textContent = name;
    $("#intro-facts").textContent = facts;
    const el = $("#intro");
    el.classList.add("show");
    clearTimeout(introTimer);
    introTimer = window.setTimeout(() => el.classList.remove("show"), 2400);
}

export function hideIntro() {
    clearTimeout(introTimer);
    $("#intro").classList.remove("show");
}
