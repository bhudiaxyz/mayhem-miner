/**
 * Paint — procedural canvas textures for a cavern: rock tiles and the layered back wall.
 *
 * Purpose
 *   Gives every cavern its own surfaces without image files. Everything is painted at
 *   runtime from a seed derived from the cavern's name, so a cavern always looks the same.
 *
 * Operations
 *   - seedOf(name): FNV-1a hash of a cavern name, the seed for everything below.
 *   - canvasTex(size, paint, seed): a nearest-filtered, repeating canvas texture.
 *   - rockTexture(style, seed): a 16 × 16 greyscale rock tile (tinted per block instance):
 *     mottled, strata, brick, cobble or crystal.
 *   - backdropTextures(theme, seed): the back wall, 16 px per cell, in three layers:
 *       1. the theme gradient, quantised into flat bands (the copper-bar look);
 *       2. masonry (theme.wall): brick, stone (ashlar), marble, rubble, slab or rough-hewn,
 *          painted as light / dark overlays so the gradient tints it;
 *       3. a feature (theme.back): bars (none), strata waves, cave stalactites, glowworm
 *          stars, pipes or ore veins.
 *     Returns { map, glow }: glow is an emissive map holding only what should shine
 *     (stars, veins), so it glows whatever the lighting.
 *
 * Usage
 *   render/view.ts build(): rock = rockTexture(th.rockStyle, seed); back wall material uses
 *   backdropTextures(th, seed). View disposes them when the cavern changes.
 *
 * See also: core/palette.ts (Theme), render/view.ts; DESIGN.md "11. Palette and themes".
 */
import * as THREE from "three";
import { rng } from "../core/random";
import type { RockStyle, Theme } from "../core/palette";

type Ctx = CanvasRenderingContext2D;

export function seedOf(name: string) {
    let h = 0x811c9dc5;
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
    return h >>> 0;
}

