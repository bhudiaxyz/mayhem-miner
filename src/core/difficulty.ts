/**
 * Difficulty — one curve for every cavern: bands of ten, from very easy to full Mayhem.
 *
 * Purpose
 *   Every per-cavern knob comes from difficulty(n), so the game starts very easy and adds
 *   complexity and difficulty steadily, one band of ten caverns at a time.
 *
 * Operations
 *   - difficulty(n): the knobs for cavern n (0-based). With band = ⌊n / 10⌋ and
 *     within = (n mod 10) / 9, progress is t = (band + 0.2·within) / 9.2: inside a band
 *     difficulty creeps up only 20% of a band step, each new band is a clear step up, and
 *     the curve saturates at cavern 100 (MAX_DIFFICULTY_AT).
 *   - Knobs that apply to every cavern: guardian speed, bonus air (band 1 only) and the
 *     creature roster. Hand-built caverns (1-20) keep their authored layouts. Knobs that
 *     shape generated caverns (21+): air, crystals, guardian counts, crumble / conveyor
 *     odds, spikes, pillars and sprinters.
 *   - New mechanics arrive at the start of a band, so each is met on its own: fliers in
 *     generated caverns from 31 (band 4), sprinting guardians from 41 (band 5).
 *   - BAND_NAMES: the intro card's label for each band ("Very easy" … "Mayhem").
 *
 * Usage
 *   core/game.ts (guardian speed, air bonus), world/generate.ts (layout knobs),
 *   render/characters.ts (which creatures appear), ui/menu.ts (band label).
 *
 * See also: scripts/check.ts (the curve never eases); DESIGN.md "7. Generation and difficulty".
 */

export const BAND = 10;
/** Cavern number (1-based) where the curve reaches full difficulty and holds. */
export const MAX_DIFFICULTY_AT = 100;
const WITHIN = 0.2;

export const BAND_NAMES = [
    "Very easy",
    "Easy",
    "Steady",
    "Tricky",
    "Hard",
    "Harder",
    "Very hard",
    "Brutal",
    "Fiendish",
    "Mayhem",
];

export interface Difficulty {
    /** 0..1 progress along the curve. */
    t: number;
    /** 1-based band (1 = caverns 1-10). */
    band: number;
    /** Guardian px per tick. */
    guardianSpeed: number;
    /** Extra seconds of air on hand-built caverns (band 1's cushion). */
    airBonus: number;
    // Generated caverns only:
    air: number;
    crystals: number;
    walkers: number;
    lifts: number;
    fliers: number;
    /** Chance a ledge segment is crumbling / a conveyor. */
    crumble: number;
    conveyor: number;
    floorSpikes: number;
    /** Chance of a spike on a long ledge. */
    ledgeSpikes: number;
    pillars: number;
    /** Guardians per cavern that move at SPRINT × speed. */
    sprinters: number;
}

/** Sprinting guardians move this much faster. */
export const SPRINT = 1.5;

export function difficulty(n: number): Difficulty {
    const bands = MAX_DIFFICULTY_AT / BAND;
    const k = Math.min(Math.max(n, 0), MAX_DIFFICULTY_AT - 1);
    const band = Math.floor(k / BAND),
        within = (k % BAND) / (BAND - 1);
    const t = (band + WITHIN * within) / (bands - 1 + WITHIN);
    const L = (a: number, b: number) => a + (b - a) * t;
    const R = (a: number, b: number) => Math.round(L(a, b));
    return {
        t,
        band: band + 1,
        guardianSpeed: L(0.5, 1.15),
        airBonus: band === 0 ? 15 : 0,
        air: R(66, 40),
        crystals: R(5, 12),
        walkers: R(1, 5),
        lifts: R(0, 3),
        // New mechanics, a band at a time.
        fliers: n < 3 * BAND ? 0 : R(1, 3),
        sprinters: n < 4 * BAND ? 0 : R(1, 3),
        crumble: L(0.06, 0.4),
        conveyor: L(0.1, 0.24),
        floorSpikes: R(1, 7),
        ledgeSpikes: L(0.15, 0.55),
        pillars: R(0, 4),
    };
}

export const bandName = (n: number) => BAND_NAMES[difficulty(n).band - 1];
