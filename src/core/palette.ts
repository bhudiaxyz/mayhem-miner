/**
 * Palette — every colour: twelve cavern themes, fixed sprite colours, and UI colours.
 *
 * Purpose
 *   Keeps colour out of the rendering and UI code, so a cavern's whole look (rock, ledges,
 *   copper-bar backdrop, lamp) can be retuned in one place.
 *
 * Operations
 *   - THEMES / themeFor(n): cavern n uses THEMES[n % 12]. Each theme has the rock, ledge,
 *     crumble and belt colours, the backdrop's copper-bar stops (top to bottom) and a glow
 *     accent used for edge strips and the portal.
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

export interface Theme {
    name: string;
    rock: number;
    ledge: number;
    crumble: number;
    belt: number;
    glow: number;
    bars: string[];
}

export const THEMES: Theme[] = [
    {
        name: "Umber",
        rock: 0x7a4a2e,
        ledge: 0xc98a4b,
        crumble: 0x9c6b4a,
        belt: 0x5d6b78,
        glow: 0xffb35c,
        bars: ["#12051a", "#3a0f2e", "#7a2c2c", "#c2602f", "#1a0a12"],
    },
    {
        name: "Slate",
        rock: 0x4c5868,
        ledge: 0x8fa3b8,
        crumble: 0x6f7c8c,
        belt: 0x6a5a48,
        glow: 0x7ad7ff,
        bars: ["#030814", "#0b1d3d", "#1f4a7a", "#5a8fc0", "#06101e"],
    },
    {
        name: "Moss",
        rock: 0x3f5a35,
        ledge: 0x8cbf5a,
        crumble: 0x6f8a4a,
        belt: 0x5a4d6b,
        glow: 0xb6ff6a,
        bars: ["#030d06", "#0d2a14", "#24552a", "#6a9a3a", "#081208"],
    },
    {
        name: "Rust",
        rock: 0x6b2e22,
        ledge: 0xd0643a,
        crumble: 0x8c4a34,
        belt: 0x4a5a5a,
        glow: 0xff7a3d,
        bars: ["#140404", "#3d0a0a", "#801f12", "#d65a1f", "#1a0606"],
    },
    {
        name: "Amethyst",
        rock: 0x4a3566,
        ledge: 0xa07ad6,
        crumble: 0x6e5a8c,
        belt: 0x4a6b5a,
        glow: 0xd09aff,
        bars: ["#0a0414", "#22104a", "#4a2a8a", "#9a5ad0", "#100820"],
    },
    {
        name: "Sandstone",
        rock: 0x8a6a3e,
        ledge: 0xe0c07a,
        crumble: 0xb0905a,
        belt: 0x5a5a7a,
        glow: 0xffe07a,
        bars: ["#140c04", "#3d2a0a", "#8a5a1a", "#e0a040", "#1a1206"],
    },
    {
        name: "Glacier",
        rock: 0x3e6070,
        ledge: 0x9ae0f0,
        crumble: 0x6a9aaa,
        belt: 0x6a4a5a,
        glow: 0x9af6ff,
        bars: ["#020a10", "#08283a", "#1a6080", "#7ad0e8", "#04121a"],
    },
    {
        name: "Ember",
        rock: 0x3a2424,
        ledge: 0xc04a3a,
        crumble: 0x7a3a34,
        belt: 0x5a5a5a,
        glow: 0xff5a3a,
        bars: ["#0a0202", "#2a0606", "#6a0a0a", "#ff4a1a", "#120404"],
    },
    {
        name: "Verdigris",
        rock: 0x2e5a52,
        ledge: 0x6ac0a8,
        crumble: 0x4a8a7a,
        belt: 0x7a5a3a,
        glow: 0x6affd0,
        bars: ["#020e0c", "#082e28", "#126a5a", "#4ac0a0", "#041612"],
    },
    {
        name: "Coal",
        rock: 0x2c2c34,
        ledge: 0x8a8aa0,
        crumble: 0x5a5a6a,
        belt: 0x6a4a3a,
        glow: 0xffd06a,
        bars: ["#050508", "#14141e", "#2a2a40", "#6a6a90", "#08080c"],
    },
    {
        name: "Rose",
        rock: 0x6a3a4a,
        ledge: 0xe08aa0,
        crumble: 0xa06a7a,
        belt: 0x4a5a6a,
        glow: 0xff8ac0,
        bars: ["#12040a", "#3a0a22", "#7a2048", "#e06a9a", "#1a0610"],
    },
    {
        name: "Indigo",
        rock: 0x2e3466,
        ledge: 0x7a8ae0,
        crumble: 0x5a62a0,
        belt: 0x6a6a3a,
        glow: 0x8aa0ff,
        bars: ["#03040e", "#0c1240", "#22308a", "#6a7ae0", "#060818"],
    },
];

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

export function themeFor(n: number) {
    return THEMES[n % THEMES.length];
}

/** Linear-space colour scaled by k (k > 1 crosses the bloom threshold). */
export function hdr(hex: number, k: number) {
    return new THREE.Color(hex).multiplyScalar(k);
}

export function applyUiColors() {
    const s = document.documentElement.style;
    for (const [k, v] of Object.entries(COLORS.ui)) s.setProperty(`--${k}`, v);
}
