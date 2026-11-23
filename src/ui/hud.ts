/**
 * HUD — the cavern name bar and the bottom status bar (air, score, best, crystals, lives).
 *
 * Purpose
 *   Shows the game state over the canvas as plain DOM.
 *
 * Operations
 *   - drawHud(game, best): writes each field only when its text or style actually changed,
 *     since identical DOM writes still cost a style recalculation every frame on phones.
 *   - message(text, ms): a fading status line (extra life, doors opening).
 *
 * Highlights
 *   - The air bar turns red and blinks under 20%.
 *
 * See also: main.ts, index.html (#hud), styles.css; DESIGN.md "10. UI, menus and progress".
 */
import type { Game } from "../core/game";

const $ = (id: string) => document.getElementById(id)!;
const last = new Map<string, string>();
let msgTimer = 0;

function put(id: string, text: string) {
    if (last.get(id) === text) return;
    last.set(id, text);
    $(id).textContent = text;
}

export function drawHud(g: Game, best: number) {
    put("h-name", `${g.n + 1}. ${g.cavern.name}`);
    put("h-score", String(g.score).padStart(6, "0"));
    put("h-best", String(Math.max(best, g.score)).padStart(6, "0"));
    put("h-crystals", `◆ ${g.left}`);
    put("h-lives", "♥".repeat(Math.max(0, Math.min(g.lives, 9))));
    const f = Math.max(0, g.air / g.cavern.air);
    const w = `${(f * 100).toFixed(1)}%`;
    if (last.get("air") !== w) {
        last.set("air", w);
        $("h-air").style.width = w;
    }
    const low = f < 0.2 && g.phase === "play" ? "1" : "";
    if (last.get("low") !== low) {
        last.set("low", low);
        $("hud").classList.toggle("low-air", !!low);
    }
}

export function message(text: string, ms = 1800) {
    const el = $("h-msg");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(msgTimer);
    msgTimer = window.setTimeout(() => el.classList.remove("show"), ms);
}
