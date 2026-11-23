/**
 * Palette — every colour: a theme per cavern, fixed sprite colours, and UI colours.
 *
 * Purpose
 *   Keeps colour out of the rendering and UI code, so a cavern's whole look (rock, ledges,
 *   copper-bar backdrop, lamp) can be retuned in one place.
 *
 * Operations
 *   - THEMES / themeFor(n): each hand-built cavern has its own theme (THEMES[n]); generated
 *     caverns get a seeded one (golden-ratio hue steps, random styles). A theme sets the rock,
 *     ledge, crumble and belt colours, the backdrop gradient (top to bottom), a glow accent
 *     (edge strips, portal), the rock texture, the back wall's masonry and feature layer,
 *     ambient motes, and the hemisphere light's sky / ground tints.
 *   - COLORS: fixed colours for the miner, guardians, crystals, spikes, lever, door, light.
 *   - hdr(hex, k): a linear RGB triple scaled above 1, for materials that should bloom.
 *   - applyUiColors(): writes COLORS.ui into CSS custom properties at start-up.
 *
 * Usage
 *   render/view.ts reads themeFor(game.n) on every cavern build; styles.css reads the CSS vars.
 *
 * Highlights
 *   - Backdrops are horizontal "copper bars": the colour gradient an Amiga's copper co-processor
 *     drew by changing the palette every scan line. Here they are a canvas gradient on the back wall.
 *   - Crystal colours cycle through CRYSTAL_CYCLE, which is what makes them "flash".
 *
 * See also: render/view.ts, styles.css; DESIGN.md "11. Palette and themes".
 */
import * as THREE from "three";
import { rng } from "./random";

export type RockStyle = "mottled" | "strata" | "brick" | "cobble" | "crystal";
export type BackStyle = "bars" | "strata" | "cave" | "stars" | "pipes" | "veins";
export type MoteKind = "dust" | "spores" | "embers" | "drips" | "bubbles" | "glints";
/** Back-wall masonry, painted procedurally (seeded per cavern) under the gradient. */
export type WallStyle = "brick" | "stone" | "marble" | "rubble" | "slab" | "rough";

export interface Theme {
    name: string;
    rock: number;
    ledge: number;
    crumble: number;
    belt: number;
    /** Edge strips, portal and portal light. */
    glow: number;
    /** Backdrop gradient stops, top to bottom. */
    bars: string[];
    /** Rock block texture pattern. */
    rockStyle: RockStyle;
    /** What is painted on the back wall over the gradient. */
    back: BackStyle;
    /** The back wall's masonry. */
    wall: WallStyle;
    /** Ambient particles drifting through the cavern, and their colour. */
    motes: MoteKind;
    mote: number;
    /** Hemisphere light: sky (from above) and ground (from below) tints. */
    sky: number;
    ground: number;
}

/** Compact theme rows: [name, rock, ledge, crumble, belt, glow, bars, rockStyle, back, motes, mote, sky, ground]. */
type Row = [
    string,
    number,
    number,
    number,
    number,
    number,
    string[],
    RockStyle,
    BackStyle,
    MoteKind,
    number,
    number,
    number,
];

/** Back-wall masonry per hand-built cavern, in cavern order. */
const WALLS: WallStyle[] = [
    "brick",
    "slab",
    "rough",
    "rubble",
    "brick",
    "rough",
    "rubble",
    "rough",
    "brick",
    "stone",
    "rough",
    "stone",
    "marble",
    "slab",
    "stone",
    "brick",
    "slab",
    "marble",
    "rough",
    "marble",
];

