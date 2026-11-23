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
 *   - HOWTO: the How to play body.
 *   - showIntro(n, name, facts): the 2.4 s cavern title card.
 *
 * Highlights
 *   - Everything is plain buttons, so mouse, touch, keyboard and gamepads all work, and focus
 *     moves into each dialog.
 *   - Names and labels go in through textContent or an escaper; nothing is injected raw.
 *
 * See also: main.ts (flow), index.html, styles.css; DESIGN.md "10. UI, menus and progress".
 */
import { bandName } from "../core/difficulty";
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