export function canvasTex(size: number | [number, number], paint: (g: Ctx, r: () => number) => void, seed: number) {
    const [w, h] = typeof size === "number" ? [size, size] : size;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    paint(c.getContext("2d")!, rng(seed));
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

const grey = (v: number, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;
const shade = (r: () => number, k: number) => (r() < 0.5 ? `rgba(0,0,0,${r() * k})` : `rgba(255,255,255,${r() * k})`);

function speckle(g: Ctx, r: () => number, n: number, lo: number, hi: number, size = 16) {
    for (let i = 0; i < n; i++) {
        g.fillStyle = grey(lo + r() * (hi - lo));
        g.fillRect(Math.floor(r() * size), Math.floor(r() * size), 1, 1);
    }
}

function bevel(g: Ctx) {
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(0, 0, 16, 1);
    g.fillRect(0, 0, 1, 16);
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.fillRect(0, 15, 16, 1);
    g.fillRect(15, 0, 1, 16);
}

// ---- Rock tiles (16 × 16) ---------------------------------------------------------------------------

const ROCK: Record<RockStyle, (g: Ctx, r: () => number) => void> = {
    mottled: (g, r) => {
        g.fillStyle = grey(200);
        g.fillRect(0, 0, 16, 16);
        for (let i = 0; i < 14; i++) {
            g.fillStyle = grey(140 + r() * 90);
            g.fillRect(Math.floor(r() * 15), Math.floor(r() * 15), 2, 2);
        }
        speckle(g, r, 50, 150, 235);
    },
    strata: (g, r) => {
        for (let y = 0; y < 16;) {
            const h = 2 + Math.floor(r() * 3);
            g.fillStyle = grey(150 + r() * 90);
            g.fillRect(0, y, 16, h);
            // A wobble: the band edge steps up or down a pixel here and there.
            g.fillStyle = grey(130 + r() * 60);
            for (let x = 0; x < 16; x += 3 + Math.floor(r() * 4)) g.fillRect(x, y, 2, 1);
            y += h;
        }
        speckle(g, r, 25, 120, 230);
    },
    brick: (g, r) => {
        g.fillStyle = grey(110);
        g.fillRect(0, 0, 16, 16);
        for (let row = 0; row < 2; row++)
            for (let k = -1; k < 2; k++) {
                const x = k * 8 + (row ? 4 : 0);
                g.fillStyle = grey(170 + r() * 70);
                g.fillRect(x + 1, row * 8 + 1, 7, 6);
            }
        speckle(g, r, 30, 140, 230);
    },
    cobble: (g, r) => {
        g.fillStyle = grey(90);
        g.fillRect(0, 0, 16, 16);
        for (let i = 0; i < 7; i++) {
            const x = r() * 16,
                y = r() * 16,
                rad = 2.5 + r() * 2.5;
            g.fillStyle = grey(160 + r() * 80);
            g.beginPath();
            g.ellipse(x, y, rad, rad * (0.7 + r() * 0.3), r() * 3, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = "rgba(255,255,255,0.25)";
            g.fillRect(Math.floor(x - rad / 2), Math.floor(y - rad / 2), 2, 1);
        }
    },
    crystal: (g, r) => {
        g.fillStyle = grey(130);
        g.fillRect(0, 0, 16, 16);
        // Facets: bright diagonal streaks of varying length, then a couple of glints.
        for (let i = 0; i < 6; i++) {
            const x = Math.floor(r() * 16),
                y = Math.floor(r() * 16),
                len = 3 + Math.floor(r() * 6),
                v = 180 + r() * 75;
            for (let k = 0; k < len; k++) {
                g.fillStyle = grey(v - k * 6);
                g.fillRect((x + k) % 16, (y + k) % 16, 1, 1);
                g.fillStyle = grey(v * 0.7);
                g.fillRect((x + k + 1) % 16, (y + k) % 16, 1, 1);
            }
        }
        speckle(g, r, 4, 250, 255);
    },
};

export function rockTexture(style: RockStyle, seed: number) {
    return canvasTex(16, (g, r) => (ROCK[style](g, r), bevel(g)), seed);
}

// ---- Back wall (32 × 16 cells at 16 px a cell) ------------------------------------------------------

const BW = 512,
    BH = 256;

function wall(g: Ctx, r: () => number, style: Theme["wall"]) {
    const mortar = "rgba(0,0,0,0.32)";
    if (style === "brick") {
        for (let y = 0, row = 0; y < BH; y += 8, row++)
            for (let x = row % 2 ? -8 : 0; x < BW; x += 16) {
                g.fillStyle = shade(r, 0.12);
                g.fillRect(x, y, 16, 8);
                g.fillStyle = mortar;
                g.fillRect(x, y, 16, 1);
                g.fillRect(x, y, 1, 8);
            }
    } else if (style === "stone") {
        // Ashlar: courses of random height, blocks of random width.
        for (let y = 0; y < BH;) {
            const h = 12 + Math.floor(r() * 4) * 4;
            for (let x = -Math.floor(r() * 24); x < BW;) {
                const w = 20 + Math.floor(r() * 8) * 4;
                g.fillStyle = shade(r, 0.14);
                g.fillRect(x, y, w, h);
                g.fillStyle = mortar;
                g.fillRect(x, y, w, 2);
                g.fillRect(x, y, 2, h);
                g.fillStyle = "rgba(255,255,255,0.06)";
                g.fillRect(x + 2, y + 2, w - 2, 1);
                x += w;
            }
            y += h;
        }
    } else if (style === "marble") {
        for (let y = 0; y < BH; y += 64)
            for (let x = 0; x < BW; x += 64) {
                g.fillStyle = shade(r, 0.08);
                g.fillRect(x, y, 64, 64);
                g.fillStyle = "rgba(0,0,0,0.2)";
                g.fillRect(x, y, 64, 1);
                g.fillRect(x, y, 1, 64);
            }
        // Veins: wandering, occasionally forking light lines.
        for (let i = 0; i < 14; i++) {
            let x = r() * BW,
                y = r() * BH,
                a = r() * Math.PI * 2;
            const len = 40 + r() * 120;
            g.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.12})`;
            for (let k = 0; k < len; k++) {
                a += (r() - 0.5) * 0.5;
                x += Math.cos(a);
                y += Math.sin(a);
                g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
                if (r() < 0.01) a += (r() - 0.5) * 2;
            }
        }
    } else if (style === "rubble") {
        g.fillStyle = "rgba(0,0,0,0.25)";
        g.fillRect(0, 0, BW, BH);
        for (let i = 0; i < 900; i++) {
            const x = r() * BW,
                y = r() * BH,
                rad = 3 + r() * 6;
            g.fillStyle = shade(r, 0.16);
            g.beginPath();
            g.ellipse(x, y, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = "rgba(255,255,255,0.08)";
            g.fillRect(Math.floor(x - rad / 2), Math.floor(y - rad / 2), Math.ceil(rad), 1);
        }
    } else if (style === "slab") {
        for (let y = 0; y < BH; y += 48)
            for (let x = (y / 48) % 2 ? -32 : 0; x < BW; x += 64) {
                g.fillStyle = shade(r, 0.1);
                g.fillRect(x, y, 64, 48);
                g.fillStyle = "rgba(255,255,255,0.12)";
                g.fillRect(x + 1, y + 1, 62, 2);
                g.fillRect(x + 1, y + 1, 2, 46);
                g.fillStyle = "rgba(0,0,0,0.3)";
                g.fillRect(x, y + 46, 64, 2);
                g.fillRect(x + 62, y, 2, 48);
                if (r() < 0.35) crack(g, r, x + 8 + r() * 48, y + 4, 30);
            }
    } else {
        // Rough-hewn: blotches and short chisel marks, no grid.
        for (let i = 0; i < 500; i++) {
            g.fillStyle = shade(r, 0.1);
            g.fillRect(Math.floor(r() * BW), Math.floor(r() * BH), 2 + Math.floor(r() * 8), 2 + Math.floor(r() * 6));
        }
        g.fillStyle = "rgba(0,0,0,0.22)";
        for (let i = 0; i < 260; i++)
            g.fillRect(Math.floor(r() * BW), Math.floor(r() * BH), 3 + Math.floor(r() * 6), 1);
    }
}

function crack(g: Ctx, r: () => number, x: number, y: number, len: number) {
    g.fillStyle = "rgba(0,0,0,0.4)";
    for (let k = 0; k < len; k++) {
        x += (r() - 0.5) * 2;
        y += 1;
        g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
}

function feature(g: Ctx, glow: Ctx, r: () => number, th: Theme) {
    const accent = `#${new THREE.Color(th.mote).getHexString()}`;
    const vein = `#${new THREE.Color(th.glow).getHexString()}`;
    if (th.back === "strata") {
        // Wavy sediment layers across the whole wall.
        for (let k = 0; k < 9; k++) {
            const y0 = (k + r()) * (BH / 9),
                amp = 3 + r() * 8,
                f = 0.01 + r() * 0.02,
                ph = r() * 6;
            g.fillStyle = k % 2 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.06)";
            g.beginPath();
            g.moveTo(0, BH);
            for (let x = 0; x <= BW; x += 8) g.lineTo(x, y0 + Math.sin(x * f + ph) * amp);
            g.lineTo(BW, BH);
            g.fill();
        }
    } else if (th.back === "cave") {
        // Stalactites from the ceiling, stalagmites from the floor (dark silhouettes).
        g.fillStyle = "rgba(0,0,0,0.42)";
        for (let x = 0; x < BW; x += 6 + r() * 18) {
            const w = 6 + r() * 14,
                h = 10 + r() * 50;
            g.beginPath();
            g.moveTo(x, 16);
            g.lineTo(x + w / 2, 16 + h);
            g.lineTo(x + w, 16);
            g.fill();
            if (r() < 0.5) {
                const h2 = 6 + r() * 26;
                g.beginPath();
                g.moveTo(x, BH - 16);
                g.lineTo(x + w / 2, BH - 16 - h2);
                g.lineTo(x + w, BH - 16);
                g.fill();
            }
        }
    } else if (th.back === "stars") {
        g.fillStyle = "rgba(0,0,0,0.3)";
        g.fillRect(0, 0, BW, BH);
        // Glowworms: clusters of tiny lights, brighter toward the ceiling.
        for (let c = 0; c < 22; c++) {
            const cx = r() * BW,
                cy = 16 + r() * r() * (BH - 32);
            for (let i = 0; i < 12; i++) {
                const x = Math.floor(cx + (r() - 0.5) * 60),
                    y = Math.floor(cy + (r() - 0.5) * 30),
                    s = r() < 0.2 ? 2 : 1;
                for (const ctx of [g, glow]) {
                    ctx.fillStyle = accent;
                    ctx.globalAlpha = 0.5 + r() * 0.5;
                    ctx.fillRect(x, y, s, s);
                }
            }
        }
        g.globalAlpha = glow.globalAlpha = 1;
    } else if (th.back === "pipes") {
        for (let x = 24 + r() * 40; x < BW - 12; x += 70 + r() * 90) {
            const w = 8 + Math.floor(r() * 3) * 2;
            const grad = g.createLinearGradient(x, 0, x + w, 0);
            grad.addColorStop(0, "rgba(20,20,26,0.75)");
            grad.addColorStop(0.35, "rgba(150,150,160,0.55)");
            grad.addColorStop(1, "rgba(10,10,14,0.8)");
            g.fillStyle = grad;
            g.fillRect(x, 0, w, BH);
            g.fillStyle = "rgba(0,0,0,0.5)";
            for (let y = r() * 40; y < BH; y += 36 + r() * 30) g.fillRect(x - 2, y, w + 4, 4);
        }
        const y = 60 + r() * 120;
        g.fillStyle = "rgba(20,20,26,0.6)";
        g.fillRect(0, y, BW, 8);
        g.fillStyle = "rgba(200,200,210,0.18)";
        g.fillRect(0, y + 2, BW, 2);
    } else if (th.back === "veins") {
        // Ore veins: jagged glowing seams with nuggets along them.
        for (let i = 0; i < 7; i++) {
            let x = r() * BW,
                y = 16 + r() * (BH - 32),
                a = (r() - 0.5) * 1.2;
            const len = 80 + r() * 200;
            for (let k = 0; k < len; k++) {
                a += (r() - 0.5) * 0.6;
                x += Math.cos(a) * 1.5;
                y += Math.sin(a);
                const s = r() < 0.06 ? 3 : 2;
                for (const ctx of [g, glow]) {
                    ctx.fillStyle = vein;
                    ctx.globalAlpha = ctx === g ? 0.55 : 0.5;
                    ctx.fillRect(Math.floor(x), Math.floor(y), s, s);
                }
            }
        }
        g.globalAlpha = glow.globalAlpha = 1;
    }
}

export function backdropTextures(th: Theme, seed: number) {
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = BW;
    glowCanvas.height = BH;
    const glow = glowCanvas.getContext("2d")!;
    glow.fillStyle = "#000";
    glow.fillRect(0, 0, BW, BH);
    const map = canvasTex(
        [BW, BH],
        (g, r) => {
            const grad = g.createLinearGradient(0, 0, 0, BH);
            th.bars.forEach((s, i) => grad.addColorStop(i / (th.bars.length - 1), s));
            g.fillStyle = grad;
            g.fillRect(0, 0, BW, BH);
            // Quantise into flat bands, the copper-list look.
            const img = g.getImageData(0, 0, 1, BH).data;
            for (let y = 0; y < BH; y += 8) {
                g.fillStyle = `rgb(${img[y * 4]},${img[y * 4 + 1]},${img[y * 4 + 2]})`;
                g.fillRect(0, y, BW, 8);
            }
            wall(g, r, th.wall);
            feature(g, glow, r, th);
        },
        seed
    );
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    glowTex.magFilter = THREE.NearestFilter;
    glowTex.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    return { map, glow: glowTex };
}