/** One theme per hand-built cavern, in cavern order, each chosen to suit its name. */
const ROWS: Row[] = [
    [
        "The Pithead",
        0x7a4a2e,
        0xc98a4b,
        0x9c6b4a,
        0x5d6b78,
        0xffb35c,
        ["#12051a", "#3a0f2e", "#7a2c2c", "#c2602f", "#1a0a12"],
        "mottled",
        "bars",
        "dust",
        0xffd0a0,
        0xffd8b0,
        0x40302a,
    ],
    [
        "Lantern Gallery",
        0x4c5868,
        0x8fa3b8,
        0x6f7c8c,
        0x6a5a48,
        0x7ad7ff,
        ["#030814", "#0b1d3d", "#1f4a7a", "#5a8fc0", "#06101e"],
        "brick",
        "bars",
        "glints",
        0xffe2a0,
        0xc8d4ff,
        0x2a3040,
    ],
    [
        "Drip Hall",
        0x3f5a35,
        0x8cbf5a,
        0x6f8a4a,
        0x5a4d6b,
        0xb6ff6a,
        ["#030d06", "#0d2a14", "#24552a", "#6a9a3a", "#081208"],
        "strata",
        "cave",
        "drips",
        0xa0f0ff,
        0xd0ffc0,
        0x203020,
    ],
    [
        "The Sump",
        0x2e4a4a,
        0x6a9a8a,
        0x4a6a62,
        0x6a5a3a,
        0x5affc0,
        ["#010808", "#04201e", "#0a3a36", "#1a6a5a", "#020c0a"],
        "cobble",
        "strata",
        "bubbles",
        0x8affe0,
        0xa0fff0,
        0x0a2020,
    ],
    [
        "Conveyor Run",
        0x4a4a52,
        0xb0a890,
        0x7a7468,
        0x3a4a5a,
        0xffc040,
        ["#08080a", "#1c1a1e", "#3a3036", "#6a5040", "#0c0a0c"],
        "brick",
        "pipes",
        "dust",
        0xffe0b0,
        0xfff0d8,
        0x302824,
    ],
    [
        "Fungus Vault",
        0x3e2e52,
        0x9a7ac0,
        0x6a5a80,
        0x4a6b5a,
        0xe07aff,
        ["#06020c", "#1a0a2e", "#3a1a5a", "#6a3a8a", "#0a0412"],
        "mottled",
        "stars",
        "spores",
        0xc0ff6a,
        0xe0c0ff,
        0x201830,
    ],
    [
        "Collapsed Seam",
        0x8a6a3e,
        0xe0c07a,
        0xb0905a,
        0x5a5a7a,
        0xffe07a,
        ["#140c04", "#3d2a0a", "#8a5a1a", "#e0a040", "#1a1206"],
        "strata",
        "strata",
        "dust",
        0xfff0c0,
        0xfff0d0,
        0x4a3a20,
    ],
    [
        "Glowworm Grotto",
        0x22303e,
        0x5a7a9a,
        0x3e5468,
        0x6a4a5a,
        0x6af0ff,
        ["#010206", "#030a18", "#081a30", "#10304a", "#02060c"],
        "cobble",
        "stars",
        "glints",
        0x8af8ff,
        0x9ad0ff,
        0x0a1018,
    ],
    [
        "Bellows Shaft",
        0x6b2e22,
        0xd0643a,
        0x8c4a34,
        0x4a5a5a,
        0xff7a3d,
        ["#140404", "#3d0a0a", "#801f12", "#d65a1f", "#1a0606"],
        "brick",
        "pipes",
        "embers",
        0xff8a3a,
        0xffc0a0,
        0x401810,
    ],
    [
        "Ironroot Cellar",
        0x4a3a32,
        0x9a6a4a,
        0x6a5244,
        0x5a6a6a,
        0xff9a5a,
        ["#080404", "#1e100c", "#3a2018", "#6a3a22", "#0c0606"],
        "cobble",
        "veins",
        "dust",
        0xffb080,
        0xf0c8b0,
        0x2a1a14,
    ],
    [
        "The Crucible",
        0x3a2424,
        0xc04a3a,
        0x7a3a34,
        0x5a5a5a,
        0xff5a3a,
        ["#0a0202", "#2a0606", "#6a0a0a", "#ff4a1a", "#120404"],
        "strata",
        "cave",
        "embers",
        0xff6a2a,
        0xffa080,
        0x501008,
    ],
    [
        "Echo Chamber",
        0x2e3466,
        0x7a8ae0,
        0x5a62a0,
        0x6a6a3a,
        0x8aa0ff,
        ["#03040e", "#0c1240", "#22308a", "#6a7ae0", "#060818"],
        "mottled",
        "cave",
        "dust",
        0xb0c0ff,
        0xc0c8ff,
        0x181c40,
    ],
    [
        "Quartz Stair",
        0x6a5a66,
        0xf0d8e8,
        0xb09aaa,
        0x4a5a6a,
        0xffb0e0,
        ["#100810", "#2a1428", "#4a2a48", "#a07aa0", "#140a14"],
        "crystal",
        "veins",
        "glints",
        0xffe0f8,
        0xffe8f8,
        0x3a2a38,
    ],
    [
        "Flooded Adit",
        0x2e5a52,
        0x6ac0a8,
        0x4a8a7a,
        0x7a5a3a,
        0x6affd0,
        ["#020e0c", "#082e28", "#126a5a", "#4ac0a0", "#041612"],
        "strata",
        "strata",
        "bubbles",
        0xa0fff0,
        0xb0fff0,
        0x0a2a28,
    ],
    [
        "Bat Belfry",
        0x3a2e40,
        0x8a7a90,
        0x5e5266,
        0x5a6a4a,
        0xff9a6a,
        ["#06030a", "#1a0e24", "#3e1e3e", "#8a3e4a", "#0a0610"],
        "brick",
        "cave",
        "dust",
        0xd0b0c0,
        0xffc8c0,
        0x201424,
    ],
    [
        "Furnace Floor",
        0x4a2a1a,
        0xe08a3a,
        0x9a5a2a,
        0x4a4a52,
        0xffa020,
        ["#100400", "#3a1000", "#8a3000", "#ff8a10", "#160600"],
        "brick",
        "pipes",
        "embers",
        0xffb040,
        0xffd090,
        0x602000,
    ],
    [
        "The Winding Gear",
        0x52483a,
        0xc8a860,
        0x8a7a54,
        0x3a4a5a,
        0xffd06a,
        ["#0a0804", "#221a0c", "#4a3a18", "#9a7a30", "#0e0a06"],
        "brick",
        "pipes",
        "dust",
        0xffe8a0,
        0xfff0c0,
        0x3a3018,
    ],
    [
        "Moonstone Cut",
        0x4a5260,
        0xd0dcf0,
        0x8a96aa,
        0x6a5a48,
        0xd0e8ff,
        ["#04060c", "#10162a", "#24304e", "#6a7aa0", "#080a14"],
        "crystal",
        "stars",
        "glints",
        0xe8f0ff,
        0xe0e8ff,
        0x202838,
    ],
    [
        "Deep Vein",
        0x1e2a24,
        0x4a8a6a,
        0x325a48,
        0x6a4a3a,
        0x3aff9a,
        ["#000402", "#021008", "#062214", "#0e4028", "#010604"],
        "crystal",
        "veins",
        "spores",
        0x6affb0,
        0x90ffc8,
        0x081810,
    ],
    [
        "Heart of the Hill",
        0x4a1a22,
        0xe0b040,
        0x8a4a3a,
        0x3a3a52,
        0xffd040,
        ["#0a0204", "#2a0610", "#5a0a1e", "#c03a2a", "#10040a"],
        "crystal",
        "veins",
        "embers",
        0xffd060,
        0xffd0a0,
        0x400a14,
    ],
];

