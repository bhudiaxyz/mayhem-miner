/**
 * Save — localStorage progress: best score and the deepest cavern reached.
 *
 * Purpose
 *   Lets the main menu offer Continue (from the deepest cavern reached, with fresh lives and
 *   score) and show the best score.
 *
 * Operations
 *   - save: the loaded state { best, reached, seenHelp }, merged over defaults so new fields
 *     never break an old save.
 *   - record(score, n): raises best and reached; writes only when something changed.
 *   - markHelpSeen(): first-run How to play is shown once.
 *
 * Highlights
 *   - Every read and write is try / caught (private mode, quota): progress is nice to have,
 *     never a reason to crash.
 *
 * See also: main.ts (menu, game over); DESIGN.md "10. UI, menus and progress".
 */
const KEY = "mm-save";

export interface Save {
    best: number;
    /** Deepest cavern index reached (0-based). */
    reached: number;
    seenHelp: boolean;
}

export const save: Save = load();

function load(): Save {
    const base: Save = { best: 0, reached: 0, seenHelp: false };
    try {
        return { ...base, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch {
        return base;
    }
}

function write() {
    try {
        localStorage.setItem(KEY, JSON.stringify(save));
    } catch {
        /* private mode or quota: play on */
    }
}

export function record(score: number, n: number) {
    if (score <= save.best && n <= save.reached) return;
    save.best = Math.max(save.best, score);
    save.reached = Math.max(save.reached, n);
    write();
}

export function markHelpSeen() {
    save.seenHelp = true;
    write();
}