export const THEMES: Theme[] = ROWS.map(
    ([name, rock, ledge, crumble, belt, glow, bars, rockStyle, back, motes, mote, sky, ground], i) => ({
        wall: WALLS[i],
        name,
        rock,
        ledge,
        crumble,
        belt,
        glow,
        bars,
        rockStyle,
        back,
        motes,
        mote,
        sky,
        ground,
    })
);

const ROCK_STYLES: RockStyle[] = ["mottled", "strata", "brick", "cobble", "crystal"];
const BACK_STYLES: BackStyle[] = ["bars", "strata", "cave", "stars", "pipes", "veins"];
const MOTES: MoteKind[] = ["dust", "spores", "embers", "drips", "bubbles", "glints"];
const WALL_STYLES: WallStyle[] = ["brick", "stone", "marble", "rubble", "slab", "rough"];

/** A seeded theme for generated caverns (n ≥ 20): its own hue, styles and motes. */
function generatedTheme(n: number): Theme {
    const r = rng(n * 7919 + 13);
    const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
    const col = (h: number, s: number, l: number) => new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l);
    const hex = (h: number, s: number, l: number) => col(h, s, l).getHex();
    const css = (h: number, s: number, l: number) => `#${col(h, s, l).getHexString()}`;
    // Golden-ratio hue steps keep neighbouring caverns far apart on the colour wheel.
    const h = (n * 0.618034) % 1;
    const sat = 0.3 + r() * 0.4;
    const bh = h + (r() - 0.5) * 0.15;
    return {
        name: `Cavern ${n + 1}`,
        rock: hex(h, sat * 0.7, 0.22 + r() * 0.12),
        ledge: hex(h + 0.04, sat, 0.55 + r() * 0.15),
        crumble: hex(h, sat * 0.6, 0.4),
        belt: hex(h + 0.5, 0.15, 0.4),
        glow: hex(h + (r() - 0.5) * 0.2, 1, 0.65),
        bars: [
            css(bh, 0.6, 0.03),
            css(bh, 0.6, 0.1),
            css(bh + 0.03, 0.55, 0.22),
            css(bh + 0.06, 0.6, 0.45),
            css(bh, 0.6, 0.05),
        ],
        rockStyle: pick(ROCK_STYLES),
        back: pick(BACK_STYLES),
        wall: pick(WALL_STYLES),
        motes: pick(MOTES),
        mote: hex(h + 0.1, 0.8, 0.75),
        sky: hex(h, 0.35, 0.82),
        ground: hex(h + 0.5, 0.3, 0.15),
    };
}

export const COLORS = {
    overalls: 0x2f6fd6,
    shirt: 0xe0e4ea,
    skin: 0xf0b890,
    helmet: 0xf2c230,
    boots: 0x3a2a20,
    lamp: 0xfff2c0,
    lampLight: 0xffe0a0,
    /** Lamp blink while a fall is already fatal. */
    lampDanger: 0xff3020,
    /** Landing / jump dust (dim so the additive sparks stay under the bloom threshold). */
    dust: 0x5a5046,
    spike: 0xb8c0cc,
    spikeTip: 0xff3a3a,
    lever: 0xd0d0d8,
    leverOn: 0x5aff7a,
    door: 0x8a5a2a,
    doorGlow: 0xffa040,
    portalClosed: 0x3a3a4a,
    guardianEye: 0xff3a5a,
    crystalCycle: [0x66f0ff, 0xff6ad0, 0xffe066, 0x7aff8a, 0xffffff],
    ui: {
        bg: "#07050d",
        ink: "#f2ecff",
        dim: "#a89cc0",
        accent: "#ffd25a",
        air: "#5ae0ff",
        danger: "#ff4a6a",
    },
};

export function themeFor(n: number): Theme {
    return n < THEMES.length ? THEMES[n] : generatedTheme(n);
}

/** Linear-space colour scaled by k (k > 1 crosses the bloom threshold). */
export function hdr(hex: number, k: number) {
    return new THREE.Color(hex).multiplyScalar(k);
}

export function applyUiColors() {
    const s = document.documentElement.style;
    for (const [k, v] of Object.entries(COLORS.ui)) s.setProperty(`--${k}`, v);
}
